/**
 * k6 script: login burst (Delivery Plan Step 48).
 *
 * Repeatedly logs in as the seeded load-test admin. Measures p95 latency and
 * the error rate. Run `node tools/load/seed-load-test.mjs` first and start
 * the API (see tools/load/README.md).
 *
 * Usage: k6 run tools/load/login.js
 */
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    login_burst: {
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

export default function () {
  const res = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: "load-admin@loadtest.example", password: "Load-Test-Password-1!" }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, {
    "status is 200": (r) => r.status === 200,
    "has token": (r) => JSON.parse(r.body).token !== undefined,
  });
}
