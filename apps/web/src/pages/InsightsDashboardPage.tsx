import type { ReactNode } from "react";
import { useParams } from "react-router";
import { api, type AiAdoptionView, type SkillsGapView, type TokenCostView } from "../api.js";
import { EmptyState, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

/** Renders a suppressed count the same way everywhere in this module — never a blank or a fabricated number. */
function suppressedOr(count: number | null, suppressed: boolean): string {
  return suppressed || count === null ? "‹8 — suppressed" : String(count);
}

/**
 * Insights dashboard (Delivery Plan Step 44): skills gaps, AI-adoption
 * proxy, and a token-cost placeholder. Every section shows its own
 * definition and a freshness note per the plan's own risk mitigation
 * ("misleading charts → definitions + freshness on every chart").
 */
export function InsightsDashboardPage(): ReactNode {
  const { orgId } = useParams();
  const skillsGap = useQuery(() => api.get<SkillsGapView>(`/v1/orgs/${orgId}/intelligence/skills-gap`), [orgId]);
  const aiAdoption = useQuery(() => api.get<AiAdoptionView>(`/v1/orgs/${orgId}/intelligence/ai-adoption`), [orgId]);
  const tokenCost = useQuery(() => api.get<TokenCostView>(`/v1/orgs/${orgId}/intelligence/token-cost`), [orgId]);

  if (!orgId) return <EmptyState title="No organisation selected" />;

  return (
    <div className="stack">
      <div>
        <h1>Insights dashboard</h1>
        <p className="muted">Every figure below is an aggregate — no individual employee's data is ever shown.</p>
      </div>

      <section className="stack">
        <h2>Skills gap (by course)</h2>
        <p className="muted">
          <small>Data as of just now — a live query, not a cached snapshot.</small>
        </p>
        {skillsGap.loading ? <Loading label="Loading skills gap…" /> : null}
        {skillsGap.error ? <ErrorState error={skillsGap.error} onRetry={skillsGap.reload} /> : null}
        {skillsGap.data ? (
          <>
            <p className="muted">{skillsGap.data.suppressionNote}</p>
            {skillsGap.data.courses.length === 0 ? (
              <EmptyState title="No published courses yet" />
            ) : (
              <table className="data responsive-table">
                <caption className="skip-link">Skills gap by course</caption>
                <thead>
                  <tr>
                    <th scope="col">Course</th>
                    <th scope="col">Enrolled</th>
                    <th scope="col">Completed</th>
                    <th scope="col">Completion rate</th>
                  </tr>
                </thead>
                <tbody>
                  {skillsGap.data.courses.map((c) => (
                    <tr key={c.courseId}>
                      <td data-label="Course">{c.title}</td>
                      <td data-label="Enrolled">{suppressedOr(c.enrolledCount, c.suppressed)}</td>
                      <td data-label="Completed">{suppressedOr(c.completedCount, c.suppressed)}</td>
                      <td data-label="Completion rate">
                        {c.suppressed || c.completionRate === null ? "‹8 — suppressed" : `${Math.round(c.completionRate * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </section>

      <section className="stack">
        <h2>AI adoption (practice-attempt participation)</h2>
        <p className="muted">
          <small>Data as of just now — a live query, not a cached snapshot.</small>
        </p>
        {aiAdoption.loading ? <Loading label="Loading AI adoption…" /> : null}
        {aiAdoption.error ? <ErrorState error={aiAdoption.error} onRetry={aiAdoption.reload} /> : null}
        {aiAdoption.data ? (
          <>
            <p className="muted">{aiAdoption.data.definition}</p>
            <dl>
              <dt>Enrolled learners</dt>
              <dd>{suppressedOr(aiAdoption.data.enrolledCount, aiAdoption.data.enrolledCount === null)}</dd>
              <dt>Made at least one practice attempt</dt>
              <dd>{suppressedOr(aiAdoption.data.attemptedCount, aiAdoption.data.attemptedCount === null)}</dd>
              <dt>Participation rate</dt>
              <dd>
                {aiAdoption.data.participationRate === null
                  ? "‹8 — suppressed"
                  : `${Math.round(aiAdoption.data.participationRate * 100)}%`}
              </dd>
            </dl>
            <p className="muted">{aiAdoption.data.suppressionNote}</p>
          </>
        ) : null}
      </section>

      <section className="stack">
        <h2>Token cost</h2>
        {tokenCost.loading ? <Loading label="Loading token cost…" /> : null}
        {tokenCost.error ? <ErrorState error={tokenCost.error} onRetry={tokenCost.reload} /> : null}
        {tokenCost.data ? (
          tokenCost.data.available ? (
            <p>Token-cost figures are available.</p>
          ) : (
            <p className="muted">Not available yet: {tokenCost.data.reason}</p>
          )
        ) : null}
      </section>
    </div>
  );
}
