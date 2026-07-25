import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { api, type OrgUser, type SessionRow } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill, formatDate } from "../ui.js";
import { routes } from "../routes.js";
import { useQuery } from "../useQuery.js";

/** Row action derived only from the session's own status field. The server
 * still enforces every transition; a rejected action surfaces via Alert. */
function rowAction(session: SessionRow): "assign" | "issue" | "profile" | null {
  if (session.status === "submitted") return "assign";
  if (session.status === "review_finalised") return "issue";
  if (session.status === "report_issued") return "profile";
  return null;
}

function AssignReviewerModal({
  session,
  orgId,
  onClose,
  onAssigned,
}: {
  session: SessionRow;
  orgId: string;
  onClose: () => void;
  onAssigned: () => void;
}): ReactNode {
  const [reviewers, setReviewers] = useState<OrgUser[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reviewerUserId, setReviewerUserId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<OrgUser[]>(`/v1/orgs/${orgId}/users`)
      .then((users) => {
        if (!alive) return;
        const eligible = users.filter((u) => u.roles.includes("reviewer"));
        setReviewers(eligible);
        setReviewerUserId(eligible[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err);
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  async function onSubmit(): Promise<void> {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/sessions/${session.id}/reviews`, { reviewerUserId });
      onAssigned();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not assign a reviewer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Assign reviewer — ${session.candidate_name}`} onClose={onClose}>
      {loadError ? <ErrorState error={loadError} /> : null}
      {submitError ? <Alert kind="danger">{submitError}</Alert> : null}
      {reviewers === null && !loadError ? (
        <Loading label="Loading reviewers…" />
      ) : reviewers && reviewers.length === 0 ? (
        <Alert kind="warning">No reviewer-role members are available in this organisation yet.</Alert>
      ) : reviewers ? (
        <div className="stack">
          <Field label="Reviewer">
            {({ id }) => (
              <select id={id} value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)}>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name} ({r.email})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="button" className="btn" disabled={submitting} onClick={() => void onSubmit()}>
            {submitting ? "Assigning…" : "Assign reviewer"}
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

function IssueReportModal({
  session,
  orgId,
  onClose,
  onIssued,
}: {
  session: SessionRow;
  orgId: string;
  onClose: () => void;
  onIssued: () => void;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onConfirm(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/sessions/${session.id}/issue-report`);
      onIssued();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not issue the report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Issue report — ${session.candidate_name}`} onClose={onClose}>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <p>
        This makes the evidence profile available to hiring stakeholders. This action cannot be
        undone.
      </p>
      <button type="button" className="btn" disabled={submitting} onClick={() => void onConfirm()}>
        {submitting ? "Issuing…" : "Issue report"}
      </button>
    </Modal>
  );
}

/** Core employer surface: assessment session pipeline with state-derived actions. */
export function SessionsPage(): ReactNode {
  const { orgId } = useParams();
  const sessions = useQuery(() => api.get<SessionRow[]>(`/v1/orgs/${orgId}/sessions`), [orgId]);
  const [assignTarget, setAssignTarget] = useState<SessionRow | null>(null);
  const [issueTarget, setIssueTarget] = useState<SessionRow | null>(null);

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Assessment pipeline</h1>
          <p className="muted">Candidate sessions in this organisation</p>
        </div>
        <button type="button" className="btn secondary" onClick={() => sessions.reload()}>
          Refresh
        </button>
      </div>

      {sessions.loading ? <Loading /> : null}
      {sessions.error ? <ErrorState error={sessions.error} onRetry={sessions.reload} /> : null}
      {sessions.data ? (
        sessions.data.length === 0 ? (
          <EmptyState title="No sessions yet" hint="Invite a candidate to an assessment to begin." />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Assessment sessions</caption>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Job</th>
                <th scope="col">Template</th>
                <th scope="col">Status</th>
                <th scope="col">Review</th>
                <th scope="col">Accommodations</th>
                <th scope="col">Submitted</th>
                <th scope="col"><span className="skip-link">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((s) => {
                const action = rowAction(s);
                return (
                  <tr key={s.id}>
                    <td data-label="Candidate">
                      {s.candidate_name} <span className="muted">({s.candidate_email})</span>
                    </td>
                    <td data-label="Job">{s.job_title}</td>
                    <td data-label="Template">{s.template_code}</td>
                    <td data-label="Status">
                      <StatusPill value={s.status} />
                    </td>
                    <td data-label="Review">{s.review_status ? <StatusPill value={s.review_status} /> : "—"}</td>
                    <td data-label="Accommodations">{s.has_accommodations ? "Yes" : "—"}</td>
                    <td data-label="Submitted">{formatDate(s.submitted_at)}</td>
                    <td data-label="">
                      {action === "assign" ? (
                        <button type="button" className="btn secondary" onClick={() => setAssignTarget(s)}>
                          Assign reviewer
                        </button>
                      ) : action === "issue" ? (
                        <button type="button" className="btn secondary" onClick={() => setIssueTarget(s)}>
                          Issue report
                        </button>
                      ) : action === "profile" ? (
                        <Link className="btn secondary" to={routes.sessionProfile(orgId!, s.id)}>
                          View evidence profile
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : null}

      {assignTarget ? (
        <AssignReviewerModal
          session={assignTarget}
          orgId={orgId!}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            sessions.reload();
          }}
        />
      ) : null}
      {issueTarget ? (
        <IssueReportModal
          session={issueTarget}
          orgId={orgId!}
          onClose={() => setIssueTarget(null)}
          onIssued={() => {
            sessions.reload();
          }}
        />
      ) : null}
    </div>
  );
}

