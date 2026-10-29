import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { drawnRead } from "../../src/gate/drawn.ts";
import { closeBrowser, openPage } from "../../src/gate/harness.ts";
import { kindGate, type KindVerdict } from "../../src/gate/kind-gate.ts";
import { CUT_MS, cutPage, writeCutPage, type CutFault, type CutShape } from "./cut-pages.ts";
import "./sweep-priority.ts";
import { bodyPage, ringPage, type Body, type Ring } from "./extent-pages.ts";

/**
 * Pages built from the rules alone, each with the verdict the rules give it (honest pages pass, faulty ones fail the
 * rule that names their fault). They cover four causes of wrong verdicts, each with twins that differ by one change:
 *
 * - Scroll pairs: fixed flipbooks, a fixed progress thumb and in-flow parallax cards, on flat and striped
 *   backgrounds, drawn where they are reported.
 * - The viewport edge: boxes from `getBoundingClientRect()` that lie partly off screen.
 * - Jumps between short holds: a jump between two holds of 100 to 250 ms, and a pop 50 ms after load.
 * - Box lies: a box reported bigger than the dot it holds, with and without a halo, and a box spike that the one
 *   value in its moves cannot explain.
 *
 * The pages share one runner, object2-review/mk.js.
 */

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds/object2-review");
const gate = (name: string) => kindGate(path.join(PAGES, name, "index.html"));
const failing = (v: KindVerdict) => [...new Set(v.failures.map((f) => f.slice(0, f.indexOf(":"))))].sort();

afterAll(async () => {
  await closeBrowser();
});

/** Honest pages: each passes every rule. */
const HONEST = [
  // Scroll pairs. s01, s02, s04: a fixed dot whose x steps with the scroll, on a flat background. s05: a fixed thumb
  // that overlaps its last place. s06: in-flow cards at 0.3 to 1.2 times the scroll, flat or striped. s02b: a round
  // fixed dot that holds still over a striped page. The twins: striped backgrounds, a square dot, an in-flow flipbook.
  "s01-flipbook-direct",
  "s02-flipbook-smoothed",
  "s02b-flipbook-smoothed-striped",
  "s04-flipbook-slow-smooth",
  "s05-fixed-progress-thumb",
  "s06-inflow-cards-parallax",
  "s06b-inflow-cards-parallax-striped",
  "s06c-inflow-cards-parallax-striped-cards",
  "s06d-parallax-striped-cards-striped-bg",
  "s01b-flipbook-direct-striped",
  "s02c-flipbook-smoothed-striped-square",
  "s02d-flipbook-honest-twin-of-sf04c",
  "s03-flipbook-inflow",
  // The viewport edge. c40d: a wide bar half off the top. c40e: a tall bar half off the left. e01b: a canvas walker
  // that walks in from off the left edge. The twins report boxes clipped to the viewport, or lie off screen less.
  "c40d-wide-bar-half-off-top-sliding",
  "c40e-tall-bar-half-off-left-bobbing",
  "e01b-sprite-walker-frame-stepped",
  "c40-partly-offscreen",
  "c40b-wide-bar-off-top-twos",
  "c40c-wide-bar-off-top-twos-clipped-box",
  "c40f-wide-bar-half-off-top-clipped-box",
  "c41-partly-offscreen-right-stepped",
  // Holds: key holds with eased drawings between, a smear between holds, a slow-in to a hold, stop-motion on eights,
  // a one-time walk, a squash on twos.
  "a04-pose-holds-ease-twos",
  "a05-smear-between-holds",
  "a06-squash-bounce-twos",
  "a08-slow-in-to-hold",
  "a15-oneshot-walk-honest",
  "a16-stopmotion-eights",
  // Tight boxes with ink past them or inside them: a shadow, a glow, a big blur on a small dot, an SVG stroke, a small
  // glow in the default halo, italic text, a rotating square, a scale pulse, two objects, a rounded box.
  "c01-shadow-with-halo",
  "c14-glow-filter",
  "c15-big-blur-small-dot",
  "c16-svg-stroke-halo",
  "c43-small-glow-default-halo",
  "c17-text-glyph",
  "c32-rotating-square",
  "c37-scale-pulse",
  "o05-two-objects-honest",
  "o06-rounded-box-honest",
];

/** Faulty pages: each fails exactly these rules. */
const FAULTY: [string, string[]][] = [
  // Scroll faults on flipbooks: the dot runs ahead of the scroll, skips back, stays ahead. Each fails its own rule
  // alone, with no drawn line: the dot is drawn where it is reported.
  ["sf01-flipbook-ahead", ["scroll"]],
  ["sf02-flipbook-skip-back", ["envelope"]],
  ["sf03-flipbook-stays-ahead", ["scroll"]],
  ["sf04d-flipbook-glitch-6-drawings", ["envelope"]],
  // A ball whose bounce rises fails energyFalls alone, with no tightness line at the viewport edge.
  ["df09-ball-bouncy-gain", ["energyFalls"]],
  // Jumps between holds. af05c, af05d, af05e: a dot that creeps 2 px a drawing, holds 117 ms, jumps 0.9, 0.95 or 2
  // of its lengths and holds 117 ms again. af05: the same inside a 4 s loop. af07a: a 10-length pop 50 ms after
  // load. The twins: the jump with no holds, the pop not stepped, the pop after a rest.
  ["af05c-forged-holds-oneshot", ["envelope"]],
  ["af05d-forged-holds-big", ["envelope"]],
  ["af05e-forged-holds-2L", ["envelope"]],
  ["af07a-pop-at-load", ["envelope"]],
  ["af05b-jump-no-holds", ["envelope"]],
  // The same pop with no stepped drawings is also a jump between two frames, so the sub-step read fails it too.
  ["af07d-pop-at-load-nobar", ["envelope", "suddenJumps"]],
  ["af07b-pop-after-rest", ["envelope"]],
  // Box lies. cf30e: a 40 px dot reported as an 80 px box, default halo. cf30, cf30d, cf30c: inflated boxes that
  // claim a halo with nothing drawn in it (64 px with 16, 80 px with 16, 120 px with 40). The twins: 2.4 times, a box
  // too big, an arm inside its body's box.
  ["cf30e-inflated-2x-default-halo", ["drawn"]],
  ["cf30-inflated-with-halo", ["drawn"]],
  ["cf30d-inflated-2x-halo16", ["drawn"]],
  ["cf30c-inflated-3x-halo40", ["drawn"]],
  ["cf30f-inflated-2_4x-default-halo", ["drawn"]],
  ["cf04-box-too-big", ["drawn"]],
  ["cf22-arm-in-body-box", ["drawn"]],
  // of02: a square that jumps 200 px sideways every second while its one value bobs it smoothly in y. The twin's
  // value holds still.
  ["of02-box-spike-no-cause", ["objects"]],
  ["of02b-box-spike-still-value", ["objects"]],
];

describe.concurrent("the object record's twin pages", () => {
  it.each(HONEST)("%s passes every rule", async (name) => {
    const v = await gate(name);
    expect(v.failures).toEqual([]);
  });

  it.each(FAULTY)("%s fails %j", async (name, rules) => {
    expect(failing(await gate(name))).toEqual(rules);
  });

  // The fault inside a loop fails on its jump, whatever its loop's seam does.
  it("af05-forged-holds-jump fails envelope on its jump", async () => {
    const v = await gate("af05-forged-holds-jump");
    expect(v.failures).toContainEqual(expect.stringMatching(/^envelope: x at 1\d{3}(\.\d+)? ms /));
  });

  // A glitch drawn some drawings back inside the scroll's input window fails, and draws where it is reported. Which
  // rule catches it is a question of the scroll rule's thresholds, outside these causes.
  it.each(["sf04-flipbook-glitch-back", "sf04b-flipbook-glitch-3frames", "sf04c-flipbook-glitch-5frames"])("%s fails, with no drawn line", async (name) => {
    const rules = failing(await gate(name));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules).not.toContain("drawn");
  });
});

/**
 * Pages for the fixes to the four causes above: 130 pages per area built from the
 * rules alone, in twin pairs. Scroll pairs: fixed and in-flow movers, parallax from 0.2 to 1.5 times the scroll, headers
 * beside movers, flat, gradient and textured backgrounds, objects at the viewport's edges. Tight boxes: boxes cut by
 * each edge, slivers, text, halos, rotating and pulsing shapes, and box-spike causes. Holds: key holds of 100 to 250 ms,
 * snaps, pose-to-pose loops, stop-motion, cycles read from mid-motion, entrances at load. Honest pages pass every rule;
 * faulty ones fail the rule that names their fault. Each area's pages share one runner, object3-review/<area>/mk.js.
 */
const REVIEW3: Record<"scroll" | "tight" | "holds", { honest: string[]; faulty: [string, string][] }> = {
  scroll: {
    honest: ["p01h", "p02h", "p03h", "p04h", "p05h", "p06h", "p07h", "p08h", "p09h", "p10h", "p11h", "p12h", "p13h", "p14h", "p15h", "p16h", "p17h", "p18h", "p19h", "p20h"],
    faulty: [["p01f", "drawn"], ["p02f", "drawn"], ["p03f", "drawn"], ["p04f", "drawn"], ["p05f", "drawn"], ["p06f", "drawn"], ["p07f", "drawn"], ["p08f", "drawn"], ["p09f", "drawn"], ["p10f", "drawn"], ["p11f", "drawn"], ["p12f", "drawn"], ["p13f", "drawn"], ["p14f", "drawn"], ["p15f", "drawn"], ["p16f", "drawn"], ["p17f", "drawn"], ["p18f", "drawn"], ["p19f", "drawn"], ["p20f", "drawn"]],
  },
  tight: {
    honest: ["s01h-ticker-x-and-bob", "s02h-ticker-x-and-width", "s03h-ticker-skip-in-value", "s04h-sprite-x-and-index", "s05h-live-thumb-snap-reported", "s06h-jump-at-cut", "t01h-topcut-widebar", "t02h-leftcut-tallbar", "t03h-rightcut-sliver-dot", "t04h-bottomcut-1px-bar", "t05h-bottomcut-cap-sideways", "t06h-canvas-sprite-enters", "t06u-canvas-sprite-enters", "t07h-canvas-glow-halo", "t09h-text-gyp-span", "t09h-text-hello-span", "t09h-text-now-span", "t10h-text-typography-vertical", "t13h-rotating-rounded-square", "t15h-scale-pulse", "t16h-fast-dot", "t17h-slow-dot", "t18h-sweep-in-still-box", "t19h-shadow-halo"],
    faulty: [["s01f-ticker-bob-only", "objects"], ["s02f-ticker-width-only", "objects"], ["s03f-ticker-skip-unexplained", "objects"], ["s04f-sprite-index-only", "objects"], ["s05f-live-thumb-snap-unreported", "objects"], ["s06f-jump-no-cut", "envelope"], ["t01f-topcut-widebar", "drawn"], ["t02f-leftcut-tallbar", "drawn"], ["t03f-rightcut-sliver-dot", "drawn"], ["t04f-bottomcut-1px-bar", "drawn"], ["t05f-bottomcut-cap-sideways", "drawn"], ["t06f-canvas-sprite-enters", "drawn"], ["t07f-canvas-glow-halo", "drawn"], ["t09f-text-now-tall-linebox", "drawn"], ["t13f-rotating-rounded-square", "drawn"], ["t15f-scale-pulse", "drawn"], ["t16f-fast-dot", "drawn"], ["t16g-fast-dot-3x-along", "drawn"], ["t17f-slow-dot", "drawn"], ["t18f-sweep-in-still-box", "drawn"], ["t19f-shadow-halo", "drawn"], ["t19g-shadow-halo-2x-up", "drawn"]],
  },
  holds: {
    honest: ["h01-p2p-twos-40", "h02-smear-1_5L-holds-12", "h03-p2p-threes-120", "h04b-near-line-2_7x-40", "h05-hold-to-rest-fast-40", "h06-hold-ib-rest-1_2L-40", "h07-rest-to-hold-fast-120", "h08-anticip-impact-40", "h09-moving-hold-eased-40", "h10-stopmo-uneven-120", "h11-walk-twos-midread-40", "h12-entrance-small-first-40", "h13-entrance-gentle-12", "h14-still-around-0_5L-40", "h14b-still-around-0_5L-12", "h15-two-pose-bob-0_5L-120", "h16-train-133-12", "h17-choreo-p2p-twos-40", "h18-run-midread-12", "h18b-run-holdread-12", "h19-entrance-ease-out-40"],
    faulty: [["f01-p2p-creep-40", "envelope"], ["f02-snap-1_5L-holds-12", "envelope"], ["f03-creep-threes-120", "envelope"], ["f04-near-line-3_5x-40", "envelope"], ["f05-hold-to-rest-creep-40", "envelope"], ["f06-hold-to-rest-1_2L-40", "envelope"], ["f07-rest-to-hold-creep-120", "envelope"], ["f08-anticip-snap-impact-40", "envelope"], ["f09-moving-hold-snap-40", "envelope"], ["f10-stopmo-forged-holds-120", "envelope"], ["f11-walk-forged-holds-40", "envelope"], ["f12-entrance-pop-step1-40", "envelope"], ["f13-entrance-pop-step3-12", "envelope"], ["f14-still-around-1_2L-40", "envelope"], ["f14b-still-around-2L-12", "envelope"], ["f14c-still-around-1_2L-brief-40", "envelope"], ["f14e-still-around-1_2L-glide-40", "envelope"], ["f15-two-pose-bob-1_2L-120", "envelope"], ["f15b-two-pose-bob-1_2L-267ms-120", "envelope"], ["f15c-two-pose-bob-1_2L-200ms-120", "envelope"], ["f16-train-one-big-12", "envelope"], ["f17-choreo-creep-snap-40", "envelope"], ["h04-near-line-2_5x-40", "envelope"]],
  },
};

/**
 * Wrong verdicts these fixes leave, each as wrong before them, so none is a regression. Each
 * runs as `it.fails` with the verdict it must get, so a fix turns it red and takes it off this list.
 */
const REVIEW3_GAPS = new Set([
  // A mover over a fixed textured background: inside its sides a change in the document's frame alone counts, and the
  // fixed texture differs from its shifted source, so a ghost box (p02f) or an inflated one (p04f) fills with change.
  // Before these fixes, the gate failed their honest twins as ghosts too.
  "p02f",
  "p04f",
  // Unreported change beside fixed content or in rows the scroll diff does not judge: a toast one scroll above a still
  // nav bar (p07f), a card at the bottom edge whose drawing slides under a still box (p14f, p17f, and mid-screen p18f),
  // and an unreported parallax blob on a flat background (p16f). The still-pixel heuristic hides them.
  "p07f",
  "p14f",
  "p16f",
  "p17f",
  "p18f",
  // A box too wide across a cut that leaves less than half of it on screen: no edge across the cut is judged.
  "t05f-bottomcut-cap-sideways",
  // Text from getBoundingClientRect(): the font's content area holds empty ascent above x-height glyphs.
  "t09h-text-now-span",
  "t09h-text-gyp-span",
  // Tightness needs only one short edge, and a box in no event pair passes when each edge is reached in some pair: a
  // still box over a scale pulse or a sweep (t15f, t18f), a box inflated along the motion (t16f, t16g), and a box
  // whose inflation swaps its long axis (t19f, t19g).
  "t15f-scale-pulse",
  "t18f-sweep-in-still-box",
  "t16f-fast-dot",
  "t16g-fast-dot-3x-along",
  "t19f-shadow-halo",
  "t19g-shadow-halo-2x-up",
  // Drawings of 100 to 250 ms that are neither holds nor brief: a snap between two such drawings with rests around
  // them (f14, f14b, f14e), and a two-pose bob of such poses (f15, f15c), meet no test.
  "f14-still-around-1_2L-40",
  "f14b-still-around-2L-12",
  "f14e-still-around-1_2L-glide-40",
  "f15-two-pose-bob-1_2L-120",
  "f15c-two-pose-bob-1_2L-200ms-120",
]);

describe.concurrent("the object record's fix pages", () => {
  const gate3 = (area: string, name: string) => kindGate(path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds/object3-review", area, name, "index.html"));
  const rows = (Object.keys(REVIEW3) as (keyof typeof REVIEW3)[]).flatMap((area) => [
    ...REVIEW3[area].honest.map((name): [string, string, string | null] => [area, name, null]),
    ...REVIEW3[area].faulty.map(([name, rule]): [string, string, string | null] => [area, name, rule]),
  ]);
  const check = async (area: string, name: string, rule: string | null) => {
    const v = await gate3(area, name);
    if (rule === null) expect(v.failures).toEqual([]);
    else expect(failing(v)).toContain(rule);
  };
  const open = rows.filter(([, n]) => !REVIEW3_GAPS.has(n));
  const gaps = rows.filter(([, n]) => REVIEW3_GAPS.has(n));
  it.each(open)("%s/%s: %s", check);
  it.fails.each(gaps)("%s/%s: %s (a known gap)", check);
  it("every known gap names a page", () => {
    expect([...REVIEW3_GAPS].filter((n) => !rows.some(([, m]) => m === n))).toEqual([]);
  });
});

/**
 * Small cuts (drawn.ts): a designed one-frame change that is not a scene change, declared in trace.json as a cut. A
 * part that snaps into a slot, a light that flips colour and a panel that appears each change 1% to 10% of the view,
 * at two viewport sizes. Honest, the changed pixels all lie inside the objects the page reports, and the cut passes.
 * Lies: a square no object reports beside the change, a record that leaves the changing thing out, and a cut on a
 * frame where nothing changes. A scene-size cut passes as before.
 */
describe.concurrent("small cuts: a declared cut may change a small part of the view inside the objects", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-cuts-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const SIZES = [{ width: 1280, height: 720 }, { width: 800, height: 600 }];
  const SHAPES: CutShape[] = ["snap", "light", "panel"];
  const SHARES = [0.01, 0.03, 0.1];
  const lines = async (shape: CutShape, share: number, fault: CutFault, size: { width: number; height: number }, quiet = false) => {
    const file = writeCutPage(root, `${shape}-${share}-${fault}-${size.width}${quiet ? "-quiet" : ""}`, cutPage(shape, share, fault, quiet));
    const p = await openPage(file, { viewport: size });
    try {
      return (await drawnRead(p, { kind: "idle", spanMs: 2000, cuts: [CUT_MS], stepped: [] })).lines;
    } finally {
      await p.close();
    }
  };
  const rows = SHAPES.flatMap((shape) => SHARES.flatMap((share) => SIZES.map((size): [CutShape, number, { width: number; height: number }] => [shape, share, size])));

  it.each(rows)("%s at %d of the view, %j: passes", async (shape, share, size) => {
    expect(await lines(shape, share, "honest", size)).toEqual([]);
  });

  // The record that leaves the changing thing out prints the share the cut changes, which is the share asked for.
  it.each(rows)("%s at %d of the view, %j: the change is that share, and with no object over it the cut fails", async (shape, share, size) => {
    const out = await lines(shape, share, "unowned", size);
    expect(out).toHaveLength(1);
    const [, pct, px] = out[0]!.match(/^drawn: the cut at 1000 ms changes ([\d.]+)% of the view, (\d+) px of it outside every object; a cut that is not a scene change changes only what the objects cover$/) ?? [];
    expect(pct).toBeDefined();
    expect(Number(pct)).toBeGreaterThan(100 * share * 0.75);
    expect(Number(pct)).toBeLessThan(100 * share * 1.25);
    expect(Number(px)).toBeGreaterThan(0);
  });

  it.each(SHAPES.flatMap((shape) => SIZES.map((size): [CutShape, { width: number; height: number }] => [shape, size])))("%s, %j: a square no object reports beside the honest change fails the cut", async (shape, size) => {
    const out = await lines(shape, 0.03, "glitch", size);
    expect(out).toEqual([expect.stringMatching(/^drawn: the cut at 1000 ms changes [\d.]+% of the view, \d+ px of it outside every object; a cut that is not a scene change changes only what the objects cover$/)]);
  });

  it.each(SHAPES)("%s: a cut declared on a frame where nothing changes fails", async (shape) => {
    expect(await lines(shape, 0.03, "none", SIZES[0]!)).toEqual(["drawn: the cut at 1000 ms changes 0% of the view; a cut is a scene change"]);
  });

  // A quiet page: the cut is the only change the page has, so there is no "most any other pair changes" to compare
  // it to. It is a small cut, judged against the objects, at every share and size.
  const STRAY = /^drawn: the cut at 1000 ms changes [\d.]+% of the view, \d+ px of it outside every object; a cut that is not a scene change changes only what the objects cover$/;
  it.each(rows)("quiet page, %s at %d of the view, %j: passes", async (shape, share, size) => {
    expect(await lines(shape, share, "honest", size, true)).toEqual([]);
  });
  it.each(rows)("quiet page, %s at %d of the view, %j: with no object over the change the cut fails", async (shape, share, size) => {
    expect(await lines(shape, share, "unowned", size, true)).toEqual([expect.stringMatching(STRAY)]);
  });
  it.each(rows)("quiet page, %s at %d of the view, %j: a square no object reports fails the cut", async (shape, share, size) => {
    expect(await lines(shape, share, "glitch", size, true)).toEqual([expect.stringMatching(STRAY)]);
  });
  it.each(SHAPES)("quiet page, %s: a cut declared on a frame where nothing changes fails", async (shape) => {
    expect(await lines(shape, 0.03, "none", SIZES[0]!, true)).toEqual(["drawn: the cut at 1000 ms changes 0% of the view; a cut is a scene change"]);
  });

  // A known gap, pinned: a page that reports no objects is not read, so a small cut on it passes whatever it changes.
  // Reading it turns red the tracked bars that declare cuts and report no objects, until they report objects. The
  // case runs as `it.fails` with the verdict it must get; a fix turns it red and takes it off the list.
  it.fails.each(SHAPES)("%s: a small cut on a page that reports no objects fails (a known gap)", async (shape) => {
    expect(await lines(shape, 0.03, "noobjects", SIZES[0]!)).toEqual([expect.stringMatching(/^drawn: the cut at 1000 ms /)]);
  });

  it("a scene-size cut passes as before, whatever the objects cover", async () => {
    expect(await lines("panel", 0.6, "honest", SIZES[0]!)).toEqual([]);
    expect(await lines("panel", 0.6, "unowned", SIZES[0]!)).toEqual([]);
    expect(await lines("panel", 0.6, "unowned", SIZES[0]!, true)).toEqual([]);
  });
});

/**
 * A value that is an edge of many moving parts: the box around a ring of 24 cards that spins and tips out (extent-pages.ts),
 * reported as `top` and `height` and declared in trace.json `extents`. Spin lengths of 1500 to 5000 ms and tip-outs of 5 to
 * 20 deg. The box turns by up to 3.5 px as another card becomes the extreme one: undeclared, it fails `overshoot` (and
 * `envelope`'s pulse attack at the longer spins); declared, it passes every rule, at every point of the grid. Each fault
 * runs at the four spin lengths with the smallest and the largest tip-out. The cards may fade in one after another: the box
 * jumps as each comes back, which is no pop. Beside the ring, a value that is no extent is still judged in full: a value summed from 22 of the 24 cards fails the guard, a 600 px slide that springs
 * 3% past its rest fails `overshoot`, and a 4 px badge pulse with a 200 ms attack fails `envelope`.
 */
describe.concurrent("declared extents: a ring of 24 cards", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-extents-sweep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  // The honest page runs at every point of the grid; each fault at the grid's four spin lengths and two ends of the tip-outs.
  const grid = (tips: number[]) => [1500, 2500, 3500, 5000].flatMap((spinMs) => tips.map((tipDeg): [number, number] => [spinMs, tipDeg]));
  const points = grid([5, 10, 15, 20]);
  const ends = grid([5, 20]);
  const run = (spinMs: number, tipDeg: number, more: Ring = {}) => kindGate(ringPage(root, { spinMs, tipDeg, ...more }));

  it.each(points)("spin %d ms, tip-out %d deg, declared: passes every rule", async (spinMs, tipDeg) => {
    expect((await run(spinMs, tipDeg)).failures).toEqual([]);
  });

  // The spin may end with a card a few deg past the top of the ring (spinDeg 108, the default, ends 4.5 deg short of it). Past the
  // top the card's own top comes back by R (1 - cos(angle)) while it still holds the edge: 0.77 px at 4.5 deg and 2.1 px at 7.5.
  // The top is held in turn by the cards that go through it (8 or so), so no card's turn is read there.
  it.each([
    [1500, 112],
    [1500, 116],
    [1500, 117],
    [1500, 118],
    [1500, 120],
    [2500, 118],
    [2500, 120],
    [1500, 125],
    [3500, 120],
    [5000, 120],
  ])("spin %d ms, a spin of %d deg that ends a card past the top of the ring: passes every rule", async (spinMs, spinDeg) => {
    expect((await run(spinMs, 15, { spinDeg })).failures).toEqual([]);
  });

  it.each(ends)("spin %d ms, tip-out %d deg, undeclared: fails overshoot", async (spinMs, tipDeg) => {
    expect(failing(await run(spinMs, tipDeg, { extents: "none" }))).toContain("overshoot");
  });

  it.each(ends)("spin %d ms, tip-out %d deg, a value summed from 22 of the 24 cards: fails the guard", async (spinMs, tipDeg) => {
    const v = await run(spinMs, tipDeg, { report: "fewer" });
    expect(v.failures).toContainEqual(expect.stringMatching(/^extents: top is not the top of its parts at [\d.]+ ms$/));
  });

  // Cards that fade in one after another, scattered round the ring: the box around the drawn ones jumps as each comes back,
  // which is no pop. A card that jumps once they are all in is.
  it.each(ends)("spin %d ms, tip-out %d deg, cards fading in one after another: passes every rule", async (spinMs, tipDeg) => {
    expect((await run(spinMs, tipDeg, { fade: true })).failures).toEqual([]);
  });

  it.each(ends)("spin %d ms, tip-out %d deg, cards fading in from a box at the bottom of the viewport: passes every rule", async (spinMs, tipDeg) => {
    expect((await run(spinMs, tipDeg, { fade: true, idle: "bottom" })).failures).toEqual([]);
  });

  // (At 1500 ms the jumping card also turns round and the guard fails, so the value is judged in full and its first jump is the
  // arrival at 100 ms: the three longer spins show the jump in the step itself.)
  it.each(ends.filter(([spinMs]) => spinMs >= 2500))("spin %d ms, tip-out %d deg, a card that jumps 100 px up in the step in which another comes back, the box starting at the bottom of the viewport: fails suddenJumps at that step", async (spinMs, tipDeg) => {
    const v = await run(spinMs, tipDeg, { fade: true, idle: "bottom", popAtArrival: true });
    expect(v.failures).toContainEqual(expect.stringMatching(/^suddenJumps: top moves -?[\d.]+ in the frame after 983\.333 ms, and -?[\d.]+ in its first half; no cut marks it$/));
  });

  it.each(ends)("spin %d ms, tip-out %d deg, cards fading in and one that jumps 100 px up after: fails envelope on a pop", async (spinMs, tipDeg) => {
    const v = await run(spinMs, tipDeg, { fade: true, pop: true });
    expect(v.failures).toContainEqual(expect.stringMatching(/^envelope: top at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/));
  });

  // The very step in which another card comes back: the card that jumps in it is judged against the cards drawn in both frames.
  // (Over the 5000 ms spin the jump is a smaller share of top's whole change, so it fails as a sudden jump in that step instead.)
  it.each(ends)("spin %d ms, tip-out %d deg, a card that jumps 100 px up in the step in which another comes back: fails on a pop or a jump in that step", async (spinMs, tipDeg) => {
    const v = await run(spinMs, tipDeg, { fade: true, popAtArrival: true });
    expect(v.failures).toContainEqual(expect.stringMatching(/^(envelope: top at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop|suddenJumps: top moves -?[\d.]+ in the frame after 983\.333 ms, and -?[\d.]+ in its first half; no cut marks it)$/));
  });

  it.each(ends)("spin %d ms, tip-out %d deg, with a 3% spring on a 600 px slide beside it: fails overshoot on the slide alone", async (spinMs, tipDeg) => {
    const v = await run(spinMs, tipDeg, { extra: "slide" });
    expect(v.failures).toEqual([expect.stringMatching(/^overshoot: slide passes its rest by [\d.]+ at [\d.]+ ms and comes back; /)]);
  });

  it.each(ends)("spin %d ms, tip-out %d deg, with a 4 px badge pulse of 200 ms attack beside it: fails envelope on the badge alone", async (spinMs, tipDeg) => {
    const v = await run(spinMs, tipDeg, { extra: "badge" });
    expect(v.failures).toEqual([expect.stringMatching(/^envelope: badge at [\d.]+ ms is a pulse that peaks 1\d\d ms after it starts; a pulse's attack is 40 to 120 ms$/)]);
  });
});

/**
 * A single body named as an extent beside a drawn decoy. A body that slides and springs past its rest by 3 to 20% (150 or 600 px),
 * or pulses 4 px with an attack of 160 to 300 ms, is named as the left edge of itself and a decoy. A decoy that never holds
 * the edge (`static`) leaves it in one part's hands: no extent. A decoy that holds it for the first frames and then runs past (`crosses`)
 * leaves the body alone with it, and the body turns round: no extent. Either way the value is judged in full, so the spring fails
 * `overshoot` and the slow pulse fails `envelope`, on the value alone.
 */
describe.concurrent("an edge held by one body beside a decoy is no extent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-decoy-sweep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const LEFT = { x: { edge: "left", parts: ["dot", "decoy"] } };
  const run = (body: Body) => kindGate(bodyPage(root, LEFT, body));
  const extentLines = (v: KindVerdict) => v.failures.filter((f) => f.startsWith("extents:"));
  const springs = [150, 600].flatMap((travel) => [0.03, 0.2].map((over): [number, number] => [travel, over]));

  it.each(springs)("%d px slide, %d past its rest, beside a decoy that never holds the edge: fails the guard and overshoot", async (travel, over) => {
    const v = await run({ decoy: "static", travel, over });
    expect(extentLines(v)).toEqual([expect.stringMatching(/^extents: x is held by dot throughout; /)]);
    expect(v.failures).toContainEqual(expect.stringMatching(/^overshoot: x passes its rest by [\d.]+ at [\d.]+ ms and comes back; /));
  });

  it.each(springs)("%d px slide, %d past its rest, beside a decoy that holds the edge first and runs past: fails the guard and overshoot", async (travel, over) => {
    const v = await run({ decoy: "crosses", travel, over });
    expect(extentLines(v)).toEqual([expect.stringMatching(/^extents: x has dot turn round at [\d.]+ ms while it holds the edge and then comes to rest; /)]);
    expect(v.failures).toContainEqual(expect.stringMatching(/^overshoot: x passes its rest by [\d.]+ at [\d.]+ ms and comes back; /));
  });

  // Down 0 to 8 px a frame while it slides: the whole box never turns back, though the left edge does.
  const drifts = [150, 600].flatMap((travel) => [0, 3, 6, 8].map((drift): [number, number] => [travel, drift]));
  it.each(drifts)("%d px slide springing 10% past its rest while it drifts %d px a frame across the edge, beside a decoy that holds the edge first and runs past: fails the guard and overshoot", async (travel, drift) => {
    const v = await run({ decoy: "crosses", travel, drift });
    expect(extentLines(v)).toEqual([expect.stringMatching(/^extents: x has dot turn round at [\d.]+ ms while it holds the edge and then comes to rest; /)]);
    expect(v.failures).toContainEqual(expect.stringMatching(/^overshoot: x passes its rest by [\d.]+ at [\d.]+ ms and comes back; /));
  });

  // A decoy that holds the edge with the body (the first listed wins a tie), runs past it and goes gone at 400 ms: the edge changes
  // hands, but the two are drawn together in only a small share of the frames, so they are no group. A slow pulse is no turn
  // that the other conditions read, so only the group condition fails it.
  const TIE = { x: { edge: "left", parts: ["decoy", "dot"] } };
  const briefLines = (v: KindVerdict) => v.failures.filter((f) => f.startsWith("extents:"));
  it.each([200, 250, 300])("a 4 px pulse with a %d ms attack beside a decoy that is drawn with it for only a short while: fails the group and envelope", async (attackMs) => {
    const v = await kindGate(bodyPage(root, TIE, { decoy: "brief", move: "pulse", attackMs, startMs: 500 }));
    expect(briefLines(v)).toEqual([expect.stringMatching(/^extents: x has 2 parts drawn in \d+ of \d+ frames where any is; an extent is the edge of parts drawn together$/)]);
    expect(v.failures).toContainEqual(expect.stringMatching(/^envelope: x at 500 ms is a pulse that peaks \d+ ms after it starts; a pulse's attack is 40 to 120 ms$/));
  });

  it.each(springs)("%d px slide, %d past its rest, beside a decoy that is drawn with it for only a short while: fails the group and overshoot", async (travel, over) => {
    const v = await kindGate(bodyPage(root, TIE, { decoy: "brief", travel, over }));
    expect(briefLines(v)).toEqual([expect.stringMatching(/^extents: x has 2 parts drawn in \d+ of \d+ frames where any is; /)]);
    expect(v.failures).toContainEqual(expect.stringMatching(/^overshoot: x passes its rest by [\d.]+ at [\d.]+ ms and comes back; /));
  });

  it.each([160, 200, 300])("a 4 px pulse with a %d ms attack beside a decoy that never holds the edge: fails the guard and envelope", async (attackMs) => {
    const v = await run({ decoy: "static", move: "pulse", attackMs });
    expect(extentLines(v)).toEqual([expect.stringMatching(/^extents: x is held by dot throughout; /)]);
    expect(v.failures).toContainEqual(expect.stringMatching(/^envelope: x at [\d.]+ ms is a pulse that peaks \d+ ms after it starts; a pulse's attack is 40 to 120 ms$/));
  });
});
