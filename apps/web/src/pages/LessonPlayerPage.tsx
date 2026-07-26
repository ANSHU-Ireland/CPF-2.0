import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import {
  api,
  type Criterion,
  type EnrollmentDetail,
  type EvaluationPreview,
  type ScoringModel,
  type TemplateDetail,
} from "../api.js";
import { Alert, BandBadge, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";
import { routes } from "../routes.js";

/**
 * Lesson player (Delivery Plan Step 42): content, prev/next navigation,
 * mark-complete, and an optional practice-assessment launch that reuses the
 * real scoring engine for the learner's own reference only (never a hiring
 * score — see learning.ts's practice-attempt route).
 */
export function LessonPlayerPage(): ReactNode {
  const { orgId, enrollmentId, lessonId } = useParams();
  const navigate = useNavigate();
  const enrollment = useQuery(
    () => api.get<EnrollmentDetail>(`/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}`),
    [orgId, enrollmentId],
  );
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  if (enrollment.loading) return <Loading label="Loading lesson…" />;
  if (enrollment.error) return <ErrorState error={enrollment.error} onRetry={enrollment.reload} />;
  if (!enrollment.data?.course) return <Alert kind="info">This lesson is not available.</Alert>;

  const lessons = enrollment.data.course.modules.flatMap((m) => m.lessons);
  const index = lessons.findIndex((l) => l.id === lessonId);
  const lesson = lessons[index];
  if (!lesson) return <Alert kind="info">Lesson not found.</Alert>;
  const prev = lessons[index - 1];
  const next = lessons[index + 1];

  async function markComplete(completed: boolean): Promise<void> {
    setMarking(true);
    setMarkError(null);
    try {
      await api.put(`/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/lessons/${lessonId}/progress`, {
        completed,
      });
      enrollment.reload();
    } catch (err) {
      setMarkError(err instanceof Error ? err.message : "Could not save progress.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <p className="muted">{enrollment.data.course.title}</p>
        <h1>{lesson.title}</h1>
      </div>

      <div className="card">
        <pre style={{ whiteSpace: "pre-wrap" }}>{lesson.content_markdown || "No content."}</pre>
      </div>

      {markError ? <Alert kind="danger">{markError}</Alert> : null}
      <div className="row">
        <button
          type="button"
          className="btn secondary"
          disabled={!prev}
          onClick={() => prev && navigate(routes.orgLearningLesson(orgId!, enrollmentId!, prev.id))}
        >
          Previous
        </button>
        <button type="button" className="btn" onClick={() => void markComplete(!lesson.completed)} disabled={marking}>
          {marking ? "Saving…" : lesson.completed ? "Mark incomplete" : "Mark complete"}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!next}
          onClick={() => next && navigate(routes.orgLearningLesson(orgId!, enrollmentId!, next.id))}
        >
          Next
        </button>
      </div>

      {index === lessons.length - 1 && enrollment.data.status !== "completed" ? (
        <Alert kind="info">
          This is the last lesson.{" "}
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await api.post(`/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/complete`);
              enrollment.reload();
            }}
          >
            Complete course
          </button>
        </Alert>
      ) : null}

      {lesson.practice_template_code ? (
        <PracticePanel orgId={orgId!} enrollmentId={enrollmentId!} lessonId={lessonId!} templateCode={lesson.practice_template_code} />
      ) : null}
    </div>
  );
}

function PracticePanel(props: { orgId: string; enrollmentId: string; lessonId: string; templateCode: string }): ReactNode {
  const { orgId, enrollmentId, lessonId, templateCode } = props;
  const [started, setStarted] = useState(false);
  const template = useQuery(() => api.get<TemplateDetail>(`/v1/framework/templates/${templateCode}`), [templateCode]);
  const scoringModel = useQuery(() => api.get<ScoringModel>("/v1/framework/scoring-model"), []);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<EvaluationPreview | null>(null);

  async function submit(): Promise<void> {
    if (!template.data) return;
    setSubmitting(true);
    setError(null);
    try {
      const assessments = template.data.criteria.map((c: Criterion) => ({
        criterionId: c.id,
        reviewer1Score: scores[c.id],
        ...(notes[c.id] ? { evidenceNote: notes[c.id] } : {}),
      }));
      const result = await api.post<{ profile: EvaluationPreview }>(
        `/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}/lessons/${lessonId}/practice-attempt`,
        { assessments },
      );
      setProfile(result.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit this practice attempt.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!started) {
    return (
      <div className="card stack">
        <h2>Practice assessment</h2>
        <p className="muted">
          Self-score against the real "{templateCode}" rubric — this is a private practice attempt for your own
          reference and is never seen by a hiring reviewer.
        </p>
        <button type="button" className="btn" onClick={() => setStarted(true)}>
          Start practice attempt
        </button>
      </div>
    );
  }

  if (template.loading || scoringModel.loading) return <Loading label="Loading rubric…" />;
  if (template.error) return <ErrorState error={template.error} onRetry={template.reload} />;
  if (!template.data) return null;

  if (profile) {
    return (
      <div className="card stack">
        <h2>Your practice profile</h2>
        {profile.overallBand ? (
          <p>
            Overall: <BandBadge band={profile.overallBand} />
          </p>
        ) : null}
        <div className="stack">
          {profile.dimensions.map((d) => (
            <div key={d.key} className="spread">
              <span>{d.name}</span>
              <BandBadge band={d.band} />
            </div>
          ))}
        </div>
        <p className="muted">{profile.governanceNote}</p>
      </div>
    );
  }

  const anchors = scoringModel.data?.scoreAnchors ?? [];

  return (
    <div className="card stack">
      <h2>Self-score each criterion</h2>
      {error ? <Alert kind="danger">{error}</Alert> : null}
      {template.data.criteria.map((c) => (
        <div key={c.id} className="stack">
          <strong>{c.dimension}</strong>
          <p className="muted">{c.observableStandard}</p>
          <select
            value={scores[c.id] ?? ""}
            onChange={(e) => setScores((prev) => ({ ...prev, [c.id]: Number(e.target.value) }))}
          >
            <option value="">Select a score…</option>
            {anchors.map((a) => (
              <option key={a.score} value={a.score}>
                {a.score} — {a.anchor}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            placeholder="Evidence note (optional)"
            value={notes[c.id] ?? ""}
            onChange={(e) => setNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => void submit()}
        disabled={submitting || template.data.criteria.some((c) => scores[c.id] === undefined)}
      >
        {submitting ? "Submitting…" : "Submit practice attempt"}
      </button>
    </div>
  );
}
