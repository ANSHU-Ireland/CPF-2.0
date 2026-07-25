import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { api, type ReviewQueueRow } from "../api.js";
import { EmptyState, ErrorState, Loading, StatusPill, formatDate } from "../ui.js";
import { routes } from "../routes.js";
import { useQuery } from "../useQuery.js";

/** Reviewer's assigned review queue. */
export function ReviewQueuePage(): ReactNode {
  const { orgId } = useParams();
  const reviews = useQuery(() => api.get<ReviewQueueRow[]>(`/v1/orgs/${orgId}/reviews/mine`), [orgId]);

  return (
    <div className="stack">
      <div>
        <h1>My reviews</h1>
        <p className="muted">Assessment sessions assigned to you for review</p>
      </div>

      {reviews.loading ? <Loading /> : null}
      {reviews.error ? <ErrorState error={reviews.error} onRetry={reviews.reload} /> : null}
      {reviews.data ? (
        reviews.data.length === 0 ? (
          <EmptyState title="No reviews assigned" hint="Assigned sessions will appear here." />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Reviews assigned to me</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Submitted</th>
                <th scope="col">Assigned</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {reviews.data.map((r) => (
                <tr key={r.id}>
                  <td data-label="Status">
                    <StatusPill value={r.status} />
                  </td>
                  <td data-label="Submitted">{formatDate(r.submitted_at)}</td>
                  <td data-label="Assigned">{formatDate(r.created_at)}</td>
                  <td data-label="">
                    <Link className="btn secondary" to={routes.orgReview(orgId!, r.id)}>
                      Open workspace
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}

