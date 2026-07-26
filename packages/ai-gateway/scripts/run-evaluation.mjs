/**
 * AIF-01 evaluation harness runner (docs/ai-governance/ai-governance.md).
 *
 * Runs the golden-set fixtures (evaluation/golden-set.json — synthetic data
 * only) through a placeholder "suggester" and writes a report artefact to
 * evaluation/report.json. The placeholder suggester is a deterministic
 * lexicon match, NOT a real model call — Phase 1 ships zero AI providers
 * (ADR-0005). Its purpose here is only to prove the evaluation *pipeline*
 * (fixtures -> suggestions -> precision/recall -> pass/fail report) works
 * end to end, ahead of a real provider/prompt being selected. This run is
 * NOT the go/no-go evaluation gate for enabling AIF-01 in production — that
 * gate requires a golden set of >=30 double-scored real sessions, per the
 * AI governance register.
 *
 * Usage (after `npm run build -w @cpf/ai-gateway`):
 *   node packages/ai-gateway/scripts/run-evaluation.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runEvaluation } from "../dist/evaluation.js";

const evaluationDir = join(import.meta.dirname, "..", "evaluation");
const goldenSetPath = join(evaluationDir, "golden-set.json");
const reportPath = join(evaluationDir, "report.json");

const { cases } = JSON.parse(readFileSync(goldenSetPath, "utf8"));

// Deterministic lexicon-match placeholder suggester (see file header) — the
// lexicon is the full set of phrases the golden set expects, so this proves
// the harness pipeline without fabricating a live model call.
const lexicon = [...new Set(cases.flatMap((c) => c.expectedClaimKeywords))];
function placeholderSuggest(workspaceEvidenceSummary) {
  const lower = workspaceEvidenceSummary.toLowerCase();
  return lexicon.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

const report = runEvaluation(cases, placeholderSuggest);
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

console.log(`Evaluation report written to ${reportPath}`);
console.log(`precision=${report.precision.toFixed(2)} recall=${report.recall.toFixed(2)} passed=${report.passed}`);

if (!report.passed) {
  process.exitCode = 1;
}
