# API Standards

Base: HTTPS-only JSON over REST. Version prefix `/v1`. Breaking changes require
`/v2` + deprecation window. OpenAPI spec generated from route schemas (CPF-44).

## Error contract (implemented)

```json
{
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "Human-safe explanation.",
    "requestId": "9be2…",
    "retryable": false,
    "details": []
  }
}
```

Codes are stable and documented; stack traces, SQL, prompts, and vendor
messages never reach clients. 400 request validation · 401/403 authn/z ·
404 unknown resource · 409 state conflict · 422 domain rule violation ·
429 rate limited · 5xx with `retryable: true` where safe.

## Conventions

- IDs: UUIDv4 strings. Times: RFC 3339 UTC.
- Pagination: cursor-based (`?cursor=…&limit=…`, max 100) for all lists.
- Idempotency: mutating candidate-facing endpoints accept `Idempotency-Key`
  (Phase 2 middleware).
- Every request gets `x-request-id` (client-suppliable, always echoed).
- Body limit 256 KiB except evidence/file endpoints (dedicated limits + scanning).
- Security headers on all responses (implemented): nosniff, DENY framing,
  no-referrer, no-store, restrictive CSP.
- Rate limiting per token/IP tier (Phase 2, before any public exposure).

## Current surface (implemented & tested)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /health | none | liveness + version |
| GET | /v1/framework/scoring-model | none* | non-personal versioned content |
| GET | /v1/framework/templates | none* | summaries only |
| GET | /v1/framework/templates/:code | none* | full frozen definition |
| POST | /v1/scoring/evaluate | none* | stateless; nothing persisted; no outcome vocabulary |
| GET | /v1/orgs/:orgId/acknowledgements/responsible-use | org_admin, hiring_manager | current-version ack status + document content (CPF-34) |
| POST | /v1/orgs/:orgId/acknowledgements/responsible-use | org_admin, hiring_manager | records ack; 409 STALE_DOCUMENT_VERSION if version mismatched (CPF-34) |

\* Deliberate scope boundary: only non-personal framework content and stateless
computation are exposed until the identity module (CPF-40) lands. Every future
tenant endpoint requires authn + org context + RLS + audit, by standard.

Note: the full tenant-scoped surface (auth, org hiring/candidates/sessions,
reviews, org read-models, data-rights/legal-holds, candidate portal) is
implemented and integration-tested (see docs/status/completion-report.md) but
predates this table's last full sync — tracked as a documentation debt, not an
implementation gap.

## Planned surface (Phase 2 — spec-first, see PRD FRs)

`/v1/orgs/:orgId/candidates|invitations|sessions|reviews|reports`,
`/v1/candidate/:token/…` (disclosure, workspace, data-rights),
`/v1/evidence/ingest` (category allow-list; rejects `raw_keystroke`,
`external_clipboard_content`, events without disclosure, events outside active
session — mirrors BR-06).
