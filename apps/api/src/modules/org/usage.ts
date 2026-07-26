import type { FastifyInstance } from "fastify";
import { withOrgTx } from "../../db/pool.js";
import { requireOrgRole } from "../auth/guards.js";
import { getOrgPlan } from "../platform/entitlements.js";

const adminRole = requireOrgRole("org_admin");

/**
 * Organisation usage vs. plan limits (Delivery Plan Step 36). Deliberately
 * NOT gated by requireModuleEntitlement — an org needs to be able to see why
 * it's blocked / what to upgrade even if a module itself is unavailable.
 * requireOrgRole already covers the ORG_SUSPENDED check (Step 35).
 */
export function registerUsageRoutes(app: FastifyInstance): void {
  app.get("/v1/orgs/:orgId/usage", { preHandler: adminRole }, async (request) => {
    const orgId = request.orgId!;
    return withOrgTx(orgId, async (client) => {
      const plan = await getOrgPlan(client, orgId);
      const activeAssessments = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM invitations
          WHERE organisation_id = $1 AND status NOT IN ('expired', 'revoked')`,
        [orgId],
      );
      const orgUsers = await client.query<{ count: number }>(
        `SELECT count(DISTINCT user_id)::int AS count FROM org_memberships WHERE organisation_id = $1`,
        [orgId],
      );
      return {
        plan: plan ? { code: plan.planCode } : null,
        usage: {
          activeAssessments: {
            used: activeAssessments.rows[0]?.count ?? 0,
            limit: plan?.limits.maxActiveAssessments ?? null,
          },
          orgUsers: {
            used: orgUsers.rows[0]?.count ?? 0,
            limit: plan?.limits.maxOrgUsers ?? null,
          },
        },
      };
    });
  });
}
