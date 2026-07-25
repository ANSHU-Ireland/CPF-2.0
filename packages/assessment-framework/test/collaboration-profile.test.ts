import { describe, expect, it } from "vitest";
import {
  COLLABORATION_DIMENSIONS,
  EVIDENCE_BANDS,
  checkBandRule,
} from "../src/collaboration-profile.js";

const okConfidence = { evidenceReferenceCount: 0, reviewerConfidence: "high" as const, counterEvidence: null, limitations: null };

describe("collaboration profile constants", () => {
  it("defines exactly 7 dimensions and 7 evidence bands", () => {
    expect(COLLABORATION_DIMENSIONS).toHaveLength(7);
    expect(EVIDENCE_BANDS).toHaveLength(7);
  });
});

describe("checkBandRule (Doc T12 structural developer rules)", () => {
  it("Exceptional requires >=2 references and high confidence", () => {
    expect(checkBandRule("Exceptional", { ...okConfidence, evidenceReferenceCount: 1 })).toMatch(/at least 2/);
    expect(checkBandRule("Exceptional", { ...okConfidence, evidenceReferenceCount: 2, reviewerConfidence: "medium" })).toMatch(/high/);
    expect(checkBandRule("Exceptional", { ...okConfidence, evidenceReferenceCount: 2 })).toBeNull();
  });

  it("Strong requires >=2 references", () => {
    expect(checkBandRule("Strong", { ...okConfidence, evidenceReferenceCount: 1 })).toMatch(/at least 2/);
    expect(checkBandRule("Strong", { ...okConfidence, evidenceReferenceCount: 2 })).toBeNull();
  });

  it("Some requires counter-evidence and limitations", () => {
    expect(checkBandRule("Some", okConfidence)).toMatch(/counter-evidence/);
    expect(
      checkBandRule("Some", { ...okConfidence, counterEvidence: "Did not attempt X.", limitations: "Small sample." }),
    ).toBeNull();
  });

  it("Clear, Limited, Insufficient, and Not assessed have no structural rule", () => {
    for (const band of ["Clear", "Limited", "Insufficient", "Not assessed"] as const) {
      expect(checkBandRule(band, okConfidence)).toBeNull();
    }
  });
});
