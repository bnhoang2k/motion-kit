import { describe, expect, it } from "vitest";
import { FRAME_MS, type Frame } from "../src/gate/harness.ts";
import { checkObjects, explainedBy, fitSlopes, goneIn, haloOf, isGone, NO_CHANGE, objectOf, stepParts, type Box, type ObjectRecord } from "../src/gate/objects.ts";

const at = (ms: number, boxes?: Record<string, Box>): Frame => ({ ms, values: { y: 0 }, ...(boxes ? { boxes } : {}) });
const dot: Record<string, ObjectRecord> = { dot: { box: [0, 0, 40, 40], moves: ["y"] } };
/** The checks on a 1280 by 720 page that does not scroll and has no cuts, unless set. */
const check = (frames: Frame[], objects: Record<string, ObjectRecord>, values: string[], units: Record<string, string> = {}, scrolled = false, cuts: number[] = []) =>
  checkObjects(frames, objects, values, units, 1280, 720, scrolled, cuts);
/** `n` frames on the 1/60 s grid: frame `i` holds `values(i)`, the boxes `boxes(i)` and the scroll `scroll(i)`. */
const run = (n: number, values: (i: number) => Record<string, number>, boxes: (i: number) => Record<string, Box>, scroll?: (i: number) => number): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ ms: i * FRAME_MS, values: values(i), boxes: boxes(i), scroll: scroll ? scroll(i) : 0 }));
/** A box of `w` by `h` centred on (cx, cy). */
const centred = (cx: number, cy: number, w = 40, h = w): Box => [cx - w / 2, cy - h / 2, w, h];
const near = (got: object | null | undefined, want: Record<string, number>) => {
  expect(got).not.toBeNull();
  for (const [k, v] of Object.entries(want)) expect((got as Record<string, number>)[k], k).toBeCloseTo(v, 6);
};

describe("objectOf", () => {
  it("maps each moved value to its object", () => {
    const m = objectOf({ a: { box: [0, 0, 5, 5], moves: ["x", "y"] }, b: { box: [0, 0, 5, 5], moves: ["s"] }, c: { box: [0, 0, 5, 5], moves: [] } });
    expect([...m]).toEqual([["x", "a"], ["y", "a"], ["s", "b"]]);
  });

  it("skips a record that is not { box, moves }, which the objects line reports", () => {
    const bad = { a: { box: [0, 0, 5, 5], moves: "xy" }, b: { box: [0, 0, 5, 5] }, c: { moves: ["z"] }, d: null, e: { box: [0, 0, 5, 5], moves: ["y"] } } as unknown as Record<string, ObjectRecord>;
    expect([...objectOf(bad)]).toEqual([["y", "e"]]);
  });
});

describe("haloOf", () => {
  it("is 4 px unless set, and capped at the larger of 16 px and the object's length", () => {
    expect(haloOf({ box: [0, 0, 40, 40], moves: [] })).toBe(4);
    expect(haloOf({ box: [0, 0, 40, 40], moves: [], halo: 600 })).toBe(40);
    expect(haloOf({ box: [0, 0, 8, 8], moves: [], halo: 600 })).toBe(16);
    expect(haloOf({ box: [0, 0, 40, 40], moves: [], halo: 10 })).toBe(10);
  });
});

describe("goneIn", () => {
  it("is gone when 1 by 1 or wholly outside the viewport", () => {
    expect(goneIn([-60, 10, 40, 40], 1280, 720)).toBe(true);
    expect(goneIn([10, 730, 40, 40], 1280, 720)).toBe(true);
    expect(goneIn([5, 5, 1, 1], 1280, 720)).toBe(true);
    expect(goneIn([-30, 10, 40, 40], 1280, 720)).toBe(false);
  });

  it("isGone is a box of 1 by 1, whatever its place", () => {
    expect(isGone([5, 5, 1, 1])).toBe(true);
    expect(isGone([5, 5, 1, 30])).toBe(false);
  });
});

describe("fitSlopes", () => {
  it("one value moving the centre x by 2 px per unit has slopes { cx: 2, cy: 0, w: 0, h: 0 }", () => {
    const frames = run(30, (i) => ({ x: i }), (i) => ({ dot: centred(100 + 2 * i, 200) }));
    const fit = fitSlopes(frames, "dot", ["x"], false);
    expect(fit.shifted).toBe(false);
    expect(fit.slopes.get("x")).toEqual({ cx: expect.closeTo(2, 9), cy: 0, w: 0, h: 0 });
  });

  it("two values on one box each get their own part: a walk x and a stepped bob", () => {
    const bob = (i: number) => (Math.floor(i / 4) % 2 ? -10 : 0);
    const frames = run(60, (i) => ({ x: 3 * i, bob: bob(i) }), (i) => ({ walker: centred(100 + 3 * i, 300 + bob(i)) }));
    const fit = fitSlopes(frames, "walker", ["x", "bob"], false);
    near(fit.slopes.get("x"), { cx: 1, cy: 0, w: 0, h: 0 });
    near(fit.slopes.get("bob"), { cx: 0, cy: 1, w: 0, h: 0 });
  });

  it("a diagonal value moves both centre coordinates by 0.707 k", () => {
    const k = 10;
    const frames = run(30, (i) => ({ d: i }), (i) => ({ dot: centred(100 + Math.SQRT1_2 * k * i, 100 + Math.SQRT1_2 * k * i) }));
    near(fitSlopes(frames, "dot", ["d"], false).slopes.get("d"), { cx: 7.0710678, cy: 7.0710678, w: 0, h: 0 });
  });

  it("a value that changes in only 2 frame steps has no slopes", () => {
    const v = (i: number) => 5 * Math.floor(i / 10);
    const frames = run(30, (i) => ({ v: v(i) }), (i) => ({ dot: centred(100 + v(i), 100) }));
    expect(fitSlopes(frames, "dot", ["v"], false).slopes.get("v")).toBeNull();
  });

  it("a two-valued facing flip on a walker measures nothing", () => {
    // A patrol: 5 px a frame, turning every 20 frames. The facing flips the sprite but not its box.
    const x = (i: number) => (i % 40 < 20 ? 5 * (i % 40) : 5 * (40 - (i % 40)));
    const facing = (i: number) => (i % 40 < 20 ? 1 : -1);
    const frames = run(120, (i) => ({ x: x(i), facing: facing(i) }), (i) => ({ walker: centred(50 + x(i), 300) }));
    const fit = fitSlopes(frames, "walker", ["x", "facing"], false);
    near(fit.slopes.get("facing"), { cx: 0, cy: 0, w: 0, h: 0 });
    near(fit.slopes.get("x"), { cx: 1 });
  });

  it("on a scroll page a fixed bar moved by translateX(f) keeps the viewport, and gains no cy slope from the scroll", () => {
    const f = (i: number) => 2.5 * i;
    const fixed = run(30, (i) => ({ f: f(i) }), (i) => ({ bar: [f(i), 340, 40, 40] }), (i) => 10 * i);
    const fit = fitSlopes(fixed, "bar", ["f"], true);
    expect(fit.shifted).toBe(false);
    near(fit.slopes.get("f"), { cx: 1, cy: 0, w: 0, h: 0 });
    // The same bar in the document's flow moves up the viewport as the page scrolls: it keeps the scroll-shifted frame.
    const inFlow = run(30, (i) => ({ f: f(i) }), (i) => ({ bar: [f(i), 900 - 10 * i, 40, 40] }), (i) => 10 * i);
    const flowFit = fitSlopes(inFlow, "bar", ["f"], true);
    expect(flowFit.shifted).toBe(true);
    near(flowFit.slopes.get("f"), { cx: 1, cy: 0, w: 0, h: 0 });
  });

  it("an object drawn in fewer than 12 frames gives every value no slopes, and still names its frame of reference", () => {
    const frames = run(30, (i) => ({ x: i }), (i) => ({ dot: i < 11 ? centred(100 + 2 * i, 200) : [0, 0, 1, 1] }));
    const fit = fitSlopes(frames, "dot", ["x"], false);
    expect(fit.slopes.get("x")).toBeNull();
    expect(fit.shifted).toBe(false);
  });
});

describe("stepParts", () => {
  it("a 40 px dot that snaps to 400 px changes size by 9 lengths of the smaller box", () => {
    const p = stepParts([0, 0, 40, 40], [-180, -180, 400, 400], { cx: 0, cy: 0, w: 360, h: 360 }, 1, 0, NO_CHANGE);
    expect(p).toEqual({ positionPx: 0, sizePx: 360, position: 0, size: 9 });
  });

  it("a facing flip whose slopes are all 0 measures 0 while its box moved 96 px", () => {
    const p = stepParts([0, 0, 40, 40], [96, 0, 40, 40], { cx: 0, cy: 0, w: 0, h: 0 }, 2, 0, NO_CHANGE);
    expect(p).toEqual({ positionPx: 0, sizePx: 0, position: 0, size: 0 });
  });

  it("with no slopes, measures the boxes' own change, the scroll added to cy for a scroll-shifted object", () => {
    expect(stepParts([0, 100, 40, 40], [0, 60, 40, 40], null, 1, 0, NO_CHANGE)).toEqual({ positionPx: 40, sizePx: 0, position: 1, size: 0 });
    expect(stepParts([0, 100, 40, 40], [0, 60, 40, 40], null, 1, 40, NO_CHANGE)).toEqual({ positionPx: 0, sizePx: 0, position: 0, size: 0 });
  });

  it("with no slopes, takes off what the object's fitted values explain, and keeps the real boxes' lengths", () => {
    // The box falls 45 px and squashes 10 px wide and 10 px flat; a fitted value explains a 40 px fall. What is left:
    // a centre move of (5, -5) over the bigger box's 50 px, and a 10 px size change over the smaller box's 40 px.
    const p = stepParts([0, 100, 40, 40], [0, 60, 50, 30], null, 1, 0, [0, -40, 0, 0]);
    expect(p.positionPx).toBeCloseTo(Math.hypot(5, -5), 9);
    expect(p.position).toBeCloseTo(Math.hypot(5, -5) / 50, 9);
    expect([p.sizePx, p.size]).toEqual([10, 0.25]);
    // With slopes, the value's own part: what other values explain is not read.
    expect(stepParts([0, 100, 40, 40], [0, 60, 50, 30], { cx: 0, cy: 0, w: 10, h: 0 }, 1, 0, [0, -40, 0, 0])).toEqual({ positionPx: 0, sizePx: 10, position: 0, size: 0.25 });
  });
});

describe("explainedBy", () => {
  it("sums each other fitted value's change times its slopes, between two frames; a value with null slopes explains nothing", () => {
    // y moves the dot down 1 px a frame; w and h move together, so neither has slopes.
    const frames = run(30, (i) => ({ y: i, w: i < 15 ? 40 : 50, h: i < 15 ? 40 : 30 }), (i) => ({ dot: centred(100, 100 + i, i < 15 ? 40 : 50, i < 15 ? 40 : 30) }));
    const fit = fitSlopes(frames, "dot", ["w", "h", "y"], false);
    expect([fit.slopes.get("w"), fit.slopes.get("h")]).toEqual([null, null]);
    const forW = explainedBy(frames, fit, "w");
    forW(14, 15).forEach((x, k) => expect(x).toBeCloseTo([0, 1, 0, 0][k]!, 6));
    forW(0, 29).forEach((x, k) => expect(x).toBeCloseTo([0, 29, 0, 0][k]!, 6));
    // y's own steps: nothing else has slopes, so nothing is explained.
    expect(explainedBy(frames, fit, "y")(14, 15)).toEqual(NO_CHANGE);
  });
});

describe("checkObjects", () => {
  const good = [at(0, { dot: [0, 0, 40, 40] }), at(500, { dot: [0, 9, 40, 40] })];

  it("passes a whole record", () => {
    expect(check(good, dot, ["y"])).toEqual([]);
  });

  it("passes a page with no objects", () => {
    expect(check([at(0), at(500)], {}, ["y"])).toEqual([]);
  });

  it("names a halo that is not a finite number of 0 or more", () => {
    for (const halo of [Number.NaN, -1, "4"]) {
      const record = { dot: { box: [0, 0, 40, 40], moves: ["y"], halo } } as unknown as Record<string, ObjectRecord>;
      expect(check(good, record, ["y"]), String(halo)).toEqual(["objects: dot halo is not a finite number ≥ 0"]);
    }
    expect(check(good, { dot: { box: [0, 0, 40, 40], moves: ["y"], halo: 0 } }, ["y"])).toEqual([]);
  });

  it("names a px value whose box does not follow it: a decoy owner, with the moving box listed under no value", () => {
    const decoy = { dot: { box: [600, 320, 40, 40] as Box, moves: ["y"] }, ghost: { box: [100, 100, 40, 40] as Box, moves: [] } };
    const frames = run(30, (i) => ({ y: 5 * i }), (i) => ({ dot: [600, 320, 40, 40], ghost: [100, 100 + 5 * i, 40, 40] }));
    expect(check(frames, decoy, ["y"], { y: "px" })).toEqual(["objects: y changes but its object's box does not follow it"]);
    // The honest record: y moves the box that moves.
    const honest = { dot: { box: [600, 320, 40, 40] as Box, moves: [] }, ghost: { box: [100, 100, 40, 40] as Box, moves: ["y"] } };
    expect(check(frames, honest, ["y"], { y: "px" })).toEqual([]);
  });

  it("leaves out an ambient object: a px value that pans a background inside its still box, grown by its halo, over half the view", () => {
    const frames = (box: Box) => run(30, (i) => ({ g: 5 * i }), () => ({ bg: box }));
    const record = (box: Box, halo?: number) => ({ bg: { box, moves: ["g"], ...(halo === undefined ? {} : { halo }) } });
    // The whole view pans: a background that moves on its own.
    const full: Box = [0, 0, 1280, 720];
    expect(check(frames(full), record(full), ["g"], { g: "px" })).toEqual([]);
    // The same still box, small: a decoy owner.
    const small: Box = [600, 320, 40, 40];
    expect(check(frames(small), record(small), ["g"], { g: "px" })).toEqual(["objects: g changes but its object's box does not follow it"]);
    // Just under half the view with its 4 px halo (1280 by 354 of 1280 by 720 in view): still judged.
    const under: Box = [0, 0, 1280, 350];
    expect(check(frames(under), record(under), ["g"], { g: "px" })).toEqual(["objects: g changes but its object's box does not follow it"]);
    // A 16 px halo takes it over half (1280 by 366): ambient.
    expect(check(frames(under), record(under, 16), ["g"], { g: "px" })).toEqual([]);
  });

  it("on a scroll page, names a scroll-driven px value listed under a still in-flow card while the box that moves lists nothing", () => {
    // The card sits still in the document, so it moves up the viewport as the page scrolls; the value changes with the scroll.
    const s = (i: number) => 10 * i;
    const frames = run(30, (i) => ({ p: s(i) }), (i) => ({ card: [100, 500 - s(i), 40, 40], bar: [100 + s(i) / 4, 340, 40, 40] }), s);
    const decoy = { card: { box: [100, 500, 40, 40] as Box, moves: ["p"] }, bar: { box: [100, 340, 40, 40] as Box, moves: [] } };
    expect(check(frames, decoy, ["p"], { p: "px" }, true)).toEqual(["objects: p changes but its object's box does not follow it"]);
  });

  it("on a scroll page, passes an in-flow card that its own value moves", () => {
    const s = (i: number) => 10 * i;
    const frames = run(30, (i) => ({ q: 3 * i }), (i) => ({ card: [100 + 3 * i, 500 - s(i), 40, 40] }), s);
    expect(check(frames, { card: { box: [100, 500, 40, 40], moves: ["q"] } }, ["q"], { q: "px" }, true)).toEqual([]);
  });

  it("names a still-jump-still box whose only changing value is an index", () => {
    const frames = run(30, (i) => ({ i: i < 15 ? 0 : 1 }), (i) => ({ dot: [i < 15 ? 100 : 220, 100, 40, 40] }));
    const record = { dot: { box: [100, 100, 40, 40] as Box, moves: ["i"] } };
    expect(check(frames, record, ["i"], { i: "index" })).toEqual(["objects: dot jumps 3 object lengths at 250 ms with no value in its moves changing"]);
    // At a listed cut the jump is the camera's.
    expect(check(frames, record, ["i"], { i: "index" }, false, [250])).toEqual([]);
    // A px value that changes in that frame is a cause.
    expect(check(frames, { dot: { box: [100, 100, 40, 40], moves: ["i"] } }, ["i"], { i: "px" })).toEqual([]);
  });

  it("names a box that jumps sideways while its one value, fitted, bobs it up and down", () => {
    const bob = (i: number) => 20 * Math.sin(i / 3);
    const frames = run(60, (i) => ({ y: bob(i) }), (i) => ({ b: [i < 30 ? 100 : 340, 300 + bob(i), 40, 40] }));
    const record = { b: { box: [100, 300, 40, 40] as Box, moves: ["y"] } };
    expect(check(frames, record, ["y"], { y: "px" })).toEqual(["objects: b jumps 6 object lengths at 500 ms more than the values in its moves explain"]);
  });

  it("passes a still-jump-still box whose fitted value explains each jump", () => {
    const x = (i: number) => (Math.floor(i / 10) % 2) * 240;
    const frames = run(60, (i) => ({ x: x(i) }), (i) => ({ dot: [100 + x(i), 100, 40, 40] }));
    expect(check(frames, { dot: { box: [100, 100, 40, 40], moves: ["x"] } }, ["x"], { x: "px" })).toEqual([]);
  });

  it("passes steady fast motion: a 16 px cursor with moves [] moving 25 px every frame", () => {
    const frames = run(30, () => ({}), (i) => ({ cursor: [100 + 25 * i, 100, 16, 16] }));
    expect(check(frames, { cursor: { box: [100, 100, 16, 16], moves: [] } }, [])).toEqual([]);
  });

  it("on a scroll page, passes a box the document carries in a jump of the scroll: its move must pass the line in both frames of reference", () => {
    const scroll = (i: number) => (i < 15 ? 0 : 120);
    const frames = run(30, () => ({}), (i) => ({ card: [100, 400 - scroll(i), 40, 40] }), scroll);
    const record = { card: { box: [100, 400, 40, 40] as Box, moves: [] } };
    expect(check(frames, record, [], {}, true)).toEqual([]);
    expect(check(frames, record, [], {}, false)).toEqual(["objects: card jumps 3 object lengths at 250 ms with no value in its moves changing"]);
  });

  it("passes a gone box of 1 by 1 and an object that moves nothing", () => {
    const frames = [at(0, { dot: [0, 0, 1, 1], ray: [0, 0, 8, 8] })];
    expect(check(frames, { dot: dot.dot!, ray: { box: [0, 0, 8, 8], moves: [] } }, ["y"])).toEqual([]);
  });

  it("names a moves entry that is not a reported value", () => {
    const lines = check(good, { dot: { box: [0, 0, 40, 40], moves: ["yy"] } }, ["y"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^objects: /);
    expect(lines[0]).toContain("yy");
  });

  it("names a value that two objects move", () => {
    const two = { a: { box: [0, 0, 9, 9], moves: ["y"] }, b: { box: [0, 0, 9, 9], moves: ["y"] } } as Record<string, ObjectRecord>;
    const lines = check([at(0, { a: [0, 0, 9, 9], b: [0, 0, 9, 9] })], two, ["y"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^objects: y .*a.*b/);
  });

  it("names a box that is not finite numbers, with the first time", () => {
    const lines = check([at(0, { dot: [0, 0, 40, 40] }), at(500, { dot: [Number.NaN, 0, 40, 40] })], dot, ["y"]);
    expect(lines).toEqual(["objects: dot box is not finite numbers at 500 ms"]);
  });

  it("names a box smaller than 1 px", () => {
    const lines = check([at(0, { dot: [0, 0, 0.5, 40] })], dot, ["y"]);
    expect(lines).toEqual(["objects: dot box is under 1 px wide or high at 0 ms"]);
  });

  it("names an object missing in some frames", () => {
    const lines = check([at(0, { dot: [0, 0, 40, 40] }), at(500, {}), at(1000)], dot, ["y"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^objects: dot has no box in 2 of 3 frames, the first at 500 ms$/);
  });

  it("names an object that appears in a later frame but not in the record", () => {
    const frames = [at(0, { dot: [0, 0, 40, 40] }), at(500, { dot: [0, 9, 40, 40] }), at(1000, { dot: [0, 9, 40, 40], rays: [0, 0, 8, 8] })];
    const lines = check(frames, dot, ["y"]);
    expect(lines).toEqual([
      "objects: rays has a box at 1000 ms but is not in the record read from the page's state",
      "objects: rays has no box in 2 of 3 frames, the first at 0 ms",
    ]);
  });

  it("names an entry without a box or a moves list", () => {
    const bad = { dot: { box: [0, 0, 40], moves: "y" } } as unknown as Record<string, ObjectRecord>;
    const lines = check(good, bad, ["y"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^objects: dot is not \{ box: \[x, y, w, h\], moves: \[names\] \}$/);
  });
});
