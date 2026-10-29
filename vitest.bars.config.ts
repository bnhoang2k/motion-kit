import { defineConfig } from "vitest/config";

// The browser suites: the gate harness and its self-checks, each bar's gate, and the gate of each
// test bar under test/fixtures/bars. They need Playwright's Chromium, so they run under
// `pnpm test:bars`, apart from `pnpm test`.
//
// A gate of one page takes 5 to 60 s and uses about 1 s of node CPU: it waits on the real clock (input replayed at
// speed, off-screen and resume windows, frames the page draws live). So the big files run their tests side by side
// (test/bars-concurrency.test.ts holds them to it), at most `maxConcurrency` at once per file, and five files at a time.
//
// Two projects run one after the other (`sequence.groupOrder`). A bar's gate is one live page at the real clock: it keeps
// its pace (and its 60 s) only while no sweep takes the cores, and the slowest needs most of the 60 even then. So the
// bars' gates, the harness checks and every other file run first, and the six big files (the sweeps) run after them.
// A file added under test/bars lands in the first group unless it is named in `sweeps`.
const sweeps = ["kind-gate", "caused-sweep", "live-sweep", "style-sweep", "loop-sweep", "object-sweep"].map((name) => `test/bars/${name}.test.ts`);

export default defineConfig({
  test: {
    environment: "node",
    maxConcurrency: 8,
    maxWorkers: 5,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: "gates",
          include: ["test/bars/**/*.test.ts", "bars/*/gate.test.ts", "test/fixtures/bars/*/gate.test.ts"],
          exclude: sweeps,
          sequence: { groupOrder: 1 },
        },
      },
      { extends: true, test: { name: "sweeps", include: sweeps, sequence: { groupOrder: 2 } } },
    ],
  },
});
