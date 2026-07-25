import type { ReactNode } from "react";
import { EmptyState } from "../ui.js";

/** Assessment library — read-only template catalogue. Built in Phase B (CPF-36). */
export function TemplatesPage(): ReactNode {
  return (
    <EmptyState
      title="Under construction — CPF-36"
      hint="The assessment library will list all templates with per-criterion detail here."
    />
  );
}
