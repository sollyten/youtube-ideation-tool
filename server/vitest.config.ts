import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites share one Postgres test database and TRUNCATE
    // between cases, so files must not run concurrently. We disable file
    // parallelism (serial execution) but keep per-file isolation (a fresh fork
    // per file) — sharing a single fork pollutes module-global state in some
    // bundled deps (e.g. pdf-parse's pdf.js).
    pool: "forks",
    fileParallelism: false,
    isolate: true,
    sequence: { concurrent: false },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
