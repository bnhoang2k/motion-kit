import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { BarJson } from "../../src/core/bar.ts";
import { barGate } from "../../src/gate/bar-gate.ts";
import { LINEAR_FAULT, plantFault, STANDARD_FAULTS, type Fault } from "../../src/gate/faults.ts";
import { closeBrowser } from "../../src/gate/harness.ts";
import { kindGate } from "../../src/gate/kind-gate.ts";

/**
 * Copies the bar folder `dir` to a fresh temp folder, writes `files` over the copy (name to
 * text), runs `fn` on the copy and removes it. The copy keeps every file the page loads.
 */
export async function withBarCopy<T>(dir: string, files: Record<string, string>, fn: (copy: string) => Promise<T>): Promise<T> {
  const copy = mkdtempSync(path.join(os.tmpdir(), "motion-kit-bar-"));
  try {
    cpSync(dir, copy, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(copy, name), text);
    return await fn(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

const faultName = (f: Fault) => (typeof f === "string" ? f : `own "${f.own}"`);

/** The names of the checks that report a failure: each line starts with its check's name. A line with no colon counts whole. */
const caughtBy = (failures: string[]) => [...new Set(failures.map((f) => (f.includes(":") ? f.slice(0, f.indexOf(":")) : f)))].sort();

/**
 * The gate suite each `bars/<slug>/gate.test.ts` runs, with its own folder as `dir`. In order:
 * the clean page passes Gate A (the bar gate) and then Gate B (the kind gate); each planted fault
 * fails Gate A. The faults are the three standard ones and every entry of the bar's own `faults`,
 * except the entry named "linear", which the `linear` fault plants. Each fault test notes the checks that caught it as an annotation, which the test report
 * shows, and names them in its assertion message.
 */
export function barGateSuite(dir: string): void {
  const bar = JSON.parse(readFileSync(path.join(dir, "bar.json"), "utf8")) as BarJson;
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  const own = bar.faults.filter((f) => f.name !== LINEAR_FAULT).map((f) => ({ own: f.name }));
  const faults: Fault[] = [...STANDARD_FAULTS, ...own];

  describe(`the ${bar.slug} bar`, () => {
    afterAll(async () => {
      await closeBrowser();
    });

    it("passes Gate A, the bar gate", async () => {
      const v = await barGate(dir);
      expect(v.failures).toEqual([]);
      expect(v.status).toBe("passed");
    });

    it("passes Gate B, the kind gate", async () => {
      const v = await kindGate(path.join(dir, "index.html"));
      expect(v.failures).toEqual([]);
      expect(v.status).toBe("passed");
    });

    for (const fault of faults) {
      const name = faultName(fault);
      it(`fails Gate A with the planted fault ${name}`, async ({ annotate }) => {
        const v = await withBarCopy(dir, { "index.html": plantFault(html, fault, bar) }, barGate);
        const checks = caughtBy(v.failures);
        await annotate(`${name}: caught by ${checks.length > 0 ? checks.join(", ") : "no check"}`);
        expect(v.failures, `${name}: no check caught it`).not.toEqual([]);
        expect(v.status, `${name}: ${v.status}, caught by ${checks.join(", ")}`).toBe("failed");
      });
    }
  });
}
