import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spring } from "motion";
import { resolve } from "../src/core/merge.ts";
import { springProgress } from "../src/core/spring.ts";
import { tx } from "../src/core/tx.ts";
import { transition } from "../src/motion/index.ts";
import { findBlender } from "../scripts/blender-path.mjs";
import { readTranslationX } from "./glb.ts";

const BLENDER = findBlender() ?? ""; // "" when none is found: the Blender tests skip
const TOL = 0.01; // 1 % of the distance: how close every engine must stay
const cfg = resolve();
const CASES = [["whimsical", "move"], ["sleek", "enter"], ["calm", "move"]] as const;

describe("same curve in every engine", () => {
  it.each(CASES)("Motion and three.js agree for %s %s", (feel, move) => {
    const t = transition(cfg, feel, move, { byTouch: true });
    const gen = spring({ keyframes: [0, 1000], visualDuration: t.visualDuration, bounce: t.bounce });
    const three = springProgress(t.visualDuration, t.bounce); // the curve tween() runs
    for (let s = 0; s <= 1.8 * t.visualDuration; s += 1 / 30) {
      expect(Math.abs(gen.next(s * 1000).value / 1000 - three(s))).toBeLessThanOrEqual(TOL);
    }
  });

});

describe.skipIf(!existsSync(BLENDER))("same curve in Blender", () => {
  it.each(CASES)(
    "Blender's baked clip agrees for %s %s",
    (feel, move) => {
      const dir = mkdtempSync(path.join(tmpdir(), "motion-kit-"));
      const resolved = path.join(dir, "motion.resolved.json");
      const glb = path.join(dir, "probe.glb");
      writeFileSync(resolved, JSON.stringify(cfg));
      execFileSync(BLENDER, ["-b", "--factory-startup", "--python", "blender/bake_probe.py", "--", resolved, glb, feel, move], { stdio: "pipe", timeout: 120_000 });
      const { times, x } = readTranslationX(readFileSync(glb), "probe");
      const s = tx(cfg, feel, move, { byTouch: true });
      const ref = springProgress(s.visualDuration, s.bounce);
      expect(times.length).toBeGreaterThan(3);
      times.forEach((t, i) => expect(Math.abs(x[i]! - ref(t - times[0]!))).toBeLessThanOrEqual(TOL));
    },
    180_000,
  );

  it("bakes no overshoot when no touch caused the move (whimsical move, notouch)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "motion-kit-"));
    const resolved = path.join(dir, "motion.resolved.json");
    const glb = path.join(dir, "probe.glb");
    writeFileSync(resolved, JSON.stringify(cfg));
    execFileSync(BLENDER, ["-b", "--factory-startup", "--python", "blender/bake_probe.py", "--", resolved, glb, "whimsical", "move", "notouch"], { stdio: "pipe", timeout: 120_000 });
    const { times, x } = readTranslationX(readFileSync(glb), "probe");
    const s = tx(cfg, "whimsical", "move", { byTouch: false });
    const ref = springProgress(s.visualDuration, s.bounce);
    expect(Math.max(...x)).toBeLessThanOrEqual(1 + 1e-6);
    times.forEach((t, i) => expect(Math.abs(x[i]! - ref(t - times[0]!))).toBeLessThanOrEqual(TOL));
  }, 180_000);

  it("bake_probe exits with an error for a fifth argument that is not touch or notouch", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "motion-kit-"));
    const resolved = path.join(dir, "motion.resolved.json");
    const glb = path.join(dir, "probe.glb");
    writeFileSync(resolved, JSON.stringify(cfg));
    let status: number | null = 0;
    let stderr = "";
    try {
      execFileSync(BLENDER, ["-b", "--factory-startup", "--python", "blender/bake_probe.py", "--", resolved, glb, "calm", "tap", "bogus"], { stdio: "pipe", timeout: 120_000 });
    } catch (e) {
      status = (e as { status: number | null }).status;
      stderr = String((e as { stderr: Buffer }).stderr);
    }
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/\[touch\|notouch\]/);
    expect(existsSync(glb)).toBe(false);
  }, 180_000);
});
