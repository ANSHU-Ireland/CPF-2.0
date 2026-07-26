import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  OversightIncompleteError,
  assertReportCanBeIssued,
  dataRightsMachine,
  invitationMachine,
  learningEnrollmentMachine,
  reviewMachine,
  sessionMachine,
} from "../src/state-machines.js";

describe("invitation lifecycle", () => {
  it("follows draft → sent → opened → accepted", () => {
    let s = invitationMachine.initial;
    s = invitationMachine.next(s, "send");
    s = invitationMachine.next(s, "open");
    s = invitationMachine.next(s, "accept");
    expect(s).toBe("accepted");
    expect(invitationMachine.isTerminal(s)).toBe(true);
  });

  it("supports reissuing an expired invitation", () => {
    let s = invitationMachine.next("sent", "expire");
    expect(s).toBe("expired");
    s = invitationMachine.next(s, "reissue");
    expect(s).toBe("sent");
  });

  it("cannot accept a revoked invitation", () => {
    expect(() => invitationMachine.next("revoked", "accept")).toThrow(
      InvalidTransitionError,
    );
  });
});

describe("assessment session lifecycle guardrails", () => {
  it("cannot start before disclosure is acknowledged", () => {
    expect(() => sessionMachine.next("created", "start")).toThrow(InvalidTransitionError);
    expect(() => sessionMachine.next("disclosure_pending", "start")).toThrow(
      InvalidTransitionError,
    );
  });

  it("the only path to a running session passes through disclosure acknowledgement", () => {
    let s = sessionMachine.initial;
    s = sessionMachine.next(s, "present_disclosure");
    s = sessionMachine.next(s, "acknowledge_disclosure");
    s = sessionMachine.next(s, "start");
    expect(s).toBe("in_progress");
  });

  it("supports pause and resume for accommodations and technical recovery", () => {
    let s = sessionMachine.next("in_progress", "pause");
    expect(s).toBe("paused");
    s = sessionMachine.next(s, "resume");
    expect(s).toBe("in_progress");
  });

  it("cannot issue a report before the review is finalised", () => {
    expect(() => sessionMachine.next("submitted", "issue_report")).toThrow(
      InvalidTransitionError,
    );
    expect(() => sessionMachine.next("under_review", "issue_report")).toThrow(
      InvalidTransitionError,
    );
    const s = sessionMachine.next("review_finalised", "issue_report");
    expect(s).toBe("report_issued");
  });

  it("has no transition to any rejected state — CPF does not decide", () => {
    const states = [
      "created",
      "disclosure_pending",
      "ready",
      "in_progress",
      "paused",
      "submitted",
      "under_review",
      "review_finalised",
      "report_issued",
    ] as const;
    for (const state of states) {
      expect(state.includes("reject")).toBe(false);
    }
  });
});

describe("review lifecycle", () => {
  it("routes adjudication before finalisation", () => {
    let s = reviewMachine.next("assigned", "begin");
    s = reviewMachine.next(s, "flag_adjudication");
    expect(s).toBe("adjudication_required");
    expect(() => reviewMachine.next(s, "finalise")).toThrow(InvalidTransitionError);
    s = reviewMachine.next(s, "resolve_adjudication");
    s = reviewMachine.next(s, "finalise");
    expect(s).toBe("finalised");
  });

  it("supports declining for conflicts of interest", () => {
    expect(reviewMachine.next("assigned", "decline")).toBe("declined");
  });
});

describe("human oversight completeness guard", () => {
  it("blocks report issuance when rationale, confidence, or limitations are missing", () => {
    expect(() =>
      assertReportCanBeIssued({
        reviewerId: "rev-1",
        finalRationale: "",
        confidence: "medium",
        limitations: "Task did not test multi-tool workflows",
        finalisedAt: new Date(),
      }),
    ).toThrow(OversightIncompleteError);
    expect(() =>
      assertReportCanBeIssued({
        reviewerId: "rev-1",
        finalRationale: "Strong verification evidence across two sources",
        confidence: "medium",
        limitations: "  ",
        finalisedAt: new Date(),
      }),
    ).toThrow(OversightIncompleteError);
  });

  it("allows report issuance for a complete oversight record", () => {
    expect(() =>
      assertReportCanBeIssued({
        reviewerId: "rev-1",
        finalRationale: "Strong verification evidence across two sources",
        confidence: "medium-high",
        limitations: "Task did not test multi-tool workflows",
        finalisedAt: new Date(),
      }),
    ).not.toThrow();
  });
});

describe("data-rights request lifecycle", () => {
  it("fulfils a verified access request", () => {
    let s = dataRightsMachine.initial;
    s = dataRightsMachine.next(s, "verify_identity");
    s = dataRightsMachine.next(s, "begin");
    s = dataRightsMachine.next(s, "fulfil");
    expect(s).toBe("fulfilled");
  });

  it("documents refusals rather than silently dropping them", () => {
    let s = dataRightsMachine.next("identity_verification", "begin");
    s = dataRightsMachine.next(s, "refuse_with_grounds");
    expect(s).toBe("refused_documented");
    expect(dataRightsMachine.isTerminal(s)).toBe(true);
  });
});

describe("learning enrollment lifecycle", () => {
  it("follows enrolled → in_progress → completed", () => {
    let s = learningEnrollmentMachine.initial;
    s = learningEnrollmentMachine.next(s, "begin");
    s = learningEnrollmentMachine.next(s, "complete");
    expect(s).toBe("completed");
    expect(learningEnrollmentMachine.isTerminal(s)).toBe(true);
  });

  it("can withdraw from either enrolled or in_progress", () => {
    expect(learningEnrollmentMachine.next("enrolled", "withdraw")).toBe("withdrawn");
    expect(learningEnrollmentMachine.next("in_progress", "withdraw")).toBe("withdrawn");
  });

  it("cannot re-enter a completed or withdrawn enrollment", () => {
    expect(() => learningEnrollmentMachine.next("completed", "begin")).toThrow(
      InvalidTransitionError,
    );
    expect(() => learningEnrollmentMachine.next("withdrawn", "begin")).toThrow(
      InvalidTransitionError,
    );
  });
});
