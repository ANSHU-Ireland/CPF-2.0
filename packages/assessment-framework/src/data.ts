import { readFileSync } from "node:fs";
import {
  AssessmentTemplateSchema,
  ScoringModelSchema,
  type AssessmentTemplate,
  type ScoringModel,
} from "./types.js";

const dataUrl = (relative: string): URL =>
  new URL(`../data/${relative}`, import.meta.url);

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(dataUrl(relative), "utf-8"));

export const TEMPLATE_CODES = [
  "SE1",
  "SE2",
  "SE3",
  "SE4",
  "SE5",
  "DM1",
  "DM2",
  "DM3",
  "DM4",
  "DM5",
] as const;
export type TemplateCode = (typeof TEMPLATE_CODES)[number];

let cachedModel: ScoringModel | undefined;
const cachedTemplates = new Map<string, AssessmentTemplate>();

/** Load and validate the versioned scoring model. */
export function loadScoringModel(): ScoringModel {
  cachedModel ??= ScoringModelSchema.parse(readJson("scoring-model.json"));
  return cachedModel;
}

/** Load and validate one assessment template by code (e.g. "SE1"). */
export function loadTemplate(code: TemplateCode): AssessmentTemplate {
  const cached = cachedTemplates.get(code);
  if (cached) return cached;
  const parsed = AssessmentTemplateSchema.parse(
    readJson(`templates/${code.toLowerCase()}.json`),
  );
  cachedTemplates.set(code, parsed);
  return parsed;
}

/** Load and validate the complete template library. */
export function loadAllTemplates(): AssessmentTemplate[] {
  return TEMPLATE_CODES.map((code) => loadTemplate(code));
}
