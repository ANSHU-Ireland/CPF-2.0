/**
 * AIF-01 evaluation harness (docs/ai-governance/ai-governance.md): a
 * golden-set runner comparing suggestions against calibrated fixtures.
 * Fixtures are synthetic sessions, clearly labelled as such — this harness
 * never calls a real provider and never uses real candidate data. Its
 * purpose in Step 45 is to prove the evaluation *pipeline* works and to
 * produce a report artefact in the shape the real gate will require once a
 * provider and prompt are chosen (Phase 5+); it is not itself the go/no-go
 * evaluation for enabling AIF-01 in production.
 */

export interface GoldenCase {
  sessionId: string;
  /** Marks the case as synthetic fixture data — never a real candidate session. */
  label: "synthetic-fixture";
  workspaceEvidenceSummary: string;
  expectedClaimKeywords: string[];
}

export interface EvaluationThresholds {
  minPrecision: number;
  minRecall: number;
}

export interface EvaluationCaseResult {
  sessionId: string;
  suggested: string[];
  expected: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface EvaluationReport {
  generatedAt: string;
  totalCases: number;
  precision: number;
  recall: number;
  thresholds: EvaluationThresholds;
  passed: boolean;
  perCase: EvaluationCaseResult[];
}

const DEFAULT_THRESHOLDS: EvaluationThresholds = { minPrecision: 0.7, minRecall: 0.7 };

/**
 * Runs `suggest` against every golden case and scores keyword-level
 * precision/recall against `expectedClaimKeywords`. `suggest` is caller-
 * supplied so the harness can be run against a stub/fixture responder (no
 * real provider exists yet) or, once a real gateway-backed suggester is
 * built, against that — without changing the harness itself.
 */
export function runEvaluation(
  cases: readonly GoldenCase[],
  suggest: (workspaceEvidenceSummary: string) => string[],
  thresholds: EvaluationThresholds = DEFAULT_THRESHOLDS,
): EvaluationReport {
  const perCase: EvaluationCaseResult[] = cases.map((goldenCase) => {
    const suggested = suggest(goldenCase.workspaceEvidenceSummary).map((s) => s.toLowerCase());
    const expected = goldenCase.expectedClaimKeywords.map((s) => s.toLowerCase());
    const suggestedSet = new Set(suggested);
    const expectedSet = new Set(expected);

    let truePositives = 0;
    for (const item of suggestedSet) {
      if (expectedSet.has(item)) truePositives += 1;
    }
    const falsePositives = suggestedSet.size - truePositives;
    const falseNegatives = [...expectedSet].filter((item) => !suggestedSet.has(item)).length;

    return {
      sessionId: goldenCase.sessionId,
      suggested,
      expected,
      truePositives,
      falsePositives,
      falseNegatives,
    };
  });

  const totals = perCase.reduce(
    (acc, c) => ({
      tp: acc.tp + c.truePositives,
      fp: acc.fp + c.falsePositives,
      fn: acc.fn + c.falseNegatives,
    }),
    { tp: 0, fp: 0, fn: 0 },
  );

  const precision = totals.tp + totals.fp === 0 ? 0 : totals.tp / (totals.tp + totals.fp);
  const recall = totals.tp + totals.fn === 0 ? 0 : totals.tp / (totals.tp + totals.fn);

  return {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    precision,
    recall,
    thresholds,
    passed: precision >= thresholds.minPrecision && recall >= thresholds.minRecall,
    perCase,
  };
}
