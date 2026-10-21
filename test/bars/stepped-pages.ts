import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Idle pages drawn pose to pose, on the shared fixture `stepped/stepped.js`: cel on twos, threes and fours,
 * stop-motion, sprites. Each page is a copied bar whose trace.json marks its lift y as stepped. The kind gate tests
 * and the style sweep write them into a temp folder, so the cases live here as data.
 */

export const STEPPED_JS = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds/stepped/stepped.js");
const F = 1000 / 60;

/** A drawing: the time it starts, in ms, and the value y holds until the next drawing starts (null: NaN; "missing": no y). */
export type Drawing = [ms: number, value: number | null | "missing"];
/**
 * `stepped` names the values trace.json marks as stepped: y, unless set. `cuts` are trace.json's cuts, in ms. `unit`
 * says what y does to the dot: px translates, scale scales, deg rotates, opacity fades, index changes nothing visible.
 * `sizePx` is the dot's size, 40 unless set. `record` plants a fault in the objects the page reports: "none" leaves
 * them out, "malformed" names y in a string, "decoy" lists y under a small still box and the dot under no value, and
 * "index" reports y's unit as `index` while y still moves the dot. `halo` is the dot's halo in its record, left out
 * unless set. `x`, when set, is a second value's drawings (px, on the same period): it moves the dot along x, the
 * record lists it beside y, and trace.json marks it stepped beside y unless `stepped` is set.
 */
export type SteppedPage = { drawings: Drawing[]; periodMs?: number; unit?: string; stepped?: string[]; cuts?: number[]; sizePx?: number; record?: "none" | "malformed" | "decoy" | "index"; halo?: unknown; x?: Drawing[] };

/** Frames of 1/60 s: a drawing that starts at frame `f` holds `y`. */
type Pose = [frame: number, y: number];

export const eis = (p: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
export const rep = (h: number, n: number) => Array<number>(n).fill(h);
/** Holds alternating a and b, n of them: threes at 24 drawings a second are 7 and 8 frames at 60. */
export const alt = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? b : a));

/**
 * One move from share a to share b: `holds` is how many frames each drawing holds; `shares` (one fewer than the
 * holds) is how far along the move each drawing after the first sits, else an ease-in-out.
 */
function move(at: number, a: number, b: number, holds: number[], shares?: number[]): { poses: Pose[]; end: number } {
  const total = holds.reduce((s, h) => s + h, 0);
  const poses: Pose[] = [];
  let s = 0;
  holds.forEach((h, j) => {
    if (j > 0) poses.push([at + s, a + (b - a) * (shares ? shares[j - 1]! : eis(s / total))]);
    s += h;
  });
  poses.push([at + total, b]);
  return { poses, end: at + total };
}

export type CycleOptions = { shares?: number[]; restBefore?: number; top?: number; restAfter?: number; pre?: [hold: number, share: number][] };

/**
 * One loop of a lift of `liftPx`: a rest, the rise (each drawing held `rise[k]` frames), a hold at the top, the fall
 * (the rise's holds and spacing again, from the top down), a rest. `pre` drawings come before the rise (an anticipation): the last one
 * is the rise's first drawing.
 */
export function cycle(rise: number[], { shares, restBefore = 30, top = 40, restAfter = 30, pre = [] }: CycleOptions = {}, liftPx = 40): SteppedPage {
  const poses: Pose[] = [[0, 0]];
  let at = restBefore;
  for (const [hold, share] of pre) {
    poses.push([at, share]);
    at += hold;
  }
  const from = pre.length > 0 ? pre[pre.length - 1]![1] : 0;
  if (pre.length > 0) at -= pre[pre.length - 1]![0];
  const holds = pre.length > 0 ? [pre[pre.length - 1]![0], ...rise.slice(1)] : rise;
  const up = move(at, from, 1, holds, shares);
  const down = move(up.end + top, 1, 0, holds, shares);
  const all = [...poses, ...up.poses, ...down.poses];
  return { drawings: all.map(([f, s]) => [f * F, Math.round(-liftPx * s * 1e6) / 1e6]), periodMs: (down.end + restAfter) * F };
}

/** A page from y per frame over one loop of `frames` frames: a drawing wherever y changes. */
export function fromFrames(frames: number, y: (f: number) => number): SteppedPage {
  const drawings: Drawing[] = [];
  for (let f = 0; f < frames; f++) if (f === 0 || y(f) !== y(f - 1)) drawings.push([f * F, y(f)]);
  return { drawings, periodMs: frames * F };
}

/** The base loop of the faulty variants below, 96 frames: rest 0, nine 4-frame drawings to -40, rest, six back, rest. */
const base = (c: number) => {
  if (c < 24) return 0;
  if (c < 60) return -40 * eis((Math.floor((c - 24) / 4) + 1) / 9);
  if (c < 72) return -40;
  return -40 * (1 - eis((Math.floor((c - 72) / 4) + 1) / 6));
};

/** The base loop with four small drawings, then one that jumps 33 px of the 40. */
const teleport = (c: number) => (c < 24 || c >= 60 ? base(c) : [-1, -2, -3, -4, -37, -38, -39, -39.5, -40][Math.floor((c - 24) / 4)]!);

const twos24 = cycle(rep(5, 12));

/** Drawings from [hold in frames, value] parts, in order; with `loop`, the page repeats after the last hold. */
function held(parts: [hold: number | number[], values: number[]][], loop = false): SteppedPage {
  const drawings: Drawing[] = [];
  let f = 0;
  for (const [h, values] of parts)
    values.forEach((v, i) => {
      drawings.push([f * F, v]);
      f += Array.isArray(h) ? h[i % h.length]! : h;
    });
  return loop ? { drawings, periodMs: f * F } : { drawings };
}
/** Threes at 24 (holds of 8 and 7 frames), ones at 24 (2 and 3), twos at 30 (5). */
const [THREES, ONES, TWOS] = [[8, 7], [2, 3], 5];
/** A 1 to 1.15 scale pulse 0.5 s in: `n` drawings up, each held `h` frames, and three back. */
const pulse = (h: number, n: number): SteppedPage => ({
  ...held([[30, [1]], [h, Array.from({ length: n }, (_, k) => 1 + (0.15 * (k + 1)) / n)], [h, [1.1, 1.05, 1.02]], [60, [1]]]),
  unit: "scale",
});

/** The pages the kind gate must pass: honest stepped timing across rates and charts. */
export const HONEST: Record<string, SteppedPage> = {
  // 24 drawings a second on twos: 5-frame holds, 12 drawings over 1 s, ease in-out.
  twos24,
  // Threes at 24: holds of 7 and 8 frames, ending on a 7 or an 8 before the top hold.
  "threes24-ends7": cycle(alt(8, 7, 8)),
  "threes24-ends8": cycle(alt(7, 8, 8)),
  // Stop-motion at 12 on twos: 10-frame holds, 6 drawings over 1 s.
  stop12: cycle(rep(10, 6)),
  // Anime on fours at 24: 10-frame holds, 9 drawings over 1.5 s.
  fours24: cycle(rep(10, 9)),
  // Threes for the slow start, ones at 24 for the fast middle, twos for the ease-out.
  mixed: cycle([8, 7, 8, 3, 2, 3, 2, 3, 5, 5, 5, 5], { shares: [0.02, 0.06, 0.12, 0.24, 0.38, 0.52, 0.66, 0.78, 0.87, 0.94, 0.98] }),
  // A strong slow-out chart: the first drawing covers 45% of the move.
  "spacing-strong": cycle(rep(5, 6), { shares: [0.45, 0.7, 0.85, 0.94, 0.98] }),
  // An anticipation dip held 12 frames, then the rise on twos.
  antic12: cycle(rep(5, 8), { pre: [[5, -0.05], [5, -0.11], [12, -0.15]] }),
  // A sprite walking at 8 drawings a second: 8 px a drawing, 24 drawings one way, then back. No drawing is a rest.
  walk8: fromFrames(720, (f) => {
    const n = Math.floor(f / 7.5 + 1e-9) % 48;
    return -8 * (n < 24 ? n : 48 - n);
  }),
  // A one-time badge pulse at 0.5 s, two drawings up to 1.15 and four back, on fours and on twos: its attack is read on
  // its drawings, from half a drawing before the first (100 and 50 ms), not on its pose line.
  "pulse-fours": { drawings: [[0, 1], [30 * F, 1.075], [34 * F, 1.15], [38 * F, 1.1], [42 * F, 1.05], [46 * F, 1.02], [50 * F, 1]], unit: "scale" },
  "pulse-twos": { drawings: [[0, 1], [30 * F, 1.075], [32 * F, 1.15], [34 * F, 1.1], [36 * F, 1.05], [38 * F, 1.02], [40 * F, 1]], unit: "scale" },
  // Threes, then ones, then threes into a settle 8% past 100 whose drawings hold 7 and 8 frames among 2s and 3s: a
  // held drawing needs to be twice as long as those on each side to end a chain.
  "mixed-settle-loop": held([[40, [0]], [THREES, [2, 6]], [ONES, [15, 30, 50, 70]], [THREES, [86, 104, 108, 99]], [40, [100]], [TWOS, [85, 60, 30, 10]], [40, [0]]], true),
  // A 2-pose bob: up and down, each drawing held 250 ms.
  bob2: { drawings: [[0, 0], [250, -2]], periodMs: 500 },
  // Twos with float noise of 1e-7 in every frame of the first rest: still one rest.
  "noise-rest": (() => {
    const noise: Drawing[] = Array.from({ length: 30 }, (_, f) => [f * F, f % 2 ? 1e-7 : 0]);
    return { ...twos24, drawings: [...noise, ...twos24.drawings.slice(1)] };
  })(),
};

/** The pages the kind gate must fail, each on a real pop inside stepped timing, or a stepped value that never moves. */
export const FAULTY: Record<string, SteppedPage> = {
  // Twos where one drawing covers 60% of the move (20% to 80%).
  "twos24-pop": cycle(rep(5, 12), { shares: [0.02, 0.06, 0.1, 0.15, 0.2, 0.8, 0.85, 0.9, 0.94, 0.97, 0.99] }),
  // Threes where one drawing covers 65% (20% to 85%).
  "threes24-pop": cycle(alt(7, 8, 8), { shares: [0.05, 0.12, 0.2, 0.85, 0.92, 0.97, 0.99] }),
  // Four small drawings, then one jumps 33 px of the 40.
  teleport: fromFrames(96, (c) => teleport(c)),
  // A rest, one 3-frame drawing 0.001 px off it, then 60 px (1.5 lengths of the dot) in one drawing, and six back.
  nudge: fromFrames(96, (c) => (c < 36 ? 0 : c < 39 ? -0.001 : c < 72 ? -60 : -60 * (1 - eis((Math.floor((c - 72) / 4) + 1) / 6)))),
  // One drawing 40 px the wrong way, in a move to -40.
  spike: fromFrames(96, (c) => (c >= 40 && c < 44 ? 40 : base(c))),
  // A value marked stepped that never moves.
  frozen: { drawings: [[0, 0]], periodMs: 1000 },
  // The teleport, with y left out of the state in the first frame only (and no repeat, so only there): the pop is
  // still judged.
  // Rest, a drawing that jumps 90 of 100 px, a rest, and an eased way back; one wild 1e6 px frame at a cut 2 s in.
  // The still tolerance comes from the range without that outlier, so the jump is still its own drawing (adv s11).
  "outlier-at-cut": { drawings: [[0, 0], [1000, -90], [1000 + 5 * F, -95], [1000 + 10 * F, -100], [2000, 1e6], [2000 + F, -100], [3000, -75], [3000 + 5 * F, -50], [3000 + 10 * F, -25], [3000 + 15 * F, 0]], cuts: [2000] },
  "absent-at-load": { drawings: [[0, "missing"], ...fromFrames(300, (c) => teleport(c % 96)).drawings.map(([ms, y]): Drawing => [ms || F, y])] },
};

/** Stepped pages that break another rule, read on their drawings, and the rule. */
export const OTHER_FAULTS: Record<string, [SteppedPage, string]> = {
  // A one-time settle 8% past its rest after threes and ones: no held drawing splits it.
  "mixed-settle-once": [held([[40, [0]], [THREES, [2, 6]], [ONES, [15, 30, 50, 70, 85]], [THREES, [96, 104, 108, 103, 99]], [40, [100]], [TWOS, [85, 60, 30, 10]], [40, [0]]]), "overshoot"],
  // A pulse whose four drawings up hold 8 frames each: it peaks 467 ms after it starts.
  "slow-pulse": [pulse(8, 4), "envelope"],
  // One wild 1e6 px frame at a cut 1 s in, then a one-time settle 8% past its rest 4 s in: the outlier sets neither
  // the still tolerance nor where the rules stop reading.
  "outlier-then-settle": [{ ...held([[60, [0]], [1, [1e6]], [179, [0]], [TWOS, [10, 30, 60, 85, 108, 97, 101]], [60, [100]]]), cuts: [1000] }, "overshoot"],
};

/** A loop from [frames, value] drawings, each held its frames, of a `sizePx` object in `unit`. */
const loopOf = (holds: [frames: number, value: number][], sizePx = 40, unit = "px"): SteppedPage => ({
  ...held(holds.map(([h, v]) => [h, [v]])),
  periodMs: holds.reduce((a, [h]) => a + h, 0) * F,
  ...(unit === "px" ? {} : { unit }),
  ...(sizePx === 40 ? {} : { sizePx }),
});
/** Drawings at `fps` a second, one per value, from `t0` ms. */
const atRate = (fps: number, values: number[], t0 = 0): Drawing[] => values.map((v, i) => [t0 + (i * 1000) / fps, v]);
/** A walker on a 40 px dot at 12 drawings a second: 24 drawings of 8 px one way, one turn drawing, back, one turn drawing. */
const WALK = [...Array.from({ length: 25 }, (_, k) => 8 * k), 192, ...Array.from({ length: 24 }, (_, k) => 8 * (23 - k)), 0];
const walkAt12 = (x: (k: number, v: number) => number): SteppedPage => ({ drawings: atRate(12, WALK.map((v, k) => x(k, v))), periodMs: (WALK.length * 1000) / 12 });
/** A hop of 30 px on twos at 30, eased in and out, held 500 ms at each end. */
const hop = (t0: number, from: number): Drawing[] => [
  ...atRate(30, [1, 2, 3, 4, 5, 6].map((k) => from - 30 * eis(k / 6)), t0),
  ...atRate(30, [1, 2, 3, 4, 5, 6].map((k) => from - 30 * eis((6 - k) / 6)), t0 + 700),
];

/**
 * Honest stepped pages that the share-of-move rule judged wrongly, rebuilt here by behaviour. Each is judged in lengths of its object: a 40 px dot unless `sizePx` says otherwise.
 */
export const REVIEWED_HONEST: Record<string, SteppedPage> = {
  // Ones at 30 (2 frames) into threes at 30 (6 frames) slowing into the key; twos back.
  "ones into threes": loopOf([[60, 0], [2, 10], [2, 25], [2, 45], [2, 65], [2, 80], [2, 90], [6, 96], [6, 99], [60, 100], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [7, 0]]),
  // Fours (10 frames) creeping out of the rest, then ones at 24 (2 and 3 frames) to the key.
  "fours into ones": loopOf([[60, 0], [10, 1], [10, 4], [2, 10], [3, 22], [2, 38], [3, 56], [2, 72], [3, 85], [2, 94], [3, 99], [60, 100], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [6, 0]]),
  // A move on twos, then a moving hold: four 16-frame drawings creeping 1 px each.
  "moving hold creeping 1 px": loopOf([[60, 0], [5, 4], [5, 15], [5, 32], [5, 50], [5, 68], [5, 85], [5, 96], [16, 100], [16, 101], [16, 102], [16, 103], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [7, 0]]),
  // Ones at 30 into the key, the last in-between cushioned on 8 frames.
  "cushioned last in-between": loopOf([[60, 0], [2, 5], [2, 20], [2, 45], [2, 72], [2, 90], [2, 96], [8, 99], [60, 100], [2, 96], [2, 85], [2, 68], [2, 50], [2, 32], [2, 15], [2, 4], [2, 0]]),
  // A turn on twos, then a moving hold creeping 0.6 deg every 16 frames.
  "moving hold creeping 0.6 deg": loopOf([[60, 0], [5, 1], [5, 4], [5, 8], [5, 12], [5, 16], [5, 19], [16, 20], [16, 20.6], [16, 21.2], [16, 21.8], [5, 18], [5, 14], [5, 9], [5, 4], [5, 1], [7, 0]], 40, "deg"),
  // An anticipation dip held 10 frames, then a release drawing of 55 px (1.4 lengths) in a 120 px travel: out of a
  // hold, it is judged by the spike alone, 1.4 times as fast as the next drawing.
  "anticipation then a strong release": loopOf([[60, 0], [5, -10], [10, -20], [5, 35], [5, 75], [5, 95], [60, 100], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [7, 0]]),
  // A strong first drawing at 55% of a 100 px move on twos, then a slow in.
  "strong first drawing at 55%": loopOf([[60, 0], [5, 55], [5, 82], [5, 95.5], [60, 100], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [7, 0]]),
  // A thirds chart on twos (66%, 88%, 96% of 100 px): the first drawing is 3 times as fast as the next, not more.
  "thirds chart from 66%": loopOf([[60, 0], [5, 66], [5, 88], [5, 96], [60, 100], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [7, 0]]),
  // A sprite blink: a 12 px lid on a 24 px eye shuts for one 67 ms drawing every 3 s.
  "one-drawing blink": { drawings: [[0, 12], [2933.3333, 0]], periodMs: 3000, sizePx: 24 },
  // A breathing idle: the low pose held 800 ms, the up pose 4 px higher held 200 ms.
  "uneven two-pose bob": { drawings: [[0, 0], [800, -4]], periodMs: 1000 },
};

export const REVIEWED_FAULTY: Record<string, SteppedPage> = {
  // Drawings on fours drifting 1 px each, one of which jumps 300 px: no rest anywhere.
  "teleport in a slow drift": { drawings: [...atRate(15, Array.from({ length: 22 }, (_, k) => k)), ...atRate(15, Array.from({ length: 23 }, (_, k) => 322 + k), 1466.6667)], periodMs: 3000 },
  // A slideshow: each drawing held 1 s at a far new place, up to 400 px apart.
  slideshow: { drawings: atRate(1, [0, 380, 40, 260, 120, 400, 10]), periodMs: 7000 },
  // An intro on twos that jumps 205 px before the first rest, then hops with rests.
  "pop before the first rest": { drawings: [...atRate(30, [0, -5, -10, -15, -20, -25, -230, -235, -240, -245, -250, -255, -260]), ...[900, 2266.6667, 3633.3333].flatMap((t) => hop(t, -260))] },
  // 120 px jumps between equal 1 s holds.
  "equal holds 3 lengths apart": { drawings: [[0, 0], [1000, 120]], periodMs: 2000 },
  // Stop-motion at 12 with no rests, 5 px a drawing, one drawing 100 px.
  "pop in an even train": loopOf([...Array.from({ length: 9 }, (_, k): [number, number] => [5, 5 * k]), ...Array.from({ length: 13 }, (_, k): [number, number] => [5, 140 + 5 * k]), ...Array.from({ length: 39 }, (_, k): [number, number] => [5, 195 - 5 * k]), [6, 5]]),
  // A long move on twos, 10 px a drawing, one drawing 90 px.
  "pop in a long move": loopOf([[60, 0], [5, 10], [5, 20], [5, 30], [5, 40], [5, 50], [5, 140], [5, 150], [5, 160], [5, 170], [5, 180], [5, 190], [5, 200], [60, 200], [5, 180], [5, 150], [5, 110], [5, 70], [5, 35], [5, 10]]),
  // The first drawing out of a rest covers 70% of a 100 px move, 3.9 times as fast as the next.
  "pop out of a rest": loopOf([[60, 0], [5, 70], [5, 88], [5, 97], [60, 100], [5, 96], [5, 85], [5, 68], [5, 50], [5, 32], [5, 15], [5, 4], [7, 0]]),
  // A walker that jumps 80 px ahead mid-walk and walks on from there.
  "walker jumps ahead": walkAt12((k, v) => v + (k >= 10 && k <= 24 ? 80 : 0)),
  // A walker with one drawing 80 px off its path, then back on it.
  "walker drawing off its path": walkAt12((k, v) => v + (k === 10 ? 80 : 0)),
  // A walker whose drawing 10 is drawing 16's place, 48 px ahead, then falls back.
  "walker drawing out of order": walkAt12((k, v) => (k === 10 ? 128 : v)),
  // A walker that wraps from 392 px back to 0 with no cut.
  "walker wraps with no cut": { drawings: atRate(12, Array.from({ length: 50 }, (_, k) => 8 * k)), periodMs: (50 * 1000) / 12 },
};

/**
 * Pages whose stepped y is not a number in one drawing, around a rest-to-rest teleport: they fail `values`, and the
 * dot's box still shows the teleport to the stepped pop rule.
 */
export const NOT_NUMBERS: Record<string, SteppedPage> = {
  "nan-drawing": { drawings: [[0, 0], [1000, null], [1000 + F, 100], [2000, 0]], periodMs: 3000 },
  "missing-drawing": { drawings: [[0, 0], [1000, "missing"], [1000 + F, 100], [2000, 0]], periodMs: 3000 },
};

/**
 * One case of the style sweep: a loop that rests, lifts 1.5 lengths of its dot (60 px on the 40 px dot) in `drawings`
 * drawings at `rate` drawings a second, holds, comes back the same way (time-reversed), and rests. `timing` "mixed"
 * holds the first two and last two drawings half as long again. `chart` is the spacing, as animators chart it: "even" steps; "slowOut", each drawing
 * covers half of what is left (the first covers 50%); "slowIn", the same reversed; "slowInOut", steps that double to
 * the middle and halve after. `shares` sets the spacing outright: each drawing's share of the move, the last 1. A
 * `fault` replaces the lift with a faulty one; the way back stays honest.
 */
export type SweepSpec = {
  rate: number;
  timing: "even" | "mixed";
  chart: "even" | "slowIn" | "slowOut" | "slowInOut";
  drawings: number;
  shares?: number[];
  /** The dot's size, 40 unless set. */
  sizePx?: number;
  fault?: "pop60" | "teleport" | "nudge" | "spike" | "set" | "frozen";
};

/** The lift, in lengths of the dot: longer than the dot, so a lift set in one drawing is a teleport. */
const LIFT_LENGTHS = 1.5;

/** Each drawing's share of the move, the last one 1. */
function chartShares(chart: SweepSpec["chart"], n: number): number[] {
  const steps =
    chart === "even" ? rep(1, n)
    : chart === "slowOut" ? Array.from({ length: n }, (_, k) => 2 ** -Math.min(k + 1, n - 1))
    : chart === "slowIn" ? Array.from({ length: n }, (_, k) => 2 ** -Math.min(n - k, n - 1))
    : Array.from({ length: n }, (_, k) => 2 ** Math.min(k, n - 1 - k));
  const sum = steps.reduce((a, b) => a + b, 0);
  let c = 0;
  return steps.map((st, k) => (k === n - 1 ? 1 : (c += st / sum)));
}

export function sweepPage(spec: SweepSpec): SteppedPage {
  const lift = LIFT_LENGTHS * (spec.sizePx ?? 40);
  const h = 60 / spec.rate;
  // Rests well past 3 times the slowest drawing beside them (1.5 h with mixed holds), at every rate.
  const rest = Math.max(40, Math.ceil(5 * h));
  const n = spec.drawings;
  const hold = (k: number) => (spec.timing === "mixed" && (k < 2 || k >= n - 2) ? 1.5 : 1) * h;
  // Drawing k of n starts this many frames into the move: whole frames, so 7.5-frame holds alternate 7 and 8.
  const at = (k: number) => Math.round(Array.from({ length: k }, (_, i) => hold(i)).reduce((a, b) => a + b, 0));
  const even = chartShares("even", n);
  let up: Pose[] = (spec.shares ?? chartShares(spec.chart, n)).map((c, k) => [rest + at(k), c]);
  const fault = spec.fault;
  if (fault === "frozen") up = [];
  if (fault === "set") up = [[rest, 1]];
  if (fault === "nudge") up = [[rest, -0.001 / lift], [rest + 3, 1]];
  if (fault === "pop60") {
    const m = Math.floor(n / 2);
    up = even.map((_, k): Pose => [rest + at(k), k < m ? (0.2 * (k + 1)) / m : k === m ? 0.8 : 0.8 + (0.2 * (k - m)) / (n - 1 - m)]);
  }
  if (fault === "teleport") up = even.map((_, k): Pose => [rest + at(k), k < 3 ? 0.025 * (k + 1) : k === 3 ? 0.925 : 0.925 + (0.075 * (k - 3)) / (n - 4)]);
  if (fault === "spike") up = even.map((c, k): Pose => [rest + at(k), k === Math.floor(n / 2) ? -1 : c]);
  const topAt = up.length > 0 ? up[up.length - 1]![0] : rest;
  const down: Pose[] = fault === "frozen" ? [] : even.map((_, k): Pose => [topAt + rest + at(k), k === n - 1 ? 0 : 1 - even[k]!]);
  const end = (down.length > 0 ? down[down.length - 1]![0] : topAt + rest) + rest;
  const all: Pose[] = [[0, 0], ...up, ...down];
  return { drawings: all.map(([f, c]) => [f * F, Math.round(-lift * c * 1e6) / 1e6]), periodMs: end * F, ...(spec.sizePx === undefined ? {} : { sizePx: spec.sizePx }) };
}

/**
 * A one-way slideshow: four 1 s drawings, each 1.5 lengths of a `sizePx` dot further up than the last, then back to
 * the start. No drawing is held next to the others, but each is shown 1 s: every step is a teleport.
 */
export const oneWaySlideshow = (sizePx: number): SteppedPage => ({
  drawings: [0, 1, 2, 3].map((k): Drawing => [1000 * k, -LIFT_LENGTHS * sizePx * k]),
  periodMs: 4000,
  sizePx,
});

/** A slug for a sweep case. */
export const sweepSlug = (s: SweepSpec) => `r${s.rate}-${s.timing}-${s.shares ? `shares${s.shares.join("_")}` : s.chart}-${s.drawings}${s.fault ? `-${s.fault}` : ""}${s.sizePx === undefined ? "" : `-size${s.sizePx}`}`;

const html = (slug: string, p: SteppedPage) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-bar" content="${slug}">
<title>bar: ${slug}</title>
<style>body { margin: 0 } #dot { position: fixed; left: 600px; top: 320px; width: 40px; height: 40px; border-radius: 50%; background: #333 }</style>
</head>
<body>
<div id="dot"></div>
<script>
const MOTION = { drawings: ${JSON.stringify(p.drawings)}, periodMs: ${p.periodMs ?? 0}, unit: ${JSON.stringify(p.unit ?? "px")}, sizePx: ${p.sizePx ?? 40}, maxStepS: 0.05${p.record ? `, record: ${JSON.stringify(p.record)}` : ""}${p.halo === undefined ? "" : `, halo: ${JSON.stringify(p.halo)}`}${p.x ? `, x: ${JSON.stringify(p.x)}` : ""} };
</script>
<script src="../stepped.js"></script>
</body>
</html>
`;

/** Writes `p` as a copied bar at `root/slug/` (with stepped.js in `root`) and returns its index.html. */
export function writeSteppedBar(root: string, slug: string, p: SteppedPage): string {
  if (!existsSync(path.join(root, "stepped.js"))) copyFileSync(STEPPED_JS, path.join(root, "stepped.js"));
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), html(slug, p));
  writeFileSync(path.join(dir, "bar.json"), JSON.stringify({ slug, kinds: ["idle"] }));
  writeFileSync(path.join(dir, "trace.json"), JSON.stringify({ ...(p.stepped?.length === 0 ? {} : { stepped: p.stepped ?? (p.x ? ["y", "x"] : ["y"]) }), ...(p.cuts ? { cuts: p.cuts } : {}) }));
  return path.join(dir, "index.html");
}
