import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, type CandidateImportResult, type CandidateRow, type JobProfileRow, type TemplateSummary } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

interface CandidateList {
  items: CandidateRow[];
  nextCursor: string | null;
}

interface InvitationCreated {
  invitationId: string;
  candidateAccessToken: string;
  expiresAt: string;
  note: string;
}

/** Candidate CRM: search, create (dedupe-aware), and invite to assessment. */
export function CandidatesPage(): ReactNode {
  const { orgId } = useParams();
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const candidates = useQuery(
    () =>
      api.get<CandidateList>(
        `/v1/orgs/${orgId}/candidates${appliedSearch ? `?search=${encodeURIComponent(appliedSearch)}` : ""}`,
      ),
    [orgId, appliedSearch],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [inviteFor, setInviteFor] = useState<CandidateRow | null>(null);
  const [invited, setInvited] = useState<InvitationCreated | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/candidates`, { email, fullName });
      setCreateOpen(false);
      setEmail("");
      setFullName("");
      candidates.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the candidate.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Candidates</h1>
          <p className="muted">One record per candidate per organisation</p>
        </div>
        <div className="row">
          <button type="button" className="btn secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </button>
          <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
            Add candidate
          </button>
        </div>
      </div>

      <form
        className="row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedSearch(search);
        }}
      >
        <Field label="Search by name or e-mail">
          {({ id }) => (
            <input
              id={id}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 280 }}
            />
          )}
        </Field>
        <button type="submit" className="btn secondary">
          Search
        </button>
      </form>

      {candidates.loading ? <Loading /> : null}
      {candidates.error ? <ErrorState error={candidates.error} onRetry={candidates.reload} /> : null}
      {candidates.data ? (
        candidates.data.items.length === 0 ? (
          <EmptyState
            title={appliedSearch ? "No candidates match this search" : "No candidates yet"}
            hint={appliedSearch ? "Try a different name or e-mail." : "Add your first candidate to begin."}
          />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">E-mail</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="skip-link">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {candidates.data.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.full_name}</td>
                  <td>{c.email}</td>
                  <td>
                    <StatusPill value={c.status} />
                  </td>
                  <td>{formatDate(c.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={c.status === "anonymised" || c.status === "withdrawn"}
                      onClick={() => setInviteFor(c)}
                    >
                      Invite to assessment
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal open={createOpen} title="Add candidate" onClose={() => setCreateOpen(false)}>
        <form onSubmit={(e) => void onCreate(e)}>
          {formError ? <Alert kind="danger">{formError}</Alert> : null}
          <Field label="Full name">
            {({ id }) => (
              <input id={id} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            )}
          </Field>
          <Field label="E-mail" hint="One live candidate record per e-mail in this organisation">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Saving…" : "Add candidate"}
          </button>
        </form>
      </Modal>

      {importOpen && orgId ? (
        <ImportModal
          orgId={orgId}
          onClose={() => {
            setImportOpen(false);
            candidates.reload();
          }}
        />
      ) : null}

      {inviteFor && orgId ? (
        <InviteModal
          orgId={orgId}
          candidate={inviteFor}
          created={invited}
          onCreated={setInvited}
          onClose={() => {
            setInviteFor(null);
            setInvited(null);
            candidates.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function InviteModal({
  orgId,
  candidate,
  created,
  onCreated,
  onClose,
}: {
  orgId: string;
  candidate: CandidateRow;
  created: InvitationCreated | null;
  onCreated: (value: InvitationCreated) => void;
  onClose: () => void;
}): ReactNode {
  const jobs = useQuery(() => api.get<JobProfileRow[]>(`/v1/orgs/${orgId}/job-profiles`), [orgId]);
  const templates = useQuery(() => api.get<TemplateSummary[]>("/v1/framework/templates"), []);
  const [jobProfileId, setJobProfileId] = useState("");
  const [templateCode, setTemplateCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<InvitationCreated>(`/v1/orgs/${orgId}/invitations`, {
        candidateId: candidate.id,
        jobProfileId,
        templateCode,
      });
      onCreated(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Invitation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Invite ${candidate.full_name}`} onClose={onClose}>
      {created ? (
        <div className="stack">
          <Alert kind="success">Invitation created (expires {formatDate(created.expiresAt)}).</Alert>
          <div>
            <h3>Candidate access token</h3>
            <p className="muted">
              Deliver this to the candidate out of band (delivery integration is on the roadmap).
              It is shown only once. The candidate enters it at <strong>/candidate</strong>.
            </p>
            <code className="token-once">{created.candidateAccessToken}</code>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)}>
          {formError ? <Alert kind="danger">{formError}</Alert> : null}
          {jobs.loading || templates.loading ? <Loading /> : null}
          {jobs.data && jobs.data.length === 0 ? (
            <Alert kind="warning">Create a job profile first — invitations must be tied to a role.</Alert>
          ) : null}
          {jobs.data && templates.data ? (
            <>
              <Field label="Job profile">
                {({ id }) => (
                  <select id={id} required value={jobProfileId} onChange={(e) => setJobProfileId(e.target.value)}>
                    <option value="">Select…</option>
                    {jobs.data?.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Assessment template" hint="Frozen published version is used for the whole cohort">
                {({ id, describedBy }) => (
                  <select
                    id={id}
                    aria-describedby={describedBy}
                    required
                    value={templateCode}
                    onChange={(e) => setTemplateCode(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {templates.data?.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.title} ({t.timebox})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="submit" className="btn" disabled={submitting || !jobProfileId || !templateCode}>
                {submitting ? "Creating…" : "Create invitation"}
              </button>
            </>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

function rejectsCsv(result: CandidateImportResult): string {
  const rows = [
    "line,reason",
    ...result.skippedDuplicates.map((r) => `${r.line},"Duplicate e-mail: ${r.email}"`),
    ...result.invalid.map((r) => `${r.line},"${r.reason.replace(/"/g, '""')}"`),
  ];
  return rows.join("\n");
}

function downloadRejects(result: CandidateImportResult): void {
  const blob = new Blob([rejectsCsv(result)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "candidate-import-rejects.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/** Bulk candidate import: upload a "name,email" CSV, show a partition report. */
function ImportModal({ orgId, onClose }: { orgId: string; onClose: () => void }): ReactNode {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<CandidateImportResult | null>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileText(await file.text());
    setFormError(null);
    setResult(null);
  }

  async function onImport(): Promise<void> {
    if (!fileText) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.postText<CandidateImportResult>(
        `/v1/orgs/${orgId}/candidates/import`,
        fileText,
        "text/csv",
      );
      setResult(res);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title="Import candidates from CSV" onClose={onClose}>
      {result ? (
        <div className="stack">
          <Alert kind={result.invalid.length > 0 || result.skippedDuplicates.length > 0 ? "warning" : "success"}>
            Imported {result.created} candidate{result.created === 1 ? "" : "s"}. {result.skippedDuplicates.length}{" "}
            duplicate{result.skippedDuplicates.length === 1 ? "" : "s"} skipped, {result.invalid.length} invalid row
            {result.invalid.length === 1 ? "" : "s"}.
          </Alert>
          {result.skippedDuplicates.length > 0 || result.invalid.length > 0 ? (
            <button type="button" className="btn secondary" onClick={() => downloadRejects(result)}>
              Download rejected rows (CSV)
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="stack">
          {formError ? <Alert kind="danger">{formError}</Alert> : null}
          <p className="muted">
            Upload a CSV with a header row of <code>name,email</code>. Up to 2000 rows, 1MB.
          </p>
          <Field label="CSV file">
            {({ id }) => <input id={id} type="file" accept=".csv,text/csv" onChange={(e) => void onFileChange(e)} />}
          </Field>
          {fileName ? <p className="muted">Selected: {fileName}</p> : null}
          <button type="button" className="btn" disabled={!fileText || submitting} onClick={() => void onImport()}>
            {submitting ? "Importing…" : "Import"}
          </button>
        </div>
      )}
    </Modal>
  );
}
