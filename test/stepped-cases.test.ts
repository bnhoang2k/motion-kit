import { describe, expect, it } from "vitest";
import { FRAME_MS } from "../src/gate/harness.ts";
import { atSize, moreName, OBJECT, OTHER, pageMotion, seriesOf, sweepRead, VALUE } from "./stepped-cases.ts";

describe("seriesOf", () => {
  it("a 3-drawing px case: one frame per 1/60 s, the drawings' values, and a 40 px box whose centre y moves with the value", () => {
    const frames = seriesOf({ drawings: [[5, 0], [3, 8], [4, -12]] });
    expect(frames).toHaveLength(12);
    expect(frames.map((f) => f.values[VALUE])).toEqual([0, 0, 0, 0, 0, 8, 8, 8, -12, -12, -12, -12]);
    expect(frames[7]!.ms).toBeCloseTo(7 * FRAME_MS, 9);
    expect(frames[0]!.boxes![OBJECT]).toEqual([620, 340, 40, 40]);
    expect(frames[5]!.boxes![OBJECT]).toEqual([620, 348, 40, 40]);
    expect(frames[11]!.boxes![OBJECT]).toEqual([620, 328, 40, 40]);
    expect(frames.every((f) => f.scroll === 0 && Object.keys(f.values).length === 1)).toBe(true);
  });

  it("scale grows the box by its size per unit about a still centre; a look unit leaves the box as it is", () => {
    expect(seriesOf({ drawings: [[1, 1], [1, 10]], unit: "scale" }).map((f) => f.boxes![OBJECT])).toEqual([
      [620, 340, 40, 40],
      [440, 160, 400, 400],
    ]);
    expect(seriesOf({ drawings: [[1, 330], [1, 0]], unit: "deg" }).map((f) => f.boxes![OBJECT])).toEqual([
      [620, 340, 40, 40],
      [620, 340, 40, 40],
    ]);
  });

  it("slopes, sizePx and at set how the box is drawn", () => {
    const frames = seriesOf({ drawings: [[1, 0], [1, 10]], slopes: { cx: 2, cy: 0 }, sizePx: 20, at: [100, 50] });
    expect(frames.map((f) => f.boxes![OBJECT])).toEqual([
      [90, 40, 20, 20],
      [110, 40, 20, 20],
    ]);
  });

  it("gone frames carry a 1 by 1 box where the object would be", () => {
    const frames = seriesOf({ drawings: [[4, 0]], gone: [1, 2] });
    expect(frames.map((f) => f.boxes![OBJECT])).toEqual([
      [620, 340, 40, 40],
      [620, 340, 1, 1],
      [620, 340, 1, 1],
      [620, 340, 40, 40],
    ]);
  });

  it("other moves the box by a second value without changing the stepped value; its last dx holds to the end", () => {
    const frames = seriesOf({ drawings: [[4, 0]], other: [[1, 0], [2, 5], [1, 10]] });
    expect(frames.map((f) => f.values)).toEqual([0, 5, 5, 10].map((x) => ({ [VALUE]: 0, [OTHER]: x })));
    expect(frames.map((f) => f.boxes![OBJECT]![0])).toEqual([620, 625, 625, 630]);
    expect(seriesOf({ drawings: [[3, 0]], other: [[1, 7]] }).map((f) => f.values[OTHER])).toEqual([7, 7, 7]);
  });

  it("more values move the box by their slopes, from their first value, and are reported by name", () => {
    const frames = seriesOf({ drawings: [[3, 0]], more: [{ holds: [[1, 40], [2, 50]], slopes: { w: 1, cy: 0.5 } }] });
    expect(frames.map((f) => f.values[moreName(0)])).toEqual([40, 50, 50]);
    expect(frames.map((f) => f.boxes![OBJECT])).toEqual([
      [620, 340, 40, 40],
      [615, 345, 50, 40],
      [615, 345, 50, 40],
    ]);
  });
});

describe("sweepRead", () => {
  it("reads a loop over its span and the read-ahead, and keeps the pops before the span's end", () => {
    // A 1 s loop is read 3000 ms (two periods, at least 3 s) plus 4000 ms; its teleports every 500 ms after the first.
    const { pops, drawings } = sweepRead({ value: [[500, 0], [500, 120]], slopes: { cx: 1, cy: 0 }, loop: true });
    expect(pops.map((p) => [p.atFrame, p.kind])).toEqual([30, 60, 90, 120, 150, 180].map((f) => [f, "teleport"]));
    expect(drawings.reduce((n, d) => n + d.frames, 0)).toBe(421);
  });

  it("a motion at another size is the same motion in object lengths", () => {
    const m = atSize({ value: [[500, 0], [500, 60]], loop: true }, 120);
    expect([m.sizePx, m.value, m.at, m.viewport]).toEqual([120, [[500, 0], [500, 180]], [1920, 1080], [3840, 2160]]);
    expect(sweepRead(m).pops[0]).toMatchObject({ kind: "teleport", lengths: expect.closeTo(1.5, 9) });
  });

  it("a fixture page's dot sits where stepped.js draws it, and repeats every period", () => {
    const m = pageMotion({ drawings: [[0, 0], [250, -20]], periodMs: 500, sizePx: 20 });
    expect(m).toEqual({ value: [[250, 0], [250, -20]], sizePx: 20, at: [610, 330], loop: true });
  });
});
