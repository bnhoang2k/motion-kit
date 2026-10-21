import { describe, expect, it } from "vitest";
import { FRAME_MS, type Frame, type InputSamples } from "../src/gate/harness.ts";
import { fittedGains, leadNames, pressesOf, quantum, rawWindowEnd, restGains, stepLeads, type Gain, type Lead } from "../src/gate/leads.ts";
import type { ObjectRecord } from "../src/gate/objects.ts";
import { drawingsOf } from "../src/gate/poses.ts";
import { inputWindow } from "../src/gate/kind-gate.ts";
import { HOLD_MS, series, stillTol } from "../src/gate/series.ts";
import { OBJECT, seriesOf, VALUE } from "./stepped-cases.ts";

/**
 * The input-window checks (leads.ts `stepLeads`) on pure frame series: a stepped value drawn per frame (seriesOf, one
 * object `dot` it moves) and an input track, one sample per frame. Live cases are horizontal sliders: the value is the
 * dot's centre x in px, and the pointer drags along x at y = ROW. Scroll cases are flipbooks the scroll position drives.
 */

const ROW = 360;
const VIEW = { width: 1280, height: 720 };
/** The frames before the input's first sample: the value rests there. */
const LEAD_IN = 30;
/** The frames after the input's last sample. */
const TAIL = 40;

/** Per-frame values as holds ([frames, value] runs), as SteppedCase `drawings` takes them. */
function holdsOf(vs: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of vs) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

/**
 * A slider: `value(i)` is the stepped value in frame i (the dot's centre x, a `sizePx` dot), and the pointer is down at
 * `hand[k]` px in frame LEAD_IN + k. Before the first sample the value is `value(i)` too (the caller keeps it at rest).
 * A unit other than px leaves the box where it is.
 */
function slider(hand: number[], value: (i: number) => number, opts: { sizePx?: number; unit?: string } = {}): { raw: Frame[]; input: InputSamples } {
  const unit = opts.unit ?? "px";
  const n = LEAD_IN + hand.length + TAIL;
  const vs = Array.from({ length: n }, (_, i) => value(i));
  const raw = seriesOf({ drawings: holdsOf(vs), unit, sizePx: opts.sizePx ?? 12, at: [vs[0]!, ROW], ...(unit === "px" ? { slopes: { cx: 1, cy: 0 } } : {}) });
  const input: InputSamples = { kind: "pointer", samples: hand.map((x, k): [number, number, number, 0 | 1] => [(LEAD_IN + k) * FRAME_MS, x, ROW, 1]) };
  return { raw, input };
}

/** The pointer's x in each frame of the input: a drag from `x0` at `speed` px a frame for `frames` frames, then each later leg. */
function drag(x0: number, legs: [frames: number, pxPerFrame: number][]): number[] {
  const out: number[] = [];
  let x = x0;
  for (const [frames, speed] of legs) {
    for (let k = 0; k < frames; k++) {
      out.push(x);
      x += speed;
    }
  }
  out.push(x);
  return out;
}

/** The hand in force at frame i: before the first sample its first sample, after the last its last. */
const handAt = (hand: number[], i: number) => hand[Math.min(Math.max(i - LEAD_IN, 0), hand.length - 1)]!;

/** A grid follower: the value is the hand's place rounded to the nearest of `cell` px cells from `x0`. */
const grid = (x0: number, cell: number, x: number) => x0 + Math.round((x - x0) / cell) * cell;

/** The record of a case's one object, moved by the value alone. */
const RECORD = (raw: Frame[]): Record<string, ObjectRecord> => ({ [OBJECT]: { box: raw[0]!.boxes![OBJECT]!, moves: [VALUE] } });

/** stepLeads on a live case: the fitted gain, the pointer's presses and the raw window from the frames. */
function live(c: { raw: Frame[]; input: InputSamples }, unit = "px"): Lead[] {
  const names = [VALUE];
  const read = { names, units: { [VALUE]: unit }, view: VIEW, scrolled: false, windowEnd: rawWindowEnd(c.raw, c.input, names) };
  return stepLeads(c.raw, c.input, fittedGains(c.raw, c.input, names), RECORD(c.raw), pressesOf(c.input), read);
}

/** The fitted gain of a live case's value, or null when it does not track the input. */
const liveGain = (c: { raw: Frame[]; input: InputSamples }) => fittedGains(c.raw, c.input, [VALUE])[0]?.gain ?? null;

/** A value drawn on twos: its place in every second frame, to 0.01 px. */
const twos = (xs: number[]) => (i: number) => Math.round(xs[i - (i % 2)]! * 100) / 100;

/** A spring of `hz` with damping ratio `zeta` chasing `hand`, its place in each frame (it rests until the first sample). */
function spring(hand: number[], hz: number, zeta: number): number[] {
  const [k, c] = [(2 * Math.PI * hz) ** 2, 2 * zeta * 2 * Math.PI * hz];
  const xs: number[] = [];
  let [x, v] = [hand[0]!, 0];
  for (let i = 0; i < LEAD_IN + hand.length + TAIL; i++) {
    xs.push(x);
    if (i >= LEAD_IN) {
      v += (k * (handAt(hand, i) - x) - c * v) / 60;
      x += v / 60;
    }
  }
  return xs;
}

/** The frames a drawing must be shown for the step out of it to stand alone: HOLD_MS or more. */
const HOLD_FRAMES = Math.ceil(HOLD_MS / FRAME_MS - 1e-6);

/**
 * A rule gap: a case stepLeads gets wrong today. It runs twice. `it.fails` holds what the case must give (`must`), so
 * it turns red when the rule is fixed. `it` pins what it gives today (`today`), exactly, so a change that turns one
 * wrong verdict into another (an ahead fail into an off one, or a later step) turns red too.
 */
function ruleGap(name: string, run: () => Lead[], must: unknown, today: Lead[]) {
  it.fails(name, () => expect(run()).toEqual(must));
  it(`${name}: today it gives ${today.length === 0 ? "no fail" : today.map((l) => `${l.kind} at ${Math.round(l.ms)} ms`).join(", ")}`, () => expect(run()).toEqual(today));
}

/** The Lead stepLeads gives for the case's value at `frame`, `steps` to 2 decimals. */
const leadAt = (frame: number, kind: Lead["kind"], steps: number): Lead => ({ name: VALUE, ms: frame * FRAME_MS, kind, steps: expect.closeTo(steps, 2) as unknown as number });

describe("quantum", () => {
  const ds = (vs: number[]) => {
    const raw = seriesOf({ drawings: holdsOf(vs.flatMap((v) => [v, v])), slopes: { cx: 1, cy: 0 } });
    return drawingsOf(raw, VALUE, OBJECT, stillTol(series(raw, VALUE)), VIEW, false);
  };

  it("is the median |Δvalue| of the non-zero drawing steps", () => {
    expect(quantum(ds([0, 12, 24, 60, 72]))).toBe(12);
    expect(quantum(ds([0, 12, 36, 60]))).toBe(24);
  });

  it("a value with 2 non-zero steps has no quantum", () => {
    expect(quantum(ds([0, 12, 200]))).toBeNull();
  });
});

describe("stepLeads (live)", () => {
  // A hard case: a 12 px handle on a round-to-nearest grid, a slow drag, then a 400 px flick in
  // 200 ms (12 frames), then the hand holds still. Honest grid steps never leave their own quantum.
  const speeds = [0.5, 1.5, 4];
  const cells = [12, 16, 24, 48, 100];
  it.each(cells.flatMap((cell) => speeds.map((speed) => [cell, speed] as const)))("a %i px grid follower dragged at %f px a frame, then flicked, never fails", (cell, speed) => {
    const hand = drag(100, [[120, speed], [12, 400 / 12], [30, 0]]);
    const c = slider(hand, (i) => grid(100, cell, handAt(hand, i)));
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  // The 12 px grid at 1.5 px a frame does not step at frame 91 (the hand is at 191.5 px, as at frame 90).
  const hand = drag(100, [[120, 1.5], [30, 0]]);
  const AT = LEAD_IN + 61;

  it("a 3-quantum skip that stays fails as off", () => {
    const out = live(slider(hand, (i) => grid(100, 12, handAt(hand, i)) + (i >= AT ? 36 : 0)));
    expect(out).toEqual([{ name: VALUE, ms: AT * FRAME_MS, kind: "off", steps: expect.closeTo(2.88, 1) }]);
  });

  it("a 2-quantum backward glitch for one drawing fails as off", () => {
    const out = live(slider(hand, (i) => grid(100, 12, handAt(hand, i)) - (i >= AT && i < AT + 3 ? 24 : 0)));
    expect(out).toEqual([{ name: VALUE, ms: AT * FRAME_MS, kind: "off", steps: expect.closeTo(2.13, 1) }]);
  });

  it("a thumb that jumps to the press passes", () => {
    // The thumb rests at 200 px; the press lands at 400 px and the thumb jumps under it, then follows a 12 px grid.
    const press = drag(400, [[120, 1.5], [30, 0]]);
    const c = slider(press, (i) => (i < LEAD_IN ? 200 : grid(400, 12, handAt(press, i))));
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  it("a skip right after the thumb's jump to the press fails as off", () => {
    // The thumb jumps 200 px to the press, and while the hand holds still (so no lead is judged) it skips 3 cells 2
    // frames on and stays. The jump to the press is not judged, so it does not stand as the step before the skip: the
    // skip is held to the quantum.
    const press = drag(400, [[10, 0], [120, 1.5], [30, 0]]);
    const c = slider(press, (i) => (i < LEAD_IN ? 200 : grid(400, 12, handAt(press, i)) + (i >= LEAD_IN + 2 ? 36 : 0)));
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([{ name: VALUE, ms: (LEAD_IN + 2) * FRAME_MS, kind: "off", steps: expect.closeTo(3, 1) }]);
  });

  it("a thumb that jumps somewhere else than the press fails as off", () => {
    // The same jump, landing 100 px short of the press: the press is not inside the thumb's box, so the anchor stays.
    const press = drag(400, [[120, 1.5], [30, 0]]);
    const c = slider(press, (i) => (i < LEAD_IN ? 200 : grid(400, 12, handAt(press, i)) - 100));
    expect(live(c)).toEqual([expect.objectContaining({ ms: LEAD_IN * FRAME_MS, kind: "off" })]);
  });

  // The hand drags 3 px a frame for 1 s, then holds still for 1 s, and the spring overshoots it.
  const still = drag(100, [[60, 3], [60, 0]]);
  const xs = spring(still, 2, 0.3);

  it("a spring on a 12 px grid that overshoots a still hand passes", () => {
    expect(Math.max(...xs)).toBeGreaterThan(still[still.length - 1]! + 1);
    expect(live(slider(still, (i) => grid(100, 12, xs[i]!)))).toEqual([]);
  });

  it("a spring on twos that overshoots a still hand passes", () => {
    // Its quantum is small (the settle's small steps pull it down), so its steps are held to the step before them:
    // a brief drawing's step may be OFF_STEPS times the one before it.
    const c = slider(still, twos(xs));
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  it("a settle glitch on the first step after the hand stops fails as off", () => {
    // The same spring on twos, its first drawing after the hand stops drawn 12 px further on: that step is more than
    // OFF_STEPS times the step before it.
    const at = LEAD_IN + 62; // the hand's last move is in frame LEAD_IN + 60, and the spring draws on even frames
    const c = slider(still, (i) => twos(xs)(i) + (i >= at && i < at + 2 ? 12 : 0));
    expect(live(c)).toEqual([expect.objectContaining({ name: VALUE, ms: at * FRAME_MS, kind: "off" })]);
  });

  // A dot that follows the hand one to one on a grid, and on release springs home (100 px) from the hand's place with the
  // hand's speed: a damped spring (omega 22.25 rad/s, damping ratio 0.84) in closed form. The hand drags `speed` px a
  // frame for 60 frames to `away` px from home; the input's last sample is the release. Once the spring moves 1 to 2
  // cells a frame, grid rounding gives steps of k and k+1 cells while the hand holds still.
  const releaseSpring = (cell: number, speed: number, away: number) => {
    const [w, z] = [22.25, 0.84];
    const wd = w * Math.sqrt(1 - z * z);
    const at = (u: number) => Math.exp(-z * w * u) * (away * Math.cos(wd * u) + ((speed * 60 + z * w * away) / wd) * Math.sin(wd * u));
    const hand = drag(100 + away - 60 * speed, [[60, speed]]);
    const stop = LEAD_IN + 60;
    const x = (i: number) => grid(100, cell, i <= stop ? handAt(hand, i) : 100 + at((i - stop) / 60));
    // The drawing steps after the release, in cells.
    const steps: number[] = [];
    for (let i = stop + 1; i < LEAD_IN + hand.length + TAIL; i++) if (x(i) !== x(i - 1)) steps.push((x(i) - x(i - 1)) / cell);
    return { c: slider(hand, x), steps };
  };
  /** Whether `steps` has step `from` followed by step `to`. */
  const hasPair = (steps: number[], from: number, to: number) => steps.some((d, k) => d === from && steps[k + 1] === to);

  it("a release spring on a 12 px grid whose settle steps go from 1 cell to 2 passes", () => {
    const { c, steps } = releaseSpring(12, 3, 100);
    expect(hasPair(steps, -1, -2)).toBe(true);
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  it("a release spring on a 12 px grid whose settle steps go from 1 cell to 3 passes", () => {
    // The step after the 3-cell step is 2 cells: the spring keeps that speed.
    const { c, steps } = releaseSpring(12, 3, 180);
    expect(hasPair(steps, -1, -3)).toBe(true);
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  // RULE GAP (a cost of the rounding allowance): the 12 px grid spring that overshoots a still hand, with one cell more
  // from its first step after the hand stops, the cell kept. The step is one cell more than the step after it, which
  // is what grid rounding gives, so it is not off.
  ruleGap(
    "a spring on a 12 px grid that skips one cell more on its first step after the hand stops, and keeps it, fails as off",
    () => {
      const stop = LEAD_IN + 60;
      const v = (i: number) => grid(100, 12, xs[i]!);
      let at = stop + 1;
      while (v(at) === v(at - 1)) at++;
      const dir = Math.sign(v(at) - v(at - 1));
      return live(slider(still, (i) => v(i) + (i >= at ? 12 * dir : 0)));
    },
    [expect.objectContaining({ name: VALUE, kind: "off" })],
    [],
  );

  // A 12 px grid follower dragged slowly, then flicked 400 px in 200 ms; the hand then holds still and the value jumps
  // 30 px (2.5 quanta) to a far rest. The flick's last step is 24 px.
  const flick = drag(100, [[120, 1.5], [12, 400 / 12], [60, 0]]);
  const flickEnd = LEAD_IN + 132;
  const jumpAt = (frame: number) => slider(flick, (i) => grid(100, 12, handAt(flick, i)) + (i >= frame ? 30 : 0));

  it("a jump to a far rest at least HOLD_MS after a flick fails as off", () => {
    const at = flickEnd + HOLD_FRAMES;
    expect(live(jumpAt(at))).toEqual([{ name: VALUE, ms: at * FRAME_MS, kind: "off", steps: expect.closeTo(2.5, 1) }]);
    expect(live(jumpAt(flickEnd + 8))).toEqual([expect.objectContaining({ ms: (flickEnd + 8) * FRAME_MS, kind: "off" })]);
  });

  it("KNOWN COST: the same jump within 100 ms of the flick passes", () => {
    // The drawing before the jump is brief, so the jump is held to the flick's last step (24 px): 30 px is under
    // OFF_STEPS times that.
    const c = jumpAt(flickEnd + 3);
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  // KNOWN COST: the step before a brief drawing's step chains. While the hand holds still ahead is not judged, so a
  // value whose steps grow just under OFF_STEPS times from one brief drawing to the next can run away from the hand.
  // Here a follower on twos (6 px steps while the hand drags 3 px a frame) runs on after the input's last sample, each
  // step 1.49 times the one before it for 8 drawings, and comes to rest 425 px past the hand. No step is over OFF_STEPS
  // times the one before it, and it does not come back, so it is no excursion. The envelope rule leaves a value stepLeads
  // judges to it until the raw window ends, where the values rest, past the run-away's last step; the overshoot rule
  // leaves out the input window, and needs a return. So no rule judges it.
  it("KNOWN COST: a value that runs away after the last sample, each step under OFF_STEPS times the one before, passes", () => {
    const stop = LEAD_IN + 60; // the input's last sample
    const away = (i: number) => {
      let s = 0;
      for (let k = 1; k <= Math.min(8, Math.floor((i - stop) / 2)); k++) s += 6 * 1.49 ** k;
      return s;
    };
    const run = drag(100, [[60, 3]]);
    const xs = Array.from({ length: LEAD_IN + run.length + TAIL }, (_, i) => handAt(run, i) + away(i));
    const c = slider(run, twos(xs));
    expect(away(Number.POSITIVE_INFINITY)).toBeCloseTo(425, 0);
    expect(liveGain(c)).not.toBeNull();
    expect(inputWindow(c.raw, c.input)![1]).toBeGreaterThanOrEqual((stop + 16) * FRAME_MS - 1e-6);
    expect(live(c)).toEqual([]);
  });

  // RULE GAP: a strongly underdamped spring (2 Hz, damping ratio 0.15) on twos, on the same drag, is honest but fails
  // as ahead at 700 ms, 3.84 quanta: while the hand drags, the spring surges past the place the prefix gain predicts.
  ruleGap("a strongly underdamped spring on twos passes", () => live(slider(still, twos(spring(still, 2, 0.15)))), [], [leadAt(LEAD_IN + 12, "ahead", 3.84)]);

  // The zeta 0.3 spring chasing the slow drag and the flick, at its turn after the hand stops. On twos a 22.49 px step
  // follows an 8.46 px one (the step that straddles the turn is small), against a 3 px quantum: more than OFF_STEPS
  // times the step before. The hand holds still and the same-way step after it is larger, so the rounding allowance
  // excuses it. The same spring on a 12 px grid passes too.
  it("a spring on twos, or on a 12 px grid, after a flick passes", () => {
    const xs = spring(flick, 2, 0.3);
    expect(live(slider(flick, twos(xs)))).toEqual([]);
    expect(live(slider(flick, (i) => grid(100, 12, xs[i]!)))).toEqual([]);
  });

  // A 12 px grid follower thrown by the flick: after the last sample it glides on, its speed kept at 0.9 a frame. Once
  // it slows under 2 cells a frame its steps go 12, 24, 12 px while the hand holds still: a 24 px step after a 12 px
  // one is over OFF_STEPS times it, but it is one cell more than its neighbours, which is grid rounding.
  it("a grid follower that glides on after a flick passes", () => {
    const xs: number[] = [];
    let [x, v] = [0, 0];
    for (let i = 0; i < LEAD_IN + flick.length + TAIL; i++) {
      if (i <= flickEnd) [v, x] = [handAt(flick, i) - x, handAt(flick, i)];
      else [v, x] = [v * 0.9, x + v * 0.9];
      xs.push(x);
    }
    expect(live(slider(flick, (i) => grid(100, 12, xs[i]!)))).toEqual([]);
  });

  // A 12 px grid follower that runs away after the flick: while the hand holds still it steps 1 cell, then `cells`
  // cells a drawing for 3 drawings (drawn on twos), and rests.
  const runAway = (cells: number) => {
    const extra = (i: number) => {
      const k = Math.floor((i - flickEnd) / 2);
      return i < flickEnd || k < 1 ? 0 : 12 + 12 * cells * Math.min(k - 1, 3);
    };
    return live(slider(flick, (i) => grid(100, 12, handAt(flick, i)) + extra(i)));
  };

  // RULE GAP (a cost of the rounding allowance): steps of 1 cell, then 2 a drawing, while the hand holds still: each
  // step is one cell more than a same-way step next to it, the pattern of an honest glide.
  ruleGap("a grid follower that runs away after a flick, 1 cell then 2 a drawing, fails as off", () => runAway(2), [expect.objectContaining({ name: VALUE, kind: "off" })], []);

  // RULE GAP (a cost of the rounding allowance): an abrupt run-away, 1 cell then 5 a drawing. The step after the first
  // 5-cell step is 5 cells too, so it excuses that step, and each later step is the same as the one before.
  ruleGap("a grid follower that runs away after a flick, 1 cell then 5 a drawing, fails as off", () => runAway(5), [expect.objectContaining({ name: VALUE, kind: "off" })], []);

  it("a value that jumps 2 cells ahead and stays fails as off (off goes first at its step)", () => {
    const out = live(slider(hand, (i) => grid(100, 12, handAt(hand, i)) + (i >= AT ? 24 : 0)));
    expect(out).toEqual([{ name: VALUE, ms: AT * FRAME_MS, kind: "off", steps: expect.closeTo(1.87, 1) }]);
  });

  // RULE GAP: a value that runs 2 cells ahead over 1 s and stays there passes. No step leaves the off bound, and the
  // fitted gain takes in the held lead: the fit reads the build-up as a steeper gain (1.15 for a hand the value follows
  // 1 to 1), so the prediction moves ahead with the value. Without the travel term it still passes.
  ruleGap(
    "a value that runs 2 cells ahead and stays fails as ahead",
    () => live(slider(hand, (i) => grid(100, 12, handAt(hand, i) + 24 * Math.min(1, Math.max(0, (i - AT) / 60))))),
    [expect.objectContaining({ name: VALUE, kind: "ahead" })],
    [],
  );

  it("an index value is skipped", () => {
    // A sprite frame that leaps 9 frames mid-drag: an index moves nothing, so the input window does not judge it.
    const out = live(slider(hand, (i) => (i < LEAD_IN ? 0 : (Math.floor((i - LEAD_IN) / 4) % 4) + (i >= AT ? 9 : 0)), { unit: "index" }), "index");
    expect(out).toEqual([]);
  });

  it("a value with 2 non-zero steps has no quantum, so only excursions judge it", () => {
    // Two 100 px steps on a slow drag: no quantum, so neither off nor ahead is judged, and they are no excursion.
    const c = slider(hand, (i) => 100 + (i >= LEAD_IN + 20 ? 100 : 0) + (i >= LEAD_IN + 80 ? 100 : 0));
    expect(liveGain(c)).not.toBeNull();
    expect(live(c)).toEqual([]);
  });

  // Values that move on their own during a drag and do not track the hand: no fitted gain, so stepLeads does not
  // judge them, each drawn on twos. The envelope rule's stepped pop checks judge them inside the input window instead.
  const t = (i: number) => i / 60;
  const own: [string, (i: number) => number][] = [
    ["a looping bounce", (i) => 300 + 60 * Math.abs(Math.sin(Math.PI * t(i)))],
    ["an eased bob", (i) => 300 + 20 * Math.sin((2 * Math.PI * t(i)) / 1.2)],
    ["an ease-out slide", (i) => 300 + 300 * (1 - (1 - Math.min(1, Math.max(0, (i - LEAD_IN) / 36))) ** 3)],
  ];
  it.each(own)("%s on twos during a drag has no gain and is not judged", (_, value) => {
    const xs = Array.from({ length: LEAD_IN + hand.length + TAIL }, (_, i) => value(i));
    const c = slider(hand, twos(xs));
    expect(liveGain(c)).toBeNull();
    expect(live(c)).toEqual([]);
  });
});

describe("stepLeads (scroll)", () => {
  it("a lerp on twos chasing 100 px scroll ticks passes", () => {
    // The scroll moves 100 px a tick, each held 41 frames; the value eases a fifth of the way to 100 + scroll / 2 each
    // frame, drawn on twos. Each tick's first steps are large and the rest shrink; each is held to the step before it.
    const ys = [...Array<number>(LEAD_IN).fill(0), ...[100, 200, 300, 400].flatMap((y) => Array<number>(41).fill(y))];
    const xs: number[] = [];
    let x = 100;
    for (const y of ys) {
      xs.push(x);
      x += 0.2 * (100 + y / 2 - x);
    }
    const vs = ys.map((_, i) => twos(xs)(i));
    const raw = seriesOf({ drawings: holdsOf(vs), slopes: { cx: 1, cy: 0 }, at: [vs[0]!, ROW] });
    const input: InputSamples = { kind: "scroll", samples: ys.slice(LEAD_IN).map((y, k): [number, number] => [(LEAD_IN + k) * FRAME_MS, y]) };
    const names = [VALUE];
    const gains = restGains(raw, input, names);
    expect(gains[0]?.gain).toBeCloseTo(0.5, 2);
    const read = { names, units: { [VALUE]: "px" }, view: VIEW, scrolled: true, windowEnd: rawWindowEnd(raw, input, names) };
    expect(stepLeads(raw, input, gains, RECORD(raw), [], read)).toEqual([]);
  });
});

describe("leadNames", () => {
  const raw = seriesOf({ drawings: [[10, 100], [10, 112]], slopes: { cx: 1, cy: 0 } });
  const gain: Gain = { name: VALUE, axis: 1, gain: 1 };

  it("names a value that moves an object, is not an index, and has a gain", () => {
    expect(leadNames([VALUE], { [VALUE]: "px" }, [gain], RECORD(raw))).toEqual([VALUE]);
  });

  it("leaves out a value with no gain, an index, and a value no object moves", () => {
    expect(leadNames([VALUE], { [VALUE]: "px" }, [], RECORD(raw))).toEqual([]);
    expect(leadNames([VALUE], { [VALUE]: "index" }, [gain], RECORD(raw))).toEqual([]);
    expect(leadNames([VALUE], { [VALUE]: "px" }, [gain], {})).toEqual([]);
  });
});

describe("restGains", () => {
  /** A flipbook the scroll drives: the scroll moves `ticks` (each [frames held, scroll position]), the value is `value(scroll)` per frame. */
  function flip(ticks: [frames: number, y: number][], value: (y: number, i: number) => number): { raw: Frame[]; input: InputSamples; names: string[] } {
    const ys = [...Array<number>(LEAD_IN).fill(0), ...ticks.flatMap(([n, y]) => Array<number>(n).fill(y))];
    const vs = ys.map((y, i) => value(y, i));
    const raw = seriesOf({ drawings: holdsOf(vs), slopes: { cx: 1, cy: 0 }, at: [vs[0]!, ROW] });
    const input: InputSamples = { kind: "scroll", samples: ys.slice(LEAD_IN).map((y, k): [number, number] => [(LEAD_IN + k) * FRAME_MS, y]) };
    return { raw, input, names: [VALUE] };
  }
  const gainOf = (gs: Gain[]) => gs.find((g) => g.name === VALUE)?.gain ?? null;

  it("is the median of the gains between consecutive rests", () => {
    // Ticks of 100 px held 20 frames; the value moves 50 px a tick, but sits 60 px further at the far rest: the median
    // keeps 0.5, where the two rests furthest apart would read 0.7.
    const c = flip([[20, 100], [20, 200], [20, 300], [20, 400]], (y) => 100 + y / 2 + (y >= 400 ? 60 : 0));
    expect(gainOf(restGains(c.raw, c.input, c.names))).toBe(0.5);
  });

  it("skips consecutive rests where the input is equal", () => {
    // The scroll rests at 100, touches 200 for 2 frames (too short to rest), comes back to rest at 100, then rests at
    // 300. The value keeps 10 px more from the touch on. The two rests at 100 give no gain, and the second one to 300
    // gives 0.5 (the first one to 300 would read 0.55).
    const c = flip([[20, 100], [2, 200], [20, 100], [20, 300]], (y, i) => 100 + y / 2 + (i >= LEAD_IN + 20 ? 10 : 0));
    expect(gainOf(restGains(c.raw, c.input, c.names))).toBe(0.5);
  });

  it("with one rest, reads the gain from the anchor to that rest", () => {
    // One scroll to 200 held to the end: from the value before the input (100 at scroll 0) to its rest (180).
    const c = flip([[40, 200]], (y) => 100 + (y * 2) / 5);
    expect(gainOf(restGains(c.raw, c.input, c.names))).toBe(0.4);
  });

  it("with no rest there is no gain", () => {
    // The scroll never holds: it moves every frame to the window's end.
    const c = flip(Array.from({ length: 30 }, (_, k): [number, number] => [1, 10 * (k + 1)]), (y) => 100 + y / 2);
    expect(gainOf(restGains(c.raw, c.input, c.names))).toBeNull();
  });
});
