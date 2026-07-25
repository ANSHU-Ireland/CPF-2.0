import { z } from "zod";

/**
 * Zod schemas for the versioned CPF assessment framework.
 *
 * The framework is data, not code: templates and the scoring model are imported
 * from the approved source workbook by `tools/source-import/transform_workbook.py`
 * and validated here at load time. The runtime never reads the Excel workbook.
 */

export const ConfidenceLevel = z.enum([
  "high",
  "medium-high",
  "medium",
  "low",
  "insufficient",
]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

export const DimensionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  weight: z.number().gt(0).lt(1),
  definition: z.string().min(1),
});
export type Dimension = z.infer<typeof DimensionSchema>;

export const ScoreAnchorSchema = z.object({
  score: z.number().int().min(1).max(5),
  anchor: z.string().min(1),
  interpretation: z.string().min(1),
});
export type ScoreAnchor = z.infer<typeof ScoreAnchorSchema>;

export const ScoringControlsSchema = z.object({
  /** A critical criterion scored at or below this value is a concern for human review. */
  criticalScoreThreshold: z.number(),
  /** Reviewer score difference at or above this value requires adjudication. */
  reviewerVarianceTrigger: z.number(),
  /** Minimum weighted share of criteria that must be scored before decision support. */
  minimumScoredCoverage: z.number().min(0).max(1),
  /** Minimum weighted share of scored criteria that must carry evidence notes. */
  minimumEvidenceNoteCoverage: z.number().min(0).max(1),
});
export type ScoringControls = z.infer<typeof ScoringControlsSchema>;

export const EvidenceIndexBandSchema = z.object({
  minIndex: z.number().min(0).max(1),
  band: z.string().min(1),
});
export type EvidenceIndexBand = z.infer<typeof EvidenceIndexBandSchema>;

export const ScoringModelSchema = z.object({
  frameworkVersion: z.string().min(1),
  dimensions: z.array(DimensionSchema).min(1),
  scoreAnchors: z.array(ScoreAnchorSchema).length(5),
  controls: ScoringControlsSchema,
  evidenceIndexBands: z.array(EvidenceIndexBandSchema).min(1),
  source: z
    .object({
      document: z.string(),
      sheet: z.string(),
      importedAt: z.string(),
    })
    .optional(),
});
export type ScoringModel = z.infer<typeof ScoringModelSchema>;

export const CriterionSchema = z.object({
  id: z.string().regex(/^(SE|DM)\d-\d{2}$/),
  dimension: z.string().min(1),
  weight: z.number().gt(0).lt(1),
  critical: z.boolean(),
  observableStandard: z.string().min(1),
  evidenceAndRedFlag: z.string().min(1),
  interviewProbe: z.string(),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const WorkflowStageSchema = z.object({
  stage: z.string().min(1),
  durationMinutes: z.number().int().positive().nullable(),
  candidateAction: z.string(),
  evidenceCaptured: z.string(),
});
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;

export const AssessmentTemplateSchema = z.object({
  code: z.string().regex(/^(SE|DM)\d$/),
  roleFamily: z.enum(["software-engineering", "digital-marketing"]),
  frameworkVersion: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string(),
  purpose: z.string().min(1),
  customerUse: z.string().min(1),
  targetLevel: z.string().min(1),
  timebox: z.string().min(1),
  simulation: z.string().min(1),
  sourcePack: z.string().min(1),
  approvedTools: z.string().min(1),
  deliverables: z.string().min(1),
  constraints: z.string().min(1),
  evidenceRecord: z.string().min(1),
  stages: z.array(WorkflowStageSchema).min(1),
  criteria: z.array(CriterionSchema).min(1),
  reviewerInstruction: z.string(),
});
export type AssessmentTemplate = z.infer<typeof AssessmentTemplateSchema>;

/** Reviewer scores for one criterion. All fields except criterionId are optional while review is in progress. */
export const CriterionAssessmentSchema = z.object({
  criterionId: z.string().min(1),
  reviewer1Score: z.number().int().min(1).max(5).optional(),
  reviewer2Score: z.number().int().min(1).max(5).optional(),
  adjudicatedScore: z.number().int().min(1).max(5).optional(),
  evidenceNote: z.string().optional(),
  confidence: ConfidenceLevel.optional(),
});
export type CriterionAssessment = z.infer<typeof CriterionAssessmentSchema>;

export const EvaluationInputSchema = z.object({
  templateCode: z.string().min(1),
  assessments: z.array(CriterionAssessmentSchema),
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;
