import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireOrgRole } from "../auth/guards.js";
import { withTx } from "../../db/pool.js";
import { getOrgPlan, isModuleEntitled, type ModuleKey } from "./entitlements.js";

/**
 * Plugin/module registry (Delivery Plan Step 46).
 *
 * Deliberately NOT a dynamic loader (per the plan's own risk note against
 * over-abstraction): `MODULE_REGISTRY` is a typed, hand-written array of
 * manifests, validated once at import time via `ModuleManifestSchema.parse`
 * (so a malformed manifest fails at boot, not silently at request time).
 * There is no remote code loading, no filesystem plugin discovery, and no
 * per-request manifest re-validation.
 *
 * Scope decision, disclosed honestly: the three modules built before this
 * step (learning, intelligence, ai_gateway) already have their own
 * hand-wired nav entries in the web Shell and their own route-registration
 * functions; they are NOT retrofitted into this registry, since doing so
 * would be a pure refactor of already-shipped, already-tested surface with
 * no behavioural benefit and real regression risk. This registry exists so
 * that FUTURE modules (starting with "workflow_insights", this step's first
 * module) can be added as data — one array entry plus one route file —
 * instead of a bespoke Shell.tsx nav block each time.
 */
export const ModuleManifestSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  requiredEntitlement: z.string().min(1),
  navigation: z.array(
    z.object({
      label: z.string().min(1),
      path: z.string().min(1),
    }),
  ),
  permissions: z.array(z.string()),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

const RAW_MODULE_REGISTRY: Array<Omit<ModuleManifest, "requiredEntitlement"> & { requiredEntitlement: ModuleKey }> = [
  {
    key: "workflow_insights",
    name: "Workflow Insights",
    version: "0.1.0",
    requiredEntitlement: "workflow_insights",
    navigation: [{ label: "Workflow insights", path: "/org/:orgId/workflow-insights" }],
    permissions: ["workflow_insights:read", "workflow_insights:decide"],
  },
];

/** Boot-time validation: throws (fails the server's startup) if any manifest is malformed. */
export const MODULE_REGISTRY: ModuleManifest[] = RAW_MODULE_REGISTRY.map((manifest) =>
  ModuleManifestSchema.parse(manifest),
);

/**
 * `GET /v1/orgs/:orgId/modules` — the web Shell's single source of truth for
 * dynamically rendering plugin-module nav entries (Step 46's "nav renders
 * registered modules dynamically" requirement). Returns only the modules the
 * calling org is actually entitled to; navigation path templates use the
 * literal `:orgId` placeholder, substituted by the caller.
 */
export function registerModuleRegistryRoutes(app: FastifyInstance): void {
  app.get(
    "/v1/orgs/:orgId/modules",
    { preHandler: [requireOrgRole("org_admin", "hiring_manager", "reviewer", "learning_admin", "support_agent")] },
    async (request) => {
      const orgId = request.orgId!;
      const plan = await withTx((client) => getOrgPlan(client, orgId));
      const entitled = MODULE_REGISTRY.filter((manifest) =>
        isModuleEntitled(plan, manifest.requiredEntitlement as ModuleKey),
      );
      return { orgId, modules: entitled };
    },
  );
}
