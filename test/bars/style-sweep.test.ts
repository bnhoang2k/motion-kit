import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "../../src/gate/harness.ts";
import { kindGate } from "../../src/gate/kind-gate.ts";
import { inputSlug, writeInputBar, type InputPage } from "./input-pages.ts";
import { REVIEWED_HONEST, sweepPage, sweepSlug, writeSteppedBar, type SweepSpec } from "./stepped-pages.ts";

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

describe("the style sweep: stepped motion", () => {
  it.each([...honest, ...edge(0.6)].map((s) => [sweepSlug(s), s] as const))("%s passes", async (slug, spec) => {
    const v = await kindGate(writeSteppedBar(root, slug, sweepPage(spec)));
    expect(v.failures).toEqual([]);
  });

  it.each(frozen.map((s) => [sweepSlug(s), s] as const))("%s fails", async (slug, spec) => {
    const v = await kindGate(writeSteppedBar(root, slug, sweepPage(spec)));
    expect(v.failures).toEqual(["stepped: y never changes"]);
  });
});

describe("the style sweep: honest pages the share-of-move rule judged wrongly", () => {
  it.each(Object.keys(REVIEWED_HONEST))("%s passes", async (name) => {
    const v = await kindGate(writeSteppedBar(root, slugOf(name), REVIEWED_HONEST[name]!));
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
describe("the style sweep: stepped drawings the input drives", () => {
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
describe("the style sweep: what honest objects draw (drawn)", () => {
  const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
  const names = ["drawn-shadow-14", "drawn-shadow-32", "drawn-shadow-48", "drawn-glow", "drawn-blur", "drawn-text", "drawn-badge", "drawn-cursor", "drawn-fade", "drawn-vanish", "drawn-faint", "drawn-confetti", "drawn-live", "drawn-choreo", "drawn-aurora", "drawn-twinkle", "drawn-particles", "drawn-stripes", "drawn-sweep", "drawn-cut/index", "drawn-cut-early/index", "drawn-sticky", "drawn-doc-card"];
  it.each(names)("%s passes every rule", async (name) => {
    const v = await kindGate(path.join(PAGES, `${name}.html`));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });
});
