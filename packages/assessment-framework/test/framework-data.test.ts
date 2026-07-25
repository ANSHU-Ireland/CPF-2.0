import { describe, expect, it } from "vitest";
import {
  TEMPLATE_CODES,
  loadAllTemplates,
  loadScoringModel,
  loadTemplate,
} from "../src/data.js";

describe("framework data integrity", () => {
  const model = loadScoringModel();

  it("loads a valid scoring model with 10 dimensions", () => {
    expect(model.dimensions).toHaveLength(10);
    expect(model.frameworkVersion).toBe("0.1.0");
  });

  it("dimension weights sum to 1", () => {
    const sum = model.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("defines the four evidence-index bands from the workbook", () => {
    expect(model.evidenceIndexBands.map((b) => b.band)).toEqual([
      "Limited evidence",
      "Mixed evidence",
      "Supported evidence",
      "Strong evidence",
    ]);
  });

  it("defines the workbook governance controls", () => {
    expect(model.controls).toEqual({
      criticalScoreThreshold: 2,
      reviewerVarianceTrigger: 2,
      minimumScoredCoverage: 0.9,
      minimumEvidenceNoteCoverage: 0.9,
    });
  });

  it("loads all 10 templates with 18 criteria each", () => {
    const templates = loadAllTemplates();
    expect(templates).toHaveLength(10);
    for (const t of templates) {
      expect(t.criteria).toHaveLength(18);
      expect(t.stages.length).toBeGreaterThanOrEqual(5);
    }
  });

  it.each(TEMPLATE_CODES)("%s criterion weights sum to 1", (code) => {
    const t = loadTemplate(code);
    const sum = t.criteria.reduce((s, c) => s + c.weight, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it.each(TEMPLATE_CODES)("%s criteria reference only known dimensions", (code) => {
    const names = new Set(model.dimensions.map((d) => d.name));
    for (const c of loadTemplate(code).criteria) {
      expect(names, `${c.id} dimension "${c.dimension}"`).toContain(c.dimension);
    }
  });

  it.each(TEMPLATE_CODES)("%s has 6 critical criteria and full probe coverage", (code) => {
    const t = loadTemplate(code);
    expect(t.criteria.filter((c) => c.critical)).toHaveLength(6);
    expect(t.criteria.every((c) => c.interviewProbe.length > 0)).toBe(true);
  });
});
