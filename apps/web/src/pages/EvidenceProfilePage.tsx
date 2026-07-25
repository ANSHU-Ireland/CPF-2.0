import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/** Employer-facing Evidence Profile (decision support, never a hire/reject verdict). Built in Phase B (CPF-36). */
export function EvidenceProfilePage(): ReactNode {
  return (
    <EmptyState
      title="Under construction — CPF-36"
      hint="The Evidence Profile for this session will appear here once issued."
    />
  );
}
