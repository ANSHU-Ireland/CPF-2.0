import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type CourseSummary } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill } from "../ui.js";
import { useQuery } from "../useQuery.js";
import { routes } from "../routes.js";

/**
 * Learning admin: course catalogue + create (Delivery Plan Step 42).
 * `org_admin`/`learning_admin` only — enforced server-side, this page just
 * surfaces the resulting 403 via ErrorState if reached without the role.
 */
export function LearningAdminPage(): ReactNode {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const courses = useQuery(() => api.get<CourseSummary[]>(`/v1/orgs/${orgId}/learning/courses`), [orgId]);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<{ id: string }>(`/v1/orgs/${orgId}/learning/courses`, { title, description });
      setOpen(false);
      setTitle("");
      setDescription("");
      navigate(routes.orgLearningCourseBuilder(orgId!, result.id));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create this course.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Learning admin</h1>
          <p className="muted">Author and publish courses for this organisation.</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Create course
        </button>
      </div>

      {courses.loading ? <Loading /> : null}
      {courses.error ? <ErrorState error={courses.error} onRetry={courses.reload} /> : null}

      {courses.data ? (
        courses.data.length === 0 ? (
          <EmptyState title="No courses yet" hint="Create your first course to begin authoring." />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Courses</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Published</th>
                <th scope="col"><span className="skip-link">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {courses.data.map((c) => (
                <tr key={c.id}>
                  <td data-label="Title">{c.title}</td>
                  <td data-label="Status">
                    <StatusPill value={c.status} />
                  </td>
                  <td data-label="Published">{c.published_at ? new Date(c.published_at).toLocaleDateString() : "—"}</td>
                  <td data-label="">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => navigate(routes.orgLearningCourseBuilder(orgId!, c.id))}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal open={open} title="Create course" onClose={() => setOpen(false)}>
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
            {submitting ? "Creating…" : "Create and open builder"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
