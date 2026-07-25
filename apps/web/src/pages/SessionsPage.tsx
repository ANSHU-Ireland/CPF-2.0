import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/** Assessment pipeline / sessions work queue. Built in Phase B (CPF-36). */
export function SessionsPage(): ReactNode {
  return (
    <EmptyState
      title="Under construction — CPF-36"
      hint="The assessment pipeline (candidate/job/template/status) will appear here."
    />
  );
}
