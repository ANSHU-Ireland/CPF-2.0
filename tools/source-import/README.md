# Source Import Tools

`transform_workbook.py` converts the approved CPF Phase-1 assessment workbook
(xlsx) into the versioned framework JSON consumed by
`@cpf/assessment-framework`. The runtime product never reads Excel.

```bash
python tools/source-import/transform_workbook.py \
  <path-to>/CPF_Phase1_AI_Native_Talent_Assessment_Templates.xlsx \
  packages/assessment-framework/data
```

Requires Python 3.12+ and `openpyxl`.

Rules:
- Source documents are confidential and are **never committed** (extraction
  workspace `.tmp-extract/` is gitignored).
- Re-run only for an approved new workbook version; bump `frameworkVersion`,
  re-run `npm test` (fidelity assertions), and record the change in an ADR.
- Import fidelity is enforced by `packages/assessment-framework/test/framework-data.test.ts`.
