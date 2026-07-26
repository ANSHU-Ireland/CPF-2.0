import type { ReactNode } from "react";
import { useParams } from "react-router";
import { api, type ManagerView } from "../api.js";
import { EmptyState, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

/**
 * Manager view (Delivery Plan Step 42): aggregate learning completion.
 *
 * SCOPE NOTE: the delivery plan describes this as "by team", but the schema
 * has no team/reporting-line concept — org_memberships is flat org+role.
 * This aggregates by COURSE across the whole organisation instead, an
 * explicit, disclosed scope reduction (see learning.ts's manager-view
 * route). A course's figures are suppressed until at least 5 learners are
 * enrolled, so no cell can ever reveal a single learner's standing.
 */
export function ManagerViewPage(): ReactNode {
  const { orgId } = useParams();
  const view = useQuery(() => api.get<ManagerView>(`/v1/orgs/${orgId}/learning/manager-view`), [orgId]);

  if (view.loading) return <Loading label="Loading manager view…" />;
  if (view.error) return <ErrorState error={view.error} onRetry={view.reload} />;
  if (!view.data) return null;

  return (
    <div className="stack">
      <div>
        <h1>Learning completion (manager view)</h1>
        <p className="muted">{view.data.suppressionNote}</p>
      </div>

      {view.data.courses.length === 0 ? (
        <EmptyState title="No courses yet" />
      ) : (
        <table className="data responsive-table">
          <caption className="skip-link">Completion by course</caption>
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col">Enrolled</th>
              <th scope="col">Completed</th>
              <th scope="col">Completion rate</th>
            </tr>
          </thead>
          <tbody>
            {view.data.courses.map((c) => (
              <tr key={c.courseId}>
                <td data-label="Course">{c.title}</td>
                <td data-label="Enrolled">{c.suppressed ? "Suppressed (fewer than 5 enrolled)" : c.enrolledCount}</td>
                <td data-label="Completed">{c.suppressed ? "—" : c.completedCount}</td>
                <td data-label="Completion rate">
                  {c.suppressed || c.completionRate === null ? "—" : `${Math.round(c.completionRate * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
