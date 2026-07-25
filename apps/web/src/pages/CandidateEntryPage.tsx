import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/**
 * Public landing for a candidate without a token in the URL (e.g. arriving
 * from an e-mail client that stripped the link). Built in Phase B (CPF-36).
 */
export function CandidateEntryPage(): ReactNode {
  return (
    <main className="shell-main" style={{ maxWidth: 480, margin: "10vh auto" }}>
      <EmptyState
        title="Under construction — CPF-36"
        hint="Use the personal link from your invitation e-mail to access your assessment."
      />
    </main>
  );
}
