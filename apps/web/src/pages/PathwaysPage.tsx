import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, type CourseSummary, type OrgUser, type PathwayDetail, type PathwaySummary } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill } from "../ui.js";
import { useQuery } from "../useQuery.js";

/** Pathways: ordered course sequences (Delivery Plan Step 42). */
export function PathwaysPage(): ReactNode {
  const { orgId } = useParams();
  const pathways = useQuery(() => api.get<PathwaySummary[]>(`/v1/orgs/${orgId}/learning/pathways`), [orgId]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/learning/pathways`, { title, description });
      setOpen(false);
      setTitle("");
      setDescription("");
      pathways.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create this pathway.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Pathways</h1>
          <p className="muted">Ordered sequences of courses.</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Create pathway
        </button>
      </div>

      {pathways.loading ? <Loading /> : null}
      {pathways.error ? <ErrorState error={pathways.error} onRetry={pathways.reload} /> : null}
      {pathways.data ? (
        pathways.data.length === 0 ? (
          <EmptyState title="No pathways yet" />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Pathways</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="skip-link">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pathways.data.map((p) => (
                <tr key={p.id}>
                  <td data-label="Title">{p.title}</td>
                  <td data-label="Status">
                    <StatusPill value={p.status} />
                  </td>
                  <td data-label="">
                    <button type="button" className="btn secondary" onClick={() => setSelectedId(p.id)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal open={open} title="Create pathway" onClose={() => setOpen(false)}>
        <form onSubmit={(e) => void onCreate(e)}>
          {formError ? <Alert kind="danger">{formError}</Alert> : null}
          <Field label="Title">
            {({ id }) => <input id={id} required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Description" hint="Optional">
            {({ id }) => (
              <textarea id={id} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>

      {selectedId ? (
        <PathwayDetailPanel orgId={orgId!} pathwayId={selectedId} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}

function PathwayDetailPanel(props: { orgId: string; pathwayId: string; onClose: () => void }): ReactNode {
  const { orgId, pathwayId, onClose } = props;
  const detail = useQuery(() => api.get<PathwayDetail>(`/v1/orgs/${orgId}/learning/pathways/${pathwayId}`), [orgId, pathwayId]);
  const courses = useQuery(() => api.get<CourseSummary[]>(`/v1/orgs/${orgId}/learning/courses`), [orgId]);
  const users = useQuery(() => api.get<OrgUser[]>(`/v1/orgs/${orgId}/users`), [orgId]);

  const [courseToAdd, setCourseToAdd] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [enrolResult, setEnrolResult] = useState<{ enrolled: number; skipped: number } | null>(null);
  const [enrolError, setEnrolError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function linkCourse(): Promise<void> {
    if (!courseToAdd) return;
    setLinkError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/learning/pathways/${pathwayId}/courses`, {
        courseId: courseToAdd,
        position: detail.data?.courses.length ?? 0,
      });
      setCourseToAdd("");
      detail.reload();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Could not link this course.");
    }
  }

  function toggleUser(userId: string): void {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function enrol(): Promise<void> {
    setSubmitting(true);
    setEnrolError(null);
    setEnrolResult(null);
    try {
      const res = await api.post<{ enrolled: number; skipped: number }>(`/v1/orgs/${orgId}/learning/enrollments`, {
        pathwayId,
        userIds: [...selectedUsers],
      });
      setEnrolResult(res);
      setSelectedUsers(new Set());
    } catch (err) {
      setEnrolError(err instanceof Error ? err.message : "Could not enrol these members.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={detail.data?.title ?? "Pathway"} onClose={onClose}>
      {detail.loading ? <Loading /> : null}
      {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {detail.data ? (
        <div className="stack">
          <h3>Linked courses</h3>
          {detail.data.courses.length === 0 ? (
            <EmptyState title="No courses linked yet" />
          ) : (
            <ol>
              {detail.data.courses.map((c) => (
                <li key={c.id}>
                  {c.title} — <StatusPill value={c.status} />
                </li>
              ))}
            </ol>
          )}
          {linkError ? <Alert kind="danger">{linkError}</Alert> : null}
          <div className="row">
            <select value={courseToAdd} onChange={(e) => setCourseToAdd(e.target.value)}>
              <option value="">Select a course to add…</option>
              {(courses.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <button type="button" className="btn secondary" onClick={() => void linkCourse()} disabled={!courseToAdd}>
              Add to pathway
            </button>
          </div>

          <h3>Enrol members</h3>
          {enrolError ? <Alert kind="danger">{enrolError}</Alert> : null}
          {enrolResult ? (
            <Alert kind="success">
              Enrolled {enrolResult.enrolled}, skipped {enrolResult.skipped}.
            </Alert>
          ) : null}
          <ul className="stack">
            {(users.data ?? []).map((u) => (
              <li key={u.id}>
                <label>
                  <input type="checkbox" checked={selectedUsers.has(u.id)} onChange={() => toggleUser(u.id)} />{" "}
                  {u.display_name} ({u.email})
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={() => void enrol()} disabled={submitting || selectedUsers.size === 0}>
            {submitting ? "Enrolling…" : `Enrol ${selectedUsers.size} selected`}
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
