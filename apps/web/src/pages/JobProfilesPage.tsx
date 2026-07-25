import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, type JobProfileRow } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

const ROLE_FAMILIES = [
  { value: "software-engineering", label: "Software engineering" },
  { value: "digital-marketing", label: "Digital marketing" },
];

/** Job profiles: table + create modal (title, role family, description). */
export function JobProfilesPage(): ReactNode {
  const { orgId } = useParams();
  const profiles = useQuery(() => api.get<JobProfileRow[]>(`/v1/orgs/${orgId}/job-profiles`), [orgId]);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [roleFamily, setRoleFamily] = useState(ROLE_FAMILIES[0]!.value);
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/job-profiles`, { title, roleFamily, description });
      setOpen(false);
      setTitle("");
      setRoleFamily(ROLE_FAMILIES[0]!.value);
      setDescription("");
      profiles.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the job profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Job profiles</h1>
          <p className="muted">Roles hiring is running assessments against</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Add job profile
        </button>
      </div>

      {profiles.loading ? <Loading /> : null}
      {profiles.error ? <ErrorState error={profiles.error} onRetry={profiles.reload} /> : null}
      {profiles.data ? (
        profiles.data.length === 0 ? (
          <EmptyState title="No job profiles yet" hint="Add your first job profile to begin." />
        ) : (
          <table className="data">
            <caption className="skip-link">Job profiles</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Role family</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {profiles.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>{p.role_family}</td>
                  <td>
                    <StatusPill value={p.status} />
                  </td>
                  <td>{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal open={open} title="Add job profile" onClose={() => setOpen(false)}>
        <form onSubmit={(e) => void onCreate(e)}>
          {formError ? <Alert kind="danger">{formError}</Alert> : null}
          <Field label="Title">
            {({ id }) => (
              <input id={id} required minLength={2} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            )}
          </Field>
          <Field label="Role family">
            {({ id }) => (
              <select id={id} required value={roleFamily} onChange={(e) => setRoleFamily(e.target.value)}>
                {ROLE_FAMILIES.map((rf) => (
                  <option key={rf.value} value={rf.value}>
                    {rf.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Description" hint="Optional context for reviewers">
            {({ id, describedBy }) => (
              <textarea
                id={id}
                aria-describedby={describedBy}
                maxLength={10_000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Creating…" : "Create job profile"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

