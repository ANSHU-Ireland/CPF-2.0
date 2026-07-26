import { describe, expect, it } from "vitest";
import { runEvaluation, type GoldenCase } from "../src/evaluation.js";

const GOLDEN_SET: GoldenCase[] = [
  {
    sessionId: "synthetic-001",
    label: "synthetic-fixture",
    workspaceEvidenceSummary: "candidate wrote unit tests before implementing the function and verified edge cases",
    expectedClaimKeywords: ["unit tests", "edge cases"],
  },
  {
    sessionId: "synthetic-002",
    label: "synthetic-fixture",
    workspaceEvidenceSummary: "candidate refactored the module and re-ran the full suite twice",
    expectedClaimKeywords: ["refactored", "full suite"],
  },
];

describe("runEvaluation", () => {
  it("scores a perfect suggester as passing both thresholds", () => {
    const report = runEvaluation(GOLDEN_SET, (summary) =>
      GOLDEN_SET.find((c) => c.workspaceEvidenceSummary === summary)?.expectedClaimKeywords ?? [],
    );
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.totalCases).toBe(2);
    expect(report.perCase).toHaveLength(2);
  });

  it("scores a suggester that returns nothing as failing", () => {
    const report = runEvaluation(GOLDEN_SET, () => []);
    expect(report.precision).toBe(0);
    expect(report.recall).toBe(0);
    expect(report.passed).toBe(false);
  });

  it("applies caller-supplied thresholds", () => {
    const report = runEvaluation(
      GOLDEN_SET,
      () => ["unit tests"],
      { minPrecision: 0.5, minRecall: 0.2 },
    );
    expect(report.passed).toBe(true);
  });

  it("includes a generatedAt ISO timestamp", () => {
    const report = runEvaluation(GOLDEN_SET, () => []);
    expect(() => new Date(report.generatedAt).toISOString()).not.toThrow();
  });
});
