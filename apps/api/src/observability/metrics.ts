/**
 * Prometheus metrics (Delivery Plan Step 33).
 *
 * A single module-level registry — these are ES-module singletons, so even
 * though `buildApp()` may be called many times in one process (every test
 * file does this), the metric objects themselves are only constructed once,
 * avoiding prom-client's "metric already registered" errors.
 *
 * Exposure is opt-in (`BuildAppOptions.metricsEnabled` / `METRICS_ENABLED`
 * env var, default off) and, even when enabled, `/metrics` is meant to be
 * reachable only from an internal network — see the operations runbook.
 * prom-client has no built-in access control; that boundary is enforced by
 * network topology (reverse proxy / firewall), not application code.
 */
import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, labelled by method, route pattern, and status code.",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const evidenceEventsTotal = new client.Counter({
  name: "cpf_evidence_events_total",
  help: "Total evidence events accepted and persisted.",
  registers: [registry],
});

export const auditAppendsTotal = new client.Counter({
  name: "cpf_audit_appends_total",
  help: "Total entries appended to the tamper-evident audit log.",
  registers: [registry],
});

export const retentionRunLastTimestamp = new client.Gauge({
  name: "cpf_retention_run_last_timestamp_seconds",
  help: "Unix timestamp (seconds) at which the most recent retention sweep completed.",
  registers: [registry],
});

export const retentionRunDurationSeconds = new client.Gauge({
  name: "cpf_retention_run_duration_seconds",
  help: "Wall-clock duration in seconds of the most recent retention sweep.",
  registers: [registry],
});
