import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These are integration tests against one shared, real Postgres instance
    // (not per-file isolated databases). Running test files concurrently
    // (vitest's default) races fixture setup/teardown across files sharing
    // global tables (users, organisations, org_memberships, sessions) —
    // this was invisible on high-core-count local machines (many workers,
    // effectively serial-per-file) but reproduces reliably on low-core CI
    // runners (few workers, files queued through shared forks). Force
    // strictly sequential file execution so this workspace's suite is
    // deterministic regardless of runner core count.
    fileParallelism: false,
  },
});
