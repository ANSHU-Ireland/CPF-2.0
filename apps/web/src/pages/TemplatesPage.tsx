import { useState, type ReactNode } from "react";
import { api, type Criterion, type TemplateDetail, type TemplateSummary } from "../api.js";
import { EmptyState, ErrorState, Loading, Modal } from "../ui.js";
import { useQuery } from "../useQuery.js";

function CriteriaTable({ criteria }: { criteria: Criterion[] }): ReactNode {
  return (
    <table className="data responsive-table">
      <caption className="skip-link">Assessment criteria</caption>
      <thead>
        <tr>
          <th scope="col">ID</th>
          <th scope="col">Dimension</th>
          <th scope="col">Weight</th>
          <th scope="col">Critical</th>
          <th scope="col">Observable standard</th>
          <th scope="col">Interview probe</th>
        </tr>
      </thead>
      <tbody>
        {criteria.map((c) => (
          <tr key={c.id}>
            <td data-label="ID">{c.id}</td>
            <td data-label="Dimension">{c.dimension}</td>
            <td data-label="Weight">{(c.weight * 100).toFixed(0)}%</td>
            <td data-label="Critical">{c.critical ? "Yes" : "—"}</td>
            <td data-label="Observable standard">{c.observableStandard}</td>
            <td data-label="Interview probe">{c.interviewProbe}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TemplateDetailPanel({ code }: { code: string }): ReactNode {
  const detail = useQuery(() => api.get<TemplateDetail>(`/v1/framework/templates/${code}`), [code]);
  if (detail.loading) return <Loading label="Loading template…" />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const t = detail.data;
  return (
    <div className="stack">
      <div>
        <p className="muted">
          {t.roleFamily} · {t.targetLevel} · timebox {t.timebox} · framework v{t.frameworkVersion}
        </p>
        <p>{t.purpose}</p>
      </div>
      <div>
        <h3>Stages</h3>
        <ol>
          {t.stages.map((s) => (
            <li key={s.stage}>
              <strong>{s.stage}</strong>
              {s.durationMinutes ? ` — ${s.durationMinutes} min` : ""}: {s.candidateAction}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3>Criteria ({t.criteria.length})</h3>
        <CriteriaTable criteria={t.criteria} />
      </div>
    </div>
  );
}

/** Read-only assessment library: 10 templates, drill into per-criterion detail. */
export function TemplatesPage(): ReactNode {
  const templates = useQuery(() => api.get<TemplateSummary[]>("/v1/framework/templates"), []);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const openTemplate = templates.data?.find((t) => t.code === openCode) ?? null;

  return (
    <div className="stack">
      <div>
        <h1>Assessment library</h1>
        <p className="muted">Read-only catalogue of CPF assessment templates</p>
      </div>

      {templates.loading ? <Loading /> : null}
      {templates.error ? <ErrorState error={templates.error} onRetry={templates.reload} /> : null}
      {templates.data ? (
        templates.data.length === 0 ? (
          <EmptyState title="No templates available" />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Assessment templates</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Title</th>
                <th scope="col">Role family</th>
                <th scope="col">Level</th>
                <th scope="col">Criteria</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {templates.data.map((t) => (
                <tr key={t.code}>
                  <td data-label="Code">{t.code}</td>
                  <td data-label="Title">{t.title}</td>
                  <td data-label="Role family">{t.roleFamily}</td>
                  <td data-label="Level">{t.targetLevel}</td>
                  <td data-label="Criteria">
                    {t.criteriaCount} ({t.criticalCriteriaCount} critical)
                  </td>
                  <td data-label="">
                    <button type="button" className="btn secondary" onClick={() => setOpenCode(t.code)}>
                      View detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal
        open={openTemplate !== null}
        title={openTemplate ? `${openTemplate.code} — ${openTemplate.title}` : "Template"}
        onClose={() => setOpenCode(null)}
      >
        {openCode ? <TemplateDetailPanel code={openCode} /> : null}
      </Modal>
    </div>
  );
}
