import { describe, expect, it } from "vitest";
import { loadScoringModel, loadTemplate } from "../src/data.js";
import {
  GOVERNANCE_NOTE,
  ScoringInputError,
  bandForIndex,
  evaluate,
  normaliseScore,
} from "../src/scoring.js";
import type { AssessmentTemplate, ScoringModel } from "../src/types.js";

/** Synthetic 4-criterion template for exact-arithmetic tests. */
const miniTemplate: AssessmentTemplate = {
  code: "SE1",
  roleFamily: "software-engineering",
  frameworkVersion: "test",
  title: "Mini",
  subtitle: "",
  purpose: "test",
  customerUse: "test",
  targetLevel: "test",
  timebox: "test",
  simulation: "test",
  sourcePack: "test",
  approvedTools: "test",
  deliverables: "test",
  constraints: "test",
  evidenceRecord: "test",
  stages: [
    { stage: "1. Only", durationMinutes: 10, candidateAction: "", evidenceCaptured: "" },
  ],
  criteria: [
    {
      id: "SE1-01",
      dimension: "Verification",
      weight: 0.4,
      critical: true,
      observableStandard: "s",
      evidenceAndRedFlag: "e",
      interviewProbe: "p",
    },
    {
      id: "SE1-02",
      dimension: "Verification",
      weight: 0.2,
      critical: false,
      observableStandard: "s",
      evidenceAndRedFlag: "e",
      interviewProbe: "p",
    },
    {
      id: "SE1-03",
      dimension: "Judgment",
      weight: 0.2,
      critical: false,
      observableStandard: "s",
      evidenceAndRedFlag: "e",
      interviewProbe: "p",
    },
    {
      id: "SE1-04",
      dimension: "Judgment",
      weight: 0.2,
      critical: false,
      observableStandard: "s",
      evidenceAndRedFlag: "e",
      interviewProbe: "p",
    },
  ],
  reviewerInstruction: "",
};

const miniModel: ScoringModel = {
  frameworkVersion: "test",
  dimensions: [
    { key: "verification", name: "Verification", weight: 0.5, definition: "d" },
    { key: "judgment", name: "Judgment", weight: 0.3, definition: "d" },
    { key: "escalation", name: "Escalation", weight: 0.2, definition: "d" },
  ],
  scoreAnchors: [1, 2, 3, 4, 5].map((score) => ({
    score,
    anchor: `a${score}`,
    interpretation: `i${score}`,
  })),
  controls: {
    criticalScoreThreshold: 2,
    reviewerVarianceTrigger: 2,
    minimumScoredCoverage: 0.9,
    minimumEvidenceNoteCoverage: 0.9,
  },
  evidenceIndexBands: [
    { minIndex: 0, band: "Limited evidence" },
    { minIndex: 0.55, band: "Mixed evidence" },
    { minIndex: 0.7, band: "Supported evidence" },
    { minIndex: 0.85, band: "Strong evidence" },
  ],
};

const note = { evidenceNote: "observed and referenced" };

describe("normaliseScore and bandForIndex", () => {
  it("maps the 1–5 anchor scale onto 0..1", () => {
    expect(normaliseScore(1)).toBe(0);
    expect(normaliseScore(3)).toBe(0.5);
    expect(normaliseScore(5)).toBe(1);
  });

  it("applies inclusive lower band boundaries from the workbook", () => {
    const bands = miniModel.evidenceIndexBands;
    expect(bandForIndex(0, bands)).toBe("Limited evidence");
    expect(bandForIndex(0.5499, bands)).toBe("Limited evidence");
    expect(bandForIndex(0.55, bands)).toBe("Mixed evidence");
    expect(bandForIndex(0.7, bands)).toBe("Supported evidence");
    expect(bandForIndex(0.8499, bands)).toBe("Supported evidence");
    expect(bandForIndex(0.85, bands)).toBe("Strong evidence");
    expect(bandForIndex(1, bands)).toBe("Strong evidence");
  });
});

describe("evaluate — transparent weighted arithmetic", () => {
  it("computes the overall evidence index exactly", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 5, ...note }, // 0.4 × 1.00
      { criterionId: "SE1-02", reviewer1Score: 3, ...note }, // 0.2 × 0.50
      { criterionId: "SE1-03", reviewer1Score: 4, ...note }, // 0.2 × 0.75
      { criterionId: "SE1-04", reviewer1Score: 2, ...note }, // 0.2 × 0.25
    ]);
    // 0.4 + 0.1 + 0.15 + 0.05 = 0.70
    expect(profile.overallEvidenceIndex).toBe(0.7);
    expect(profile.overallBand).toBe("Supported evidence");
    expect(profile.scoredCoverage).toBe(1);
    expect(profile.evidenceNoteCoverage).toBe(1);
    expect(profile.decisionSupportRoute).toBe("evidence_profile_ready_for_human_review");
  });

  it("summarises per-dimension achievement and marks unassessed dimensions", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 5, ...note },
      { criterionId: "SE1-02", reviewer1Score: 3, ...note },
      { criterionId: "SE1-03", reviewer1Score: 4, ...note },
      { criterionId: "SE1-04", reviewer1Score: 2, ...note },
    ]);
    const verification = profile.dimensions.find((d) => d.name === "Verification");
    // (0.4×1.0 + 0.2×0.5) / 0.6 = 0.8333
    expect(verification?.achievementIndex).toBeCloseTo(0.8333, 3);
    expect(verification?.band).toBe("Supported evidence");
    const escalation = profile.dimensions.find((d) => d.name === "Escalation");
    expect(escalation?.achievementIndex).toBeNull();
    expect(escalation?.band).toBe("Not assessed in this task");
  });

  it("flags a critical criterion at or below the threshold as a concern — never a rejection", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 2, ...note },
      { criterionId: "SE1-02", reviewer1Score: 4, ...note },
      { criterionId: "SE1-03", reviewer1Score: 4, ...note },
      { criterionId: "SE1-04", reviewer1Score: 4, ...note },
    ]);
    expect(profile.criticalConcerns).toEqual([{ criterionId: "SE1-01", finalScore: 2 }]);
    // Structural guardrail: the profile carries no outcome vocabulary at all.
    const serialised = JSON.stringify(profile).toLowerCase();
    for (const forbidden of ['"hire"', '"reject"', '"pass"', '"fail"', '"rank"']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(profile.governanceNote).toBe(GOVERNANCE_NOTE);
  });

  it("requires adjudication when reviewer variance meets the trigger", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 2, reviewer2Score: 4, ...note },
      { criterionId: "SE1-02", reviewer1Score: 4, reviewer2Score: 4, ...note },
      { criterionId: "SE1-03", reviewer1Score: 4, ...note },
      { criterionId: "SE1-04", reviewer1Score: 4, ...note },
    ]);
    expect(profile.adjudicationsRequired).toEqual(["SE1-01"]);
    expect(profile.decisionSupportRoute).toBe("adjudication_required");
    const flagged = profile.criteria.find((c) => c.criterionId === "SE1-01");
    expect(flagged?.finalScore).toBeNull();
  });

  it("resolves adjudicated scores and averages small reviewer differences", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 2, reviewer2Score: 4, adjudicatedScore: 3, ...note },
      { criterionId: "SE1-02", reviewer1Score: 3, reviewer2Score: 4, ...note },
      { criterionId: "SE1-03", reviewer1Score: 4, ...note },
      { criterionId: "SE1-04", reviewer1Score: 4, ...note },
    ]);
    expect(profile.decisionSupportRoute).toBe("evidence_profile_ready_for_human_review");
    expect(profile.criteria.find((c) => c.criterionId === "SE1-01")?.finalScore).toBe(3);
    expect(profile.criteria.find((c) => c.criterionId === "SE1-02")?.finalScore).toBe(3.5);
  });

  it("blocks decision support when scored coverage is below the minimum", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 5, ...note },
      { criterionId: "SE1-02", reviewer1Score: 4, ...note },
      // SE1-03 and SE1-04 unscored → coverage 0.6 < 0.9
    ]);
    expect(profile.scoredCoverage).toBeCloseTo(0.6, 4);
    expect(profile.decisionSupportRoute).toBe("incomplete_evidence_do_not_decide");
  });

  it("blocks decision support when evidence notes are missing — a number alone is not evidence", () => {
    const profile = evaluate(miniTemplate, miniModel, [
      { criterionId: "SE1-01", reviewer1Score: 5 }, // no note on 0.4 weight
      { criterionId: "SE1-02", reviewer1Score: 4, ...note },
      { criterionId: "SE1-03", reviewer1Score: 4, ...note },
      { criterionId: "SE1-04", reviewer1Score: 4, ...note },
    ]);
    expect(profile.evidenceNoteCoverage).toBeCloseTo(0.6, 4);
    expect(profile.decisionSupportRoute).toBe("incomplete_evidence_do_not_decide");
  });

  it("rejects unknown and duplicate criterion ids", () => {
    expect(() =>
      evaluate(miniTemplate, miniModel, [{ criterionId: "SE9-99", reviewer1Score: 3 }]),
    ).toThrow(ScoringInputError);
    expect(() =>
      evaluate(miniTemplate, miniModel, [
        { criterionId: "SE1-01", reviewer1Score: 3 },
        { criterionId: "SE1-01", reviewer1Score: 4 },
      ]),
    ).toThrow(ScoringInputError);
  });
});

describe("evaluate — real SE1 template integration", () => {
  it("produces a complete, ready evidence profile for a fully scored SE1 session", () => {
    const template = loadTemplate("SE1");
    const model = loadScoringModel();
    const assessments = template.criteria.map((c, i) => ({
      criterionId: c.id,
      reviewer1Score: (i % 3) + 3, // rotating 3,4,5
      evidenceNote: `Observed: evidence for ${c.id}`,
    }));
    const profile = evaluate(template, model, assessments);
    expect(profile.scoredCoverage).toBeCloseTo(1, 3);
    expect(profile.decisionSupportRoute).toBe("evidence_profile_ready_for_human_review");
    expect(profile.overallEvidenceIndex).toBeGreaterThan(0.5);
    expect(profile.overallEvidenceIndex).toBeLessThan(1);
    expect(profile.dimensions.filter((d) => d.achievementIndex !== null)).toHaveLength(10);
  });
});
