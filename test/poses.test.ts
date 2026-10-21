import { describe, expect, it } from "vitest";
import { FRAME_MS } from "../src/gate/harness.ts";
import { explainedBy, NOTHING_EXPLAINED, type Box } from "../src/gate/objects.ts";
import { drawingsOf, excursions, heldPoses, isRest, isRestDrawing, poseLine, poses, ratioIsLook, stepMeasure, stepPops, type Drawing, type StepPop } from "../src/gate/poses.ts";
import { HOLD_MS } from "../src/gate/series.ts";
import { caseDrawings, OTHER, unitOf, VALUE, type SteppedCase } from "./stepped-cases.ts";

/** A series from [frames, value] holds. */
const held = (...holds: [number, number][]) => holds.flatMap(([n, v]) => Array<number>(n).fill(v));
const EPS = 1e-4 * 40;
const none = () => false;

describe("poses", () => {
  it("merges float noise under the tolerance into one pose", () => {
    const v = [0, 1e-7, 0, 1e-7, 0, -5, -5, -5];
    expect(poses(v, EPS)).toEqual([
      { start: 0, frames: 5, value: 0 },
      { start: 5, frames: 3, value: -5 },
    ]);
  });

  it("a rest holds at least 3 times the typical pose beside it, and 3 frames or more", () => {
    // Threes: holds of 7 and 8. An 8 among 7s is a pose, not a rest.
    const threes = poses(held([30, 0], [7, 1], [8, 2], [7, 3], [8, 4], [7, 5], [40, 6]), EPS);
    expect(threes.map((_, k) => isRest(threes, k))).toEqual([true, false, false, false, false, false, true]);
    // A 12-frame hold among 4s is a rest.
    const fours = poses(held([4, 0], [4, 1], [4, 2], [12, 3], [4, 4], [4, 5], [4, 6]), EPS);
    expect(isRest(fours, 3)).toBe(true);
    // A train of 10-frame holds has no rest.
    const train = poses(held(...Array.from({ length: 8 }, (_, k): [number, number] => [10, k % 2])), EPS);
    expect(train.some((_, k) => isRest(train, k))).toBe(false);
    // Smooth motion: a 3-frame hold among ones is a rest, a 2-frame one is not.
    const smooth = poses([0, 1, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8], EPS);
    expect(smooth.map((_, k) => isRest(smooth, k))).toEqual([false, false, false, true, false, false, false, false, false]);
  });

  it("the pose line never moves before the raw value, and reaches each drawing when the next one starts", () => {
    const v = held([20, 0], [5, 10], [5, 20], [5, 30], [20, 40]);
    const line = poseLine(v, EPS);
    // Causal: the same as raw up to and including the frame the first drawing appears.
    for (let i = 0; i <= 20; i++) expect(line[i]).toBe(0);
    // Each drawing's value at the next drawing's start, a straight line between.
    expect(line[25]).toBe(10);
    expect(line[30]).toBe(20);
    expect(line[27]).toBeCloseTo(14, 9);
    // Into the rest it glides over one pose length, then holds.
    expect(line[35]).toBe(30);
    expect(line[40]).toBe(40);
    for (let i = 40; i < v.length; i++) expect(line[i]).toBe(40);
    // Never ahead of raw, and at most one pose behind it.
    for (let i = 0; i < v.length; i++) {
      expect(line[i]!).toBeLessThanOrEqual(v[i]! + 1e-9);
      expect(line[i]!).toBeGreaterThanOrEqual(v[Math.max(0, i - 5)]! - 1e-9);
    }
  });

  it("a move from a rest straight to the next rest keeps its jump", () => {
    // A rest, a jump to the next rest, then a way back on fours.
    const v = held([30, 0], [30, 40], [4, 30], [4, 20], [4, 10], [30, 0]);
    expect(poseLine(v, EPS).slice(0, 60)).toEqual(v.slice(0, 60));
  });
});

/** Drawings of a 40 px dot from [frames, y px] holds: the box moves with y. */
const drawn = (...holds: [number, number][]): Drawing[] => {
  let start = 0;
  return holds.map(([frames, y]) => {
    const d: Drawing = { start, frames, value: y, box: [0, y, 40, 40], endBox: [0, y, 40, 40], scroll: 0, endScroll: 0, endFrame: start + frames - 1, gone: false };
    start += frames;
    return d;
  });
};

/** A case's pops as the envelope rule reads them: the value's fitted slopes, read to the case's last frame. */
const popsOf = (c: SteppedCase, skip: (frame: number) => boolean = none) => {
  const { frames, fit, drawings } = caseDrawings(c);
  return stepPops(drawings, unitOf(c), fit.slopes.get(VALUE) ?? null, skip, frames.length - 1, fit.shifted, explainedBy(frames, fit, VALUE));
};
/** A case's excursions alone (rule 3). */
const excursionsOf = (c: SteppedCase) => {
  const { frames, fit, drawings } = caseDrawings(c);
  return excursions(drawings, unitOf(c), fit.slopes.get(VALUE) ?? null, none, fit.shifted, explainedBy(frames, fit, VALUE));
};
/** Drawings each held `frames`, one per value. */
const train = (frames: number, values: number[]): [number, number][] => values.map((v) => [frames, v]);
/** [atFrame, kind, lengths, drawings] of each pop, lengths to 2 decimals. */
const brief = (pops: StepPop[]) => pops.map((p) => [p.atFrame, p.kind, Math.round(p.lengths * 100) / 100, p.drawings]);
/**
 * One lift of the 40 px dot, as an animator draws it: a rest at 0, the drawings `ys` (px, up is minus) at `rate`
 * drawings a second, a key hold on the last of them, an even way back down to 0 in as many drawings, and a rest.
 * "mixed" holds the first two and last two drawings of each way half as long again; every drawing starts on a whole
 * frame.
 */
function lift(rate: number, timing: "even" | "mixed", ys: number[]): [number, number][] {
  const h = 60 / rate;
  const rest = Math.max(40, Math.ceil(5 * h));
  const n = ys.length;
  const hold = (k: number) => (timing === "mixed" && (k < 2 || k >= n - 2) ? 1.5 : 1) * h;
  const at = (k: number) => Math.round(Array.from({ length: k }, (_, i) => hold(i)).reduce((a, b) => a + b, 0));
  const way = (vs: number[]) => vs.slice(0, -1).map((v, k): [number, number] => [at(k + 1) - at(k), v]);
  const down = ys.map((_, k) => Math.round(ys[n - 1]! * (1 - (k + 1) / n) * 1e6) / 1e6);
  return [[rest, 0], ...way(ys), [rest, ys[n - 1]!], ...way(down), [rest, 0]];
}
/** The pops of a case read with no slopes, as for a value whose box fits no coordinate: steps are read by box centres. */
const popsNoSlopes = (c: SteppedCase) => {
  const { frames, drawings } = caseDrawings(c);
  return stepPops(drawings, unitOf(c), null, none, frames.length - 1, false, NOTHING_EXPLAINED);
};

describe("stepPops", () => {
  it("a hold is shown 100 ms or more and twice as long as the drawings on each side: slow among slow holds nothing", () => {
    expect(heldPoses(drawn([5, 0], [10, 1], [5, 2], [5, 3], [5, 4], [6, 5]))).toEqual([false, true, false, false, false, false]);
    expect(heldPoses(drawn([5, 0], [10, 1], [5, 2], [6, 3], [6, 4], [6, 5]))[1]).toBe(false);
    // 1 s drawings among 1 s drawings: none is a hold. Each side is judged apart, and an empty side holds.
    expect(heldPoses(drawn([60, 0], [60, 1], [60, 2]))).toEqual([false, false, false]);
    expect(heldPoses(drawn([30, 0], [5, 1], [5, 2]))).toEqual([true, false, false]);
  });

  it("for the pop checks, a side the read cuts short of 3 drawings gives no veto, as a side with none does", () => {
    // Two 0.6 s drawings at the read's start: the second has only the first on its left. The overshoot rule's holds
    // (the default) keep that side; the pop checks' holds (cutSides) do not, so both drawings are holds.
    const start = drawn([36, 0], [36, 1], [5, 2], [5, 3], [5, 4]);
    expect(heldPoses(start)).toEqual([true, false, false, false, false]);
    expect(heldPoses(start, true)).toEqual([true, true, false, false, false]);
    // The read's end cuts the right side short in the same way.
    expect(heldPoses(drawn([5, 0], [5, 1], [5, 2], [36, 3], [36, 4]), true)).toEqual([false, false, false, true, true]);
  });

  it("a pose pop of 0.8 lengths between two 0.6 s holds passes at the read's start, as it does in every later period", () => {
    const period: [number, number][] = [[36, 0], [36, 32], ...train(5, [28, 20, 12, 4])];
    expect(popsOf({ drawings: [...period, ...period, [36, 0]] })).toEqual([]);
  });

  it("a release out of the second of two holds at the read's start is timed on its own drawing: a spike", () => {
    // 28 px out of the hold, then 6 px: 4.67 times. Timed over the hold's 600 ms, it would be slow and pass.
    expect(popsOf({ drawings: [[36, 0], [36, 32], ...train(5, [60, 66, 70, 72]), [36, 74]] })).toEqual([{ atFrame: 72, kind: "spike", lengths: expect.closeTo(0.7, 6), ratio: expect.closeTo(28 / 6, 6), drawings: 1 }]);
  });

  it("a spike: one step far faster than the moving steps just outside it", () => {
    expect(popsOf({ drawings: train(5, [0, 4, 8, 12, 52, 56, 60, 64]) })).toEqual([{ atFrame: 20, kind: "spike", lengths: expect.closeTo(1, 6), ratio: expect.closeTo(10, 6), drawings: 1 }]);
  });

  it("runs: two big steps in a row cannot shield each other; runs stop at 3 steps", () => {
    // Two 4-length steps among creeps of 0.05 lengths: one run of 2, 8 lengths in all, each step 80 times the creeps.
    expect(popsOf({ drawings: train(5, [0, 2, 4, 6, 166, 326, 328, 330, 332]) })).toEqual([{ atFrame: 20, kind: "spike", lengths: expect.closeTo(8, 6), ratio: expect.closeTo(80, 6), drawings: 2 }]);
    // Three in a row are still one run. (The dot starts near the top, so it stays inside the viewport.)
    expect(brief(popsOf({ drawings: train(5, [0, 2, 4, 6, 166, 326, 486, 488, 490, 492]), at: [640, 40] }))).toEqual([[20, "spike", 12, 3]]);
    // Four in a row are a move, not a pop.
    const four: SteppedCase = { drawings: train(5, [0, 2, 4, 6, 166, 326, 486, 646, 648, 650, 652]), at: [640, 40] };
    expect(caseDrawings(four).drawings.some((d) => d.gone)).toBe(false);
    expect(popsOf(four)).toEqual([]);
  });

  it("out of a hold, a step is judged against the moving step on its other side, on its own drawing's time", () => {
    // After a rest: 28 px then 6 px on 5-frame drawings is 4.67 times as fast, a spike. 18 px then 6 px is 3, not more.
    expect(popsOf({ drawings: [[30, 0], [5, 28], [5, 34], [5, 38], [30, 40]] })).toEqual([{ atFrame: 30, kind: "spike", lengths: expect.closeTo(0.7, 6), ratio: expect.closeTo(28 / 6, 6), drawings: 1 }]);
    expect(popsOf({ drawings: [[30, 0], [5, 18], [5, 24], [5, 28], [30, 30]] })).toEqual([]);
  });

  it("a moving hold that creeps 1 px a drawing is nothing", () => {
    expect(popsOf({ drawings: [[30, 0], ...train(16, [1, 2, 3, 4, 5, 6, 7, 8]), [30, 0]] })).toEqual([]);
  });

  it("teleport between rests: a step over one length between two drawings each shown 250 ms or more", () => {
    // Equal 0.5 s drawings, each 1.5 lengths on: every step is a teleport.
    expect(popsOf({ drawings: train(30, [0, 60, 120, 180]) })).toEqual([30, 60, 90].map((atFrame) => ({ atFrame, kind: "teleport", lengths: expect.closeTo(1.5, 6), ratio: 0, drawings: 1 })));
    // The same steps on 8-frame (133 ms) drawings: no rests, and the spike sees an even train.
    expect(popsOf({ drawings: train(8, [0, 60, 120, 180]) })).toEqual([]);
    // Under the line: 0.8 lengths between rests.
    expect(popsOf({ drawings: train(30, [0, 32, 64, 96]) })).toEqual([]);
  });

  it("teleport through brief in-betweens: rest to rest through one or two drawings shown under 100 ms, judged by its largest step", () => {
    expect(popsOf({ drawings: [[30, 0], [1, 100], [30, 200]] })).toEqual([{ atFrame: 30, kind: "teleport", lengths: expect.closeTo(2.5, 6), ratio: 0, drawings: 1 }]);
    expect(brief(popsOf({ drawings: [[30, 0], [3, 20], [3, 80], [30, 100]] }))).toEqual([[33, "teleport", 1.5, 1]]);
    // Three in-betweens are a move: the spike judges it, and an even move passes.
    expect(popsOf({ drawings: [[30, 0], [3, 60], [3, 120], [3, 180], [30, 240]] })).toEqual([]);
  });

  it("through brief in-betweens, a size part is judged by its net change from rest to rest, a position part by its largest step", () => {
    // A smear: a 40 px wide dot drawn 440 px wide for 2 frames between two 0.9 s holds, twice. It ends the size it
    // started, so it passes, though its steps are 10 lengths each.
    const smear: SteppedCase = { drawings: [[54, 40], [2, 440], [54, 40], [2, 440], [54, 40]], slopes: { cx: 0, cy: 0, w: 1, h: 0 } };
    expect(caseDrawings(smear).fit.slopes.get(VALUE)).not.toBeNull();
    expect(popsOf(smear)).toEqual([]);
    // A size snap from 40 to 400 px through one 2-frame drawing of 220 px: 9 lengths net, reported at its first step.
    expect(popsOf({ drawings: [[30, 40], [2, 220], [30, 400]], slopes: { cx: 0, cy: 0, w: 1, h: 1 } })).toEqual([{ atFrame: 30, kind: "teleport", lengths: expect.closeTo(9, 6), ratio: 0, drawings: 1 }]);
    // A position part keeps its largest step: rest, a 2-frame drawing 10 lengths away, and back to the rest it left.
    expect(brief(popsOf({ drawings: [[54, 0], [2, 400], [54, 0]], at: [640, 40] }))).toEqual([[54, "teleport", 10, 1]]);
  });

  it("excursion: one brief drawing off a path and back, with the path going on the same way after it", () => {
    // A 4-frame train creeping 2 px a drawing; one drawing 24 px (0.6 lengths) off it and back: a short excursion,
    // reported as a spike of 2 drawings, its length the step out (26 px).
    const knock = (off: number): SteppedCase => ({ drawings: train(4, [0, 2, 4, 6, 8, 10, 12 + off, 14, 16, 18, 20, 22]) });
    expect(popsOf(knock(24))).toEqual([{ atFrame: 24, kind: "spike", lengths: expect.closeTo(0.65, 6), ratio: expect.closeTo(11, 6), drawings: 2 }]);
    // 60 px off: longer than the object, a teleport out and back.
    expect(brief(popsOf(knock(60)))).toEqual([[24, "outAndBack", 1.55, 2]]);
    // excursions alone finds both.
    expect(brief(excursionsOf(knock(24)))).toEqual([[24, "spike", 0.65, 2]]);
    expect(brief(excursionsOf(knock(60)))).toEqual([[24, "outAndBack", 1.55, 2]]);
  });

  it("a turn and an alternation are no excursion: a bounce, a shake, a yo-yo, a walk's turnaround", () => {
    // A bounce: down, a 2-frame contact, up the same way.
    expect(popsOf({ drawings: [[30, 0], ...train(5, [10, 25, 45, 70]), [2, 100], ...train(5, [70, 45, 25, 10]), [30, 0]] })).toEqual([]);
    // A shake of ±0.3 lengths on 4-frame drawings.
    expect(popsOf({ drawings: [[30, 0], ...train(4, [12, -12, 12, -12, 12, -12, 12, -12]), [30, 0]] })).toEqual([]);
    // A walk on 5-frame drawings that turns round at 80 px and at 0, three times.
    const pingPong = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 72, 64, 56, 48, 40, 32, 24, 16, 8];
    expect(popsOf({ drawings: train(5, [...pingPong, ...pingPong, ...pingPong, 0]) })).toEqual([]);
  });

  it("a yo-yo held 0.2 s at the bottom is no excursion; held 67 ms, it is a teleport through a brief in-between", () => {
    expect(popsOf({ drawings: [[30, 0], [12, 60], [30, 0]] })).toEqual([]);
    expect(brief(popsOf({ drawings: [[30, 0], [4, 60], [30, 0]] }))).toEqual([[30, "teleport", 1.5, 1]]);
  });

  it("a triangle through a 33 ms middle drawing, 5 lengths each way, is a teleport through a brief in-between", () => {
    expect(brief(popsOf({ drawings: [[30, 0], [2, 200], [30, 0]] }))).toEqual([[30, "teleport", 5, 1]]);
  });

  it("size parts get the teleport line only: a squash or a smear passes, a snap between rests fails", () => {
    // A contact squash: w 40 to 52 and back in one twos drawing.
    expect(popsOf({ drawings: [[30, 1], [5, 1.3], [30, 1]], unit: "scale", slopes: { w: 40, h: 0 } })).toEqual([]);
    // A smear among moving drawings: one twos drawing 76 px wider (1.7 lengths), then back.
    expect(popsOf({ drawings: train(5, [1, 1.05, 1.1, 3, 1.15, 1.2, 1.25]), unit: "scale", slopes: { w: 40, h: 0 } })).toEqual([]);
    // A 40 px dot that snaps to 400 px between rests: 9 lengths of the smaller box.
    expect(popsOf({ drawings: [[30, 1], [30, 10]], unit: "scale" })).toEqual([{ atFrame: 30, kind: "teleport", lengths: expect.closeTo(9, 6), ratio: 0, drawings: 1 }]);
  });

  it("with no slopes, a step is the box's change less what the fitted values beside it explain", () => {
    // y falls on 5-frame drawings and lands 60 px down at frame 45. w and h move together, so neither has slopes; they
    // squash the dot to 50 by 30 for one drawing as it lands. What w does there is a 10 px size change (0.25 lengths),
    // not y's 60 px fall (1.2 lengths of the 50 px box), so rest to rest through the contact drawing passes.
    const y: [number, number][] = [[25, 0], [5, 10], [5, 25], [5, 45], [5, 70], [45, 130]];
    const squash = (w: [number, number][], h: [number, number][]): SteppedCase => ({ drawings: w, slopes: { cx: 0, cy: 0, w: 1, h: 0 }, more: [{ holds: h, slopes: { h: 1 } }, { holds: y, slopes: { cy: 1 } }], at: [640, 100] });
    const contact = squash([[45, 40], [5, 50], [40, 40]], [[45, 40], [5, 30], [40, 40]]);
    const { fit } = caseDrawings(contact);
    expect(fit.slopes.get(VALUE)).toBeNull();
    expect(measured(contact).map((m) => [m.position, m.size])).toEqual([[expect.closeTo(0, 9), expect.closeTo(0.25, 9)], [expect.closeTo(0, 9), expect.closeTo(0.25, 9)]]);
    expect(popsOf(contact)).toEqual([]);
    // The same w and h snapping from 40 to 400 px as y lands: still 9 lengths between two rests.
    expect(brief(popsOf(squash([[45, 40], [45, 400]], [[45, 40], [45, 400]])))).toEqual([[45, "teleport", 9, 1]]);
  });

  it("look values get the spike only: a blink passes, a fade with one drawing dropped early and back fails", () => {
    // opacity 1 to 0 to 1 on 0.5 s drawings: 4 lengths between rests, but a look value has no teleport line.
    expect(popsOf({ drawings: [[30, 1], [30, 0], [30, 1]], unit: "opacity" })).toEqual([]);
    expect(popsOf({ drawings: [[5, 0.95], [60, 1], [60, 0.2], [5, 0.15]], unit: "opacity" })).toEqual([]);
    // A fade on twos, 0.05 a drawing, with one drawing dropped to 0.2 early: a run of 2, 5.4 lengths, 13 times the fade.
    expect(popsOf({ drawings: train(5, [1, 0.95, 0.9, 0.2, 0.85, 0.8, 0.75, 0.7]), unit: "opacity" })).toEqual([{ atFrame: 15, kind: "spike", lengths: expect.closeTo(5.4, 6), ratio: expect.closeTo(13, 6), drawings: 2 }]);
    // An index never pops.
    expect(popsOf({ drawings: train(5, [0, 1, 2, 9, 3, 4]), unit: "index" })).toEqual([]);
  });

  it("a blink to a gone box is nothing: a short one is bridged, a long one skipped", () => {
    expect(popsOf({ drawings: [[30, 1], [4, 0], [30, 1]], unit: "scale", gone: [30, 31, 32, 33] })).toEqual([]);
    expect(popsOf({ drawings: [[30, 1], [10, 0], [30, 1]], unit: "scale", gone: Array.from({ length: 10 }, (_, k) => 30 + k) })).toEqual([]);
  });

  it("gone gaps: a 1-frame gap between rests is bridged; a wrap off the edge passes; a wrap inside the view fails", () => {
    // A dot blanked one frame and back 400 px (10 lengths) away.
    expect(popsOf({ drawings: [[20, 0], [21, 400]], gone: [20], at: [640, 100] })).toEqual([{ atFrame: 21, kind: "teleport", lengths: expect.closeTo(10, 6), ratio: 0, drawings: 1 }]);
    // A walker 20 px a drawing reaches past the right edge, is clipped 2 frames, and comes back in at the left edge.
    const off = [0, 20, 40, 60, 80, 100];
    const wrap: SteppedCase = { drawings: [...train(10, off), [2, 120], ...train(10, [-1150, -1130, -1110, -1090])], slopes: { cx: 1, cy: 0 }, at: [1170, 360], gone: [60, 61] };
    expect(caseDrawings(wrap).drawings.map((d) => d.gone)).toEqual([false, false, false, false, false, false, true, false, false, false, false]);
    expect(popsOf(wrap)).toEqual([]);
    // The same walk wrapping 400 px inside the viewport, with no gone frames and no cut.
    expect(popsOf({ drawings: train(5, [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, -200, -180, -160, -140, -120]) })).toEqual([{ atFrame: 55, kind: "spike", lengths: expect.closeTo(10, 6), ratio: expect.closeTo(20, 6), drawings: 1 }]);
  });

  it("a step into or out of a gone run of HOLD_MS or more is skipped, and is no neighbour", () => {
    const frames = Math.ceil(HOLD_MS / FRAME_MS);
    const gone = (from: number) => Array.from({ length: frames }, (_, k) => from + k);
    expect(popsOf({ drawings: [[20, 0], [frames, 200], [20, 400]], gone: gone(20), at: [640, 100] })).toEqual([]);
    // 0.75 lengths out of a rest, then the dot is gone: there is no moving step to compare it with.
    expect(popsOf({ drawings: [[30, 0], [5, 30], [frames, 60], [30, 90]], gone: gone(35) })).toEqual([]);
  });

  it("a drawing wholly off the viewport is gone by Drawing.gone, though its box is not 1 by 1: its steps are skipped", () => {
    // 0.3 lengths out of a rest, then one 8-frame drawing 600 px up, wholly above the viewport, then twos on. The step
    // out of the rest has no moving step to compare with: the one after it goes into a gone drawing.
    const off: SteppedCase = { drawings: [[30, 0], [5, 12], [8, -600], ...train(5, [24, 36, 48])] };
    const { drawings } = caseDrawings(off);
    expect(drawings.map((d) => d.gone)).toEqual([false, false, true, false, false, false]);
    expect(drawings[2]!.box![2]).toBe(40);
    expect(popsOf(off)).toEqual([]);
  });

  it("a run that goes out and comes back may sit next to a hold: one drawing the wrong way, back, then the key hold", () => {
    // Six drawings lifting 60 px; drawing 4 is set 1.5 lengths the wrong way (+60) and drawing 5 brings it back, into
    // the key hold. The run of 2 is judged against the moving step before it alone: 90 and 110 px against 10 px.
    const wrongWay = [-10, -20, -30, 60, -50, -60];
    for (const rate of [6, 20, 30]) {
      const h = 60 / rate;
      const rest = Math.max(40, Math.ceil(5 * h));
      expect(popsOf({ drawings: lift(rate, "even", wrongWay) })).toEqual([{ atFrame: rest + 3 * h, kind: "spike", lengths: expect.closeTo(5, 6), ratio: expect.closeTo(9, 6), drawings: 2 }]);
    }
    // Mixed holds at 20 drawings a second: 5 and 4 frames on the first two, 3 on the run.
    expect(brief(popsOf({ drawings: lift(20, "mixed", wrongWay) }))).toEqual([[52, "spike", 5, 2]]);
  });

  it("a slow-in into a key hold passes: its two big last drawings do not go out and back", () => {
    // Each drawing covers half of what is left, the last two 15 and 30 px, on mixed holds.
    for (const rate of [8, 24]) expect(popsOf({ drawings: lift(rate, "mixed", [-1.875, -3.75, -7.5, -15, -30, -60]) })).toEqual([]);
  });

  it("with no slopes, the way back is read by box centres", () => {
    // The wrong-way lift on a dot whose y and x move together, so neither value's slopes can be told.
    const ys = [-10, -20, -30, 60, -50, -60];
    const twin: SteppedCase = { drawings: lift(20, "even", ys), other: lift(20, "even", ys) };
    const { fit } = caseDrawings(twin);
    expect(fit.slopes.get(VALUE)).toBeNull();
    expect(brief(popsOf(twin))).toEqual([[49, "spike", 7.07, 2]]);
    // x leaves the box beside y: y stops 50 px short of where it left, but the box comes back within half its way.
    const boxBack: SteppedCase = { drawings: lift(20, "even", [-10, -20, -30, 60, 20, -60]), other: lift(20, "even", [-10, -20, -30, 60, -50, -60]) };
    expect(brief(popsNoSlopes(boxBack))).toEqual([[49, "spike", 6.11, 2]]);
    // y comes back, but x stays out: the box does not come back, so the run needs moving steps on both sides.
    const boxOut: SteppedCase = { drawings: lift(20, "even", [-10, -20, -30, 60, -50, -60]), other: lift(20, "even", [-10, -20, -30, 60, 60, -60]) };
    expect(popsNoSlopes(boxOut)).toEqual([]);
  });

  it("a look value's run always needs moving steps on both sides: going out and back next to a hold is a position run's exception", () => {
    // A fade with one drawing dropped and back just before a hold, on a dot another value slides 3 px a frame (the
    // fade has slopes, of about 0) and on a still dot (no slopes).
    const fade: [number, number][] = [...train(5, [1, 0.95, 0.9, 0.2, 0.85]), [30, 0.8]];
    const sliding: SteppedCase = { drawings: fade, unit: "opacity", other: Array.from({ length: 55 }, (_, i): [number, number] => [1, 3 * i]), at: [400, 360] };
    expect(caseDrawings(sliding).fit.slopes.get(VALUE)).not.toBeNull();
    expect(popsOf(sliding)).toEqual([]);
    const still: SteppedCase = { drawings: fade, unit: "opacity" };
    expect(caseDrawings(still).fit.slopes.get(VALUE)).toBeNull();
    expect(popsOf(still)).toEqual([]);
    // The same drop and back as a position run, 0.9 px for each 0.01 of the fade: a spike of 2 drawings.
    expect(brief(popsOf({ drawings: [...train(5, [0, -4.5, -9, -72, -13.5]), [30, -18]] }))).toEqual([[15, "spike", 3.04, 2]]);
  });

  it("the way back is half the way or more: exactly half comes back, just under does not", () => {
    // An excursion on a fours train: 60 px out, then 30 px back (half) or 29.6 px back (just under).
    const knock = (back: number): SteppedCase => ({ drawings: train(4, [0, 2, 4, 6, 8, 10, 70, back, 42, 44, 46, 48]) });
    expect(brief(excursionsOf(knock(40)))).toEqual([[24, "outAndBack", 1.5, 2]]);
    expect(excursionsOf(knock(40.4))).toEqual([]);
    // A wrong-way run into a key hold: 90 px out, then 45 px back (half) or 44 px back (just under).
    expect(popsOf({ drawings: lift(20, "even", [-10, -20, -30, 60, 15, -60]) })).toEqual([{ atFrame: 49, kind: "spike", lengths: expect.closeTo(3.375, 6), ratio: expect.closeTo(4.5, 6), drawings: 2 }]);
    expect(popsOf({ drawings: lift(20, "even", [-10, -20, -30, 60, 16, -60]) })).toEqual([]);
  });

  it("a stepped loop's last-to-first step is judged like any other", () => {
    // A walker that jumps from 80 px back to 0 each loop with no cut: 2 lengths, 10 times its steps.
    const walk = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80];
    expect(brief(popsOf({ drawings: train(5, [...walk, ...walk, ...walk]) }))).toEqual([
      [55, "spike", 2, 1],
      [110, "spike", 2, 1],
    ]);
  });

  it("a step whose new drawing starts at a frame skip names is not judged, and is no neighbour", () => {
    const c: SteppedCase = { drawings: train(5, [0, 4, 8, 12, 52, 56, 60, 64]) };
    expect(popsOf(c, (f) => f === 20)).toEqual([]);
    // Two 1-length steps in a row are a run of 2; with the second skipped, the first is a spike of its own.
    const two: SteppedCase = { drawings: train(5, [0, 4, 8, 48, 88, 92, 96, 100]) };
    expect(brief(popsOf(two))).toEqual([[15, "spike", 2, 2]]);
    expect(popsOf(two, (f) => f === 20)).toEqual([{ atFrame: 15, kind: "spike", lengths: expect.closeTo(1, 6), ratio: expect.closeTo(10, 6), drawings: 1 }]);
  });
});

/** [start, frames, value, gone] of each drawing. */
const shape = (ds: Drawing[]) => ds.map((d) => [d.start, d.frames, d.value, d.gone]);
/** The steps of a case, each measured across its boundary frame with the value's fitted slopes. */
const measured = (c: SteppedCase, heldBefore = false) => {
  const { frames, fit, drawings: ds } = caseDrawings(c);
  const slopes = fit.slopes.get(VALUE) ?? null;
  const explained = explainedBy(frames, fit, VALUE);
  const ratioLook = ratioIsLook(ds, slopes, fit.shifted, explained);
  return ds.slice(1).map((b, j) => stepMeasure(ds[j]!, b, unitOf(c), slopes, { shifted: fit.shifted, heldBefore, ratioLook, explained: explained(ds[j]!.endFrame, b.start) }));
};

describe("drawingsOf", () => {
  it("a value's drawings, each with its object's box and the scroll in its first and last frames", () => {
    const at = (ms: number, y: number) => ({ ms, values: { y }, boxes: { dot: [0, y, 40, 40] as Box }, scroll: ms * 10 });
    expect(drawingsOf([at(0, 0), at(1, 0), at(2, 5)], "y", "dot", EPS, { width: 1280, height: 720 }, true)).toEqual([
      { start: 0, frames: 2, value: 0, box: [0, 0, 40, 40], endBox: [0, 0, 40, 40], scroll: 0, endScroll: 10, endFrame: 1, gone: false },
      { start: 2, frames: 1, value: 5, box: [0, 5, 40, 40], endBox: [0, 5, 40, 40], scroll: 20, endScroll: 20, endFrame: 2, gone: false },
    ]);
    // Off a scroll page, the scroll reads 0.
    expect(drawingsOf([at(0, 0), at(1, 0)], "y", "dot", EPS, { width: 1280, height: 720 }, false)[0]!.endScroll).toBe(0);
    expect(drawingsOf([at(0, 0)], "y", null, EPS, { width: 1280, height: 720 }, false)[0]).toMatchObject({ box: null, endBox: null, gone: false });
  });

  it("a gone gap shorter than HOLD_MS is bridged: its frames join the drawing before, and the step is one, from the last drawn box", () => {
    // A dot blanked one frame and back 400 px (10 lengths) away.
    const blanked: SteppedCase = { drawings: [[20, 0], [21, 400]], gone: [20], at: [640, 100] };
    const { drawings } = caseDrawings(blanked);
    expect(shape(drawings)).toEqual([
      [0, 21, 0, false],
      [21, 20, 400, false],
    ]);
    expect(drawings[0]!.endBox).toEqual([620, 80, 40, 40]);
    expect(measured(blanked)[0]!.position).toBeCloseTo(10, 9);
    // A blank inside one drawing leaves it whole: the drawings on each side merge.
    expect(shape(caseDrawings({ drawings: [[20, 0]], gone: [10] }).drawings)).toEqual([[0, 20, 0, false]]);
    // Five gone frames (83 ms) are bridged too.
    expect(shape(caseDrawings({ drawings: [[30, 0]], gone: [10, 11, 12, 13, 14] }).drawings)).toEqual([[0, 30, 0, false]]);
  });

  it("a gone gap whose box leaves through the viewport's edge stays split: a wrap off screen is honest", () => {
    // A dot stepping right by 20 px reaches past the right edge, is clipped 2 frames, and comes back in at the left edge.
    const wrap: SteppedCase = { drawings: [[10, 0], [10, 20], [2, 40], [10, -1240]], slopes: { cx: 1, cy: 0 }, at: [1250, 360], gone: [20, 21] };
    expect(shape(caseDrawings(wrap).drawings)).toEqual([
      [0, 10, 0, false],
      [10, 10, 20, false],
      [20, 2, 40, true],
      [22, 10, -1240, false],
    ]);
  });

  it("a gone run of HOLD_MS or more is a gone drawing", () => {
    const frames = Math.ceil(HOLD_MS / FRAME_MS);
    const gone = Array.from({ length: frames }, (_, k) => 20 + k);
    expect(shape(caseDrawings({ drawings: [[20 + frames, 0], [20, 80]], gone }).drawings)).toEqual([
      [0, 20, 0, false],
      [20, frames, 0, true],
      [20 + frames, 20, 80, false],
    ]);
  });

  it("a box wholly outside the viewport is gone", () => {
    const { drawings } = caseDrawings({ drawings: [[20, 0], [20, -400], [20, 0]], at: [640, 360], viewport: [1280, 720] });
    expect(drawings.map((d) => d.gone)).toEqual([false, true, false]);
  });
});

describe("stepMeasure", () => {
  it("a facing flip on a walker measures position 0", () => {
    // A patrol: 5 px a frame, turning every 20 frames. The facing (scaleX ±1) flips the sprite but not its box.
    const x = (i: number) => (i % 40 < 20 ? 5 * (i % 40) : 5 * (40 - (i % 40)));
    const walker: SteppedCase = {
      drawings: Array.from({ length: 6 }, (_, k): [number, number] => [20, k % 2 ? -1 : 1]),
      unit: "scale",
      slopes: { w: 0, h: 0 },
      other: Array.from({ length: 120 }, (_, i): [number, number] => [1, x(i)]),
    };
    const steps = measured(walker);
    expect(steps).toHaveLength(5);
    for (const m of steps) {
      expect(m.position).toBeCloseTo(0, 6);
      expect(m.size).toBeCloseTo(0, 6);
    }
  });

  it("a stepped y on a swaying object measures only y", () => {
    // y steps 8 px every 10 frames; x sways 30 px each way over a second, moving the box every frame.
    const sway: SteppedCase = {
      drawings: Array.from({ length: 12 }, (_, k): [number, number] => [10, 8 * k]),
      other: Array.from({ length: 120 }, (_, i): [number, number] => [1, 30 * Math.sin((2 * Math.PI * i) / 60)]),
      at: [640, 200],
    };
    const steps = measured(sway);
    expect(steps).toHaveLength(11);
    for (const m of steps) expect(m.position).toBeCloseTo(0.2, 6);
  });

  it("a 40 px dot that snaps to 400 px and back measures size 9, by the smaller box", () => {
    const steps = measured({ drawings: [[30, 1], [30, 10], [30, 1], [30, 10]], unit: "scale" });
    for (const m of steps) {
      expect(m.size).toBeCloseTo(9, 6);
      expect(m.position).toBeCloseTo(0, 6);
      expect(m.look).toBe(0);
    }
  });

  it("a value whose box fits no coordinate is measured by the box's change across the boundary frame", () => {
    // One snap only: too few changes to fit, so the boxes in the last frame before and the first frame after are read.
    const [m] = measured({ drawings: [[30, 1], [30, 10]], unit: "scale" });
    expect(m!.size).toBeCloseTo(9, 9);
  });

  it("deg 330 to 0 measures look 2 (30° over 15°), wrapped to the shortest turn; an index measures 0", () => {
    expect(measured({ drawings: [[30, 330], [30, 0]], unit: "deg" })[0]).toMatchObject({ position: 0, size: 0, look: expect.closeTo(2, 9) });
    expect(measured({ drawings: [[30, 0], [30, 7]], unit: "index" })[0]).toEqual({ position: 0, size: 0, look: 0, speedPos: 0, speedLook: 0 });
  });

  it("opacity is a look value; a ratio that leaves the box unchanged is a look value, and one that moves it is measured by box parts", () => {
    expect(measured({ drawings: [[30, 1], [30, 0.5]], unit: "opacity" })[0]).toMatchObject({ position: 0, size: 0, look: expect.closeTo(2, 9) });
    expect(measured({ drawings: [[30, 0.5], [30, 1]], unit: "ratio" })[0]).toMatchObject({ position: 0, size: 0, look: expect.closeTo(2, 9) });
    // A bar whose width is 80 px per unit of the ratio: 40 px to 80 px is 1 length of the smaller box.
    for (const m of measured({ drawings: [[30, 0.5], [30, 1], [30, 0.5], [30, 1]], unit: "ratio", slopes: { w: 80 } })) {
      expect(m.size).toBeCloseTo(1, 6);
      expect(m.look).toBe(0);
    }
  });

  it("a stepped ratio on a box a smooth x moves is a look value, though the fit gives it slopes of about 0", () => {
    // A fill mix stepping between 0.5 and 1 on a card that slides 3 px a frame: the ratio never changes the box.
    const mix: SteppedCase = {
      drawings: Array.from({ length: 6 }, (_, k): [number, number] => [10, k % 2 ? 1 : 0.5]),
      unit: "ratio",
      other: Array.from({ length: 60 }, (_, i): [number, number] => [1, 3 * i]),
      at: [400, 360],
    };
    const { frames, fit, drawings } = caseDrawings(mix);
    expect(fit.slopes.get(VALUE)).not.toBeNull();
    expect(ratioIsLook(drawings, fit.slopes.get(VALUE) ?? null, fit.shifted, explainedBy(frames, fit, VALUE))).toBe(true);
    const steps = measured(mix);
    expect(steps).toHaveLength(5);
    for (const m of steps) expect(m).toMatchObject({ position: 0, size: 0, look: expect.closeTo(2, 9) });
  });

  it("a ratio that scales its box takes box parts on every step of the run", () => {
    const bar: SteppedCase = { drawings: [[30, 0.5], [30, 1], [30, 0.5], [30, 1]], unit: "ratio", slopes: { w: 80 }, other: [[60, 0], ...Array.from({ length: 60 }, (_, i): [number, number] => [1, 2 * i])] };
    const { frames, fit, drawings } = caseDrawings(bar);
    expect(ratioIsLook(drawings, fit.slopes.get(VALUE) ?? null, fit.shifted, explainedBy(frames, fit, VALUE))).toBe(false);
    for (const m of measured(bar)) {
      expect(m.size).toBeCloseTo(1, 6);
      expect(m.look).toBe(0);
    }
  });

  it("a ratio with no slopes is classed once for the run: a box change at one step makes every step box parts", () => {
    // Two changes, too few to fit. Across the first boundary the box is still; across the second, another value with
    // too few changes to fit moves it 3 px. Both steps take box parts, so the run is never measured in two units.
    const c: SteppedCase = { drawings: [[20, 0.5], [20, 1], [20, 0.5]], unit: "ratio", other: [[40, 0], [20, 3]] };
    const { frames, fit, drawings } = caseDrawings(c);
    expect([fit.slopes.get(VALUE), fit.slopes.get(OTHER)]).toEqual([null, null]);
    expect(ratioIsLook(drawings, null, fit.shifted, explainedBy(frames, fit, VALUE))).toBe(false);
    const steps = measured(c);
    expect(steps.map((m) => m.look)).toEqual([0, 0]);
    expect(steps.map((m) => m.position)).toEqual([0, expect.closeTo(3 / 40, 9)]);
    // When that other value has slopes (it slides the box 3 px a frame), it explains the box change, so the ratio
    // leaves its box as it is: a look value on every step.
    const slid: SteppedCase = { ...c, other: [[30, 0], ...Array.from({ length: 30 }, (_, i): [number, number] => [1, 3 * (i + 1)])] };
    const s = caseDrawings(slid);
    expect([s.fit.slopes.get(VALUE), s.fit.slopes.get(OTHER)]).toEqual([null, expect.objectContaining({ cx: expect.closeTo(1, 6) })]);
    expect(ratioIsLook(s.drawings, null, s.fit.shifted, explainedBy(s.frames, s.fit, VALUE))).toBe(true);
    expect(ratioIsLook(s.drawings, null, s.fit.shifted, NOTHING_EXPLAINED)).toBe(false);
    expect(measured(slid).map((m) => m.look)).toEqual([expect.closeTo(2, 9), expect.closeTo(2, 9)]);
    // With the box still at every boundary, every step is a look value.
    expect(measured({ drawings: [[20, 0.5], [20, 1], [20, 0.5]], unit: "ratio" }).map((m) => m.look)).toEqual([expect.closeTo(2, 9), expect.closeTo(2, 9)]);
  });

  it("the pop checks class a ratio with no slopes by its own box change: a fitted x's slide leaves a fill flash a look value", () => {
    // A fill mix with two changes, too few to fit: a small step, then a jump of 0.48 into a hold, on a card that a
    // fitted x slides 3 px a frame across both boundaries. Less the slide, the box is still, so the mix is a look value
    // and its jump is a spike against the small step before it. Read as box-moving, its box parts (less the slide)
    // would be 0, and it would never pop.
    const slide = Array.from({ length: 60 }, (_, i): [number, number] => [1, 3 * (i + 1)]);
    const flash: SteppedCase = { drawings: [[3, 0.5], [3, 0.52], [30, 1]], unit: "ratio", other: slide };
    const { fit } = caseDrawings(flash);
    expect([fit.slopes.get(VALUE), fit.slopes.get(OTHER)]).toEqual([null, expect.objectContaining({ cx: expect.closeTo(1, 6) })]);
    const spike = [{ atFrame: 6, kind: "spike", lengths: expect.closeTo(1.92, 6), ratio: expect.closeTo(24, 6), drawings: 1 }];
    expect(popsOf(flash)).toEqual(spike);
    // The same flash on a still card: the slide changes nothing.
    expect(popsOf({ drawings: flash.drawings, unit: "ratio" })).toEqual(spike);
  });

  it("speed: a part over how long the drawing before was shown, or the drawing after when the one before is a hold", () => {
    const c: SteppedCase = { drawings: [[10, 0], [5, 8], [5, 16], [5, 24]] };
    const [first] = measured(c);
    expect(first!.speedPos).toBeCloseTo(8 / (10 * FRAME_MS), 6);
    expect(measured(c, true)[0]!.speedPos).toBeCloseTo(8 / (5 * FRAME_MS), 6);
    const [look] = measured({ drawings: [[10, 1], [5, 0.5]], unit: "opacity" });
    expect(look!.speedLook).toBeCloseTo(0.5 / (10 * FRAME_MS), 9);
  });

  it("a step into or out of a gone drawing measures 0", () => {
    const frames = Math.ceil(HOLD_MS / FRAME_MS);
    const gone = Array.from({ length: frames }, (_, k) => 20 + k);
    const steps = measured({ drawings: [[20, 0], [frames, 200], [20, 400]], gone, at: [640, 100] });
    expect(steps.map((m) => [m.position, m.size, m.look])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});

describe("isRestDrawing", () => {
  it("a drawing shown 250 ms or more, the first of the read, or one that holds to the end of the read, is a rest; 8 frames (133 ms) is not", () => {
    const { frames, drawings: ds } = caseDrawings({ drawings: [[8, 0], [15, 8], [8, 16], [10, 24]] });
    const last = frames.length - 1;
    // The page opens on the first drawing, so a jump out of it leaves a rest.
    expect(ds.map((_, i) => isRestDrawing(ds, i, last))).toEqual([true, true, false, true]);
    // Read further than the frames reach, the last drawing no longer holds to the end.
    expect(isRestDrawing(ds, 3, last + 60)).toBe(false);
  });
});
