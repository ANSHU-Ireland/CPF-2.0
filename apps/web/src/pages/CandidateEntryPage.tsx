import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { routes } from "../routes.js";

/**
 * Public landing for a candidate without a token in the URL (e.g. arriving
 * from an e-mail client that stripped the link).
 */
export function CandidateEntryPage(): ReactNode {
  const [token, setToken] = useState("");
  const navigate = useNavigate();

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    navigate(routes.candidatePortal(trimmed));
  }

  return (
    <main className="shell-main" style={{ maxWidth: 480, margin: "10vh auto" }}>
      <div className="stack">
        <h1>Access your assessment</h1>
        <p className="muted">Enter the personal link token from your invitation e-mail.</p>
        <form onSubmit={onSubmit} className="stack">
          <label htmlFor="candidate-token">Assessment link token</label>
          <input
            id="candidate-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="e.g. 3f9a1c2b..."
            required
          />
          <button type="submit" className="btn">
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
