import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { useAuth } from "../auth.js";
import { api, type PainPointCategory, type PainPointThemesView } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

const CATEGORIES: Array<{ value: PainPointCategory; label: string }> = [
  { value: "workload", label: "Workload" },
  { value: "tooling", label: "Tooling" },
  { value: "process", label: "Process" },
  { value: "management", label: "Management" },
  { value: "other", label: "Other" },
];

/** Renders a suppressed count the same way everywhere in this module — never a blank or a fabricated number. */
function suppressedOr(count: number | null, suppressed: boolean): string {
  return suppressed || count === null ? "‹8 — suppressed" : String(count);
}

/** Admin-only aggregate view: counts by category only — no individual report is ever readable here. */
function PainPointThemes({ orgId }: { orgId: string }): ReactNode {
  const themes = useQuery(() => api.get<PainPointThemesView>(`/v1/orgs/${orgId}/intelligence/pain-point-themes`), [orgId]);

  if (themes.loading) return <Loading label="Loading pain-point themes…" />;
  if (themes.error) return <ErrorState error={themes.error} onRetry={themes.reload} />;
  if (!themes.data) return null;

  return (
    <section className="stack">
      <h2>Pain-point themes (admin view)</h2>
      <p className="muted">{themes.data.suppressionNote}</p>
      <p className="muted">
        <small>Data as of just now — a live query, not a cached snapshot.</small>
      </p>
      <table className="data responsive-table">
        <caption className="skip-link">Pain-point reports by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Reports</th>
          </tr>
        </thead>
        <tbody>
          {themes.data.themes.map((t) => (
            <tr key={t.category}>
              <td data-label="Category">{t.category}</td>
              <td data-label="Reports">{suppressedOr(t.count, t.suppressed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function PainPointsPage(): ReactNode {
  const { orgId } = useParams();
  const { memberships } = useAuth();
  const isAdmin = memberships.some((m) => m.organisationId === orgId && m.role === "org_admin");

  const [category, setCategory] = useState<PainPointCategory>("workload");
  const [reportText, setReportText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!orgId) return <EmptyState title="No organisation selected" />;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setSubmitted(false);
    if (!reportText.trim()) {
      setFormError("Enter a description of the pain point before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/v1/orgs/${orgId}/pain-points`, {
        category,
        reportText: reportText.trim(),
        anonymous,
      });
      setSubmitted(true);
      setReportText("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not submit this report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Pain points</h1>
        <p className="muted">
          Tell your organisation about a workplace pain point. Admins only ever see aggregate counts by category
          (never your individual report) — see the{" "}
          <a href={`/org/${orgId}/intelligence/transparency`}>transparency page</a> for details.
        </p>
      </div>

      {formError ? <Alert kind="danger">{formError}</Alert> : null}
      {submitted ? <Alert kind="success">Report submitted. Thank you.</Alert> : null}

      <form className="stack" noValidate onSubmit={(e) => void onSubmit(e)}>
        <Field label="Category">
          {({ id }) => (
            <select id={id} value={category} onChange={(e) => setCategory(e.target.value as PainPointCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Description">
          {({ id }) => (
            <textarea id={id} rows={4} value={reportText} onChange={(e) => setReportText(e.target.value)} />
          )}
        </Field>
        <Field label="Anonymity">
          {({ id }) => (
            <label className="row" htmlFor={id} style={{ alignItems: "center" }}>
              <input id={id} type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span>Submit this report anonymously (your name will not be stored with it)</span>
            </label>
          )}
        </Field>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit report"}
        </button>
      </form>

      {isAdmin ? <PainPointThemes orgId={orgId} /> : null}
    </div>
  );
}
