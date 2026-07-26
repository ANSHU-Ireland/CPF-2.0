/**
 * k6 script: employer Evidence Profile read, p95<500ms target (Delivery
 * Plan Step 48). GET .../evidence-profile is the heaviest single-record read
 * in the app: it joins reviews + criterion_scores + evidence_ledger_claims,
 * loads the frozen template definition, and runs the full `evaluate()`
 * scoring computation server-side on every request (no caching).
 *
 * Usage:
 *   ORG_ID=<org id> SESSION_ID=<profileSessionId> k6 run tools/load/profile-read.js
 *   (both values are printed by tools/load/seed-load-test.mjs)
 */
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    profile_read: {
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
const SESSION_ID = __ENV.SESSION_ID;
if (!ORG_ID || !SESSION_ID) {
  throw new Error("Required env vars: ORG_ID, SESSION_ID (from tools/load/seed-load-test.mjs output)");
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
  const res = http.get(`${BASE_URL}/v1/orgs/${ORG_ID}/sessions/${SESSION_ID}/evidence-profile`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}
