import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/**
 * Public, token-authenticated candidate portal (disclosure, session
 * lifecycle, evidence submission). Built in Phase B (CPF-36).
 */
export function CandidatePortalPage(): ReactNode {
  return (
    <main className="shell-main" style={{ maxWidth: 640, margin: "10vh auto" }}>
      <EmptyState
        title="Under construction — CPF-36"
        hint="Your assessment landing page, disclosure notice, and session controls will appear here."
      />
    </main>
  );
}
