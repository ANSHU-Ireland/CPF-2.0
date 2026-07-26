import { z } from "zod";

/**
 * Startup configuration, validated with fail-fast semantics.
 * Secrets are never defaulted; missing critical configuration stops the process.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /**
   * When set, the API runs in full platform mode (identity, tenancy, hiring,
   * reviews, data rights). When absent, only the non-personal framework
   * catalogue and stateless evaluation are served (framework-only mode).
   * Production refuses to start without it.
   */
  DATABASE_URL: z.string().url().optional(),
  /**
   * Outbound-mail delivery. When SMTP_HOST is unset, the console adapter is
   * used instead (logs message metadata only — never candidate/subject PII
   * in the body — and never actually delivers). Set all SMTP_* to enable
   * real delivery.
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("no-reply@cpf.invalid"),
  /**
   * Multiplies rate-limit bucket capacity (and refill rate) so integration
   * tests can run bursts of real requests without tripping 429s by accident.
   * Deliberately a multiplier, not a bypass — rate limiting stays exercised
   * end-to-end even in test mode, just against a wider window.
   */
  RATE_LIMIT_TEST_MULTIPLIER: z.coerce.number().positive().default(1),

  /**
   * AI gateway (ADR-0005, Delivery Plan Step 45) — global platform-level
   * kill switch. Defaults OFF: Phase 1 ships zero AI providers and zero AI
   * product features, permanently, until a feature's AI-governance register
   * entry and evaluation plan both pass (docs/ai-governance). Even when an
   * org opts in via its own org_ai_settings row, this switch must ALSO be on.
   */
  AI_GATEWAY_ENABLED: z.coerce.boolean().default(false),
  /** OpenAI-compatible HTTP base URL. Point at an EU-hosted endpoint. Unset by default — no provider is configured. */
  AI_PROVIDER_BASE_URL: z.string().url().optional(),
  AI_PROVIDER_API_KEY: z.string().optional(),
  /** Allow-listed, pinned model + version (ADR-0005) — a single pin for this phase's one use case. */
  AI_ALLOWED_MODEL: z.string().default("gpt-4o-mini"),
  AI_ALLOWED_MODEL_VERSION: z.string().default("2024-07-18"),
  AI_REGION: z.enum(["eu", "us", "other"]).default("eu"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(50_000),
  AI_DAILY_COST_BUDGET_USD_CENTS: z.coerce.number().positive().default(500),
  /**
   * Test-only fixture responder for the AI gateway's stub adapter. When set
   * AND NODE_ENV=test, the reviewer-assist route uses a deterministic,
   * non-network stub instead of refusing with AI_PROVIDER_NOT_CONFIGURED —
   * this is the only way test code can exercise a "provider configured" path
   * without a real API key. Never honoured outside NODE_ENV=test.
   */
  AI_GATEWAY_TEST_STUB_RESPONSE: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration — refusing to start: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production — refusing to start.");
  }
  return parsed.data;
}
