import type { ReactNode } from "react";
import { api, type PlatformAnalytics } from "../api.js";
import { EmptyState, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

const MIN_ORGS_FOR_TEMPLATE_CELL = 5;

/**
 * Platform-wide analytics (Delivery Plan Step 39), platform_admin only.
 * Per-template cells are suppressed when fewer than
 * MIN_ORGS_FOR_TEMPLATE_CELL distinct organisations used that template, so a
 * cross-tenant figure can never be read back to a single organisation.
 */
export function PlatformAnalyticsPage(): ReactNode {
  const analytics = useQuery(() => api.get<PlatformAnalytics>("/v1/platform/analytics"), []);

  if (analytics.loading) return <Loading label="Loading platform analytics…" />;
  if (analytics.error) return <ErrorState error={analytics.error} onRetry={analytics.reload} />;
  if (!analytics.data) return null;
  const d = analytics.data;

  return (
    <div className="stack">
      <div>
        <h1>Platform analytics</h1>
        <p className="muted">{d.suppressionNote}</p>
      </div>

      <section className="stack">
        <h2>Assessments by status (all organisations)</h2>
        {d.totalAssessmentsByStatus.length === 0 ? (
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
              {d.totalAssessmentsByStatus.map((row) => (
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
        <p className="muted">
          A template's cell is shown only once at least {MIN_ORGS_FOR_TEMPLATE_CELL} distinct organisations have used it.
        </p>
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
                  <td data-label="Sessions">{row.suppressed ? "suppressed" : row.sessionCount}</td>
                  <td data-label="Median reviewer minutes">
                    {row.suppressed
                      ? `< ${MIN_ORGS_FOR_TEMPLATE_CELL} organisations`
                      : (row.medianReviewerMinutes ?? "not yet measured")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
