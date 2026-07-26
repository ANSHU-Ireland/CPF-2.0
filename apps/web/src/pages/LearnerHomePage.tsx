import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type EnrollmentDetail, type EnrollmentSummary } from "../api.js";
import { EmptyState, ErrorState, Loading, StatusPill } from "../ui.js";
import { useQuery } from "../useQuery.js";
import { routes } from "../routes.js";

/**
 * Learner home (Delivery Plan Step 42): the signed-in user's own
 * enrolments and progress. Course-based enrolments continue into the
 * lesson player; pathway-based enrolments show their linked courses only
 * (no lesson-level player for pathways yet — same v1 scope boundary as
 * practice-attempt).
 */
export function LearnerHomePage(): ReactNode {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const enrollments = useQuery(() => api.get<EnrollmentSummary[]>(`/v1/orgs/${orgId}/learning/my-enrollments`), [orgId]);
  const [opening, setOpening] = useState<string | null>(null);

  async function continueEnrollment(enrollmentId: string): Promise<void> {
    setOpening(enrollmentId);
    try {
      const detail = await api.get<EnrollmentDetail>(`/v1/orgs/${orgId}/learning/enrollments/${enrollmentId}`);
      if (!detail.course) return;
      const lessons = detail.course.modules.flatMap((m) => m.lessons);
      const next = lessons.find((l) => !l.completed) ?? lessons[0];
      if (next) navigate(routes.orgLearningLesson(orgId!, enrollmentId, next.id));
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>My learning</h1>
        <p className="muted">Courses and pathways you're enrolled in.</p>
      </div>

      {enrollments.loading ? <Loading /> : null}
      {enrollments.error ? <ErrorState error={enrollments.error} onRetry={enrollments.reload} /> : null}
      {enrollments.data ? (
        enrollments.data.length === 0 ? (
          <EmptyState title="No enrolments yet" hint="Your organisation's learning admin will enrol you into courses." />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">My enrolments</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="skip-link">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {enrollments.data.map((e) => (
                <tr key={e.id}>
                  <td data-label="Title">{e.title}</td>
                  <td data-label="Type">{e.course_id ? "Course" : "Pathway"}</td>
                  <td data-label="Status">
                    <StatusPill value={e.status} />
                  </td>
                  <td data-label="">
                    {e.course_id && e.status !== "withdrawn" ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void continueEnrollment(e.id)}
                        disabled={opening === e.id}
                      >
                        {opening === e.id ? "Opening…" : e.status === "completed" ? "Review" : "Continue"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}
