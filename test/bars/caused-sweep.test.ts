import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "../../src/gate/harness.ts";
import { kindGate } from "../../src/gate/kind-gate.ts";
import { type Bob, bobPage } from "./bob-pages.ts";
import { type Breath, breathPage } from "./breath-pages.ts";
import { drawsPage } from "./draw-pages.ts";
import { loadLoopPage } from "./creep-pages.ts";
import { tapLoopPage } from "./loop-tap-pages.ts";
import { type Runaway, runawayPage } from "./runaway-pages.ts";
import { type Tween, tweenPage } from "./tween-pages.ts";
import { breath, REST_RULES, riderPage, ruleLines, rulesOn, slideCards, twoTapPanel, type Tracks, tracksPage } from "./rest-pages.ts";
import "./sweep-priority.ts";

/**
 * The choreo and sim style sweep: the shared rules that read a caused sequence (envelope's pops and fades inside it,
 * the live rest after it, reduced motion's ends, repeats and held states) must hold across the class of sequences, not
 * only the fixtures that prompted them. Choreo: staggers from a near-unison 40 ms to 3 s pauses, slides from 150 ms
 * to 1 s, and each variant (a toggle, an ignored repeat, three stops, a shake, a toast). Sim: soft to stiff bounces
 * under light and heavy gravity. Bobs and shakes through their start, 2 to 20 px over 150 to 600 ms (choreo: CSS ease
 * and linear legs; sim: a half cosine, a body's smooth swing), with the turns at quarters or on evenly spaced keyframes.
 * A sim page's tile that acts out the tap with a keyframe tween (a bob or shake, 2 to 30 px over 150 to 1050 ms, CSS
 * ease, ease-in-out and linear legs, turns at quarters or on evenly spaced keyframes), named in the bar's `tweens`.
 * Honest cases must pass; each planted fault must fail its rule at every timing, on the same points. The
 * grid is sampled, with variants and slides rotated across the staggers.
 */

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
const LOOP_PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/loops");
const dir = mkdtempSync(path.join(os.tmpdir(), "motion-kit-caused-sweep-"));

afterAll(async () => {
  await closeBrowser();
  rmSync(dir, { recursive: true, force: true });
});

type Knobs = Record<string, string | number>;
/** Where each swept number sits in a fixture script's MOTION block. */
const SLOTS: Record<string, RegExp> = {
  STAGGER_S: /(\n  staggerS: )[^\n]*?(, \/\/)/,
  SLIDE_S: /(\n  slideS: )[^,]*(,)/,
  GRAVITY: /(\n  gravity: )[^,]*(,)/,
  BOUNCE: /(\n  bounce: )[^\n]*?(, \/\/)/,
  CLOSE_PX: /(\n  closePx: )[^,]*(,)/,
  RIDE_FROM: /(\n  rideFromPx: )[^,]*(,)/,
};

/**
 * A copy of `base` (a fixture page) in its own folder: FAULT and VARIANT set as the fixtures set them, and each other
 * knob written into the copied script's MOTION block, where a page keeps its timings.
 */
function sweepPage(base: string, knobs: Knobs): string {
  const name = Object.entries(knobs).map(([k, v]) => `${k}-${v}`).join("_") || "base";
  const out = mkdtempSync(path.join(dir, `${base.replace(/\.html$/, "")}_${name}_`));
  const script = base.startsWith("sim") ? "sim.js" : "choreo.js";
  let js = readFileSync(path.join(PAGES, script), "utf8");
  for (const [k, v] of Object.entries(knobs)) if (SLOTS[k]) js = js.replace(SLOTS[k], `$1${v}$2`);
  writeFileSync(path.join(out, script), js);
  const set = `window.FAULT = ${JSON.stringify(knobs.FAULT ?? "")}; window.VARIANT = ${JSON.stringify(knobs.VARIANT ?? "")};`;
  const file = path.join(out, "index.html");
  writeFileSync(file, readFileSync(path.join(PAGES, base), "utf8").replace(/<script>window\.FAULT = [^<]*<\/script>/, `<script>${set}</script>`));
  return file;
}

const STAGGERS = [0.04, 0.12, 0.6, 1.5, 3];
const SLIDES = [0.15, 0.4, 1];
const VARIANTS = ["", "ignore", "cycle", "shake", "toast"];

const honest: Knobs[] = STAGGERS.flatMap((STAGGER_S, i) => [0, 1].map((j): Knobs => ({ VARIANT: VARIANTS[(i + 2 * j) % 5]!, STAGGER_S, SLIDE_S: SLIDES[(i + j) % 3]! })));

/** Each fault, the rule it fails and the line it prints, and the variant it needs. */
const FAULTS: { FAULT: string; VARIANT?: string; rule: string; line: RegExp }[] = [
  { FAULT: "set-piece", rule: "envelope", line: /^envelope: b2 at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/ },
  { FAULT: "fade-rises", rule: "envelope", line: /^envelope: o rises at [\d.]+ ms, during the fade that starts at [\d.]+ ms; fades only fall$/ },
  { FAULT: "reduced-once", rule: "reducedMotion", line: /^reducedMotion: b0 rests at 200 after the cause played again at [\d.]+ ms under reduced motion, and at 0 without it; reduced motion shows the sequence's end state$/ },
  { FAULT: "reduced-toast-skipped", VARIANT: "toast", rule: "reducedMotion", line: /^reducedMotion: b0 holds at (19\d|20\d)(\.\d+)? from [\d.]+ to [\d.]+ ms after the cause at [\d.]+ ms and comes back, but not under reduced motion; reduced motion shows a held state too$/ },
];
const faulty = STAGGERS.flatMap((STAGGER_S, i) => [0, 1].map((j) => {
  const f = FAULTS[(i + j) % FAULTS.length]!;
  return { knobs: { FAULT: f.FAULT, VARIANT: f.VARIANT ?? "", STAGGER_S, SLIDE_S: SLIDES[(i + 2 * j) % 3]! } as Knobs, rule: f.rule, line: f.line };
}));
// A live loop that sleeps when no bar is in flight stalls in every pause longer than a slide.
const stalls = [0.6, 3].map((STAGGER_S) => ({ FAULT: "live-stalls", STAGGER_S, SLIDE_S: 0.4 }));

// A close button rides a bar and the tap's spot, the viewport center, crosses its path where each later bar starts and
// where the path ends. Its side runs from 24 to 48 px. A press on it docks the bars where they are, so every case
// rests at a dock no tap reaches; that rest is the one a press on the button at rest also reaches.
const RIDE_SIDES = [24, 32, 48];
// RIDE_FROM is the button's x at the start of its path; the path is 200 px long and the spot is 640 px along, so
// each value puts the spot 0, 131 (the second bar's start), 187 (the third's) or 200 px along its path.
const RIDE_STARTS = [640, 509, 453, 440];
const riders: Knobs[] = RIDE_SIDES.flatMap((CLOSE_PX) => RIDE_STARTS.map((RIDE_FROM): Knobs => ({ VARIANT: "rider", CLOSE_PX, RIDE_FROM })));
// The planted fault: a press on the button while the bars move freezes them halfway, at each spot along the path.
const riderFreezes: Knobs[] = RIDE_SIDES.flatMap((CLOSE_PX) => RIDE_STARTS.slice(1, 3).map((RIDE_FROM): Knobs => ({ VARIANT: "rider", FAULT: "rider-freeze", CLOSE_PX, RIDE_FROM })));

const BODIES: Knobs[] = [0, 0.3, 0.7].map((BOUNCE, i) => ({ BOUNCE, GRAVITY: [1000, 3000, 2000][i]! }));

describe.concurrent("the choreo and sim style sweep", { timeout: 120_000 }, () => {
  it.each(honest.map((k) => [JSON.stringify(k), k] as const))("choreo %s passes every rule", async (_, knobs) => {
    const v = await kindGate(sweepPage("choreo-pause.html", knobs));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(faulty.map((f) => [JSON.stringify(f.knobs), f] as const))("choreo %s fails its rule", async (_, f) => {
    const v = await kindGate(sweepPage("choreo-pause.html", f.knobs));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(f.line)]));
  });

  it.each(stalls.map((k) => [JSON.stringify(k), k] as const))("choreo %s fails loopStopsAtRest", async (_, knobs) => {
    const v = await kindGate(sweepPage("choreo-pause.html", knobs));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^loopStopsAtRest: the live page comes to rest with b\d at 0, where its \?seek frames end at 200; the live loop stopped before its sequence ended$/)]));
  });

  it.each(riders.map((k) => [JSON.stringify(k), k] as const))("choreo rider %s passes interrupt", async (_, knobs) => {
    const v = await kindGate(sweepPage("choreo-rider.html", knobs));
    expect(v.failures.filter((f) => f.startsWith("interrupt:"))).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(riderFreezes.map((k) => [JSON.stringify(k), k] as const))("choreo rider %s that freezes the bars fails interrupt", async (_, knobs) => {
    const v = await kindGate(sweepPage("choreo-rider.html", knobs));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^interrupt: b\d rests at [\d.]+ after the second trigger at [\d.]+ ms, a state the page never rests at without it; a piece is stuck halfway$/)]));
  });

  it.each(BODIES.map((k) => [JSON.stringify(k), k] as const))("sim %s passes every rule", async (_, knobs) => {
    const v = await kindGate(sweepPage("sim-good.html", knobs));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(BODIES.slice(0, 2).map((k) => [JSON.stringify(k), k] as const))("sim %s with a one-frame drop fails envelope", async (_, knobs) => {
    const v = await kindGate(sweepPage("sim-good.html", { FAULT: "glow-pop", ...knobs }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: fade at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/)]));
  });
});

// A bob 0, -a, +a, 0 (or a shake, 0, +a, -a, 0) comes back to where it started, so the envelope has no pop test for it: at
// every point of the grid it passes, and the same bob with one frame that carries two thirds of its swing (4 px at a = 3)
// fails suddenJumps, which reads the motion between its frames, though that jump is a small share of a swing of 40 px.
// Honest and jump run on the same points. Two
// leg timings: turns at a quarter and three quarters (the swing takes half the time), and evenly spaced keyframes
// (turns at a third and two thirds, so every leg takes a third). A CSS ease bob on evenly spaced keyframes at 150 ms is
// left out: its swing leg is 3 frames and the first covers 58% of it.
const PXS = [2, 3, 8, 20];
const BOB_MS = [150, 250, 350, 600];
const bobs = (eases: Bob["ease"][], legs: Bob["legs"] = "quarters", ms = BOB_MS) => PXS.flatMap((px, i) => [0, 1].map((j): Bob => ({ px, ms: ms[(i + 2 * j) % ms.length]!, ease: eases[(i + j) % eases.length]!, first: j === 0 ? -1 : 1, legs })));
const CHOREO_BOBS = [
  ...bobs(["ease", "linear"]),
  ...bobs(["ease", "linear"], "thirds", [200, 250, 350, 600]),
  { px: 3, ms: 150, ease: "linear", first: -1, legs: "thirds" } as Bob,
];
const SIM_BOBS = [...bobs(["sine"]), ...bobs(["sine"], "thirds")];
const BOB_JUMP = /^suddenJumps: b1 moves -?[\d.]+ in the frame after [\d.]+ ms, and -?[\d.]+ in its first half; no cut marks it$/;

describe.concurrent("the bob and shake style sweep", { timeout: 120_000 }, () => {
  it.each(CHOREO_BOBS.map((b) => [JSON.stringify(b), b] as const))("choreo %s passes every rule", async (_, bob) => {
    const v = await kindGate(bobPage(dir, "choreo", bob));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(CHOREO_BOBS.map((b) => [JSON.stringify(b), b] as const))("choreo %s with a 2/3 swing jump fails suddenJumps", async (_, bob) => {
    const v = await kindGate(bobPage(dir, "choreo", bob, "jump"));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(BOB_JUMP)]));
  });

  it.each(SIM_BOBS.map((b) => [JSON.stringify(b), b] as const))("sim %s passes every rule", async (_, bob) => {
    const v = await kindGate(bobPage(dir, "sim", bob));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(SIM_BOBS.map((b) => [JSON.stringify(b), b] as const))("sim %s with a 2/3 swing jump fails suddenJumps", async (_, bob) => {
    const v = await kindGate(bobPage(dir, "sim", bob, "jump"));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(BOB_JUMP)]));
  });
});

// A sim page's tile bobs or shakes beside a clean body on a keyframe tween. Named in `tweens`, it passes at every point
// of the grid; the same tween unnamed fails energyFalls wherever its legs rise above the px floor (a leg's rise in speed
// under half a px a frame is no bounce, so a 2 px tween over 1 s is no fault unnamed). Each ease leg ends at zero speed
// and the next starts at 0.4 of its mean speed, so unnamed it reads as a bounce that rises. A tween on a CSS ease on
// evenly spaced keyframes at 150 ms is a pop in its own right (3 frames a leg) and is left out, as in the bob sweep.
const TWEENS: { tween: Tween; rises: boolean }[] = [
  { tween: { px: 2, ms: 150, ease: "ease", legs: "quarters" }, rises: false },
  { tween: { px: 2, ms: 350, ease: "ease", legs: "thirds", first: 1 }, rises: true },
  { tween: { px: 2, ms: 1050, ease: "linear", legs: "thirds" }, rises: false },
  { tween: { px: 6, ms: 150, ease: "ease", legs: "quarters" }, rises: true },
  { tween: { px: 6, ms: 350, ease: "ease-in-out", legs: "thirds", first: 1 }, rises: false },
  { tween: { px: 6, ms: 700, ease: "ease", legs: "thirds" }, rises: true },
  { tween: { px: 14, ms: 150, ease: "ease-in-out", legs: "quarters", first: 1 }, rises: true },
  { tween: { px: 14, ms: 700, ease: "linear", legs: "thirds" }, rises: true },
  { tween: { px: 14, ms: 1050, ease: "ease", legs: "thirds", first: 1 }, rises: true },
  { tween: { px: 30, ms: 350, ease: "linear", legs: "thirds" }, rises: true },
  { tween: { px: 30, ms: 700, ease: "ease-in-out", legs: "quarters", first: 1 }, rises: false },
  { tween: { px: 30, ms: 1050, ease: "ease", legs: "quarters" }, rises: true },
];
const TWEEN_RISES = /^energyFalls: t leaves its turn at [\d.]+ ms at [\d.]+ a frame, faster than it arrived \([\d.]+\); a bounce never rises$/;

describe.concurrent("the tween style sweep", () => {
  it.each(TWEENS.map((c) => [JSON.stringify(c.tween), c.tween] as const))("sim, tile %s named in tweens passes every rule", async (_, tween) => {
    const v = await kindGate(tweenPage(dir, tween, "", ["t"]));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(TWEENS.filter((c) => c.rises).map((c) => [JSON.stringify(c.tween), c.tween] as const))("sim, tile %s unnamed fails energyFalls", async (_, tween) => {
    const v = await kindGate(tweenPage(dir, tween));
    expect(v.failures).toEqual([expect.stringMatching(TWEEN_RISES)]);
  });

  // The four points whose rise is under the px floor are no fault unnamed: the guard is not what lets them pass.
  it.each(TWEENS.filter((c) => !c.rises).map((c) => [JSON.stringify(c.tween), c.tween] as const))("sim, tile %s unnamed passes: its rise is under the px floor", async (_, tween) => {
    const v = await kindGate(tweenPage(dir, tween));
    expect(v.failures).toEqual([]);
  });

  // The guard's own planted faults, at every point of the grid: a tween that ends away or is thrown, one whose second
  // swing goes twice as far as its first, and one that pops.
  const GUARD: [string, RegExp][] = [
    ["tween-away", /^tweens: t ends at -?[\d.]+ after the cause at [\d.]+ ms, not at 0 where it was just before it; /],
    ["tween-grows", /^tweens: t swings further from home at [\d.]+ ms \([\d.]+ after [\d.]+\); a tween's swings never grow$/],
    // A tween that comes home (a bob) has no pop share in the envelope; the sub-step read fails its pop instead.
    ["tween-pop", /^(envelope: t at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop|suddenJumps: t moves -?[\d.]+ in the frame after [\d.]+ ms, and -?[\d.]+ in its first half; no cut marks it)$/],
  ];
  it.each(TWEENS.flatMap((c) => GUARD.map(([fault, line]) => [fault, JSON.stringify(c.tween), c.tween, line] as const)))("sim, tile with %s %s named in tweens fails", async (fault, _, tween, line) => {
    const v = await kindGate(tweenPage(dir, tween, fault, ["t"]));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
  });
});

// A tap starts a breath on the picked item: 1 + a sin(2 pi t / P), faded in over 0.5 s, for ever. It is a loop at any
// period off the frame grid, any amplitude above the unit floor and any tap time (the page's intro, which the gate's tap
// waits for, sets it: the tap lands 250 ms after the intro ends), so it passes every rule: the live loop keeps running,
// reduced motion holds it still, and a second tap leaves it be. Honest cases run on the same points as each fault.
const BREATH_PERIODS = [2.9, Math.PI, 3.33, 4.1];
const BREATH_AMPS = [0.005, 0.02, 0.05];
const BREATH_INTROS = [0.25, 1.25, 3.25, 5.75];
const breaths: Breath[] = BREATH_PERIODS.flatMap((periodS, i) => [0, 1].map((j): Breath => ({ periodS, amp: BREATH_AMPS[(i + j) % 3]!, introS: BREATH_INTROS[(i + 2 * j) % 4]! })));
// A breath that dies away with its page's loop still running, one whose period grows each cycle, one that drops back in
// one frame each cycle, and a piece that breathes three cycles and holds, whose second tap, while it slides, freezes it.
const BREATH_FAULTS: { fault: string; rule: string; line: RegExp }[] = [
  { fault: "damped", rule: "loopStopsAtRest", line: /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/ },
  { fault: "drift", rule: "span", line: /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/ },
  { fault: "pops", rule: "envelope", line: /^envelope: breath at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/ },
  { fault: "burst-freeze", rule: "interrupt", line: /^interrupt: x rests at [\d.]+ after the second trigger at [\d.]+ ms, a state the page never rests at without it; a piece is stuck halfway$/ },
];
// The same breath on top of a lead-in move: the tap scales the item up by 5% over 0.4 s, and it breathes around its new size
// with a swing smaller than the lead-in (a mid level read over the whole range lies below such a breath).
const LEAD_BREATHS: Breath[] = [
  { periodS: 2.5, amp: 0.01, lead: 0.05, introS: 0.25 },
  { periodS: 3, amp: 0.01, lead: 0.05, introS: 1.25 },
  { periodS: 2.5, amp: 0.005, lead: 0.05, introS: 3.25 },
  { periodS: 4.1, amp: 0.005, lead: 0.05, introS: 5.75 },
];
const breathFaults = BREATH_PERIODS.flatMap((periodS, i) => [0, 1].map((j) => {
  const f = BREATH_FAULTS[(i + j) % BREATH_FAULTS.length]!;
  return { breath: { periodS, amp: BREATH_AMPS[(i + 2 * j) % 3]!, introS: BREATH_INTROS[(i + 3 * j) % 4]! } as Breath, ...f };
}));

describe.concurrent("the breath style sweep: a tap starts a loop", { timeout: 120_000 }, () => {
  // A page that idles its rAF until the tap: the loop is running only after it, so the gate plays the tap before its
  // off-screen and resume rules look. One that keeps its breath running off screen fails pausesOffScreen, and only that.
  const tapStarted = BREATH_PERIODS.map((periodS, i): Breath => ({ periodS, amp: BREATH_AMPS[i % 3]!, idleUntilTap: true }));
  it.each(tapStarted.map((b) => [JSON.stringify(b), b] as const))("choreo %s, with the loop started by the tap, passes every rule", async (_, b) => {
    const v = await kindGate(breathPage(dir, b));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });
  it.each(tapStarted.map((b) => [JSON.stringify(b), b] as const))("choreo %s, with the loop started by the tap, that never pauses off screen fails pausesOffScreen", async (_, b) => {
    const v = await kindGate(breathPage(dir, b, "no-pause"));
    expect(v.failures).toEqual([expect.stringMatching(/^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen; the loop pauses off screen$/)]);
  });

  it.each([...breaths, ...LEAD_BREATHS].map((b) => [JSON.stringify(b), b] as const))("choreo %s passes every rule", async (_, b) => {
    const v = await kindGate(breathPage(dir, b));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // A breath that dies away, and one that stops after three cycles with a second tap that freezes the slide, on a lead-in.
  it.each(LEAD_BREATHS.slice(0, 2).map((breath, k) => [JSON.stringify({ ...breath, fault: BREATH_FAULTS[k === 0 ? 0 : 3]!.fault }), breath, BREATH_FAULTS[k === 0 ? 0 : 3]!] as const))("choreo %s fails its rule", async (_, breath, f) => {
    const v = await kindGate(breathPage(dir, breath, f.fault));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(f.line)]));
  });

  it.each(breathFaults.map((f) => [JSON.stringify({ ...f.breath, fault: f.fault }), f] as const))("choreo %s fails its rule", async (_, f) => {
    const v = await kindGate(breathPage(dir, f.breath, f.fault));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(f.line)]));
  });
});

// A steady speed is a loop only on a page that was moving before its first cause. A tap that starts a value which never
// stops looks like a marquee at the end of the read, but it is a fault the span and rest rules must still see: a choreo
// tween with no clamp (20 to 400 px/s from the tap) and a sim body thrown with too little friction (a time constant of
// 6 to 20 s, or none). Each ends clamped or at rest on the honest page of the same speed.
const RUNAWAYS: Runaway[] = [
  { kind: "choreo", speed: 20 },
  { kind: "choreo", speed: 95 },
  { kind: "choreo", speed: 300 },
  { kind: "choreo", speed: 400 },
  { kind: "sim", speed: 800, tauS: 6 },
  { kind: "sim", speed: 300, tauS: 10 },
  { kind: "sim", speed: 95, tauS: 20 },
  { kind: "sim", speed: 800 },
];
const RUNAWAY_SPAN = /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/;
const RUNAWAY_REST = /^restsInTime: x still moves at [\d.]+ ms, more than 4000 ms after the cause stopped at [\d.]+ ms$/;

describe.concurrent("the runaway sweep: a tap starts a value that never stops", { timeout: 120_000 }, () => {
  it.each(RUNAWAYS.map((r) => [JSON.stringify(r), r] as const))("%s fails span, whatever its steady last 500 ms", async (_, r) => {
    const v = await kindGate(runawayPage(dir, r));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(RUNAWAY_SPAN)]));
  });

  it.each(RUNAWAYS.filter((r) => r.kind === "sim").map((r) => [JSON.stringify(r), r] as const))("%s fails restsInTime: its body is not a loop", async (_, r) => {
    const v = await kindGate(runawayPage(dir, r));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(RUNAWAY_REST)]));
  });

  it.each(RUNAWAYS.map((r) => [JSON.stringify(r), { ...r, clampS: 1 }] as const))("%s, clamped one second after the tap, meets span and restsInTime", async (_, r) => {
    const v = await kindGate(runawayPage(dir, r));
    expect(v.failures.filter((f) => /^(span|restsInTime|loopStopsAtRest|pausesOffScreen):/.test(f))).toEqual([]);
  });
});

// One sort for every rule: a tap starts a loop on a choreo or sim page, and span, rest, interrupt, reduced motion and the
// envelope all find it, whatever its phase against the frame grid. Each page slides two bars and starts one loop
// (fixtures/gate-pages/loops/), except the bob, which starts nothing else.
const SORTED: [string, string][] = [
  // Crests that fall half way between two frames, however short the period.
  ["choreo-breath-300ms.html", "a 300 ms breath"],
  ["sim-bob-1500ms.html", "a 1.5 s bob"],
  ["choreo-glow-750ms.html", "a 750 ms glow in opacity"],
  // A 7 and a 7.5 s breath show two crests in a read of 15 s.
  ["choreo-breath-7s.html", "a 7 s breath"],
  ["sim-breath-7s.html", "a 7 s breath"],
  ["sim-breath-7500ms.html", "a 7.5 s breath"],
  // A fade-in or a spring before the loop. (A swing that grows in as 1 - e^(-t/1.5 s) takes 3.6 s to settle within the
  // scale floor, past the 2 s lead-in a loop may have: it is no loop.)
  ["choreo-ramp-2s-then-breath-4s.html", "a breath whose swing ramps in over 2 s"],
  ["choreo-spring-then-breath-4400ms.html", "a spring that overshoots and settles into a 4.4 s breath"],
  // Two highs a cycle with no hold, and a bounce reported with up as negative.
  ["choreo-heartbeat-keyframes.html", "a heartbeat of keyframes with no hold"],
  ["sim-bounce-875ms-up-negative.html", "a bounce with up as negative"],
];

describe.concurrent("one sort for every rule: a loop a tap starts on a choreo or sim page", { timeout: 120_000 }, () => {
  it.each(SORTED)("%s, %s, passes every rule", async (file) => {
    const v = await kindGate(path.join(LOOP_PAGES, file));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // A tap starts a bob and nothing else, and under reduced motion nothing moves: the loop has no end state to ask for.
  // A sim page needs a body, so energyFalls stays the one line.
  it("sim-bob-only.html, a bob a tap starts, nothing else, asks for no end state under reduced motion", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "sim-bob-only.html"));
    expect(v.failures).toEqual([expect.stringMatching(/^energyFalls: no px or deg value moves after the cause; a sim page needs a body, with its unit in __state\(\)\.units$/)]);
  });
});

/**
 * And for the rules that wait until the page stops (rest-pages.ts): a choreo page's loop pauses off screen once the sequence
 * the tap starts is at rest and the loop runs, whichever way it pauses (the loop's clock alone, or the whole page's, by the
 * visibility event or an IntersectionObserver alone), and however late the tap starts it (0.3 to 2 s, by a timer that wakes the
 * page's clock). The planted fault, a late loop that ignores that the page is hidden, fails (kind-gate.test.ts).
 */
describe.concurrent("a choreo loop beside a sequence passes the rules that wait for the page to stop", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-choreo-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const pages: [string, Tracks][] = [
    ["a breath from load, the loop's clock alone paused, three cards 120 ms apart", { loop: breath("load"), pause: "loop", tracks: slideCards() }],
    ["...three cards 300 ms apart, each sliding 600 ms", { loop: breath("load"), pause: "loop", tracks: slideCards(0.3, 0.6) }],
    ["...three cards 200 ms apart, each sliding 600 ms", { loop: breath("load"), pause: "loop", tracks: slideCards(0.2, 0.6) }],
    ["a breath from load and a second card at 1.6 s, the whole clock paused", { loop: breath("load"), tracks: [["a", "px", [[0, 0.4, 0, 120, "out"]]], ["b", "px", [[1.6, 0.5, 0, 120, "out"]]]] }],
    ["a breath the tap starts 0.6 s on, a timer waking the clock", { loop: breath("cause", { startS: 0.6 }), gaps: "timer", tracks: [["c0", "px", [[0, 0.2, 0, 40, "out"]]], ["c1", "px", [[0.1, 0.2, 0, 40, "out"]]]] }],
    ["a breath the tap starts 1 s on, a timer waking the clock", { loop: breath("cause", { startS: 1 }), gaps: "timer", tracks: [["c0", "px", [[0, 0.2, 0, 40, "out"]]], ["c1", "px", [[0.1, 0.2, 0, 40, "out"]]]] }],
    ["a breath the tap starts 2 s on, a timer waking the clock", { loop: breath("cause", { startS: 2 }), gaps: "timer", tracks: [["c0", "px", [[0, 0.2, 0, 40, "out"]]], ["c1", "px", [[0.1, 0.2, 0, 40, "out"]]]] }],
  ];
  it.each(pages)("%s", async (_what, motion) => {
    expect(await ruleLines(tracksPage(root, "choreo", "loop-beside-sequence", motion), REST_RULES)).toEqual([]);
  }, 120000);

  // A page that pauses by an IntersectionObserver alone is told it left 40 to 75 ms after the body moved.
  it("a page that pauses by an IntersectionObserver alone passes pausesOffScreen in 10 of 10 runs", async () => {
    const on = await rulesOn(tracksPage(root, "choreo", "io-only", { loop: breath("load"), watch: "io", tracks: slideCards() }));
    try {
      const runs: string[][] = [];
      for (let i = 0; i < 10; i++) runs.push(await on.run(["pausesOffScreen"]));
      expect(runs).toEqual(Array.from({ length: 10 }, () => []));
    } finally {
      await on.close();
    }
  }, 300000);
});

/**
 * Interrupt's toggle and pressed-control runs play the cause the run is about, once more after the sequence, and read the
 * page until it rests (not to the next cause, and not for a fixed length past the trigger): a second tap that lands soon after the
 * first sequence ends, or a control whose own answer outlasts the sequence by more than a second, is no fault in the page.
 */
describe.concurrent("interrupt reads its toggle and pressed-control runs until the page rests", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-interrupt-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const interrupt = async (file: string) => (await kindGate(file)).failures.filter((f) => f.startsWith("interrupt:"));

  // The first sequence ends at about 890 ms: the second tap comes 300 ms and 610 ms after, then 910 ms and 1.3 s and 1.7 s.
  it.each([1200, 1500, 1800, 2200, 2600])("a close button that rides the bars, a second tap at %i ms, passes", async (second) => {
    expect(await interrupt(riderPage(root, "rider-twotap", {}, [250, second]))).toEqual([]);
  });

  it("a close button whose dock takes 2 s (0.4 s a bar, 0.8 s apart), longer than the 0.64 s sequence and a second, passes", async () => {
    expect(await interrupt(riderPage(root, "rider-long-dock", { dockS: 0.4, dockStaggerS: 0.8 }))).toEqual([]);
  });

  it("a close button whose dock answers a long time after the second tap lands reads to its rest", async () => {
    expect(await interrupt(riderPage(root, "rider-long-dock-twotap", { dockS: 0.4, dockStaggerS: 0.8 }, [250, 1500]))).toEqual([]);
  });

  it("a two-tap bar whose first tap's sequence runs to the second tap (1 s slide, a tap at 1.5 s) no longer stops the rule", async () => {
    const file = twoTapPanel(root, 1500);
    const v = await kindGate(file);
    expect(v.failures.filter((f) => f.includes("could not run"))).toEqual([]);
    // The panel's minimize button is hidden once the panel is closed again, so the second cause has no control to press at rest.
    expect(v.failures.filter((f) => f.startsWith("interrupt:") && !/^interrupt: x rests at 60 after the second trigger at 1[67]\d\d ms, a state the page never rests at without it; a piece is stuck halfway$/.test(f))).toEqual([]);
  });

  // Reading to rest must not excuse a page that never gets there: a dock that takes 40 s is still moving at the cap.
  it("a close button whose dock never ends within the 15 s read still fails", async () => {
    const lines = await interrupt(riderPage(root, "rider-dock-forever", { dockS: 40 }));
    expect(lines.length).toBeGreaterThan(0);
  }, 120000);
});

/**
 * The seed contract for the rest compare on a choreo page: a tap cuts a deck of tiles by a random number of slots, throws chips
 * to random distances, fades bubbles in after random gaps, tosses a card to a random tilt on a spring that overshoots, or pops a
 * badge after a random delay. The page draws from a seeded stream, the same in live play as under `?seek`, reseeded at the tap, so
 * it passes loopStopsAtRest at three seeds.
 */
describe.concurrent("the seed contract: a choreo page that draws seeded random values passes loopStopsAtRest", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-seeded-choreo-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const cases = (["deck", "scatter", "gaps", "tilt", "pop"] as const).flatMap((scene) => [1, 7, 23].map((seed) => [scene, seed] as const));
  it.each(cases)("a choreo %s page at seed %i", async (scene, seed) => {
    expect(await ruleLines(drawsPage(root, `${scene}-seed-${seed}`, { kind: "choreo", scene, seed }), ["loopStopsAtRest"])).toEqual([]);
  });
});

/**
 * The loop sort on choreo pages: a value at one steady speed is a loop only when it moves the same with no tap
 * (or, on a page that starts on load, from the end of its lead-in), and a loop that moves on a little each period
 * is none. A drift strip that was moving before the tap, easing in or not, a breath slower than 2 s a cycle and a bob with
 * float jitter stay loops; a creep a tap starts after a breath, a bob that sinks and a pulse that grows are not.
 */
describe.concurrent("the choreo loop sort: a creep the tap starts is no loop, and a loop comes back", { timeout: 120_000 }, () => {
  const STILL_MOVING = /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/;
  const LOOP = { restart: false, motion: { reducedAtS: 0 } };
  const COS = "(1 - Math.cos(2 * Math.PI * d / MOTION.periodS)) / 2";
  const failing = (lines: string[]) => [...new Set(lines.map((f) => f.slice(0, f.indexOf(":"))))];

  // A strip that drifts from load at `pxPerS`, its speed easing in over `easeS` (smoothstep on the speed). A tap slides two
  // bars in beside it. The gate's tap comes 250 ms in, before a 0.5 s ease has finished.
  const strips = [20, 95, 400].flatMap((pxPerS) => [0, 0.5].map((easeS) => [pxPerS, easeS] as const));
  it.each(strips)("a strip drifting at %i px/s, eased in over %d s, that was moving before the tap passes", async (pxPerS, easeS) => {
    const valuesAfter = `function valuesAfter(d) { const t = S.t, e = MOTION.easeS; const p = Math.min(1, t / Math.max(e, 1e-9)); return { y: e > 0 && t < e ? MOTION.pxPerS * e * (p ** 3 - p ** 4 / 2) : MOTION.pxPerS * (t - e / 2) }; }`;
    const v = await kindGate(tapLoopPage(dir, `strip-${pxPerS}-${easeS}`, { ...LOOP, motion: { ...LOOP.motion, pxPerS, easeS }, units: { y: "px" }, valuesAfter }));
    expect(failing(v.failures)).not.toContain("span");
    expect(failing(v.failures)).not.toContain("loopStopsAtRest");
  });

  // A creep a tap starts after a breath that has run since load: the breath is another motion.
  // A negative speed goes the way the breath goes at the tap (it goes down for its first 0.6 s).
  const creeps = [12, 25, 95, 400, -12, -25, -95, -400].flatMap((creepPxS) => [4, 12].map((breathPx) => [creepPxS, breathPx] as const));
  it.each(creeps)("an unclamped creep of %i px/s after a breath of %i px fails span", async (creepPxS, breathPx) => {
    const valuesAfter = "const breath = (t) => -MOTION.breathPx * (1 - Math.cos(2 * Math.PI * t / MOTION.breathS)) / 2;\nfunction valuesAfter(d) { if (d === null) return { y: breath(S.t) }; return { y: breath(S.vtap) + MOTION.creepPxS * d }; }";
    const v = await kindGate(tapLoopPage(dir, `creep-${creepPxS}-${breathPx}`, { ...LOOP, motion: { ...LOOP.motion, breathS: 1.2, breathPx, creepPxS }, units: { y: "px" }, valuesAfter }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(STILL_MOVING)]));
  });

  // The same creep on a page that starts on load: a breath that runs 3 s or more, then creeps.
  it.each([[3, 12], [3, 95], [5, 25]])("a breath for %d s that turns into a creep of %i px/s on a page that starts on load fails the rules that wait for rest", async (breathS, creepPxS) => {
    const v = await kindGate(
      loadLoopPage(dir, `load-creep-${breathS}-${creepPxS}`, {
        motion: { breathS: 1.2, breathPx: 6, creepFromS: breathS, creepPxS },
        units: { y: "px" },
        valuesAfter: "function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.breathPx * (1 - Math.cos(2 * Math.PI * Math.min(d, MOTION.creepFromS) / MOTION.breathS)) / 2 + MOTION.creepPxS * Math.max(0, d - MOTION.creepFromS) }; }",
      }),
    );
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^(span|loopStopsAtRest): /)]));
  });

  // A loop a tap starts that moves on a little each period, at periods from 0.5 to 2 s.
  const sinks = [0.5, 0.8, 1.2, 2].flatMap((periodS) => [
    [`a bob that sinks 0.45 px a cycle, ${periodS} s a cycle`, { ...LOOP, motion: { ...LOOP.motion, periodS, ampPx: 12, sinkPx: 0.45 }, units: { y: "px" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.ampPx * ${COS} + MOTION.sinkPx * d / MOTION.periodS }; }` }] as const,
    [`a pulse that grows 1% of its swing a beat, ${periodS} s a beat`, { ...LOOP, motion: { ...LOOP.motion, periodS, amp: 0.04, grow: 0.01 }, units: { s: "scale" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { s: 1 }; return { s: 1 + MOTION.amp * (1 + MOTION.grow * d / MOTION.periodS) * ${COS} }; }` }] as const,
  ]);
  it.each(sinks)("%s fails span", async (name, spec) => {
    const v = await kindGate(tapLoopPage(dir, name.replace(/\W+/g, "-"), spec));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(STILL_MOVING)]));
  });

  // Loops that hold their level pass every rule, with float jitter of 1e-5 and a period off the frame grid; a breath slower than 2 s a cycle among them.
  const holds = [
    [0.7103, "y", "px"],
    [2.4, "s", "scale"],
    [3.7019, "s", "scale"],
    [5.3, "y", "px"],
  ] as const;
  it.each(holds)("a loop of %d s in %s (%s) with float jitter passes", async (periodS, name, unit) => {
    const amp = unit === "px" ? 12 : 0.03;
    const valuesAfter = `function valuesAfter(d) { if (d === null) return { ${name}: ${unit === "px" ? 0 : 1} }; return { ${name}: ${unit === "px" ? "-" : "1 + "}MOTION.amp * ${COS} + 1e-5 * Math.sin(d * 977.3) }; }`;
    const v = await kindGate(tapLoopPage(dir, `hold-${periodS}-${name}`, { ...LOOP, motion: { ...LOOP.motion, periodS, amp }, units: { [name]: unit }, valuesAfter }));
    expect(v.failures).toEqual([]);
  });
});
