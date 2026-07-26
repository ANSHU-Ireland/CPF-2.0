import { useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, ApiError, type WorkflowInsightProposal, type WorkflowInsightProposalsView } from "../api.js";
import { Alert, EmptyState, ErrorState, Loading, StatusPill, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

const STATUS_LABEL: Record<WorkflowInsightProposal["status"], string> = {
  proposed: "Proposed",
  approved: "Approved",
  dismissed: "Dismissed",
};

const SOURCE_LABEL: Record<WorkflowInsightProposal["sourceType"], string> = {
  pain_point_theme: "Pain-point theme",
  learning_gap: "Learning gap",
};

/**
 * Workflow Insights (Delivery Plan Step 46, MILESTONE): proposal-only
 * recommendations derived from workforce-intelligence pain-point themes and
 * learning completion gaps. Autonomy level 2 — this page can only generate
 * proposals and let an org_admin approve or dismiss them. There is no button
 * anywhere on this page that executes anything; approving a proposal only
 * records a human decision for audit purposes.
 */
export function WorkflowInsightsPage(): ReactNode {
  const { orgId } = useParams();
  const proposals = useQuery(
    () => api.get<WorkflowInsightProposalsView>(`/v1/orgs/${orgId}/workflow-insights/proposals`),
    [orgId],
  );
  const [generating, setGenerating] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!orgId) return <EmptyState title="No organisation selected" />;

  async function onGenerate(): Promise<void> {
    setActionError(null);
    setGenerating(true);
    try {
      await api.post(`/v1/orgs/${orgId}/workflow-insights/generate`);
      proposals.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not generate proposals.");
    } finally {
      setGenerating(false);
    }
  }

  async function onDecide(proposal: WorkflowInsightProposal, decision: "approve" | "dismiss"): Promise<void> {
    setActionError(null);
    setDecidingId(proposal.id);
    try {
      await api.post(`/v1/orgs/${orgId}/workflow-insights/proposals/${proposal.id}/${decision}`);
      proposals.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not record your decision.");
    } finally {
      setDecidingId(null);
    }
  }

  const openProposals = proposals.data?.proposals.filter((p) => p.status === "proposed") ?? [];
  const decidedProposals = proposals.data?.proposals.filter((p) => p.status !== "proposed") ?? [];

  return (
    <div className="stack">
      <div>
        <h1>Workflow insights</h1>
        <p className="muted">
          Proposal-only recommendations from pain-point themes and learning gaps. Nothing here is executed
          automatically — every proposal waits for you to approve or dismiss it.
        </p>
      </div>

      {actionError ? <Alert kind="danger">{actionError}</Alert> : null}

      <div>
        <button type="button" className="btn" onClick={() => void onGenerate()} disabled={generating}>
          {generating ? "Generating…" : "Generate proposals"}
        </button>
      </div>

      {proposals.loading ? <Loading label="Loading proposals…" /> : null}
      {proposals.error ? <ErrorState error={proposals.error} onRetry={proposals.reload} /> : null}

      {proposals.data ? (
        <section className="stack">
          <h2>Open proposals</h2>
          {openProposals.length === 0 ? (
            <EmptyState title="No open proposals" hint="Generate proposals to see recommendations here." />
          ) : (
            <table className="data responsive-table">
              <caption className="skip-link">Open workflow-insight proposals</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Source</th>
                  <th scope="col">Rationale</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {openProposals.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Title">{p.title}</td>
                    <td data-label="Source">{SOURCE_LABEL[p.sourceType]}</td>
                    <td data-label="Rationale">{p.rationale}</td>
                    <td data-label="Actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={decidingId === p.id}
                        onClick={() => void onDecide(p, "approve")}
                      >
                        Approve
                      </button>{" "}
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={decidingId === p.id}
                        onClick={() => void onDecide(p, "dismiss")}
                      >
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Decided</h2>
          {decidedProposals.length === 0 ? (
            <EmptyState title="No decided proposals yet" />
          ) : (
            <table className="data responsive-table">
              <caption className="skip-link">Decided workflow-insight proposals</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Decided at</th>
                </tr>
              </thead>
              <tbody>
                {decidedProposals.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Title">{p.title}</td>
                    <td data-label="Source">{SOURCE_LABEL[p.sourceType]}</td>
                    <td data-label="Status">
                      <StatusPill value={STATUS_LABEL[p.status]} />
                    </td>
                    <td data-label="Decided at">{p.decidedAt ? formatDate(p.decidedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  );
}
