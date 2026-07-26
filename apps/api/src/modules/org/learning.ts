import type { FastifyInstance } from "fastify";
import { requireModuleEntitlement, requireOrgRole } from "../auth/guards.js";

/**
 * Placeholder route for the not-yet-built Learning module (a later phase of
 * the platform's commercial roadmap). This exists solely to prove the
 * module-entitlement gate (Delivery Plan Step 36) enforces correctly for a
 * module with no real feature routes yet — the same requireModuleEntitlement
 * guard will front the actual Learning feature set once it's built.
 */
const learningRoles = [
  requireOrgRole("org_admin", "hiring_manager", "learning_admin"),
  requireModuleEntitlement("learning"),
];

export function registerLearningRoutes(app: FastifyInstance): void {
  app.get("/v1/orgs/:orgId/learning/status", { preHandler: learningRoles }, async () => {
    return { module: "learning", enabled: true };
  });
}
