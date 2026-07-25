import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import { routes } from "../routes.js";
import { Alert, Field } from "../ui.js";

/**
 * Sign-in with progressive MFA: the 6-digit code field appears only when the
 * server requires it. Lockout (423) and invalid credentials render distinct,
 * non-enumerating messages.
 */
export function LoginPage(): ReactNode {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await login(email, password, mfaRequired ? totpCode : undefined);
      const first = response.memberships[0];
      if (response.memberships.some((m) => m.role === "platform_admin")) {
        navigate(routes.platformOrgs());
      } else if (first && response.memberships.some((m) => m.role === "reviewer")) {
        navigate(routes.orgReviews(first.organisationId));
      } else if (first) {
        navigate(routes.orgSessions(first.organisationId));
      } else {
        navigate(routes.templates());
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") {
        setMfaRequired(true);
        setError(
          mfaRequired
            ? "That code did not match. Enter the current 6-digit code from your authenticator app."
            : null,
        );
      } else if (err instanceof ApiError && err.code === "ACCOUNT_LOCKED") {
        setError("Too many failed attempts. The account is temporarily locked — try again later.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Sign-in failed unexpectedly. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell-main" style={{ maxWidth: 440, margin: "10vh auto" }}>
      <div className="card stack">
        <div>
          <h1>Sign in to CPF</h1>
          <p className="muted">Candidate Performance Framework</p>
        </div>
        {error ? <Alert kind="danger">{error}</Alert> : null}
        {mfaRequired && !error ? (
          <Alert kind="info">Enter the 6-digit code from your authenticator app.</Alert>
        ) : null}
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field label="E-mail">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {mfaRequired ? (
            <Field label="Authenticator code" hint="6 digits, refreshes every 30 seconds">
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/gu, ""))}
                />
              )}
            </Field>
          ) : null}
          <button type="submit" className="btn" style={{ width: "100%" }} disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="muted">
          <small>
            Candidates: use the assessment link from your invitation instead —{" "}
            <a href="/candidate">open the candidate portal</a>.
          </small>
        </p>
      </div>
    </main>
  );
}
