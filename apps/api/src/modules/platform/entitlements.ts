import type { Queryable } from "../../db/pool.js";

/**
 * Module keys used by the entitlement gate (Delivery Plan Step 36). Mirrors
 * the keys seeded into `plans.module_entitlements` (migration 0012) — keep in
 * sync with any new module added there. "learning" and "intelligence" have no
 * real routes yet (future phases); their presence here only proves the gate
 * mechanism is generic, not tied to a single module.
 */
export type ModuleKey = "assessments" | "learning" | "intelligence";

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
