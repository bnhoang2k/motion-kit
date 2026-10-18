import { defineConfig } from "vitest/config";

// The browser suites: the gate harness and its self-checks, each bar's gate, and the gate of each
// test bar under test/fixtures/bars. They need Playwright's Chromium, so they run under
// `pnpm test:bars`, apart from `pnpm test`.
export default defineConfig({
  test: {
    include: ["test/bars/**/*.test.ts", "bars/*/gate.test.ts", "test/fixtures/bars/*/gate.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
