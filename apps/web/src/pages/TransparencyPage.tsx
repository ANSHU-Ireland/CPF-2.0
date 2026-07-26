import type { ReactNode } from "react";
import { useParams } from "react-router";
import { api, type IntelligenceStatus } from "../api.js";
import { EmptyState, ErrorState, Loading } from "../ui.js";
import { useQuery } from "../useQuery.js";

/**
 * Employee-facing transparency page (Delivery Plan Step 44).
 *
 * COLLECTED_SIGNALS / FORBIDDEN_SIGNALS are exported so a component test can
 * assert the page renders these strings verbatim — the list itself is the
 * source of truth, not a duplicated copy embedded in JSX.
 */
export const COLLECTED_SIGNALS: string[] = [
  "Aggregate course and pathway completion counts, by course/pathway across the whole organisation",
  "Aggregate pain-point report counts, by category, once at least 8 reports exist in that category",
  "Aggregate practice-attempt participation, as a proxy for AI-assisted practice adoption",
];

export const FORBIDDEN_SIGNALS: string[] = [
  "No individual employee's learning progress, pain-point report, or AI-adoption figure is ever shown to any admin",
  "No pain-point report text is ever readable by an admin — only anonymous category counts, suppressed below 8 reports",
  "No employee ranking, scoring, or comparison between individuals",
  "No 'ai-literacy tag' or similar profiling label is attached to any employee",
  "No raw keystroke, clipboard-content, or camera data is ever collected, in this module or anywhere else in CPF",
];

export function TransparencyPage(): ReactNode {
  const { orgId } = useParams();
  const status = useQuery(() => api.get<IntelligenceStatus>(`/v1/orgs/${orgId}/intelligence/status`), [orgId]);

  if (!orgId) return <EmptyState title="No organisation selected" />;

  return (
    <div className="stack">
      <div>
        <h1>Workforce Intelligence: what is, and is never, collected</h1>
        {status.loading ? <Loading label="Loading status…" /> : null}
        {status.error ? <ErrorState error={status.error} onRetry={status.reload} /> : null}
        {status.data ? (
          <p className="muted">
            Workforce Intelligence is currently{" "}
            <strong>{status.data.enabled ? "enabled" : "not enabled"}</strong> for your organisation.
          </p>
        ) : null}
      </div>

      <section className="stack">
        <h2>What is collected</h2>
        <ul>
          {COLLECTED_SIGNALS.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      </section>

      <section className="stack">
        <h2>What is never collected</h2>
        <ul>
          {FORBIDDEN_SIGNALS.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
