import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "../../src/gate/harness.ts";
import { kindGate, type KindVerdict } from "../../src/gate/kind-gate.ts";
import { loopSlug, writeLoopPage, type LoopSpec } from "./loop-pages.ts";

/**
 * The style sweep for designed idle loops (the class guard, as test/bars/style-sweep.test.ts is for stepped
 * motion). A value that repeats at one period, 0.5 to 7.5 s, after a lead-in of up to 2 s, is a loop: it may pulse
 * with any attack, and settle past its rest by up to half its move when each cycle holds still. Periods on and off
 * the frame grid, and lead-ins from 0 to 2 s, are rotated across the shapes.
 */

const honest: LoopSpec[] = [
  { shape: "relay", periodS: 0.5, leadS: 0 },
  { shape: "badge", periodS: 0.8, leadS: 0.4 },
  { shape: "breath", periodS: 1.237, leadS: 1.1 },
  // The loader's first cycle has no landing to spring back from, so its frames repeat 0.35 periods after its lead-in
  // ends: 1.3 s here makes a measured lead-in of 2 s.
  { shape: "loader", periodS: 2, leadS: 1.3 },
  { shape: "tick", periodS: 3.33, leadS: 0 },
  { shape: "relay", periodS: 5, leadS: 0.4 },
  { shape: "badge", periodS: 7.5, leadS: 2 },
  { shape: "loader", periodS: 1.33, leadS: 1.1 },
  { shape: "breath", periodS: 4, leadS: 0 },
  { shape: "tick", periodS: 1, leadS: 0.4 },
  // A pulse with a 200 ms attack that repeats only twice in 15 s: a loop by its period, so it has no attack bound.
  { shape: "blink", periodS: 7.5, leadS: 0.4 },
  // Loops longer than 3 s whose reduced-motion still frame is their start state: the rules read the loop through two
  // periods, so it comes back to its start (sprite blinks too).
  { shape: "breath", periodS: 4, leadS: 0, stillAt: 0 },
  { shape: "swing", periodS: 7.4, leadS: 0, stillAt: 0 },
  { shape: "blink", periodS: 3, leadS: 0, stillAt: 0 },
  { shape: "swing", periodS: 3.333, leadS: 1.1 },
  // A hand that turns on: its angle grows, but on screen it comes back each period (sprite spinners, clock-tick).
  { shape: "spin", periodS: 0.6, leadS: 0, stillAt: 0 },
  { shape: "tick", periodS: 1, leadS: 0, stillAt: 0 },
  // An opacity loop that starts at its high is a loop, not a fade that rises.
  { shape: "shimmer", periodS: 1.6, leadS: 0 },
  { shape: "shimmer", periodS: 3, leadS: 0.4 },
  // Two equal hops a period: the gate tries multiples of the half period it first finds.
  { shape: "hops2", periodS: 1.6, leadS: 0 },
  { shape: "hops2", periodS: 3, leadS: 1.1 },
  // Noise under the unit floor does not keep a loop from holding still.
  { shape: "noisySwing", periodS: 2, leadS: 0 },
  { shape: "noisySwing", periodS: 4, leadS: 0.4 },
  // Straight moves with held rests: the zero steps of a hold sit at the steps' mid level.
  { shape: "linearHold", periodS: 2, leadS: 0 },
  { shape: "linearHold", periodS: 1.2, leadS: 0.4 },
  // Moves the overshoot rule reads as one: a ball that lands short of the ground in its frames, and an anticipation
  // dip, whose share is from the dip.
  { shape: "ballDrop", periodS: 1, leadS: 0.4 },
  { shape: "antic", periodS: 2, leadS: 0.3 },
  // A value at one steady speed comes back on screen each frame.
  { shape: "marquee", periodS: 3, leadS: 0 },
];

const faulty: [LoopSpec, string][] = [
  [{ shape: "bounce", periodS: 0.6, leadS: 0 }, "overshoot"],
  [{ shape: "overcap", periodS: 2, leadS: 0.4 }, "overshoot"],
  [{ shape: "springOnce", periodS: 1, leadS: 0 }, "overshoot"],
  [{ shape: "pops", periodS: 1, leadS: 0 }, "envelope"],
  // A hop that lands is pulses, so the drifting hop, no loop, breaks the pulse attack bound.
  [{ shape: "drift", periodS: 1.6, leadS: 0 }, "envelope"],
  // An opacity loop that dips past its rest: opacity never overshoots, in a loop too.
  [{ shape: "shimmerOver", periodS: 1.6, leadS: 0 }, "overshoot"],
  [{ shape: "shimmerOver", periodS: 4, leadS: 0.4 }, "overshoot"],
  // Faults after the first 3 s: the rules read them too.
  [{ shape: "lateSpring", periodS: 1, leadS: 0 }, "overshoot"],
  [{ shape: "latePop", periodS: 1, leadS: 0 }, "envelope"],
  [{ shape: "lateSettle", periodS: 7, leadS: 0 }, "overshoot"],
  [{ shape: "latePopLoop", periodS: 6, leadS: 0 }, "envelope"],
  [{ shape: "reducedLate", periodS: 1.2, leadS: 0 }, "reducedMotion"],
  // A rebound that starts the next move, and a slow move home that settles 80% past it.
  [{ shape: "stepOnRebound", periodS: 1, leadS: 0 }, "overshoot"],
  [{ shape: "stepOnReboundLoop", periodS: 2.5, leadS: 0.3 }, "overshoot"],
  [{ shape: "homeSettle", periodS: 3, leadS: 0.3 }, "overshoot"],
];

const failing = (v: KindVerdict) => [...new Set(v.failures.map((f) => f.slice(0, f.indexOf(":"))))].sort();
const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-loops-"));

afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await closeBrowser();
});

describe("the style sweep: designed idle loops", () => {
  it.each(honest.map((s) => [loopSlug(s), s] as const))("%s passes", async (_, spec) => {
    const v = await kindGate(writeLoopPage(root, spec));
    expect(v.failures).toEqual([]);
  });

  // A fault may break more than one rule (a drifting hop is a slow pulse too); it must break its own.
  it.each(faulty.map(([s, rule]) => [loopSlug(s), s, rule] as const))("%s fails %s", async (_, spec, rule) => {
    const v = await kindGate(writeLoopPage(root, spec));
    expect(failing(v)).toContain(rule);
  });
});
