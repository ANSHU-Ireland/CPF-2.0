import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import {
  api,
  ApiError,
  type AuditChainVerification,
  type AuditSearchResponse,
  type DataRightsRow,
  type RetentionPolicyResponse,
} from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

const MAX_RETENTION_DAYS = 3650;
const DELETION_MODES = ["anonymise_then_delete", "hard_delete"] as const;

/** Audit explorer: filter/search the org's audit trail, verify chain integrity, export a CSV slice. */
function AuditExplorer({ orgId }: { orgId: string }): ReactNode {
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (entityType) params.set("entityType", entityType);
    if (action) params.set("action", action);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    return params.toString();
  }, [entityType, action, from, to, offset]);

  const results = useQuery(
    () => api.get<AuditSearchResponse>(`/v1/orgs/${orgId}/audit/search?${query}`),
    [orgId, query],
  );

  const [chainResult, setChainResult] = useState<AuditChainVerification | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [chainChecking, setChainChecking] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function verifyChain(): Promise<void> {
    setChainChecking(true);
    setChainError(null);
    try {
      const result = await api.get<AuditChainVerification>(`/v1/orgs/${orgId}/audit/verify-chain`);
      setChainResult(result);
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Could not verify the audit chain.");
    } finally {
      setChainChecking(false);
    }
  }

  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await api.getBlob(`/v1/orgs/${orgId}/audit/export?${query}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError && err.code === "STEP_UP_REQUIRED") {
        setExportError(
          "This export requires a recently-verified session. Sign out and back in, then retry within a few minutes.",
        );
      } else {
        setExportError(err instanceof Error ? err.message : "Could not export the audit log.");
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="stack">
      <div className="spread">
        <h2>Audit explorer</h2>
        <div className="row">
          <button type="button" className="btn secondary" onClick={() => void verifyChain()} disabled={chainChecking}>
            {chainChecking ? "Verifying…" : "Verify chain integrity"}
          </button>
          <button type="button" className="btn" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {chainError ? <Alert kind="danger">{chainError}</Alert> : null}
      {chainResult ? (
        <Alert kind={chainResult.valid ? "success" : "danger"}>
          {chainResult.valid
            ? `Chain verified: ${chainResult.entries} entries, no tampering detected.`
            : `Chain integrity FAILED at entry id ${chainResult.firstBrokenId}. Escalate immediately.`}
        </Alert>
      ) : null}
      {exportError ? <Alert kind="danger">{exportError}</Alert> : null}

      <form
        className="row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setOffset(0);
          results.reload();
        }}
      >
        <Field label="Entity type">
          {({ id }) => (
            <input id={id} value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. candidate" />
          )}
        </Field>
        <Field label="Action">
          {({ id }) => <input id={id} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. data_rights.fulfilled" />}
        </Field>
        <Field label="From">{({ id }) => <input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{({ id }) => <input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        <button type="submit" className="btn secondary">
          Apply filters
        </button>
      </form>

      {results.loading ? <Loading /> : null}
      {results.error ? <ErrorState error={results.error} onRetry={results.reload} /> : null}
      {results.data ? (
        results.data.items.length === 0 ? (
          <EmptyState title="No matching audit entries" />
        ) : (
          <>
            <table className="data responsive-table">
              <caption className="skip-link">Audit log entries</caption>
              <thead>
                <tr>
                  <th scope="col">Occurred</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity type</th>
                  <th scope="col">Entity id</th>
                </tr>
              </thead>
              <tbody>
                {results.data.items.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Occurred">{formatDate(row.occurred_at)}</td>
                    <td data-label="Action">{row.action}</td>
                    <td data-label="Entity type">{row.entity_type}</td>
                    <td data-label="Entity id">{row.entity_id ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
                disabled={offset === 0}
              >
                Previous
              </button>
              <span className="muted">
                Showing {offset + 1}–{Math.min(offset + limit, results.data.total)} of {results.data.total}
              </span>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setOffset((o) => o + limit)}
                disabled={offset + limit >= results.data.total}
              >
                Next
              </button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

/** Retention dashboard: last executed sweep + a bounds-validated policy editor. */
function RetentionDashboard({ orgId }: { orgId: string }): ReactNode {
  const policyQuery = useQuery(() => api.get<RetentionPolicyResponse>(`/v1/orgs/${orgId}/retention-policy`), [orgId]);
  const [evidenceDays, setEvidenceDays] = useState("180");
  const [integrityDays, setIntegrityDays] = useState("90");
  const [auditDays, setAuditDays] = useState("730");
  const [deletionMode, setDeletionMode] = useState<(typeof DELETION_MODES)[number]>("anonymise_then_delete");
  const [initialised, setInitialised] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  if (policyQuery.data?.policy && !initialised) {
    setEvidenceDays(String(policyQuery.data.policy.evidence_retention_days));
    setIntegrityDays(String(policyQuery.data.policy.integrity_retention_days));
    setAuditDays(String(policyQuery.data.policy.audit_retention_days));
    setDeletionMode(policyQuery.data.policy.deletion_mode);
    setInitialised(true);
  }

  function validateDays(label: string, value: string): string | null {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_RETENTION_DAYS) {
      return `${label} must be a whole number between 1 and ${MAX_RETENTION_DAYS}.`;
    }
    return null;
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setSaved(false);
    const errors = [
      validateDays("Evidence retention", evidenceDays),
      validateDays("Integrity retention", integrityDays),
      validateDays("Audit retention", auditDays),
    ].filter((v): v is string => v !== null);
    if (errors.length > 0) {
      setFormError(errors[0] ?? null);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/v1/orgs/${orgId}/retention-policy`, {
        evidenceRetentionDays: Number(evidenceDays),
        integrityRetentionDays: Number(integrityDays),
        auditRetentionDays: Number(auditDays),
        deletionMode,
      });
      setSaved(true);
      policyQuery.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not update the retention policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <h2>Retention dashboard</h2>
      {policyQuery.loading ? <Loading /> : null}
      {policyQuery.error ? <ErrorState error={policyQuery.error} onRetry={policyQuery.reload} /> : null}
      {policyQuery.data ? (
        <>
          <p className="muted">
            Last retention sweep:{" "}
            {policyQuery.data.lastRun ? formatDate(policyQuery.data.lastRun.occurredAt) : "no sweep has run yet"}.{" "}
            {policyQuery.data.nextDueEstimateNote}
          </p>
          <form className="stack" noValidate onSubmit={(e) => void onSubmit(e)}>
            {formError ? <Alert kind="danger">{formError}</Alert> : null}
            {saved ? <Alert kind="success">Retention policy updated.</Alert> : null}
            <Field label="Evidence retention (days)" hint={`1–${MAX_RETENTION_DAYS}`}>
              {({ id }) => (
                <input id={id} type="number" min={1} max={MAX_RETENTION_DAYS} value={evidenceDays} onChange={(e) => setEvidenceDays(e.target.value)} />
              )}
            </Field>
            <Field label="Integrity retention (days)" hint={`1–${MAX_RETENTION_DAYS}`}>
              {({ id }) => (
                <input id={id} type="number" min={1} max={MAX_RETENTION_DAYS} value={integrityDays} onChange={(e) => setIntegrityDays(e.target.value)} />
              )}
            </Field>
            <Field label="Audit retention (days)" hint={`1–${MAX_RETENTION_DAYS}`}>
              {({ id }) => (
                <input id={id} type="number" min={1} max={MAX_RETENTION_DAYS} value={auditDays} onChange={(e) => setAuditDays(e.target.value)} />
              )}
            </Field>
            <Field label="Deletion mode">
              {({ id }) => (
                <select id={id} value={deletionMode} onChange={(e) => setDeletionMode(e.target.value as (typeof DELETION_MODES)[number])}>
                  {DELETION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving…" : "Save policy"}
            </button>
          </form>
        </>
      ) : null}
    </section>
  );
}

const SLA_BUCKETS = ["Overdue", "Due within 3 days", "Due within 7 days", "On track", "Resolved"] as const;

function bucketFor(row: DataRightsRow): (typeof SLA_BUCKETS)[number] {
  if (row.resolved_at) return "Resolved";
  if (row.overdue) return "Overdue";
  const daysUntilDue = (new Date(row.due_at).getTime() - Date.now()) / 86_400_000;
  if (daysUntilDue <= 3) return "Due within 3 days";
  if (daysUntilDue <= 7) return "Due within 7 days";
  return "On track";
}

/** DSR SLA view: aging buckets computed client-side from the existing data-rights list (no new endpoint). */
function DsrSlaView({ orgId }: { orgId: string }): ReactNode {
  const requests = useQuery(() => api.get<DataRightsRow[]>(`/v1/orgs/${orgId}/data-rights`), [orgId]);

  const buckets = useMemo(() => {
    const counts = new Map<(typeof SLA_BUCKETS)[number], number>(SLA_BUCKETS.map((b) => [b, 0]));
    for (const row of requests.data ?? []) {
      const bucket = bucketFor(row);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return counts;
  }, [requests.data]);

  return (
    <section className="stack">
      <h2>Data rights SLA</h2>
      {requests.loading ? <Loading /> : null}
      {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
      {requests.data ? (
        requests.data.length === 0 ? (
          <EmptyState title="No data rights requests" />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Data rights SLA aging buckets</caption>
            <thead>
              <tr>
                {SLA_BUCKETS.map((b) => (
                  <th scope="col" key={b}>
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {SLA_BUCKETS.map((b) => (
                  <td data-label={b} key={b}>
                    {buckets.get(b) ?? 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )
      ) : null}
    </section>
  );
}

export function CompliancePage(): ReactNode {
  const { orgId } = useParams();
  if (!orgId) return <EmptyState title="No organisation selected" />;

  return (
    <div className="stack">
      <div>
        <h1>Compliance</h1>
        <p className="muted">Audit explorer, retention policy, and data rights SLA tracking</p>
      </div>
      <AuditExplorer orgId={orgId} />
      <RetentionDashboard orgId={orgId} />
      <DsrSlaView orgId={orgId} />
    </div>
  );
}
