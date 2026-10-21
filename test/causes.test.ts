import { describe, expect, it } from "vitest";
import { causedWindows, causesOf, repeatCause, type Cause } from "../src/gate/causes.ts";
import { FRAME_MS, type Frame, type InputSamples } from "../src/gate/harness.ts";
import { lastMoveMs } from "../src/gate/series.ts";

const F = FRAME_MS;
const grid = (k: number) => (k * 1000) / 60;

/** Frames every 1/60 s from 0 to `toMs`, each value set by its function of ms. */
const framesOf = (toMs: number, fns: Record<string, (ms: number) => number>): Frame[] =>
  Array.from({ length: Math.round(toMs / F) + 1 }, (_, k) => ({ ms: grid(k), values: Object.fromEntries(Object.entries(fns).map(([n, f]) => [n, f(grid(k))])) }));

describe("causesOf", () => {
  it("reads each press of a pointer input as a cause, from its first down sample to its lift", () => {
    const input: InputSamples = {
      kind: "pointer",
      samples: [
        [grid(15), 100, 200, 1],
        [grid(16), 100, 200, 0],
        [grid(60), 300, 400, 1],
        [grid(62), 310, 400, 1],
      ],
    };
    expect(causesOf(input)).toEqual([
      { kind: "press", startMs: grid(15), stopMs: grid(16), at: [100, 200] },
      // The input ends down: the pointer lifts after the last sample.
      { kind: "press", startMs: grid(60), stopMs: grid(62), at: [300, 400] },
    ]);
  });

  it("reads scroll ticks less than 250 ms apart as one burst, with its first tick", () => {
    const input: InputSamples = { kind: "scroll", samples: [[0, 100], [50, 200], [100, 300], [400, 300], [600, 200]] };
    expect(causesOf(input)).toEqual([
      { kind: "scroll", startMs: 0, stopMs: 100, tick: 100 },
      { kind: "scroll", startMs: 600, stopMs: 600, tick: -100 },
    ]);
  });

  it("makes the page load the one cause when there is no input", () => {
    expect(causesOf(null)).toEqual([{ kind: "load", startMs: 0, stopMs: 0 }]);
    expect(causesOf({ kind: "pointer", samples: [] })).toEqual([{ kind: "load", startMs: 0, stopMs: 0 }]);
  });
});

describe("repeatCause", () => {
  it("plays a press again at the same spot for the same length, after an input that ended down", () => {
    const input: InputSamples = { kind: "pointer", samples: [[grid(15), 100, 200, 1], [grid(18), 100, 200, 1]] };
    const [press] = causesOf(input) as [Cause];
    expect(repeatCause(input, press, grid(40)).samples).toEqual([
      [grid(15), 100, 200, 1],
      [grid(18), 100, 200, 1],
      // The first press keeps its lift right after its last sample.
      [grid(19), 100, 200, 0],
      [grid(40), 100, 200, 1],
      [grid(43), 100, 200, 0],
    ]);
  });

  it("keeps the first press's samples when it already lifted", () => {
    const input: InputSamples = { kind: "pointer", samples: [[grid(15), 100, 200, 1], [grid(16), 100, 200, 0]] };
    const [press] = causesOf(input) as [Cause];
    expect(repeatCause(input, press, grid(30)).samples).toEqual([
      [grid(15), 100, 200, 1],
      [grid(16), 100, 200, 0],
      [grid(30), 100, 200, 1],
      [grid(31), 100, 200, 0],
    ]);
  });

  it("plays a scroll burst's first tick again", () => {
    const input: InputSamples = { kind: "scroll", samples: [[0, 100], [50, 200], [500, 200]] };
    const [burst] = causesOf(input) as [Cause];
    expect(repeatCause(input, burst, 300)).toEqual({ kind: "scroll", samples: [[0, 100], [50, 200], [300, 300], [500, 300]] });
  });

  it("taps the viewport center for a load", () => {
    const [load] = causesOf(null) as [Cause];
    expect(repeatCause(null, load, grid(30))).toEqual({ kind: "pointer", samples: [[grid(30), 640, 360, 1], [grid(31), 640, 360, 0]] });
  });
});

describe("causedWindows", () => {
  const press: Cause = { kind: "press", startMs: grid(10), stopMs: grid(11), at: [0, 0] };

  it("runs from the cause to the end of its sequence, across a pause", () => {
    // a moves from 200 to 400 ms, holds still to 600, then moves again to 900.
    const a = (ms: number) => (ms < 200 ? 0 : ms < 400 ? ms - 200 : ms < 600 ? 200 : ms < 900 ? 200 + (ms - 600) : 500);
    const [w] = causedWindows(framesOf(2000, { a }), [press], new Set());
    expect(w![0]).toBe(grid(10));
    expect(w![1]).toBeCloseTo(900, 0);
  });

  it("ends at the next cause, and a loop never keeps a window open", () => {
    const second: Cause = { kind: "press", startMs: 1500, stopMs: 1500 + F, at: [0, 0] };
    const a = (ms: number) => (ms < 200 ? 0 : ms < 400 ? ms - 200 : 200);
    const ring = (ms: number) => Math.sin(ms / 100);
    const ws = causedWindows(framesOf(2000, { a, ring }), [press, second], new Set(["ring"]));
    expect(ws[0]![1]).toBeCloseTo(400, 0);
    expect(ws[1]).toEqual([1500, 1500 + F]);
  });

  it("gives no window for a load", () => {
    expect(causedWindows(framesOf(500, { a: (ms) => ms }), causesOf(null), new Set())).toEqual([]);
  });
});

describe("lastMoveMs", () => {
  it("is the frame after the last step a value moves in, pauses inside the sequence not counted", () => {
    // a moves to 300 ms, holds, moves again from 1000 to 1200 ms; a loop runs to the end.
    const a = (ms: number) => Math.min(ms, 300) + Math.max(0, Math.min(ms, 1200) - 1000);
    const frames = framesOf(3000, { a, loop: (ms) => Math.sin(ms / 100) });
    expect(lastMoveMs(frames, new Set(["loop"]))).toBeCloseTo(1200, 6);
    expect(lastMoveMs(frames)).toBeCloseTo(3000, 6);
  });

  it("is null when nothing moves", () => {
    expect(lastMoveMs(framesOf(500, { a: () => 4 }))).toBeNull();
  });
});
