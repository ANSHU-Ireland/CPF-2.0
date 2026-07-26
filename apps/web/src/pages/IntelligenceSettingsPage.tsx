import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, type IntelligenceSettings } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

/**
 * Intelligence settings (Delivery Plan Step 44): org_admin-only enable/
 * disable flow for Workforce Intelligence.
 *
 * Enforces the plan's own risk mitigation client-side, on top of the API's
 * own 422 WORKS_COUNCIL_ACK_REQUIRED check: enabling requires BOTH a
 * works-council / employee-representative name AND an explicit checkbox
 * confirmation that the works-council pack has been reviewed — a name typed
 * into a text box alone is not treated as a real acknowledgement.
 */
export function IntelligenceSettingsPage(): ReactNode {
  const { orgId } = useParams();
  const settings = useQuery(() => api.get<IntelligenceSettings>(`/v1/orgs/${orgId}/intelligence/settings`), [orgId]);
  const [ackName, setAckName] = useState("");
  const [ackConfirmed, setAckConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!orgId) return <EmptyState title="No organisation selected" />;
  if (settings.loading) return <Loading label="Loading intelligence settings…" />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return null;

  async function enable(e: FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setSaved(null);
    if (!ackName.trim()) {
      setFormError("Enter the name of the works council / employee representative who acknowledged this.");
      return;
    }
    if (!ackConfirmed) {
      setFormError("Confirm that the works-council pack has been reviewed before enabling.");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/v1/orgs/${orgId}/intelligence/settings`, {
        enabled: true,
        worksCouncilAcknowledgedBy: ackName.trim(),
      });
      setSaved("Workforce Intelligence enabled.");
      setAckName("");
      setAckConfirmed(false);
      settings.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not enable Workforce Intelligence.");
    } finally {
      setSaving(false);
    }
  }

  async function disable(): Promise<void> {
    setFormError(null);
    setSaved(null);
    setSaving(true);
    try {
      await api.put(`/v1/orgs/${orgId}/intelligence/settings`, { enabled: false });
      setSaved("Workforce Intelligence disabled.");
      settings.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not disable Workforce Intelligence.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Workforce Intelligence settings</h1>
        <p className="muted">
          Aggregate-only, anonymous-capable workforce signals. No individual employee's data is ever shown to any
          admin — see the{" "}
          <a href={`/org/${orgId}/intelligence/transparency`}>employee transparency page</a> for the full list of
          what is, and is never, collected.
        </p>
      </div>

      {formError ? <Alert kind="danger">{formError}</Alert> : null}
      {saved ? <Alert kind="success">{saved}</Alert> : null}

      <section className="stack">
        <h2>Current status</h2>
        <p>
          Workforce Intelligence is currently <strong>{settings.data.enabled ? "enabled" : "not enabled"}</strong>{" "}
          for this organisation.
        </p>
        {settings.data.enabled ? (
          <p className="muted">
            Works-council / employee-representative acknowledgement: {settings.data.worksCouncilAcknowledgedBy}
            {settings.data.worksCouncilAcknowledgedAt
              ? ` (acknowledged ${formatDate(settings.data.worksCouncilAcknowledgedAt)})`
              : ""}
            .
          </p>
        ) : null}
      </section>

      {settings.data.enabled ? (
        <section className="stack">
          <h2>Disable</h2>
          <p className="muted">Disabling immediately blocks every Workforce Intelligence endpoint for this org.</p>
          <button type="button" className="btn secondary" onClick={() => void disable()} disabled={saving}>
            {saving ? "Saving…" : "Disable Workforce Intelligence"}
          </button>
        </section>
      ) : (
        <section className="stack">
          <h2>Enable</h2>
          <p className="muted">
            Enabling requires a fresh works-council / employee-representative acknowledgement, recorded every time
            — not carried over from a prior enable.
          </p>
          <form className="stack" noValidate onSubmit={(e) => void enable(e)}>
            <Field
              label="Works council / employee representative name"
              hint="The person who reviewed and acknowledged the works-council pack"
            >
              {({ id }) => (
                <input id={id} value={ackName} onChange={(e) => setAckName(e.target.value)} />
              )}
            </Field>
            <Field label="Acknowledgement confirmation">
              {({ id }) => (
                <label className="row" htmlFor={id} style={{ alignItems: "center" }}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={ackConfirmed}
                    onChange={(e) => setAckConfirmed(e.target.checked)}
                  />
                  <span>I confirm the works-council pack has been reviewed and acknowledged by the named person.</span>
                </label>
              )}
            </Field>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving…" : "Enable Workforce Intelligence"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
