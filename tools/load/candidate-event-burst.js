/**
 * k6 script: candidate evidence-event burst (Delivery Plan Step 48).
 *
 * Sustained 10 rps for 2 minutes against the one seeded in_progress session's
 * POST /v1/candidate/:token/events endpoint (workspace_evidence category,
 * always allow-listed for candidate submission).
 *
 * Usage: CANDIDATE_TOKEN=<token from seed script output> k6 run tools/load/candidate-event-burst.js
 */
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    event_burst: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "2m",
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
const TOKEN = __ENV.CANDIDATE_TOKEN;
if (!TOKEN) {
  throw new Error("Required env var: CANDIDATE_TOKEN (from tools/load/seed-load-test.mjs output)");
}

export default function () {
  const res = http.post(
    `${BASE_URL}/v1/candidate/${TOKEN}/events`,
    JSON.stringify({
      category: "workspace_evidence",
      eventType: "editor_edit",
      payload: { characters: 42, note: "k6 load-test event" },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, {
    "status is 201": (r) => r.status === 201,
  });
}
