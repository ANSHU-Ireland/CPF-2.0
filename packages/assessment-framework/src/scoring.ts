import type {
  AssessmentTemplate,
  CriterionAssessment,
  EvidenceIndexBand,
  ScoringModel,
} from "./types.js";

/**
 * CPF transparent scoring engine.
 *
 * Implements the "Transparent Scoring Model" from the CPF Phase-1 workbook:
 * weighted arithmetic over anchored 1–5 criterion scores, evidence-index bands,
 * coverage controls, critical-concern flags, and reviewer-variance adjudication.
 *
 * GOVERNANCE GUARDRAILS (enforced by construction — see docs/compliance):
 *  - The engine never produces a hire/reject/pass/fail outcome or candidate ranking.
 *  - A critical criterion at or below the threshold raises a CONCERN for human
 *    review; it never changes candidate status.
 *  - Incomplete scoring or missing evidence notes BLOCKS decision support,
 *    because a number without evidence is not evidence.
 */

export const GOVERNANCE_NOTE =
  "No automated hiring or placement outcome. This evidence profile supports a " +
  "human reviewer and employer decision-maker. Record accommodations, confidence, " +
  "limitations, and challenge or correction requests separately.";

export type DecisionSupportRoute =
  | "incomplete_evidence_do_not_decide"
  | "adjudication_required"
  | "evidence_profile_ready_for_human_review";

export type CriterionStatus = "scored" | "unscored" | "adjudication_required";

export interface CriterionResolution {
  criterionId: string;
  dimension: string;
  weight: number;
  critical: boolean;
  finalScore: number | null;
  status: CriterionStatus;
  varianceFlag: boolean;
  evidenceNotePresent: boolean;
  criticalConcern: boolean;
}

export interface DimensionSummary {
  key: string;
  name: string;
  weight: number;
  /** Normalised 0..1 achievement over scored criteria in this dimension, or null when not assessed. */
  achievementIndex: number | null;
  band: string;
  scoredWeight: number;
  totalWeight: number;
}

export interface EvidenceProfile {
  templateCode: string;
  frameworkVersion: string;
  criteria: CriterionResolution[];
  dimensions: DimensionSummary[];
  overallEvidenceIndex: number | null;
  overallBand: string | null;
  scoredCoverage: number;
  evidenceNoteCoverage: number;
  criticalConcerns: Array<{ criterionId: string; finalScore: number }>;
  adjudicationsRequired: string[];
  decisionSupportRoute: DecisionSupportRoute;
  governanceNote: typeof GOVERNANCE_NOTE;
}

export class ScoringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringInputError";
  }
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Map a 1–5 anchored score onto the normalised 0..1 evidence scale. */
export const normaliseScore = (score: number): number => (score - 1) / 4;

/** Resolve the evidence band for a normalised index (bands sorted ascending, inclusive lower bound). */
export function bandForIndex(index: number, bands: EvidenceIndexBand[]): string {
  const sorted = [...bands].sort((a, b) => a.minIndex - b.minIndex);
  let current = sorted[0]?.band ?? "Unbanded";
  for (const b of sorted) {
    if (index >= b.minIndex) current = b.band;
  }
  return current;
}

interface ResolvedScore {
  finalScore: number | null;
  status: CriterionStatus;
  varianceFlag: boolean;
}

function resolveScore(
  a: CriterionAssessment | undefined,
  varianceTrigger: number,
): ResolvedScore {
  if (!a) return { finalScore: null, status: "unscored", varianceFlag: false };
  const { reviewer1Score: r1, reviewer2Score: r2, adjudicatedScore: adj } = a;
  if (adj !== undefined) {
    const variance =
      r1 !== undefined && r2 !== undefined ? Math.abs(r1 - r2) : 0;
    return {
      finalScore: adj,
      status: "scored",
      varianceFlag: variance >= varianceTrigger,
    };
  }
  if (r1 !== undefined && r2 !== undefined) {
    const variance = Math.abs(r1 - r2);
    if (variance >= varianceTrigger) {
      // Adjudication protocol: a large reviewer difference must be discussed and
      // adjudicated before the criterion contributes to decision support.
      return { finalScore: null, status: "adjudication_required", varianceFlag: true };
    }
    return { finalScore: (r1 + r2) / 2, status: "scored", varianceFlag: false };
  }
  const single = r1 ?? r2;
  if (single !== undefined) {
    return { finalScore: single, status: "scored", varianceFlag: false };
  }
  return { finalScore: null, status: "unscored", varianceFlag: false };
}

/**
 * Evaluate a set of reviewer criterion assessments against a template and the
 * scoring model, producing a decision-support Evidence Profile.
 */
export function evaluate(
  template: AssessmentTemplate,
  model: ScoringModel,
  assessments: CriterionAssessment[],
): EvidenceProfile {
  const byId = new Map<string, CriterionAssessment>();
  for (const a of assessments) {
    if (byId.has(a.criterionId)) {
      throw new ScoringInputError(`Duplicate assessment for criterion ${a.criterionId}`);
    }
    byId.set(a.criterionId, a);
  }
  const knownIds = new Set(template.criteria.map((c) => c.id));
  for (const id of byId.keys()) {
    if (!knownIds.has(id)) {
      throw new ScoringInputError(
        `Criterion ${id} does not exist in template ${template.code}`,
      );
    }
  }

  const { controls, evidenceIndexBands } = model;
  const criteria: CriterionResolution[] = template.criteria.map((c) => {
    const a = byId.get(c.id);
    const resolved = resolveScore(a, controls.reviewerVarianceTrigger);
    const evidenceNotePresent = Boolean(a?.evidenceNote && a.evidenceNote.trim().length > 0);
    const criticalConcern =
      c.critical &&
      resolved.finalScore !== null &&
      resolved.finalScore <= controls.criticalScoreThreshold;
    return {
      criterionId: c.id,
      dimension: c.dimension,
      weight: c.weight,
      critical: c.critical,
      finalScore: resolved.finalScore,
      status: resolved.status,
      varianceFlag: resolved.varianceFlag,
      evidenceNotePresent,
      criticalConcern,
    };
  });

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const scored = criteria.filter((c) => c.finalScore !== null);
  const scoredWeight = scored.reduce((s, c) => s + c.weight, 0);
  const notedWeight = scored
    .filter((c) => c.evidenceNotePresent)
    .reduce((s, c) => s + c.weight, 0);

  const scoredCoverage = totalWeight > 0 ? round4(scoredWeight / totalWeight) : 0;
  const evidenceNoteCoverage = scoredWeight > 0 ? round4(notedWeight / scoredWeight) : 0;

  const overallEvidenceIndex =
    scoredWeight > 0
      ? round4(
          scored.reduce(
            (s, c) => s + c.weight * normaliseScore(c.finalScore as number),
            0,
          ) / scoredWeight,
        )
      : null;

  const dimensions: DimensionSummary[] = model.dimensions.map((d) => {
    const inDim = criteria.filter((c) => c.dimension === d.name);
    const dimScored = inDim.filter((c) => c.finalScore !== null);
    const dimScoredWeight = dimScored.reduce((s, c) => s + c.weight, 0);
    const achievementIndex =
      dimScoredWeight > 0
        ? round4(
            dimScored.reduce(
              (s, c) => s + c.weight * normaliseScore(c.finalScore as number),
              0,
            ) / dimScoredWeight,
          )
        : null;
    return {
      key: d.key,
      name: d.name,
      weight: d.weight,
      achievementIndex,
      band:
        achievementIndex === null
          ? "Not assessed in this task"
          : bandForIndex(achievementIndex, evidenceIndexBands),
      scoredWeight: round4(dimScoredWeight),
      totalWeight: round4(inDim.reduce((s, c) => s + c.weight, 0)),
    };
  });

  const criticalConcerns = criteria
    .filter((c) => c.criticalConcern)
    .map((c) => ({ criterionId: c.criterionId, finalScore: c.finalScore as number }));
  const adjudicationsRequired = criteria
    .filter((c) => c.status === "adjudication_required")
    .map((c) => c.criterionId);

  let decisionSupportRoute: DecisionSupportRoute;
  if (adjudicationsRequired.length > 0) {
    decisionSupportRoute = "adjudication_required";
  } else if (
    scoredCoverage < controls.minimumScoredCoverage ||
    evidenceNoteCoverage < controls.minimumEvidenceNoteCoverage
  ) {
    decisionSupportRoute = "incomplete_evidence_do_not_decide";
  } else {
    decisionSupportRoute = "evidence_profile_ready_for_human_review";
  }

  return {
    templateCode: template.code,
    frameworkVersion: template.frameworkVersion,
    criteria,
    dimensions,
    overallEvidenceIndex,
    overallBand:
      overallEvidenceIndex === null
        ? null
        : bandForIndex(overallEvidenceIndex, evidenceIndexBands),
    scoredCoverage,
    evidenceNoteCoverage,
    criticalConcerns,
    adjudicationsRequired,
    decisionSupportRoute,
    governanceNote: GOVERNANCE_NOTE,
  };
}
