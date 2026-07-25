import type { ReactNode } from "react";
import { useParams } from "react-router";
import { ApiError, api, type EvidenceProfile } from "../api.js";
import { Alert, BandBadge, EmptyState, ErrorState, Loading, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

const ROUTE_LABELS: Record<string, string> = {
  standard_review: "Standard review",
  insufficient_evidence: "Insufficient evidence",
  accommodation_review: "Accommodation-adjusted review",
};

/** Employer-facing Evidence Profile (decision support, never a hire/reject verdict). */
export function EvidenceProfilePage(): ReactNode {
  const { orgId, sessionId } = useParams();
  const profile = useQuery(
    () => api.get<EvidenceProfile>(`/v1/orgs/${orgId}/sessions/${sessionId}/evidence-profile`),
    [orgId, sessionId],
  );

  if (profile.loading) return <Loading label="Loading evidence profile…" />;
  if (profile.error) {
    if (profile.error instanceof ApiError && profile.error.code === "REPORT_NOT_ISSUED") {
      return (
        <EmptyState
          title="Evidence profile not yet available"
          hint="This becomes available once the reviewer has finalised their assessment and the report has been issued."
        />
      );
    }
    return <ErrorState error={profile.error} onRetry={profile.reload} />;
  }
  if (!profile.data) return null;
  const data = profile.data;

  return (
    <div className="stack">
      <h1>Evidence profile</h1>

      <div className="card stack">
        <h2>Reviewer summary</h2>
        <p>{data.reviewerSummary.rationale}</p>
        <p className="muted">
          Confidence: {data.reviewerSummary.confidence} · Finalised {formatDate(data.reviewerSummary.finalisedAt)}
        </p>
        <p className="muted">Limitations: {data.reviewerSummary.limitations}</p>
      </div>

      {data.accommodationsNote ? <Alert kind="info">Accommodations: {data.accommodationsNote}</Alert> : null}

      <Alert kind="info">
        Decision-support route: {ROUTE_LABELS[data.decisionSupportRoute] ?? data.decisionSupportRoute}
      </Alert>

      <div className="card stack">
        <h2>Dimension bands</h2>
        <div className="row">
          {data.dimensions.map((d) => (
            <div key={d.key} className="stack">
              <BandBadge band={d.band} />
              <span className="muted">{d.name}</span>
            </div>
          ))}
        </div>
      </div>

      {data.criticalConcerns.length > 0 ? (
        <div className="card stack">
          <h2>Areas warranting closer attention</h2>
          <p className="muted">
            These are framed as concerns for structured follow-up in interview — not an outcome judgement.
          </p>
          <ul>
            {data.criticalConcerns.map((c) => (
              <li key={c.criterionId}>{c.criterionId}: consider probing this area further in interview.</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="stack">
        <h2>Interview probes</h2>
        {data.interviewProbes.map((p) => (
          <details key={p.criterionId}>
            <summary>{p.criterionId}</summary>
            <p>{p.probe}</p>
          </details>
        ))}
      </div>

      <p className="muted">{data.governanceNote}</p>
    </div>
  );
}

