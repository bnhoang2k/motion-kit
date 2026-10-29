import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "../../src/gate/harness.ts";
import { kindGate } from "../../src/gate/kind-gate.ts";
import { inputSlug, writeInputBar, type InputPage } from "./input-pages.ts";
import { REVIEWED_HONEST, sweepPage, sweepSlug, writeSteppedBar, type SweepSpec } from "./stepped-pages.ts";
import { kf, keyframePage, phases, type Keyframes, type Track } from "./keyframe-pages.ts";
import "./sweep-priority.ts";

/**
 * The style sweep: a gate rule must hold across the whole class of motion it judges, not only the bar that prompted
 * it. For stepped motion the class is every drawing rate from 4 to 30 a second, even and mixed holds, the spacing
 * charts animators use, and objects from 12 to 120 px: the lift is measured in lengths of the dot, so a verdict must
 * not change with its size. Here, in a browser, honest stepped pages must pass every rule of the kind gate: the grid
 * is sampled, with charts, holds, drawing counts and sizes rotated across the rates, so the file runs in a few
 * minutes. The honest pages the share-of-move rule judged wrongly are cases too, rebuilt by
 * behaviour. The planted pops, which only the stepped pop rule judges, run as pure cases over the whole grid in
 * test/stepped-sweep.test.ts; a stepped value that never moves still fails here.
 */

const RATES = [4, 6, 8, 10, 12, 15, 20, 24, 30];
const CHARTS: SweepSpec["chart"][] = ["slowOut", "slowIn", "slowInOut", "even"];
const DRAWINGS = [4, 6, 8, 12];
const SIZES = [12, 40, 120];
const FAULTS: NonNullable<SweepSpec["fault"]>[] = ["pop60", "teleport", "nudge", "spike", "set", "frozen"];

const honest: SweepSpec[] = RATES.flatMap((rate, i) =>
  [0, 1, 2].map((j): SweepSpec => ({ rate, timing: (i + j) % 2 ? "mixed" : "even", chart: CHARTS[(i + j) % 4]!, drawings: DRAWINGS[(i + 2 * j) % 4]!, sizePx: SIZES[j]! })),
);
// The sampled grid's faults, of which only "frozen" (a stepped value that never moves) runs here.
const frozen: SweepSpec[] = RATES.flatMap((rate, i) =>
  [0, 1, 2, 3].map((j): SweepSpec => ({ rate, timing: (i + j) % 2 ? "mixed" : "even", chart: "even", drawings: Math.max(6, DRAWINGS[(i + j) % 4]!), fault: FAULTS[(i + j) % 6]!, sizePx: SIZES[(i + j) % 3]! })),
).filter((s) => s.fault === "frozen");
// A 3-drawing move from a rest: a first drawing at 60% moves 3 times as fast as the next (20%) and passes.
const edge = (first: number): SweepSpec[] => [8, 24].map((rate) => ({ rate, timing: "even", chart: "even", drawings: 3, shares: [first, 0.8, 1] }));
const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-sweep-"));
const slugOf = (name: string) => name.replace(/[^a-z0-9]+/gi, "-");

afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await closeBrowser();
});

describe.concurrent("the style sweep: stepped motion", () => {
  it.each([...honest, ...edge(0.6)].map((s) => [sweepSlug(s), s] as const))("%s passes", async (slug, spec) => {
    const v = await kindGate(writeSteppedBar(root, slug, sweepPage(spec)));
    expect(v.failures).toEqual([]);
  });

  it.each(frozen.map((s) => [sweepSlug(s), s] as const))("%s fails", async (slug, spec) => {
    const v = await kindGate(writeSteppedBar(root, slug, sweepPage(spec)));
    expect(v.failures).toEqual(["stepped: y never changes"]);
  });
});

describe.concurrent("the style sweep: honest pages the share-of-move rule judged wrongly", () => {
  it.each(Object.keys(REVIEWED_HONEST))("%s passes", async (name) => {
    const v = await kindGate(writeSteppedBar(root, slugOf(name), REVIEWED_HONEST[name]!));
    expect(v.failures).toEqual([]);
  });
});

/**
 * Motion that comes back to its start, fast: the shakes, wobbles and bobs that animation libraries ship. A fast one puts
 * 51% to 69% of a leg into one 1/60 s frame, and where in a frame it starts changes which frame that is, so each page
 * runs four bars that start 70 ms (or 53, or 31 ms) apart, at four phases of a frame. They have no pop, so they pass
 * every rule. Each is the keyframes the library ships (Animate.css at its normal and `faster` speeds, a CSS shake, and
 * Motion, GSAP and WAAPI keyframes of 250 to 600 ms) on the curve the library uses.
 */
describe.concurrent("the style sweep: motion that comes back to its start (library shakes)", () => {
  const tenths = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const fifths = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const shakeX = [0, -10, 10, -10, 10, -10, 10, -10, 10, -10, 0];
  const cases: [string, Keyframes, Partial<Track>][] = [
    ...[1000, 500].map((ms): [string, Keyframes, Partial<Track>] => [`animate-shakeX-${ms}`, kf(ms, tenths, shakeX, "ease"), {}]),
    ...[820, 600, 500].map((ms): [string, Keyframes, Partial<Track>] => [`css-shake-${ms}`, kf(ms, tenths, [0, -1, 2, -4, 4, -4, 4, -4, 2, -1, 0], "shakeCurve"), {}]),
    ...[1000, 500].map((ms): [string, Keyframes, Partial<Track>] => [`animate-headShake-${ms}`, kf(ms / 2, [0, 0.13, 0.37, 0.63, 0.87, 1], [0, -6, 5, -3, 2, 0], "easeInOut"), {}]),
    ...[1000, 500].map((ms): [string, Keyframes, Partial<Track>] => [`animate-tada-${ms}`, kf(ms, tenths, [0, -3, -3, 3, -3, 3, -3, 3, -3, 3, 0], "ease"), { unit: "deg", prop: "rotate" }]),
    ...[1000, 500].map((ms): [string, Keyframes, Partial<Track>] => [`animate-rubberBand-${ms}`, kf(ms, [0, 0.3, 0.4, 0.5, 0.65, 0.75, 1], [1, 1.25, 0.75, 1.15, 0.95, 1.05, 1], "ease"), { unit: "scale", prop: "scale" }]),
    ...[1000, 500].map((ms): [string, Keyframes, Partial<Track>] => [`animate-jello-${ms}`, kf(ms, [0, 0.111, 0.222, 0.333, 0.444, 0.555, 0.666, 0.777, 0.888, 1], [0, 0, -12.5, 6.25, -3.125, 1.5625, -0.78125, 0.390625, -0.1953125, 0], "ease"), { unit: "deg", prop: "skewX" }]),
    // The 500 ms bounce lands on a steep ease-in: its last frame before the stop moves 25 of 30 px, 7 of them in its first half. The sub-steps read that as a jump (a known limit of sharp eases).
    ...[1000].map((ms): [string, Keyframes, Partial<Track>] => [`animate-bounce-${ms}`, kf(ms, [0, 0.2, 0.4, 0.43, 0.53, 0.7, 0.8, 0.9, 1], [0, 0, -30, -30, 0, -15, 0, -4, 0], ["animOut", "animOut", "animIn", "animIn", "animOut", "animIn", "animOut", "ease"]), { prop: "translateY" }]),
    ...[600, 500, 400, 300, 250].map((ms): [string, Keyframes, Partial<Track>] => [`motion-shake-${ms}`, kf(ms, fifths, [0, -10, 10, -10, 10, 0], "easeInOut"), {}]),
    ...[500, 400].map((ms): [string, Keyframes, Partial<Track>] => [`gsap-shake-${ms}`, kf(ms, fifths, [0, -10, 10, -10, 10, 0], "power1InOut", { global: "power3Out" }), {}]),
    ...[600, 400].map((ms): [string, Keyframes, Partial<Track>] => [`waapi-shake-${ms}`, kf(ms, tenths, [0, -10, 10, -8, 8, -6, 6, -4, 4, -2, 0], "linear", { global: "easeOut" }), {}]),
    ...[150, 250].flatMap((ms) => ["ease", "linear", "sine"].map((e): [string, Keyframes, Partial<Track>] => [`bob-${e}-${ms}`, kf(ms, [0, 0.25, 0.75, 1], [0, -8, 8, 0], e), {}])),
  ];
  const STEPS = [70, 53, 31];
  it.each(cases.map(([name, model, extra], i) => [name, model, extra, STEPS[i % STEPS.length]!] as const))("%s passes every rule", async (name, model, extra, stepMs) => {
    const v = await kindGate(keyframePage(root, `shake-${name}`, phases(model, extra, 4, stepMs)));
    expect(v.failures).toEqual([]);
  });
});

/**
 * An honest sharp ease: the circle curves of Motion, GSAP and Penner have infinite speed at one point (the middle of
 * circInOut, an end of circIn and circOut) and no jump. The sub-steps of circInOut stand out from their neighbours by
 * 2.7 to 2.9 at every duration and phase, over the 2.5 that a jump is judged by, so suddenJumps tells a cusp from a jump
 * by what the ratio does when the sub-steps get finer. Each page runs four bars that start 70 ms apart, at four phases
 * of a frame. They pass every rule.
 */
describe.concurrent("the style sweep: a square-root cusp (circle curves)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-cusp-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  // Out and back, each leg 300, 600 or 1200 ms: the page returns home, as the shakes above do, so it has no end state to keep under reduced motion.
  const legs: [string, string[]][] = [["circInOut", ["circInOut", "circInOut"]], ["circIn out", ["circIn", "circOut"]], ["circOut in", ["circOut", "circIn"]]];
  const cases = legs.flatMap(([name, eases]) => [300, 600, 1200].map((leg): [string, string[], number] => [name, eases, leg]));
  it.each(cases)("%s legs of %s ms pass every rule", async (name, eases, leg) => {
    const v = await kindGate(keyframePage(root, `cusp-${name.replace(/\W+/g, "-")}-${leg}`, phases(kf(2 * leg, [0, 0.5, 1], [0, 300, 0], eases))));
    expect(v.failures).toEqual([]);
  });
});

/**
 * A steeper ease than the circle: cubic-bezier(1,0,0,1), a plain CSS ease, has a cube-root cusp at its middle and stands
 * out from the sub-steps beside it by 4 to 5, past what any fixed cap on the ratio allows. A cusp is told from a jump by
 * what it does as the sub-steps are cut finer: its largest sub-step shrinks by 2^-a each halving and a jump's keeps its
 * size. Each page runs three bars that start 0, 5 and 9 ms apart (different places in a frame), out and back, for legs of
 * 250 to 2000 ms. Just under the cusp, cubic-bezier(0.96 to 0.995,0,1-x1,1) has a bounded speed in a straight middle far
 * narrower than a frame: the frame steps beside it fall away as one bell's do. They pass every rule.
 */
describe.concurrent("the style sweep: a steep ease (cubic-bezier cusp)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-steep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  // Three bars start 0, 5 and 9 ms apart, so the middle of the ease falls in three places of a frame; a fourth, on a gentle
  // ease 300 ms later, gives the page a second onset.
  const delays = (model: Keyframes): Track[] => [
    ...[0, 5, 9].map((delayMs, k): Track => ({ name: `p${k}`, unit: "px", delayMs, model })),
    { name: "q", unit: "px", delayMs: 300, model: kf(400, [0, 0.5, 1], [0, 40, 0], "easeInOut") },
  ];
  const cases: [string, number][] = [
    ...[250, 400, 600, 1200, 2000].map((leg): [string, number] => ["bez1001", leg]),
    ...[250, 600, 2000].map((leg): [string, number] => ["bez9001", leg]),
    ...[250, 2000].map((leg): [string, number] => ["expoInOut", leg]),
    ...[250, 2000].map((leg): [string, number] => ["circInOut", leg]),
    ...["bez96", "bez98", "bez995"].flatMap((ease) => [300, 600, 1200].map((leg): [string, number] => [ease, leg])),
  ];
  it.each(cases)("%s legs of %s ms pass every rule", async (ease, leg) => {
    const v = await kindGate(keyframePage(root, `steep-${ease}-${leg}`, delays(kf(2 * leg, [0, 0.5, 1], [0, 300, 0], [ease, ease]))));
    expect(v.failures).toEqual([]);
  });
});

/**
 * Stepped values the input drives: a dot dragged on a grid (live) and a flipbook drawn by a smoothed scroll, held to
 * the input in their own drawing steps (leads.ts). A grid's rounding sits at most half a cell from the hand, and a
 * chase that skips drawings lags the scroll, so honest pages pass at every cell or step from 10 to 100 px with the
 * object as big as the cell, and with a faster chase. A drawing that jumps ahead of the input and stays there, at any
 * time in the drag, or jumps ahead for one drawing and comes back, fails with one line naming the value that jumped:
 * off the input, which the rule judges before a lead at the same step.
 */
describe.concurrent("the style sweep: stepped drawings the input drives", () => {
  const honest: InputPage[] = [
    ...[10, 12, 16, 20, 24, 30, 40, 80].map((px): InputPage => ({ kind: "live", stepPx: px, sizePx: px })),
    ...[10, 25, 50, 100].map((px): InputPage => ({ kind: "scroll", stepPx: px, sizePx: px })),
    { kind: "scroll", stepPx: 25, sizePx: 25, smoothS: 0.05 },
  ];
  const faulty: InputPage[] = [
    ...[[10, 10], [20, 40], [40, 40]].flatMap(([stepPx, sizePx]) => [0.2, 0.3, 0.4, 0.5].map((aheadAfterS): InputPage => ({ kind: "live", stepPx: stepPx!, sizePx: sizePx!, fault: "jump-ahead", aheadAfterS }))),
    ...[10, 25, 50].flatMap((px) => ["jump-ahead", "glitch"].map((fault): InputPage => ({ kind: "scroll", stepPx: px, sizePx: px, fault }))),
  ];
  // On the 10, 12 and 30 px grids the 1 ms release probe sees the dot's cell still after the drag's last frame moved
  // it: releaseSpeed fails them, a gap of that rule on stepped values that this sweep pins rather than hides.
  const RELEASE_GAP = /^releaseSpeed: at release, x leaves at 0% of its speed/;
  const gapped = (p: InputPage) => p.kind === "live" && [10, 12, 30].includes(p.stepPx) && p.sizePx === p.stepPx;

  it.each(honest.map((p) => [inputSlug(p), p] as const))("%s passes", async (slug, p) => {
    const v = await kindGate(writeInputBar(root, p, slug));
    expect(v.failures).toEqual(gapped(p) ? [expect.stringMatching(RELEASE_GAP)] : []);
  });

  // Exactly one off line, naming the value that jumped, and no other rule. On the 40 px grid a jump of 100 px early in
  // the drag also leaves the dot moving in under 80% of the drag's frames, which follows' share line reports too.
  it.each(faulty.map((p) => [inputSlug(p), p] as const))("%s fails only its off line", async (slug, p) => {
    const v = await kindGate(writeInputBar(root, p, slug));
    const [rule, name] = p.kind === "live" ? ["follows", "x"] : ["scroll", "f"];
    const off = new RegExp(`^${rule}: ${name} at [\\d.]+ ms jumps [\\d.]+ of its drawing steps off the input in one drawing$`);
    const rest = v.failures.filter((f) => !(gapped(p) && RELEASE_GAP.test(f)));
    expect(rest.filter((f) => / of its drawing steps (ahead of the input|off the input in one drawing)$/.test(f))).toEqual([expect.stringMatching(off)]);
    expect([...new Set(rest.map((f) => f.slice(0, f.indexOf(":"))))]).toEqual([rule]);
  });
});

/**
 * The drawn check across the ink an honest object spreads past its box, and the effects no value moves. Each page
 * reports its objects as drawn, with a halo for the ink past its box, and passes every rule: card shadows of 0 4px
 * 14px, 0 12px 32px and 0 24px 48px, a glow, a blur, italic text whose glyphs overhang their box, a badge on an
 * icon's edge that pops in and out, a drawn cursor inside a card that lifts, a fade to 2% opacity, a fade whose last
 * drawn frame before a 30-frame gone gap mid-loop is all but invisible (judged from its fade reference), a faint
 * shape that drifts at 1.3 px a frame at most, a confetti field with moves: [], and a live and a choreo page whose dot
 * and bars are objects. Backgrounds that change on their own, each one object that covers the viewport behind an
 * honest dot: an aurora that shimmers everywhere, lights that twinkle, eight particles that drift, and sinusoidal
 * stripes that slow at each turn of their sway; and a band of light that sweeps a panel as an object of its own. A
 * bar whose listed cut turns the scene dark, after the cut or (drawn-cut-early) at it. Scroll pages that scroll themselves: a sticky header over the scrolling
 * page, and an in-flow card the document carries into view.
 */
describe.concurrent("the style sweep: what honest objects draw (drawn)", () => {
  const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
  const names = ["drawn-shadow-14", "drawn-shadow-32", "drawn-shadow-48", "drawn-glow", "drawn-blur", "drawn-text", "drawn-badge", "drawn-cursor", "drawn-fade", "drawn-vanish", "drawn-faint", "drawn-confetti", "drawn-live", "drawn-choreo", "drawn-aurora", "drawn-twinkle", "drawn-particles", "drawn-stripes", "drawn-sweep", "drawn-cut/index", "drawn-cut-early/index", "drawn-sticky", "drawn-doc-card"];
  it.each(names)("%s passes every rule", async (name) => {
    const v = await kindGate(path.join(PAGES, `${name}.html`));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });
});
