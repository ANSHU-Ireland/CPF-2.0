/**
 * Lifecycle state machines for CPF core entities.
 *
 * These encode product guardrails as domain rules, not UI conventions:
 *  - an assessment session cannot start before the candidate acknowledges disclosure;
 *  - an employer report cannot be issued before a human reviewer finalises the
 *    review with a rationale, confidence, and limitations (meaningful oversight);
 *  - no transition ever sets a candidate to "rejected" — CPF does not decide.
 */

export class InvalidTransitionError extends Error {
  constructor(entity: string, from: string, event: string) {
    super(`${entity}: event "${event}" is not allowed in state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

export interface StateMachineDefinition<S extends string, E extends string> {
  entity: string;
  initial: S;
  terminal: readonly S[];
  transitions: Readonly<Record<S, Partial<Readonly<Record<E, S>>>>>;
}

export class StateMachine<S extends string, E extends string> {
  constructor(private readonly def: StateMachineDefinition<S, E>) {}

  get initial(): S {
    return this.def.initial;
  }

  can(state: S, event: E): boolean {
    return this.def.transitions[state]?.[event] !== undefined;
  }

  next(state: S, event: E): S {
    const target = this.def.transitions[state]?.[event];
    if (target === undefined) {
      throw new InvalidTransitionError(this.def.entity, state, event);
    }
    return target;
  }

  isTerminal(state: S): boolean {
    return this.def.terminal.includes(state);
  }
}

// ---------------------------------------------------------------------------
// Invitation
// ---------------------------------------------------------------------------

export type InvitationState =
  | "draft"
  | "sent"
  | "opened"
  | "accepted"
  | "expired"
  | "revoked";

export type InvitationEvent =
  | "send"
  | "open"
  | "accept"
  | "expire"
  | "revoke"
  | "reissue";

export const invitationMachine = new StateMachine<InvitationState, InvitationEvent>({
  entity: "Invitation",
  initial: "draft",
  terminal: ["accepted", "revoked"],
  transitions: {
    draft: { send: "sent", revoke: "revoked" },
    sent: { open: "opened", expire: "expired", revoke: "revoked" },
    opened: { accept: "accepted", expire: "expired", revoke: "revoked" },
    // A lost or expired invitation is reissued as a fresh send with a new token.
    expired: { reissue: "sent" },
    accepted: {},
    revoked: {},
  },
});

// ---------------------------------------------------------------------------
// Assessment session
// ---------------------------------------------------------------------------

export type SessionState =
  | "created"
  | "disclosure_pending"
  | "ready"
  | "in_progress"
  | "paused"
  | "submitted"
  | "under_review"
  | "review_finalised"
  | "report_issued"
  | "withdrawn"
  | "expired"
  | "invalidated";

export type SessionEvent =
  | "present_disclosure"
  | "acknowledge_disclosure"
  | "start"
  | "pause"
  | "resume"
  | "submit"
  | "begin_review"
  | "finalise_review"
  | "issue_report"
  | "withdraw"
  | "expire"
  | "invalidate";

export const sessionMachine = new StateMachine<SessionState, SessionEvent>({
  entity: "AssessmentSession",
  initial: "created",
  terminal: ["report_issued", "withdrawn", "expired", "invalidated"],
  transitions: {
    created: { present_disclosure: "disclosure_pending", withdraw: "withdrawn", expire: "expired" },
    // GUARDRAIL: the only path to "ready" is acknowledging disclosure.
    disclosure_pending: {
      acknowledge_disclosure: "ready",
      withdraw: "withdrawn",
      expire: "expired",
    },
    ready: { start: "in_progress", withdraw: "withdrawn", expire: "expired" },
    in_progress: {
      pause: "paused",
      submit: "submitted",
      withdraw: "withdrawn",
      expire: "expired",
      invalidate: "invalidated",
    },
    // Pause supports accommodations and technical-failure recovery.
    paused: {
      resume: "in_progress",
      withdraw: "withdrawn",
      expire: "expired",
      invalidate: "invalidated",
    },
    submitted: { begin_review: "under_review", invalidate: "invalidated" },
    under_review: { finalise_review: "review_finalised", invalidate: "invalidated" },
    review_finalised: { issue_report: "report_issued" },
    report_issued: {},
    withdrawn: {},
    expired: {},
    invalidated: {},
  },
});

// ---------------------------------------------------------------------------
// Review (human oversight record)
// ---------------------------------------------------------------------------

export type ReviewState =
  | "assigned"
  | "in_review"
  | "adjudication_required"
  | "finalised"
  | "reopened"
  | "declined";

export type ReviewEvent =
  | "begin"
  | "flag_adjudication"
  | "resolve_adjudication"
  | "finalise"
  | "reopen"
  | "decline";

export const reviewMachine = new StateMachine<ReviewState, ReviewEvent>({
  entity: "Review",
  initial: "assigned",
  terminal: ["declined"],
  transitions: {
    // Decline supports conflict-of-interest and reviewer-absence cases.
    assigned: { begin: "in_review", decline: "declined" },
    in_review: { flag_adjudication: "adjudication_required", finalise: "finalised" },
    adjudication_required: { resolve_adjudication: "in_review" },
    finalised: { reopen: "reopened" },
    reopened: { begin: "in_review" },
    declined: {},
  },
});

// ---------------------------------------------------------------------------
// Human oversight completeness guard
// ---------------------------------------------------------------------------

export interface HumanOversightRecord {
  reviewerId: string;
  finalRationale: string;
  confidence: string;
  limitations: string;
  finalisedAt: Date | null;
}

export class OversightIncompleteError extends Error {
  constructor(missing: string[]) {
    super(
      `Employer report cannot be issued: human oversight record incomplete (missing: ${missing.join(", ")})`,
    );
    this.name = "OversightIncompleteError";
  }
}

/**
 * GUARDRAIL: an employer-facing report may only be generated from a complete,
 * finalised human oversight record. Throws when oversight is not meaningful.
 */
export function assertReportCanBeIssued(record: HumanOversightRecord): void {
  const missing: string[] = [];
  if (!record.reviewerId.trim()) missing.push("reviewerId");
  if (!record.finalRationale.trim()) missing.push("finalRationale");
  if (!record.confidence.trim()) missing.push("confidence");
  if (!record.limitations.trim()) missing.push("limitations");
  if (record.finalisedAt === null) missing.push("finalisedAt");
  if (missing.length > 0) throw new OversightIncompleteError(missing);
}

// ---------------------------------------------------------------------------
// Data-rights request
// ---------------------------------------------------------------------------

export type DataRightsState =
  | "received"
  | "identity_verification"
  | "in_progress"
  | "awaiting_controller"
  | "fulfilled"
  | "refused_documented"
  | "withdrawn_by_subject";

export type DataRightsEvent =
  | "verify_identity"
  | "begin"
  | "refer_to_controller"
  | "controller_responded"
  | "fulfil"
  | "refuse_with_grounds"
  | "withdraw";

export const dataRightsMachine = new StateMachine<DataRightsState, DataRightsEvent>({
  entity: "DataRightsRequest",
  initial: "received",
  terminal: ["fulfilled", "refused_documented", "withdrawn_by_subject"],
  transitions: {
    received: { verify_identity: "identity_verification", withdraw: "withdrawn_by_subject" },
    identity_verification: { begin: "in_progress", withdraw: "withdrawn_by_subject" },
    in_progress: {
      refer_to_controller: "awaiting_controller",
      fulfil: "fulfilled",
      refuse_with_grounds: "refused_documented",
      withdraw: "withdrawn_by_subject",
    },
    awaiting_controller: {
      controller_responded: "in_progress",
      withdraw: "withdrawn_by_subject",
    },
    fulfilled: {},
    refused_documented: {},
    withdrawn_by_subject: {},
  },
});
