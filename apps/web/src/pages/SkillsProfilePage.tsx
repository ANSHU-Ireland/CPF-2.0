import type { ReactNode } from "react";
import { useParams } from "react-router";
import { api, type SkillsProfile } from "../api.js";
import { BandBadge, EmptyState, ErrorState, Loading, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

/**
 * Skills profile (Delivery Plan Step 42): the learner's own self-view,
 * built entirely from their own completed learning items and practice
 * attempts. Never used for, or linked to, any hiring decision.
 */
export function SkillsProfilePage(): ReactNode {
  const { orgId } = useParams();
  const profile = useQuery(() => api.get<SkillsProfile>(`/v1/orgs/${orgId}/learning/my-skills-profile`), [orgId]);

  if (profile.loading) return <Loading label="Loading your skills profile…" />;
  if (profile.error) return <ErrorState error={profile.error} onRetry={profile.reload} />;
  if (!profile.data) return null;
  const d = profile.data;

  return (
    <div className="stack">
      <div>
        <h1>My skills profile</h1>
        <p className="muted">Your own completed learning and practice-assessment history. Not visible to anyone else.</p>
      </div>

      <div className="stack">
        <h2>Completed courses</h2>
        {d.completedCourses.length === 0 ? (
          <EmptyState title="No completed courses yet" />
        ) : (
          <ul>
            {d.completedCourses.map((c) => (
              <li key={c.id}>
                {c.title} — completed {formatDate(c.completed_at)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="stack">
        <h2>Completed pathways</h2>
        {d.completedPathways.length === 0 ? (
          <EmptyState title="No completed pathways yet" />
        ) : (
          <ul>
            {d.completedPathways.map((p) => (
              <li key={p.id}>
                {p.title} — completed {formatDate(p.completed_at)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="stack">
        <h2>Practice assessments</h2>
        <p className="muted">Your latest self-scored practice attempt per template.</p>
        {d.practiceAttempts.length === 0 ? (
          <EmptyState title="No practice attempts yet" />
        ) : (
          d.practiceAttempts.map((a) => (
            <div key={a.id} className="card stack">
              <div className="spread">
                <strong>{a.template_code}</strong>
                {a.profile.overallBand ? <BandBadge band={a.profile.overallBand} /> : null}
              </div>
              <p className="muted">{formatDate(a.created_at)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
