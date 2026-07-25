import {
  EvaluationInputSchema,
  TEMPLATE_CODES,
  evaluate,
  loadAllTemplates,
  loadScoringModel,
  loadTemplate,
  ScoringInputError,
  type TemplateCode,
} from "@cpf/assessment-framework";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { createPool } from "./db/pool.js";
import { buildOpenApiSpec, captureRoutes } from "./openapi.js";
import { LOG_REDACT_PATHS } from "./modules/constants.js";
import { InMemoryRateLimitStore } from "./modules/rate-limit.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerCandidatePortalRoutes } from "./modules/candidate/portal.js";
import { registerAcknowledgementRoutes } from "./modules/org/acknowledgements.js";
import { registerCalibrationRoutes } from "./modules/org/calibration.js";
import { registerClaimsRoutes } from "./modules/org/claims.js";
import { registerDataRightsRoutes } from "./modules/org/data-rights.js";
import { registerHiringRoutes } from "./modules/org/hiring.js";
import { registerReviewRoutes } from "./modules/org/reviews.js";
import { registerOrgViewsRoutes } from "./modules/org/views.js";
import { registerPlatformRoutes } from "./modules/platform/routes.js";

const API_VERSION = "0.1.0";

export interface BuildAppOptions {
  /** Enables full platform mode (identity, tenancy, hiring, reviews, data rights). */
  databaseUrl?: string;
  /**
   * Token-bucket sizing for the in-memory rate limiter. Defaults are generous
   * (sized for real traffic, not for tests) — integration tests that want to
   * exercise 429 behaviour build their own app instance with small values
   * here rather than tripping the shared test app's buckets by accident.
   */
  rateLimit?: {
    generalCapacity: number;
    generalRefillPerSecond: number;
    strictCapacity: number;
    strictRefillPerSecond: number;
  };
  /**
   * Test-only hook: capture log output to a stream instead of stdout, and
   * force level to "info" (overriding the NODE_ENV=test silent default) so
   * redaction behaviour can be observed. Never set outside tests.
   */
  loggerStream?: Writable;
}

/**
 * Build the CPF API instance.
 *
 * Scope note (honest boundary): every endpoint currently served is either
 * operational (health) or works exclusively on non-personal, versioned
 * framework content and caller-supplied stateless input. No personal data is
 * stored or processed. Tenant-scoped and identity-protected endpoints are
 * deliberately absent until the identity and tenancy modules are implemented —
 * see docs/status/completion-report.md.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const platformMode = Boolean(options.databaseUrl);
  if (options.databaseUrl) createPool(options.databaseUrl);
  const app = Fastify({
    logger: {
      level: options.loggerStream ? "info" : process.env.NODE_ENV === "test" ? "silent" : "info",
      redact: LOG_REDACT_PATHS,
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
    },
    genReqId: () => randomUUID(),
    bodyLimit: 262_144, // 256 KiB — framework payloads are small by design
  });

  // CPF-44: capture every route as it's registered so the OpenAPI spec below
  // can never drift out of coverage with the real route table.
  const capturedRoutes = captureRoutes(app);

  // CSV import bodies (candidate import) arrive as text/csv, not JSON.
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  // Rate limiting (CPF-43): token bucket per bearer session token when authed,
  // per-IP otherwise. /v1/auth/* and /v1/candidate/* use a stricter bucket
  // since they're reachable without any prior authentication. Single-node,
  // in-memory only for this phase (RateLimitStore is the seam for Redis later).
  const rateLimitConfig = options.rateLimit ?? {
    generalCapacity: 1000,
    generalRefillPerSecond: 1000 / 60,
    strictCapacity: 500,
    strictRefillPerSecond: 500 / 60,
  };
  const rateLimitStore = new InMemoryRateLimitStore();
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const strict = request.url.startsWith("/v1/auth/") || request.url.startsWith("/v1/candidate/");
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const bucketScope = strict ? "strict" : "general";
    const bucketKey = `${bucketScope}:${bearer ?? `ip:${request.ip}`}`;
    const capacity = strict ? rateLimitConfig.strictCapacity : rateLimitConfig.generalCapacity;
    const refillPerSecond = strict ? rateLimitConfig.strictRefillPerSecond : rateLimitConfig.generalRefillPerSecond;
    const outcome = rateLimitStore.consume(bucketKey, capacity, refillPerSecond);
    if (!outcome.allowed) {
      reply.header("retry-after", String(outcome.retryAfterSeconds));
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please slow down and try again shortly.",
          requestId: request.id,
          retryable: true,
        },
      });
    }
  });

  // Baseline security headers on every response.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", "no-store");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  });

  // Safe, machine-readable error contract; internals are never exposed.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ScoringInputError) {
      return reply.status(422).send({
        error: {
          code: "SCORING_INPUT_INVALID",
          message: error.message,
          requestId: request.id,
          retryable: false,
        },
      });
    }
    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_FAILED",
          message: "The request body or parameters are invalid.",
          requestId: request.id,
          retryable: false,
        },
      });
    }
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.status(413).send({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "The request body exceeds the allowed size limit.",
          requestId: request.id,
          retryable: false,
        },
      });
    }
    // Any other well-known 4xx raised by Fastify itself (malformed JSON body,
    // unsupported content-type, oversized headers, etc.) is a client mistake,
    // not a server fault — classify it honestly instead of falling through to
    // a 500 (found via Step 29 ingestion fuzz testing: malformed JSON bodies
    // were previously misreported as INTERNAL_ERROR).
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code ?? "BAD_REQUEST",
          message: "The request could not be processed.",
          requestId: request.id,
          retryable: false,
        },
      });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: request.id,
        retryable: true,
      },
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "cpf-api",
    version: API_VERSION,
    mode: platformMode ? "platform" : "framework-only",
    time: new Date().toISOString(),
  }));

  app.get("/v1/framework/scoring-model", async () => loadScoringModel());

  app.get("/v1/framework/templates", async () =>
    loadAllTemplates().map((t) => ({
      code: t.code,
      roleFamily: t.roleFamily,
      title: t.title,
      subtitle: t.subtitle,
      targetLevel: t.targetLevel,
      timebox: t.timebox,
      frameworkVersion: t.frameworkVersion,
      criteriaCount: t.criteria.length,
      criticalCriteriaCount: t.criteria.filter((c) => c.critical).length,
    })),
  );

  app.get<{ Params: { code: string } }>(
    "/v1/framework/templates/:code",
    async (request, reply) => {
      const code = request.params.code.toUpperCase();
      if (!(TEMPLATE_CODES as readonly string[]).includes(code)) {
        return reply.status(404).send({
          error: {
            code: "TEMPLATE_NOT_FOUND",
            message: `No assessment template with code "${request.params.code}".`,
            requestId: request.id,
            retryable: false,
          },
        });
      }
      return loadTemplate(code as TemplateCode);
    },
  );

  /**
   * Stateless reviewer-assist evaluation. Computes a decision-support evidence
   * profile from caller-supplied criterion scores. Nothing is persisted, and the
   * response never contains a hiring outcome (guardrail enforced in the domain
   * engine and covered by tests).
   */
  app.post("/v1/scoring/evaluate", async (request, reply) => {
    const parsed = EvaluationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_FAILED",
          message: "Evaluation input is invalid.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
          requestId: request.id,
          retryable: false,
        },
      });
    }
    const code = parsed.data.templateCode.toUpperCase();
    if (!(TEMPLATE_CODES as readonly string[]).includes(code)) {
      return reply.status(404).send({
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: `No assessment template with code "${parsed.data.templateCode}".`,
          requestId: request.id,
          retryable: false,
        },
      });
    }
    return evaluate(
      loadTemplate(code as TemplateCode),
      loadScoringModel(),
      parsed.data.assessments,
    );
  });

  if (platformMode) {
    registerAuthRoutes(app);
    registerPlatformRoutes(app);
    registerHiringRoutes(app);
    registerCandidatePortalRoutes(app);
    registerReviewRoutes(app);
    registerOrgViewsRoutes(app);
    registerDataRightsRoutes(app);
    registerAcknowledgementRoutes(app);
    registerClaimsRoutes(app);
    registerCalibrationRoutes(app);
  } else {
    app.log.info(
      "DATABASE_URL not configured — running in framework-only mode (non-personal catalogue + stateless evaluation). Platform endpoints are disabled.",
    );
  }

  // Public, safe-by-construction (no field-level schemas, no secrets) — see openapi.ts.
  app.get("/v1/openapi.json", async () => buildOpenApiSpec(capturedRoutes));

  return app;
}
