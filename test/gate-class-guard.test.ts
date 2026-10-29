import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The class guard's code check: a gate rule holds for a class of motion, so the gate's code never names a bar. A bar
 * slug in src/gate/ or kinds/<kind>/gate.ts would mean a rule was shaped around one bar. The rule's range is proven by
 * the style sweeps (test/bars/style-sweep.test.ts, loop-sweep.test.ts), and its numbers by pages written from the rules alone.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const gateFiles = [
  ...readdirSync(path.join(ROOT, "src/gate")).filter((f) => f.endsWith(".ts")).map((f) => path.join(ROOT, "src/gate", f)),
  ...readdirSync(path.join(ROOT, "kinds")).map((k) => path.join(ROOT, "kinds", k, "gate.ts")).filter((f) => {
    try {
      readFileSync(f);
      return true;
    } catch {
      return false;
    }
  }),
];
const slugs = readdirSync(path.join(ROOT, "bars")).filter((d) => /^\d+-/.test(d));

describe("the class guard", () => {
  it("finds the gate code and the bars", () => {
    expect(gateFiles.length).toBeGreaterThan(5);
    // Every bar folder, and no other. The list may be empty.
    const folders = readdirSync(path.join(ROOT, "bars"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(slugs.sort()).toEqual(folders.sort());
  });

  it.each(slugs)("no gate code names bar %s", (slug) => {
    const name = slug.replace(/^\d+-/, "");
    const hits = gateFiles.filter((f) => readFileSync(f, "utf8").includes(name)).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
