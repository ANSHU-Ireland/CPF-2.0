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
