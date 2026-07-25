import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { dataRightsMachine, type DataRightsEvent, type DataRightsState } from "@cpf/assessment-framework/state-machines";
import { api, ApiError, type CandidateRow, type DataRightsRow, type LegalHoldRow } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

const ALL_EVENTS: DataRightsEvent[] = [
  "verify_identity",
  "begin",
  "refer_to_controller",
  "controller_responded",
  "fulfil",
  "refuse_with_grounds",
  "withdraw",
];

const EVENT_LABELS: Record<DataRightsEvent, string> = {
  verify_identity: "Verify identity",
  begin: "Begin processing",
  refer_to_controller: "Refer to controller",
  controller_responded: "Controller responded",
  fulfil: "Fulfil",
  refuse_with_grounds: "Refuse (with grounds)",
  withdraw: "Withdraw",
};

function allowedEvents(status: string): DataRightsEvent[] {
  return ALL_EVENTS.filter((event) => dataRightsMachine.can(status as DataRightsState, event));
}

function TransitionModal({
  request,
  orgId,
  event,
  onClose,
  onDone,
}: {
  request: DataRightsRow;
  orgId: string;
  event: DataRightsEvent;
  onClose: () => void;
  onDone: () => void;
}): ReactNode {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [legalHoldBlocked, setLegalHoldBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setLegalHoldBlocked(false);
    try {
      await api.post(`/v1/orgs/${orgId}/data-rights/${request.id}/transition`, {
        event,
        ...(note ? { note } : {}),
      });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "LEGAL_HOLD_ACTIVE") {
        setLegalHoldBlocked(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not apply this transition.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`${EVENT_LABELS[event]} — ${request.candidate_name}`} onClose={onClose}>
      {legalHoldBlocked ? (
        <Alert kind="warning">
          An active legal hold prevents erasure for this candidate. Release the legal hold first,
          then retry fulfilment.
        </Alert>
      ) : null}
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <form onSubmit={(e) => void onSubmit(e)}>
        <Field label="Note (optional)">
          {({ id }) => <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Saving…" : "Confirm"}
        </button>
      </form>
    </Modal>
  );
}

function PlaceLegalHoldModal({
  orgId,
  onClose,
  onPlaced,
}: {
  orgId: string;
  onClose: () => void;
  onPlaced: () => void;
}): ReactNode {
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ items: CandidateRow[] }>(`/v1/orgs/${orgId}/candidates?limit=100`)
      .then((res) => {
        if (!alive) return;
        setCandidates(res.items);
        setCandidateId(res.items[0]?.id ?? "");
      })
      .catch(() => {
        if (alive) setCandidates([]);
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/legal-holds`, { candidateId, reason });
      onPlaced();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the legal hold.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title="Place legal hold" onClose={onClose}>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      {candidates === null ? (
        <Loading label="Loading candidates…" />
      ) : candidates.length === 0 ? (
        <Alert kind="warning">No candidates available in this organisation yet.</Alert>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)}>
          <Field label="Candidate">
            {({ id }) => (
              <select id={id} required value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.email})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Reason" hint="At least 5 characters, kept for compliance evidence">
            {({ id, describedBy }) => (
              <textarea
                id={id}
                aria-describedby={describedBy}
                required
                minLength={5}
                maxLength={2_000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Placing…" : "Place legal hold"}
          </button>
        </form>
      )}
    </Modal>
  );
}

/** Data subject rights request queue + legal holds (admin-only). */
export function DataRightsPage(): ReactNode {
  const { orgId } = useParams();
  const requests = useQuery(() => api.get<DataRightsRow[]>(`/v1/orgs/${orgId}/data-rights`), [orgId]);
  const holds = useQuery(() => api.get<LegalHoldRow[]>(`/v1/orgs/${orgId}/legal-holds`), [orgId]);

  const [transitionFor, setTransitionFor] = useState<{ request: DataRightsRow; event: DataRightsEvent } | null>(null);
  const [placeHoldOpen, setPlaceHoldOpen] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  async function releaseHold(hold: LegalHoldRow): Promise<void> {
    setReleaseError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/legal-holds/${hold.id}/release`);
      holds.reload();
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : "Could not release the legal hold.");
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Data rights</h1>
        <p className="muted">Data subject requests and legal holds</p>
      </div>

      {requests.loading ? <Loading /> : null}
      {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
      {requests.data ? (
        requests.data.length === 0 ? (
          <EmptyState title="No data rights requests" />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Data subject requests</caption>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col">Due</th>
                <th scope="col"><span className="skip-link">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {requests.data.map((r) => (
                <tr key={r.id}>
                  <td data-label="Candidate">{r.candidate_name}</td>
                  <td data-label="Type">{r.request_type.replaceAll("_", " ")}</td>
                  <td data-label="Status">
                    <StatusPill value={r.status} />
                  </td>
                  <td data-label="Received">{formatDate(r.received_at)}</td>
                  <td data-label="Due">
                    {formatDate(r.due_at)} {r.overdue ? <span className="pill band limited">OVERDUE</span> : null}
                  </td>
                  <td data-label="" className="row">
                    {allowedEvents(r.status).map((event) => (
                      <button
                        key={event}
                        type="button"
                        className="btn secondary"
                        onClick={() => setTransitionFor({ request: r, event })}
                      >
                        {EVENT_LABELS[event]}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <div className="spread">
        <h2>Legal holds</h2>
        <button type="button" className="btn" onClick={() => setPlaceHoldOpen(true)}>
          Place legal hold
        </button>
      </div>
      {releaseError ? <Alert kind="danger">{releaseError}</Alert> : null}
      {holds.loading ? <Loading /> : null}
      {holds.error ? <ErrorState error={holds.error} onRetry={holds.reload} /> : null}
      {holds.data ? (
        holds.data.length === 0 ? (
          <EmptyState title="No legal holds" />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Legal holds</caption>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Reason</th>
                <th scope="col">Placed</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="skip-link">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {holds.data.map((h) => (
                <tr key={h.id}>
                  <td data-label="Candidate">{h.candidate_name}</td>
                  <td data-label="Reason">{h.reason}</td>
                  <td data-label="Placed">{formatDate(h.placed_at)}</td>
                  <td data-label="Status">{h.released_at ? "Released" : "Active"}</td>
                  <td data-label="">
                    {h.released_at ? null : (
                      <button type="button" className="btn secondary" onClick={() => void releaseHold(h)}>
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {transitionFor ? (
        <TransitionModal
          request={transitionFor.request}
          orgId={orgId!}
          event={transitionFor.event}
          onClose={() => setTransitionFor(null)}
          onDone={() => requests.reload()}
        />
      ) : null}
      {placeHoldOpen ? (
        <PlaceLegalHoldModal
          orgId={orgId!}
          onClose={() => setPlaceHoldOpen(false)}
          onPlaced={() => holds.reload()}
        />
      ) : null}
    </div>
  );
}

