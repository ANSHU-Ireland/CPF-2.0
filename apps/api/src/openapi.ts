/**
 * OpenAPI 3.0 spec generation (CPF-44).
 *
 * Deliberately self-maintaining rather than hand-transcribed: every route is
 * captured automatically via Fastify's `onRoute` hook as it's registered, so
 * the spec can never drift out of coverage with the real route table (the
 * risk called out in the delivery plan). Request/response *bodies* are
 * documented at the error-contract + auth level (every route's real 4xx/5xx
 * envelope, security requirement) rather than per-field, since routes
 * validate with hand-written zod `safeParse` calls rather than Fastify's own
 * schema validation — deriving full per-route JSON Schema would require
 * threading a schema reference through every route file, which is out of
 * scope for this pass. The inject test suite remains the source of truth for
 * actual request/response shapes, exactly as the risk note requires.
 */
import type { FastifyInstance } from "fastify";

export interface CapturedRoute {
  method: string;
  url: string;
}

const ERROR_CONTRACT_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "requestId", "retryable"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        retryable: { type: "boolean" },
        details: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
  },
} as const;

/** Routes reachable without a bearer session token (public or token-in-path auth). */
function isPublicRoute(url: string): boolean {
  return (
    url === "/health" ||
    url.startsWith("/v1/framework/") ||
    url === "/v1/scoring/evaluate" ||
    url === "/v1/auth/login" ||
    url.startsWith("/v1/candidate/") ||
    url === "/v1/platform/organisations" // first-admin bootstrap: no session exists yet
  );
}

function operationFor(route: CapturedRoute): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    "400": { description: "Validation failed.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } },
    "401": { description: "Missing or invalid credentials.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } },
    "403": { description: "Not permitted for this role/tenant.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } },
    "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } },
    "429": { description: "Rate limited.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } },
    "500": { description: "Unexpected error.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } },
  };
  if (route.method === "POST" || route.method === "PUT") {
    responses["200"] = { description: "Successful response." };
    responses["201"] = { description: "Created." };
    responses["409"] = { description: "Conflict.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } };
    responses["413"] = { description: "Payload too large.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } };
    responses["422"] = { description: "Semantically invalid request.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorContract" } } } };
  } else if (route.method === "DELETE") {
    responses["204"] = { description: "Deleted." };
  } else {
    responses["200"] = { description: "Successful response." };
  }

  const segments = route.url.split("/").filter(Boolean);
  const tag = segments[1] ?? "root"; // e.g. /v1/orgs/... -> "orgs"

  return {
    summary: `${route.method} ${route.url}`,
    tags: [tag],
    ...(isPublicRoute(route.url) ? {} : { security: [{ bearerAuth: [] }] }),
    responses,
  };
}

/** Converts Fastify's `:param` route-parameter syntax to OpenAPI's `{param}`. */
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function buildOpenApiSpec(routes: CapturedRoute[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const path = toOpenApiPath(route.url);
    paths[path] ??= {};
    paths[path]![route.method.toLowerCase()] = operationFor(route);
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "CPF Enterprise Ecosystem API",
      version: "0.1.0",
      description:
        "Auto-generated from the live Fastify route table (CPF-44). Documents every registered route's " +
        "auth requirement and standard error contract; exact request/response field shapes are proven by " +
        "the inject-based integration test suite, which remains the source of truth.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ErrorContract: ERROR_CONTRACT_SCHEMA,
      },
    },
    paths,
  };
}

/** Registers an `onRoute` hook that captures every route as it's added, for later spec generation. */
export function captureRoutes(app: FastifyInstance): CapturedRoute[] {
  const routes: CapturedRoute[] = [];
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      routes.push({ method, url: routeOptions.url });
    }
  });
  return routes;
}
