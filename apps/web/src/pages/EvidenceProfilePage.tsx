import { useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { ApiError, api, type EvidenceProfile, type ResponsibleUseAck } from "../api.js";
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
  const ack = useQuery(
    () => api.get<ResponsibleUseAck>(`/v1/orgs/${orgId}/acknowledgements/responsible-use`),
    [orgId],
  );

  if (ack.loading) return <Loading label="Loading…" />;
  if (ack.error) return <ErrorState error={ack.error} onRetry={ack.reload} />;
  if (!ack.data) return null;
  if (!ack.data.acknowledged) {
    return <ResponsibleUseGate orgId={orgId!} document={ack.data} onAcknowledged={ack.reload} />;
  }

  return <ProfileView orgId={orgId!} sessionId={sessionId!} />;
}

function ResponsibleUseGate(props: {
  orgId: string;
  document: ResponsibleUseAck;
  onAcknowledged: () => void;
}): ReactNode {
  const { orgId, document, onAcknowledged } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/acknowledgements/responsible-use`, { version: document.version });
      onAcknowledged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record acknowledgement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <h1>{document.title}</h1>
      <div className="card stack">
        {document.sections.map((section, i) => (
          <p key={i}>{section}</p>
        ))}
      </div>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <button className="btn" type="button" onClick={acknowledge} disabled={submitting}>
        {submitting ? "Recording…" : "I acknowledge and continue"}
      </button>
    </div>
  );
}

function ProfileView(props: { orgId: string; sessionId: string }): ReactNode {
  const { orgId, sessionId } = props;
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
        <h2>AI Collaboration Profile</h2>
        <p className="muted">
          A narrative lens assembled by the reviewer from Evidence Ledger claims — never a score, never raw
          evidence.
        </p>
        <div className="stack">
          {data.collaborationProfile.map((d) => (
            <div key={d.dimension} className="card stack">
              <div className="spread">
                <strong>{d.dimension}</strong>
                <BandBadge band={d.band} />
              </div>
              {d.claims.length === 0 ? (
                <p className="muted">Not assessed.</p>
              ) : (
                <ul>
                  {d.claims.map((claim, i) => (
                    <li key={i}>
                      <p>{claim.claim}</p>
                      {claim.counterEvidence ? <p className="muted">Counter-evidence: {claim.counterEvidence}</p> : null}
                      {claim.limitations ? <p className="muted">Limitations: {claim.limitations}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>

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

