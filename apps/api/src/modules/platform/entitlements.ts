import type { Queryable } from "../../db/pool.js";

/**
 * Module keys used by the entitlement gate (Delivery Plan Step 36). Mirrors
 * the keys seeded into `plans.module_entitlements` (migration 0012) — keep in
 * sync with any new module added there. "learning" (Step 41) and
 * "intelligence" (Step 43) both have real routes now, gated the same way as
 * "assessments". "ai_gateway" (Step 45) is the org-level half of the AI
 * gateway's kill switch (ADR-0005) — it defaults to false and, even once an
 * org is entitled, the org must ALSO opt in via org_ai_settings AND the
 * platform-level switch must be on. No org has any AI product feature
 * reachable by default. "workflow_insights" (Step 46) is the first module
 * mounted through the plugin/module registry (module-registry.ts) — see that
 * file's doc comment for the manifest convention every future pluggable
 * module should follow.
 */
export type ModuleKey = "assessments" | "learning" | "intelligence" | "ai_gateway" | "workflow_insights";

/**
 * Baseline entitlement for organisations with no active subscription row.
 * Matches the product's pre-Step-35 state (assessments was the only module
 * that existed, and every org had it) so existing/legacy organisations are
 * never silently locked out just because nobody has assigned them a plan.
 */
export const DEFAULT_MODULE_ENTITLEMENTS: Record<ModuleKey, boolean> = {
  assessments: true,
  learning: false,
  intelligence: false,
  ai_gateway: false,
  workflow_insights: false,
};

export interface OrgPlan {
  planCode: string;
  moduleEntitlements: Record<string, boolean>;
  limits: Record<string, number>;
}

/** Looks up the organisation's active plan (module entitlements + limits), if any. */
export async function getOrgPlan(client: Queryable, organisationId: string): Promise<OrgPlan | null> {
  const result = await client.query<{
    code: string;
    module_entitlements: Record<string, boolean>;
    limits: Record<string, number>;
  }>(
    `SELECT p.code, p.module_entitlements, p.limits
       FROM org_subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.organisation_id = $1 AND s.status = 'active'`,
    [organisationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { planCode: row.code, moduleEntitlements: row.module_entitlements, limits: row.limits };
}

/** Whether an org (given its resolved plan, or null if unsubscribed) has a module. */
export function isModuleEntitled(plan: OrgPlan | null, moduleKey: ModuleKey): boolean {
  if (!plan) return DEFAULT_MODULE_ENTITLEMENTS[moduleKey];
  return plan.moduleEntitlements[moduleKey] === true;
}
