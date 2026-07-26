/**
 * k6 script: sessions list read, with 1,000 sessions seeded (Delivery Plan
 * Step 48). GET /v1/orgs/:orgId/sessions is the employer portal's main
 * work-queue read model — the query this script exercises joins
 * assessment_sessions -> invitations -> candidates -> job_profiles ->
 * assessment_template_versions -> assessment_templates plus a LATERAL join
 * to the latest review, LIMIT 200, ORDER BY created_at DESC.
 *
 * Usage:
 *   ORG_ID=<org id from seed script output> k6 run tools/load/sessions-list.js
 */
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    sessions_read: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:4000";
const ORG_ID = __ENV.ORG_ID;
if (!ORG_ID) {
  throw new Error("Required env var: ORG_ID (from tools/load/seed-load-test.mjs output)");
}

export function setup() {
  const res = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: "load-admin@loadtest.example", password: "Load-Test-Password-1!" }),
    { headers: { "Content-Type": "application/json" } },
  );
  return { token: JSON.parse(res.body).token };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/v1/orgs/${ORG_ID}/sessions`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  check(res, {
    "status is 200": (r) => r.status === 200,
    "returns rows": (r) => JSON.parse(r.body).length > 0,
  });
}
