import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import barsConfig from "../vitest.bars.config.ts";

/**
 * The browser suites wait on the real clock more than they use the CPU (a gate of one page takes 5 to 60 s and about 1 s
 * of it is node). One test at a time leaves the machine idle, so the big files run their tests side by side, and
 * `maxConcurrency` in vitest.bars.config.ts says how many. This guard reads the sources, so `pnpm test` checks it
 * without a browser:
 *
 * - every top-level `describe` of a big file is `describe.concurrent` (or `{ concurrent: false }`, with a reason), so a block added
 *   later does not quietly run one test at a time;
 * - a test that closes the shared browser (`closeBrowser()`, or the `gate` and `sheet` commands, which close it when they end) sits in a top-level describe with `{ concurrent: false }`.
 *   vitest runs such a block alone, between the concurrent blocks at its own level, and a block deeper down would still
 *   run beside the other top-level blocks and close the browser under them.
 *
 * - every big file imports `./sweep-priority.ts`, which lowers the priority of its worker and the browser it starts. The
 *   sweeps take as much CPU as they are given, and each bar's gate (a live page at the real clock, in WebGL) must keep
 *   its pace to finish inside the 60 s test timeout while they run beside it.
 *
 * - the big files run as a project of their own, in a later group than every other file (`sequence.groupOrder`), so a bar's
 *   gate, which keeps its 60 s only on a machine with free cores, never runs beside a sweep.
 *
 * The other files stay as they are: harness.test.ts mocks modules (`vi.resetModules`), which no sibling test may share a
 * worker with, and each bar's gate.test.ts and bar-gate.test.ts are short.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const BIG = ["kind-gate", "caused-sweep", "live-sweep", "style-sweep", "loop-sweep", "object-sweep"];
const source = (name: string) => readFileSync(path.join(ROOT, "test/bars", `${name}.test.ts`), "utf8").split("\n");

describe("the browser suites run their tests side by side", () => {
  it("vitest.bars.config.ts caps how many, and keeps the 60 s test timeout", () => {
    const config = readFileSync(path.join(ROOT, "vitest.bars.config.ts"), "utf8");
    expect(config).toMatch(/maxConcurrency:\s*\d+/);
    expect(config).toMatch(/testTimeout:\s*60_000/);
    expect(config).toMatch(/hookTimeout:\s*60_000/);
  });

  it.each(BIG)("%s: runs at a lower priority than the bars' gates", (name) => {
    expect(source(name).filter((line) => line === 'import "./sweep-priority.ts";')).toHaveLength(1);
  });

  it.each(BIG)("%s: every top-level describe is concurrent or says why not", (name) => {
    const plain = source(name)
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^describe(\.each\(|\()/.test(line) && !/concurrent: false/.test(line));
    expect(plain.map(({ n, line }) => `${name}.test.ts:${n} ${line.slice(0, 60)}`)).toEqual([]);
  });

  it.each(BIG)("%s: a test that closes the shared browser sits in a top-level describe with concurrent: false", (name) => {
    const lines = source(name);
    const stray: string[] = [];
    lines.forEach((line, i) => {
      if (!/closeBrowser\(\)|\brun\(\["(gate|sheet)"/.test(line) || /^\s*import /.test(line)) return;
      // The lines that open the blocks around this one, found by indent, innermost first.
      const openers: { at: number; text: string }[] = [];
      let indent = line.search(/\S/);
      for (let j = i - 1; j >= 0; j--) {
        const at = lines[j]!.search(/\S/);
        if (at >= 0 && at < indent) {
          openers.push({ at, text: lines[j]!.trim() });
          indent = at;
        }
      }
      const inHook = /^(afterAll|beforeAll)\(/.test(openers[0]?.text ?? "");
      const alone = openers.some((o) => o.at === 0 && /^describe\b.*\{ concurrent: false/.test(o.text));
      if (!inHook && !alone) stray.push(`${name}.test.ts:${i + 1}`);
    });
    expect(stray).toEqual([]);
  });

  it("the big files are a project that runs after every other file, so no bar's gate runs beside a sweep", () => {
    type Project = { test: { name: string; include: string[]; sequence?: { groupOrder?: number } } };
    const projects = (barsConfig.test as unknown as { projects?: Project[] }).projects ?? [];
    const sweeps = projects.filter((p) => BIG.every((name) => p.test.include.includes(`test/bars/${name}.test.ts`)));
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.test.include).toHaveLength(BIG.length);
    const others = projects.filter((p) => p !== sweeps[0]);
    expect(others.length).toBeGreaterThan(0);
    const order = (p: Project) => p.test.sequence?.groupOrder ?? 0;
    for (const p of others) expect(order(p)).toBeLessThan(order(sweeps[0]!));
  });

  it("a browser test file that is not a big file runs in the first group, so a new file does not fall out", () => {
    type Project = { test: { include: string[]; exclude?: string[] } };
    const projects = (barsConfig.test as unknown as { projects?: Project[] }).projects ?? [];
    const rest = projects.find((p) => !BIG.every((name) => p.test.include.includes(`test/bars/${name}.test.ts`)));
    expect(rest?.test.include).toEqual(expect.arrayContaining(["test/bars/**/*.test.ts", "bars/*/gate.test.ts", "test/fixtures/bars/*/gate.test.ts"]));
    expect([...(rest?.test.exclude ?? [])].sort()).toEqual(BIG.map((name) => `test/bars/${name}.test.ts`).sort());
  });
});
