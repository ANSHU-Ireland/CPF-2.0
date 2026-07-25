import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/** Reviewer workspace: evidence, scoring, adjudication, finalisation. Built in Phase B (CPF-36). */
export function ReviewWorkspacePage(): ReactNode {
  return (
    <EmptyState
      title="Under construction — CPF-36"
      hint="The reviewer workspace (evidence, scoring, finalisation) will appear here."
    />
  );
}
