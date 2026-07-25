import { z } from "zod";

/**
 * The AI Collaboration Profile — the employer-facing 7-dimension narrative
 * lens, layered over Evidence Ledger claims (ADR-0004). Distinct from the
 * 10-dimension scoring model: this lens is assembled by a human reviewer from
 * claims, never computed arithmetically, and never produces a score.
 */
export const COLLABORATION_DIMENSIONS = [
  "Problem framing",
  "Prompt direction",
  "Iteration & steering",
  "Verification & scepticism",
  "Output ownership",
  "Efficiency & proportionality",
  "Integrity context",
] as const;

export const CollaborationDimension = z.enum(COLLABORATION_DIMENSIONS);
export type CollaborationDimension = z.infer<typeof CollaborationDimension>;

export const EVIDENCE_BANDS = [
  "Exceptional",
  "Strong",
  "Clear",
  "Some",
  "Limited",
  "Insufficient",
  "Not assessed",
] as const;

export const EvidenceBand = z.enum(EVIDENCE_BANDS);
export type EvidenceBand = z.infer<typeof EvidenceBand>;

export const ReviewerConfidence = z.enum(["high", "medium-high", "medium", "low", "insufficient"]);
export type ReviewerConfidence = z.infer<typeof ReviewerConfidence>;

/**
 * Structural developer rules (co-founder Doc T12). Enforced on the band enum
 * and the shape of the claim only — never on the free-text wording, which
 * would require unreliable sentiment analysis and is explicitly out of scope.
 */
export interface BandRuleInput {
  evidenceReferenceCount: number;
  reviewerConfidence: ReviewerConfidence;
  counterEvidence: string | null | undefined;
  limitations: string | null | undefined;
}

/** Returns a human-readable violation message, or null if the claim satisfies the band's rule. */
export function checkBandRule(band: EvidenceBand, input: BandRuleInput): string | null {
  const hasText = (v: string | null | undefined) => Boolean(v && v.trim().length > 0);
  switch (band) {
    case "Exceptional":
      if (input.evidenceReferenceCount < 2 || input.reviewerConfidence !== "high") {
        return "Exceptional requires at least 2 evidence references and high reviewer confidence.";
      }
      return null;
    case "Strong":
      if (input.evidenceReferenceCount < 2) {
        return "Strong requires at least 2 evidence references.";
      }
      return null;
    case "Some":
      if (!hasText(input.counterEvidence) || !hasText(input.limitations)) {
        return "Some evidence requires both counter-evidence and limitations to be recorded.";
      }
      return null;
    case "Clear":
    case "Limited":
    case "Insufficient":
    case "Not assessed":
      return null;
  }
}
