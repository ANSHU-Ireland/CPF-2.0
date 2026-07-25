"""Transform the CPF Phase-1 assessment workbook (xlsx) into versioned framework JSON.

This is the single source-of-truth import pipeline: the runtime product never reads
the Excel file. Re-run only when a new workbook version is approved.

Usage:
    python tools/source-import/transform_workbook.py <workbook.xlsx> <output-dir>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import openpyxl

TEMPLATE_CODES = ["SE1", "SE2", "SE3", "SE4", "SE5", "DM1", "DM2", "DM3", "DM4", "DM5"]
SHEET_FOR_CODE = {
    "SE1": "SE1 Feature Delivery",
    "SE2": "SE2 Incident Recovery",
    "SE3": "SE3 Secure Integration",
    "SE4": "SE4 Legacy Optimisation",
    "SE5": "SE5 AI PR Review",
    "DM1": "DM1 Paid Acquisition",
    "DM2": "DM2 SEO Content",
    "DM3": "DM3 Lifecycle CRM",
    "DM4": "DM4 Attribution",
    "DM5": "DM5 Integrated Launch",
}
ROLE_FAMILY = {"SE": "software-engineering", "DM": "digital-marketing"}
METADATA_LABELS = {
    "Purpose": "purpose",
    "Customer use": "customerUse",
    "Target level": "targetLevel",
    "Timebox": "timebox",
    "Simulation": "simulation",
    "Source pack": "sourcePack",
    "Approved tools": "approvedTools",
    "Deliverables": "deliverables",
    "Constraints": "constraints",
    "Evidence record": "evidenceRecord",
}
CRITERION_ID = re.compile(r"^(SE|DM)\d-\d{2}$")
STAGE_ROW = re.compile(r"^\d\.\s")
DURATION = re.compile(r"^(\d+)\s*min", re.IGNORECASE)


def sheet_rows(ws) -> list[list[str]]:
    rows = []
    for row in ws.iter_rows():
        vals = [("" if c.value is None else str(c.value).strip()) for c in row]
        if any(vals):
            rows.append(vals)
    return rows


def nonempty(row: list[str]) -> list[str]:
    return [c for c in row if c]


def parse_scoring_model(rows: list[list[str]]) -> dict:
    dimensions, anchors, controls, thresholds = [], [], {}, []
    control_labels = {
        "Critical score threshold": "criticalScoreThreshold",
        "Reviewer variance trigger": "reviewerVarianceTrigger",
        "Minimum scored coverage": "minimumScoredCoverage",
        "Minimum evidence note coverage": "minimumEvidenceNoteCoverage",
    }
    for row in rows:
        cells = nonempty(row)
        if not cells:
            continue
        first = cells[0]
        if first in control_labels and len(cells) >= 2:
            try:
                controls[control_labels[first]] = float(cells[1])
            except ValueError:
                pass
            continue
        if first in {"Dimension", "Score", "Stage", "Control", "Total"}:
            continue
        # dimension row: name, weight(float), definition [, threshold, band]
        if len(cells) >= 3:
            try:
                weight = float(cells[1])
            except ValueError:
                weight = None
            if weight is not None and 0 < weight < 1:
                dimensions.append(
                    {
                        "key": re.sub(r"[^a-z0-9]+", "-", first.lower()).strip("-"),
                        "name": first,
                        "weight": round(weight, 4),
                        "definition": cells[2],
                    }
                )
                if len(cells) >= 5:
                    try:
                        thresholds.append({"minIndex": float(cells[3]), "band": cells[4]})
                    except ValueError:
                        pass
                continue
        # anchor row: score(int 1-5), anchor, interpretation
        if first.isdigit() and 1 <= int(first) <= 5 and len(cells) >= 3:
            anchors.append(
                {"score": int(first), "anchor": cells[1], "interpretation": cells[2]}
            )
    return {
        "dimensions": dimensions,
        "scoreAnchors": sorted(anchors, key=lambda a: a["score"]),
        "controls": controls,
        "evidenceIndexBands": sorted(thresholds, key=lambda t: t["minIndex"]),
    }


def parse_template(code: str, rows: list[list[str]]) -> dict:
    meta: dict = {"code": code, "roleFamily": ROLE_FAMILY[code[:2]]}
    stages, criteria, probes = [], [], {}
    reviewer_instruction = ""
    meta["title"] = rows[0][0] if rows else code
    meta["subtitle"] = rows[1][0] if len(rows) > 1 else ""
    for row in rows:
        cells = nonempty(row)
        if not cells:
            continue
        first = cells[0]
        if first in METADATA_LABELS and len(cells) >= 2:
            meta[METADATA_LABELS[first]] = max(cells[1:], key=len)
            continue
        if STAGE_ROW.match(first):
            duration = None
            rest = cells[1:]
            if rest and DURATION.match(rest[0]):
                duration = int(DURATION.match(rest[0]).group(1))
                rest = rest[1:]
            stages.append(
                {
                    "stage": first,
                    "durationMinutes": duration,
                    "candidateAction": rest[0] if rest else "",
                    "evidenceCaptured": rest[1] if len(rest) > 1 else "",
                }
            )
            continue
        if CRITERION_ID.match(first):
            if len(cells) >= 6:
                criteria.append(
                    {
                        "id": first,
                        "dimension": cells[1],
                        "weight": round(float(cells[2]), 6),
                        "critical": cells[3].lower() == "yes",
                        "observableStandard": cells[4],
                        "evidenceAndRedFlag": cells[5],
                    }
                )
            elif len(cells) == 2:
                probes[first] = cells[1]
            continue
        if first.startswith("Reviewer instruction"):
            reviewer_instruction = first.split(":", 1)[-1].strip()
    for c in criteria:
        c["interviewProbe"] = probes.get(c["id"], "")
    return {
        **meta,
        "stages": stages,
        "criteria": criteria,
        "reviewerInstruction": reviewer_instruction,
    }


def main() -> None:
    workbook_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(str(workbook_path), data_only=True)

    scoring = parse_scoring_model(sheet_rows(wb["Scoring Model"]))
    scoring["frameworkVersion"] = "0.1.0"
    scoring["source"] = {
        "document": workbook_path.name,
        "sheet": "Scoring Model",
        "importedAt": "2026-07-25",
    }
    (out_dir / "scoring-model.json").write_text(
        json.dumps(scoring, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    templates_dir = out_dir / "templates"
    templates_dir.mkdir(exist_ok=True)
    summary = []
    for code in TEMPLATE_CODES:
        tpl = parse_template(code, sheet_rows(wb[SHEET_FOR_CODE[code]]))
        tpl["frameworkVersion"] = "0.1.0"
        weight_sum = round(sum(c["weight"] for c in tpl["criteria"]), 6)
        summary.append(
            {
                "code": code,
                "criteria": len(tpl["criteria"]),
                "criticalCriteria": sum(1 for c in tpl["criteria"] if c["critical"]),
                "stages": len(tpl["stages"]),
                "criterionWeightSum": weight_sum,
                "probesLinked": sum(1 for c in tpl["criteria"] if c["interviewProbe"]),
            }
        )
        (templates_dir / f"{code.lower()}.json").write_text(
            json.dumps(tpl, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print(json.dumps({"scoringDimensions": len(scoring["dimensions"]),
                      "anchors": len(scoring["scoreAnchors"]),
                      "controls": scoring["controls"],
                      "bands": scoring["evidenceIndexBands"],
                      "templates": summary}, indent=1))


if __name__ == "__main__":
    main()
