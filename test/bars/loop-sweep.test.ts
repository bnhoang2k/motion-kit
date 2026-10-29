import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, openPage } from "../../src/gate/harness.ts";
import { kindGate, loopSet, type KindVerdict } from "../../src/gate/kind-gate.ts";
import { loopSlug, writeLoopPage, type LoopSpec } from "./loop-pages.ts";
import { bob, breath, ruleLines, stallsPage, tracksPage } from "./rest-pages.ts";
import "./sweep-priority.ts";

const LOOP_PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/loops");

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
  // ...at 20 and 400 px/s, and after a ramp-up over 1.5 s: the last 500 ms are steady, not the whole series.
  { shape: "marqueeSlow", periodS: 3, leadS: 0 },
  { shape: "marqueeFast", periodS: 3, leadS: 0 },
  { shape: "marqueeRamp", periodS: 3, leadS: 0 },
  // A plain sine breath from load, at periods off the frame grid up to the longest loop: a loop whatever the period.
  { shape: "sineBreath", periodS: 2.9, leadS: 0, stillAt: 0 },
  { shape: "sineBreath", periodS: Math.PI, leadS: 0, stillAt: 0 },
  { shape: "sineBreath", periodS: 4.1, leadS: 0, stillAt: 0 },
  { shape: "sineBreath", periodS: 5.5, leadS: 0, stillAt: 0 },
  { shape: "sineBreath", periodS: 7.5, leadS: 0, stillAt: 0 },
  // A fade-in from 0 that then glows, shown in the glow under reduced motion: a loop that came in, not a blank page.
  { shape: "fadeInGlow", periodS: 2, leadS: 0 },
];

const faulty: [LoopSpec, string][] = [
  [{ shape: "bounce", periodS: 0.6, leadS: 0 }, "overshoot"],
  [{ shape: "overcap", periodS: 2, leadS: 0.4 }, "overshoot"],
  [{ shape: "springOnce", periodS: 1, leadS: 0 }, "overshoot"],
  // A loop that sets its lift in one frame each cycle comes home, so its pop is read between frames.
  [{ shape: "pops", periodS: 1, leadS: 0 }, "suddenJumps"],
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
  // A slide-on that comes to rest is no steady speed, however steady its middle: its start state is blank.
  [{ shape: "entranceBlank", periodS: 3, leadS: 0 }, "reducedMotion"],
  // ...nor is one that slides on and then drifts: it came to its drift faster than the drift, at 10 and 30 px/s.
  [{ shape: "entranceDrift10", periodS: 3, leadS: 0 }, "reducedMotion"],
  [{ shape: "entranceDrift30", periodS: 3, leadS: 0 }, "reducedMotion"],
  // ...nor is a fade-in from 0 that then glows: its start state lies outside the glow's swing, so the loop never comes back
  // to it, and a page that shows it under reduced motion stays blank.
  [{ shape: "fadeInGlow", periodS: 2, leadS: 0, stillAt: 0 }, "reducedMotion"],
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

describe.concurrent("the style sweep: designed idle loops", () => {
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

/**
 * A loop a page runs from load holds still under reduced motion, so it is no value that answers the input: the drag
 * moves it, the reduced-motion run holds it, and the gate leaves loops out of that check. These live pages carry a glow
 * of 4% every 2 s, alone and beside a timed sequence, and a breath of 2% that begins at the release of the drag
 * (fixtures/gate-pages/loops/). A loop is asked to answer the input only for the part of its motion that exceeds its own swing.
 */
describe.concurrent("a live load loop that holds still under reduced motion passes", () => {
  it.each([
    ["live-load-glow.html", "a glow from load, nothing else"],
    ["live-load-loop-beside-sequence.html", "a loop from load beside a timed sequence"],
    ["live-breath-begins-at-release.html", "a breath that begins at the release of a drag, which the no-input page never starts"],
  ])("%s, %s", async (file) => {
    const v = await kindGate(path.join(LOOP_PAGES, file));
    expect(v.failures).toEqual([]);
  });
});

/**
 * And for the idle rules that look at values, not callbacks (rest-pages.ts): a loop that pauses off screen and comes back
 * keeps moving, for a page with the loop from load (an idle page has no input). A return that runs 6 frames and leaves the
 * loop dead has a frame within 50 ms, and fails resumes; a loop that ignores that the page is hidden fails pausesOffScreen.
 */
describe.concurrent("an idle loop pauses, and comes back moving", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-idle-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const rules = ["pausesOffScreen", "resumes"];

  it("a bob that pauses and resumes passes", async () => {
    expect(await ruleLines(stallsPage(root, "idle", "bob", { loops: [bob("load")] }), rules)).toEqual([]);
  }, 120000);
  it("a glow that pauses by an IntersectionObserver alone passes", async () => {
    expect(await ruleLines(tracksPage(root, "idle", "glow-io", { loop: breath("load"), watch: "io" }), rules)).toEqual([]);
  }, 120000);
  it("a return that runs 6 frames and leaves the bob dead fails resumes", async () => {
    expect(await ruleLines(stallsPage(root, "idle", "bob-6-frames", { loops: [bob("load")], resume: "once", resumeFrames: 6 }), rules)).toEqual([
      expect.stringMatching(/^resumes: g has stopped moving 300 ms after the page came back on screen; the loop runs on after it resumes$/),
    ]);
  }, 120000);
  it("a bob that ignores that the page is hidden fails pausesOffScreen", async () => {
    expect(await ruleLines(stallsPage(root, "idle", "bob-no-pause", { loops: [bob("load")], pause: false }), rules)).toEqual([
      expect.stringMatching(/^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen; the loop pauses off screen$/),
    ]);
  }, 120000);
});

/**
 * A loop is a value that comes back to where it was: one that moves on by less than the unit's floor each period still adds up
 * over the read. The honest shapes below hold their level (float jitter of 1e-5 and periods off the frame grid included) or ease
 * in to a steady speed on load, and pass every rule. The sorted page is read for its loops (an idle page has no rule that makes a
 * value that never rests fail, so the sort is what is asserted): a bob that sinks 0.45 px a cycle, a pulse that grows 1% of its
 * swing a beat and an opacity loop that fades 0.002 a cycle are no loop, at every period; the honest ones are.
 */
describe.concurrent("the style sweep: drift under the floor each period", () => {
  const honestSpecs: LoopSpec[] = [
    { shape: "bobJitter", periodS: 0.5, leadS: 0 },
    { shape: "bobJitter", periodS: 0.7103, leadS: 0.4 },
    { shape: "bobJitter", periodS: 1.237, leadS: 0 },
    { shape: "bobJitter", periodS: 3.33, leadS: 1.1 },
    { shape: "breathJitter", periodS: 0.6, leadS: 0 },
    { shape: "breathJitter", periodS: 1.9371, leadS: 0.4 },
    { shape: "breathJitter", periodS: 2.2, leadS: 0 },
    { shape: "breathJitter", periodS: 4.1, leadS: 0.4 },
    { shape: "marqueeEase1", periodS: 3, leadS: 0 },
  ];
  it.each(honestSpecs.map((s) => [loopSlug(s), s] as const))("%s passes", async (_, spec) => {
    const v = await kindGate(writeLoopPage(root, spec));
    expect(v.failures).toEqual([]);
  });

  // The read is 17 s: a drift that adds up to less than the floor over it (a pulse that grows 1% a beat with a beat every
  // 3.5 s has 4 beats to grow) is within what the floor allows, so the longest period is swept for the bob alone.
  const sinking: [LoopSpec, string][] = [
    ...[0.5, 0.6, 0.8, 1.2, 2].flatMap((periodS) => [
      [{ shape: "bobSinks", periodS, leadS: 0 }, "y"] as [LoopSpec, string],
      [{ shape: "pulseGrows", periodS, leadS: 0.4 }, "s"] as [LoopSpec, string],
      [{ shape: "shimmerFades", periodS, leadS: 0 }, "o"] as [LoopSpec, string],
    ]),
    [{ shape: "bobSinks", periodS: 3.5, leadS: 0 }, "y"],
  ];
  const loopsOf = async (spec: LoopSpec) => {
    const page = await openPage(writeLoopPage(root, spec));
    try {
      return [...(await loopSet(page, await page.frames(0, 17000), [], undefined))];
    } finally {
      await page.close();
    }
  };
  it.each(sinking.map(([s, n]) => [loopSlug(s), s, n] as const))("%s is no loop", async (_, spec, name) => {
    expect(await loopsOf(spec)).not.toContain(name);
  });
  it.each(honestSpecs.filter((s) => s.shape !== "marqueeEase1").map((s) => [loopSlug(s), s] as const))("%s is a loop", async (_, spec) => {
    expect(await loopsOf(spec)).toHaveLength(1);
  });
});
