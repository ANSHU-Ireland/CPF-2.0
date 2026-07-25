import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/** Reviewer's assigned review queue. Built in Phase B (CPF-36). */
export function ReviewQueuePage(): ReactNode {
  return (
    <EmptyState
      title="Under construction — CPF-36"
      hint="Reviews assigned to you will appear here."
    />
  );
}
