import type { ReactNode } from "react";
import { useParams } from "react-router";
import { api, type OrgAnalytics } from "../api.js";
import { EmptyState, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

function formatPercent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 1000) / 10}%`;
}

/**
 * Org analytics dashboard (Delivery Plan Step 39): assessments by
 * status/template, median reviewer minutes, completion + challenge rate —
 * this organisation's own data only. Every figure shows its definition
 * inline so a reader can't mistake it for something it isn't.
 */
export function AnalyticsPage(): ReactNode {
  const { orgId } = useParams();
  const analytics = useQuery(() => api.get<OrgAnalytics>(`/v1/orgs/${orgId}/analytics`), [orgId]);

  if (analytics.loading) return <Loading label="Loading analytics…" />;
  if (analytics.error) return <ErrorState error={analytics.error} onRetry={analytics.reload} />;
  if (!analytics.data) return null;
  const d = analytics.data;

  return (
    <div className="stack">
      <div>
        <h1>Analytics</h1>
        <p className="muted">Measured from this organisation's own assessment activity. No cross-organisation data appears here.</p>
      </div>

      <section className="stack">
        <h2>Assessments by status</h2>
        {d.assessmentsByStatus.length === 0 ? (
          <EmptyState title="No assessment sessions yet" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {d.assessmentsByStatus.map((row) => (
                <tr key={row.status}>
                  <td data-label="Status">{row.status}</td>
                  <td data-label="Count">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="stack">
        <h2>Reviewer minutes by template</h2>
        <p className="muted">Reviewer minutes = time between a reviewer's first saved score and finalisation.</p>
        {d.byTemplate.length === 0 ? (
          <EmptyState title="No template activity yet" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Template</th>
                <th scope="col">Sessions</th>
                <th scope="col">Median reviewer minutes</th>
              </tr>
            </thead>
            <tbody>
              {d.byTemplate.map((row) => (
                <tr key={row.templateCode}>
                  <td data-label="Template">{row.templateCode}</td>
                  <td data-label="Sessions">{row.sessionCount}</td>
                  <td data-label="Median reviewer minutes">
                    {row.medianReviewerMinutes === null ? "not yet measured" : row.medianReviewerMinutes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="row">
        <div className="card stack" style={{ flex: 1, minWidth: 260 }}>
          <h2>Completion rate</h2>
          <p style={{ fontSize: "2rem", fontWeight: 600, margin: 0 }}>{formatPercent(d.completionRate.rate)}</p>
          <p className="muted">{d.completionRate.completedCount} of {d.completionRate.startedCount} started sessions</p>
          <p className="muted"><small>{d.completionRate.definition}</small></p>
        </div>
        <div className="card stack" style={{ flex: 1, minWidth: 260 }}>
          <h2>Challenge rate</h2>
          <p style={{ fontSize: "2rem", fontWeight: 600, margin: 0 }}>{formatPercent(d.challengeRate.rate)}</p>
          <p className="muted">{d.challengeRate.challengedCount} of {d.challengeRate.reportedCount} reported candidates</p>
          <p className="muted"><small>{d.challengeRate.definition}</small></p>
        </div>
      </section>
    </div>
  );
}
