import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, type OrgUser } from "../api.js";
import { Alert, EmptyState, ErrorState, Field, Loading, Modal, StatusPill } from "../ui.js";
import { useQuery } from "../useQuery.js";

const ROLES = [
  { value: "hiring_manager", label: "Hiring manager" },
  { value: "reviewer", label: "Reviewer" },
  { value: "learning_admin", label: "Learning admin" },
  { value: "org_admin", label: "Org admin" },
];

interface InvitedUser {
  userId: string;
  activationToken: string;
  note: string;
}

/** Organisation member directory + invitation (admin-only). */
export function TeamPage(): ReactNode {
  const { orgId } = useParams();
  const users = useQuery(() => api.get<OrgUser[]>(`/v1/orgs/${orgId}/users`), [orgId]);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState(ROLES[0]!.value);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invited, setInvited] = useState<InvitedUser | null>(null);

  async function onInvite(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<InvitedUser>(`/v1/orgs/${orgId}/users`, { email, displayName, role });
      setInvited(result);
      setEmail("");
      setDisplayName("");
      setRole(ROLES[0]!.value);
      users.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not invite this person.");
    } finally {
      setSubmitting(false);
    }
  }

  function closeModal(): void {
    if (invited && !window.confirm("The activation token is shown only once and cannot be retrieved again. Close anyway?")) {
      return;
    }
    setOpen(false);
    setInvited(null);
    setFormError(null);
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Team</h1>
          <p className="muted">Members of this organisation</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Invite member
        </button>
      </div>

      {users.loading ? <Loading /> : null}
      {users.error ? <ErrorState error={users.error} onRetry={users.reload} /> : null}
      {users.data ? (
        users.data.length === 0 ? (
          <EmptyState title="No team members yet" hint="Invite your first colleague to begin." />
        ) : (
          <table className="data responsive-table">
            <caption className="skip-link">Team members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">E-mail</th>
                <th scope="col">Roles</th>
                <th scope="col">Status</th>
                <th scope="col">MFA</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name">{u.display_name}</td>
                  <td data-label="E-mail">{u.email}</td>
                  <td data-label="Roles">{u.roles.map((r) => r.replaceAll("_", " ")).join(", ")}</td>
                  <td data-label="Status">
                    <StatusPill value={u.status} />
                  </td>
                  <td data-label="MFA">
                    <span className="pill">{u.mfa_enrolled ? "Enrolled" : "Not enrolled"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal open={open} title="Invite member" onClose={closeModal}>
        {invited ? (
          <div className="stack">
            <Alert kind="success">Invitation sent.</Alert>
            <div>
              <h3>Activation token</h3>
              <p className="muted">
                Deliver this token to the new member out of band. It is shown only once and
                expires per the organisation's activation policy.
              </p>
              <code className="token-once">{invited.activationToken}</code>
            </div>
            <button type="button" className="btn" onClick={closeModal}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void onInvite(e)}>
            {formError ? <Alert kind="danger">{formError}</Alert> : null}
            <Field label="E-mail">
              {({ id }) => (
                <input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
            <Field label="Name">
              {({ id }) => (
                <input id={id} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              )}
            </Field>
            <Field label="Role">
              {({ id }) => (
                <select id={id} required value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Inviting…" : "Send invitation"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}

