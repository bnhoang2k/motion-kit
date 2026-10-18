import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The browser suites run under `pnpm test:bars` (vitest.bars.config.ts), so `pnpm test` never starts a browser.
    exclude: [...configDefaults.exclude, "test/bars/**", "test/fixtures/**"],
    environment: "node",
  },
});
