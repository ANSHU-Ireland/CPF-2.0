import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api.js";
import { Alert, ErrorState, Field, Loading, Modal, StatusPill, formatDate } from "../ui.js";
import { useQuery } from "../useQuery.js";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  country_code: string | null;
  created_at: string;
}

interface CreatedOrg {
  organisationId: string;
  firstAdmin: { userId: string; activationToken: string; note: string };
}

/** Platform administration: employer directory + onboarding with first admin. */
export function PlatformOrgsPage(): ReactNode {
  const orgs = useQuery(() => api.get<OrgRow[]>("/v1/platform/organisations"), []);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [country, setCountry] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrg | null>(null);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<CreatedOrg>("/v1/platform/organisations", {
        name,
        slug,
        ...(country ? { countryCode: country.toUpperCase() } : {}),
        firstAdmin: { email: adminEmail, displayName: adminName },
      });
      setCreated(result);
      setName("");
      setSlug("");
      setCountry("");
      setAdminEmail("");
      setAdminName("");
      orgs.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Creation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Employers</h1>
          <p className="muted">Organisations on the CPF platform</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Onboard employer
        </button>
      </div>

      {orgs.loading ? <Loading /> : null}
      {orgs.error ? <ErrorState error={orgs.error} onRetry={orgs.reload} /> : null}
      {orgs.data ? (
        orgs.data.length === 0 ? (
          <Alert kind="info">No organisations yet — onboard the first employer.</Alert>
        ) : (
          <table className="data">
            <caption className="skip-link">Employer organisations</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Slug</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Country</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.data.map((org) => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.slug}</td>
                  <td>{org.type}</td>
                  <td>
                    <StatusPill value={org.status} />
                  </td>
                  <td>{org.country_code ?? "—"}</td>
                  <td>{formatDate(org.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <Modal
        open={open}
        title="Onboard employer"
        onClose={() => {
          setOpen(false);
          setCreated(null);
        }}
      >
        {created ? (
          <div className="stack">
            <Alert kind="success">Organisation created.</Alert>
            <div>
              <h3>First administrator activation token</h3>
              <p className="muted">
                Deliver this token to the administrator out of band. It is shown only once and
                expires in 72 hours.
              </p>
              <code className="token-once">{created.firstAdmin.activationToken}</code>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                setCreated(null);
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void onCreate(e)}>
            {formError ? <Alert kind="danger">{formError}</Alert> : null}
            <Field label="Organisation name">
              {({ id }) => (
                <input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Slug" hint="Lowercase letters, numbers, hyphens — used in URLs">
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  required
                  pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              )}
            </Field>
            <Field label="Country code (optional)" hint="Two letters, e.g. DE">
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  maxLength={2}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                />
              )}
            </Field>
            <Field label="First administrator — e-mail">
              {({ id }) => (
                <input id={id} type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              )}
            </Field>
            <Field label="First administrator — name">
              {({ id }) => (
                <input id={id} required value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              )}
            </Field>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Creating…" : "Create organisation"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
