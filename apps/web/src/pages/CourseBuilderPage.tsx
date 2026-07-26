import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, type CourseDetail, type OrgUser, type TemplateSummary } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, StatusPill } from "../ui.js";
import { useQuery } from "../useQuery.js";

/**
 * Course builder (Delivery Plan Step 42): modules/lessons authoring with a
 * simple content preview, publish (freezes content — locks further
 * structural edits), and bulk enrolment.
 */
export function CourseBuilderPage(): ReactNode {
  const { orgId, courseId } = useParams();
  const course = useQuery(
    () => api.get<CourseDetail>(`/v1/orgs/${orgId}/learning/courses/${courseId}`),
    [orgId, courseId],
  );

  if (course.loading) return <Loading label="Loading course…" />;
  if (course.error) return <ErrorState error={course.error} onRetry={course.reload} />;
  if (!course.data) return null;

  return <BuilderView orgId={orgId!} course={course.data} reload={course.reload} />;
}

function BuilderView(props: { orgId: string; course: CourseDetail; reload: () => void }): ReactNode {
  const { orgId, course, reload } = props;
  const isDraft = course.status === "draft";
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  async function publish(): Promise<void> {
    if (!window.confirm("Publishing freezes this course's content and locks further structural edits. Continue?")) {
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/learning/courses/${course.id}/publish`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish this course.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>{course.title}</h1>
          <p className="muted">{course.description || "No description."}</p>
          <StatusPill value={course.status} />
        </div>
        {isDraft ? (
          <button type="button" className="btn" onClick={() => void publish()} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish"}
          </button>
        ) : null}
      </div>

      {error ? <Alert kind="danger">{error}</Alert> : null}
      {!isDraft ? <Alert kind="info">This course is {course.status} — its structure can no longer be edited.</Alert> : null}

      <div className="stack">
        <h2>Modules</h2>
        {course.modules.length === 0 ? <EmptyState title="No modules yet" /> : null}
        {course.modules.map((m) => (
          <div key={m.id} className="card stack">
            <h3>{m.title}</h3>
            <ul>
              {m.lessons.map((l) => (
                <li key={l.id}>
                  {l.title}
                  {l.practice_template_code ? <span className="pill">Practice: {l.practice_template_code}</span> : null}
                </li>
              ))}
            </ul>
            {isDraft ? <AddLessonForm orgId={orgId} moduleId={m.id} nextPosition={m.lessons.length} onAdded={reload} /> : null}
          </div>
        ))}
        {isDraft ? (
          <AddModuleForm orgId={orgId} courseId={course.id} nextPosition={course.modules.length} onAdded={reload} />
        ) : null}
      </div>

      <EnrolPanel orgId={orgId} courseId={course.id} />
    </div>
  );
}

function AddModuleForm(props: { orgId: string; courseId: string; nextPosition: number; onAdded: () => void }): ReactNode {
  const { orgId, courseId, nextPosition, onAdded } = props;
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/learning/courses/${courseId}/modules`, { title, position: nextPosition });
      setTitle("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this module.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="row">
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <Field label="New module title">
        {({ id }) => <input id={id} required value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <button type="submit" className="btn secondary" disabled={submitting}>
        {submitting ? "Adding…" : "Add module"}
      </button>
    </form>
  );
}

function AddLessonForm(props: { orgId: string; moduleId: string; nextPosition: number; onAdded: () => void }): ReactNode {
  const { orgId, moduleId, nextPosition, onAdded } = props;
  const templates = useQuery(() => api.get<TemplateSummary[]>("/v1/framework/templates"), []);
  const [title, setTitle] = useState("");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [practiceTemplateCode, setPracticeTemplateCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/orgs/${orgId}/learning/modules/${moduleId}/lessons`, {
        title,
        contentMarkdown,
        position: nextPosition,
        ...(practiceTemplateCode ? { practiceTemplateCode } : {}),
      });
      setTitle("");
      setContentMarkdown("");
      setPracticeTemplateCode("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this lesson.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="stack">
      {error ? <Alert kind="danger">{error}</Alert> : null}
      <Field label="New lesson title">
        {({ id }) => <input id={id} required value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Content (markdown)" hint="Optional">
        {({ id }) => (
          <textarea id={id} rows={3} value={contentMarkdown} onChange={(e) => setContentMarkdown(e.target.value)} />
        )}
      </Field>
      <Field label="Practice-mode template" hint="Optional — lets learners self-score against a real rubric">
        {({ id }) => (
          <select id={id} value={practiceTemplateCode} onChange={(e) => setPracticeTemplateCode(e.target.value)}>
            <option value="">None</option>
            {(templates.data ?? []).map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} — {t.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button type="submit" className="btn secondary" disabled={submitting}>
        {submitting ? "Adding…" : "Add lesson"}
      </button>
    </form>
  );
}

function EnrolPanel(props: { orgId: string; courseId: string }): ReactNode {
  const { orgId, courseId } = props;
  const users = useQuery(() => api.get<OrgUser[]>(`/v1/orgs/${orgId}/users`), [orgId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [consentGiven, setConsentGiven] = useState(false);
  const [result, setResult] = useState<{ enrolled: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(userId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function onEnrol(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ enrolled: number; skipped: number }>(`/v1/orgs/${orgId}/learning/enrollments`, {
        courseId,
        userIds: [...selected],
        consentGiven,
      });
      setResult(res);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enrol these members.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card stack">
      <h2>Enrol members</h2>
      {users.loading ? <Loading /> : null}
      {users.error ? <ErrorState error={users.error} onRetry={users.reload} /> : null}
      {error ? <Alert kind="danger">{error}</Alert> : null}
      {result ? (
        <Alert kind="success">
          Enrolled {result.enrolled}, skipped {result.skipped} (already enrolled or not a member).
        </Alert>
      ) : null}
      {users.data && users.data.length > 0 ? (
        <ul className="stack">
          {users.data.map((u) => (
            <li key={u.id}>
              <label>
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />{" "}
                {u.display_name} ({u.email})
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <label>
        <input type="checkbox" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} /> Consent
        recorded for this enrolment
      </label>
      <button type="button" className="btn" onClick={() => void onEnrol()} disabled={submitting || selected.size === 0}>
        {submitting ? "Enrolling…" : `Enrol ${selected.size} selected`}
      </button>
    </div>
  );
}
