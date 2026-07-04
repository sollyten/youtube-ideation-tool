import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites share one Postgres test database and TRUNCATE
    // between cases. Run everything in a single fork, serially, so one file's
    // truncate can never wipe another file's fixtures mid-run.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
