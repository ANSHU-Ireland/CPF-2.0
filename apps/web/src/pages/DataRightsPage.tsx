import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/** Data subject rights request queue + legal holds. Built in Phase B (CPF-36). */
export function DataRightsPage(): ReactNode {
  return (
    <EmptyState
      title="Under construction — CPF-36"
      hint="Data rights requests and legal holds will be manageable here."
    />
  );
}
