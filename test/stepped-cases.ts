import { FRAME_MS, type Frame } from "../src/gate/harness.ts";
import { IDLE_PERIODS_READ, SETTLE_MS, SPAN_MS } from "../src/gate/kind-gate.ts";
import { explainedBy, fitSlopes, type Box, type ObjectFit, type Slopes } from "../src/gate/objects.ts";
import { LOOP_PERIOD_MS, PERIODIC_SCAN_MS } from "../src/gate/periodic.ts";
import { drawingsOf, stepPops, type Drawing, type StepPop } from "../src/gate/poses.ts";
import { MOVE_READ_AHEAD_MS } from "../src/gate/self-checks.ts";
import { series, stillTol } from "../src/gate/series.ts";
import { HONEST, oneWaySlideshow, REVIEWED_FAULTY, REVIEWED_HONEST, sweepPage, sweepSlug, type SteppedPage, type SweepSpec } from "./bars/stepped-pages.ts";

/**
 * Stepped motion as recorded `Frame` series, built from a short description, so the stepped measure and pop rules run
 * as pure TypeScript (no browser). Each case is one object, `dot`, moved by the stepped value `y` and, when `other` is
 * set, by a second value `x`; `more` adds further values.
 *
 * - `drawings`: the stepped value's drawings, each [frames it holds, value].
 * - `unit`: the value's unit (px unless set). It sets how the value draws the box: px moves its centre y by 1 px per
 *   unit; scale grows its width and height by `sizePx` per unit; every other unit (deg, opacity, ratio, index) leaves
 *   the box as it is.
 * - `sizePx`: the box's width and height at the first drawing's value (40 unless set).
 * - `slopes`: how the case draws its box, in px per unit of the value, over the unit's own: centre x, centre y, width,
 *   height. It is never passed to the rule; the tests fit it back with `fitSlopes`.
 * - `other`: [frames it holds, dx] holds of `x`, which moves the box's centre x by dx px; the last dx holds to the end.
 * - `more`: further values (`moreName(k)`), each [frames, value] holds (the last value holds to the end) that draw the
 *   box by `slopes` px per unit of their change from their first value.
 * - `gone`: frame indices where the object is not drawn and reports `[x, y, 1, 1]`.
 * - `at`: the box's centre at the first drawing's value, with `x` at 0 (640, 360 unless set).
 * - `viewport`: the viewport in CSS px (1280 by 720 unless set).
 */
export type SteppedCase = {
  drawings: [frames: number, value: number][];
  unit?: string;
  sizePx?: number;
  slopes?: Partial<Slopes>;
  other?: [frames: number, dx: number][];
  more?: { holds: [frames: number, value: number][]; slopes: Partial<Slopes> }[];
  gone?: number[];
  at?: [x: number, y: number];
  viewport?: [w: number, h: number];
};

/** The stepped value, the second value and the object of every case. */
export const VALUE = "y";
export const OTHER = "x";
export const OBJECT = "dot";
/** The name of a case's `more` value k. */
export const moreName = (k: number) => `v${k + 1}`;

const SIZE_PX = 40;
const AT: [number, number] = [640, 360];
const VIEWPORT: [number, number] = [1280, 720];
const NO_SLOPES: Slopes = { cx: 0, cy: 0, w: 0, h: 0 };

/** How a unit draws the box, in px per unit, for a box of `size` px. */
function unitSlopes(unit: string, size: number): Slopes {
  if (unit === "px") return { cx: 0, cy: 1, w: 0, h: 0 };
  if (unit === "scale") return { cx: 0, cy: 0, w: size, h: size };
  return { cx: 0, cy: 0, w: 0, h: 0 };
}

/** A case's unit: px unless set. */
export const unitOf = (c: SteppedCase) => c.unit ?? "px";

/** A case's viewport, as GatePage `viewport()` gives it. */
export const viewOf = (c: SteppedCase) => ({ width: (c.viewport ?? VIEWPORT)[0], height: (c.viewport ?? VIEWPORT)[1] });

/** The values a case reports, the stepped one first: those its object's record lists in `moves`. */
export const movesOf = (c: SteppedCase) => [VALUE, ...(c.other ? [OTHER] : []), ...(c.more ?? []).map((_, k) => moreName(k))];

/** Holds expanded to one value per frame. */
const perFrame = (holds: [frames: number, value: number][]) => holds.flatMap(([n, v]) => Array<number>(n).fill(v));

/**
 * The frames of a case, one per 1/60 s: each carries the values, the dot's box and a scroll of 0. The frame count is
 * the sum of the drawings' holds.
 */
export function seriesOf(c: SteppedCase): Frame[] {
  const size = c.sizePx ?? SIZE_PX;
  const s = { ...unitSlopes(unitOf(c), size), ...c.slopes };
  const [x0, y0] = c.at ?? AT;
  const ys = perFrame(c.drawings);
  const v0 = ys[0] ?? 0;
  const dxs = c.other ? perFrame(c.other) : [];
  const more = (c.more ?? []).map((m) => ({ vs: perFrame(m.holds), s: { ...NO_SLOPES, ...m.slopes } }));
  const gone = new Set(c.gone ?? []);
  return ys.map((y, i) => {
    const dx = c.other ? (dxs[Math.min(i, dxs.length - 1)] ?? 0) : 0;
    const d = y - v0;
    let [cx, cy, w, h] = [x0 + dx + s.cx * d, y0 + s.cy * d, size + s.w * d, size + s.h * d];
    const values: Record<string, number> = c.other ? { [VALUE]: y, [OTHER]: dx } : { [VALUE]: y };
    more.forEach((m, k) => {
      const v = m.vs[Math.min(i, m.vs.length - 1)] ?? 0;
      const dm = v - (m.vs[0] ?? 0);
      [cx, cy, w, h] = [cx + m.s.cx * dm, cy + m.s.cy * dm, w + m.s.w * dm, h + m.s.h * dm];
      values[moreName(k)] = v;
    });
    const box: Box = gone.has(i) ? [cx - w / 2, cy - h / 2, 1, 1] : [cx - w / 2, cy - h / 2, w, h];
    return { ms: i * FRAME_MS, values, boxes: { [OBJECT]: box }, scroll: 0 };
  });
}

/**
 * A case as the rules read it: its frames, the dot's fit (fitSlopes on every value the case reports) and the stepped
 * value's drawings (drawingsOf, split at the value's still tolerance).
 */
export function caseDrawings(c: SteppedCase): { frames: Frame[]; fit: ObjectFit; drawings: Drawing[] } {
  const frames = seriesOf(c);
  const fit = fitSlopes(frames, OBJECT, movesOf(c), false);
  const drawings = drawingsOf(frames, VALUE, OBJECT, stillTol(series(frames, VALUE)), viewOf(c), false);
  return { frames, fit, drawings };
}

// ---------------------------------------------------------------------------------------------------------------------
// The stepped sweep: motions as a page times them, read as the envelope rule reads a stepped value.

/** Drawings as a page times them, in order: [ms shown, value] each. */
export type Timed = [ms: number, value: number][];

/**
 * A stepped motion as a page plays it, for the stepped sweep. It is drawn as a SteppedCase is (`unit`, `sizePx`,
 * `slopes`, `at`, `viewport`), but each value is timed in ms, as a page's clock shows it, and not in frames.
 *
 * - `value`: the stepped value's drawings, [ms shown, value] each.
 * - `more`: further values that move the box, each timed the same way, with its slopes per unit of change.
 * - `gone`: [ms, 1] spans where the object is not drawn, among [ms, 0] spans where it is.
 * - `loop`: the motion repeats after its last drawing (each timed list on its own period, all the same in practice);
 *   else every value holds its last drawing.
 * - `cuts`: cuts, in ms, as trace.json lists them.
 */
export type Motion = {
  value: Timed;
  unit?: string;
  sizePx?: number;
  slopes?: Partial<Slopes>;
  more?: { value: Timed; slopes: Partial<Slopes> }[];
  gone?: Timed;
  at?: [x: number, y: number];
  viewport?: [w: number, h: number];
  loop?: boolean;
  cuts?: number[];
};

const total = (t: Timed) => t.reduce((s, [ms]) => s + ms, 0);

/** The value timed list `t` shows at `ms`: the last drawing started by then (within 1e-6 ms), each period when `loop`. */
function timedAt(t: Timed, ms: number, loop: boolean): number {
  const period = total(t);
  const u = loop ? ms - period * Math.floor(ms / period + 1e-9) : ms;
  let [start, v] = [0, t[0]![1]];
  for (const [d, x] of t) {
    if (start > u + 1e-6) break;
    v = x;
    start += d;
  }
  return v;
}

/** Per-frame values gathered into [frames, value] holds. */
function holdsOf(vs: number[]): [frames: number, value: number][] {
  const out: [number, number][] = [];
  for (const v of vs) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

/**
 * The span the idle gate reads for a motion, in ms (idleSpan, with the loop's lead taken as 0): a loop of
 * LOOP_PERIOD_MS is read IDLE_PERIODS_READ periods and at least SPAN_MS; a longer loop to PERIODIC_SCAN_MS; a motion
 * that stops is read SETTLE_MS past its last drawing, at least SPAN_MS. Never past PERIODIC_SCAN_MS.
 */
export function spanOfMotion(m: Motion): number {
  const period = total(m.value);
  if (m.loop) return period >= LOOP_PERIOD_MS[0] - 1e-6 && period <= LOOP_PERIOD_MS[1] + 1e-6 ? Math.min(PERIODIC_SCAN_MS, Math.max(SPAN_MS, IDLE_PERIODS_READ * period)) : PERIODIC_SCAN_MS;
  const lastStart = total(m.value.slice(0, -1));
  return Math.min(PERIODIC_SCAN_MS, Math.max(SPAN_MS, lastStart + SETTLE_MS));
}

/**
 * A motion at an object size of `size` px: every px number scales by `size` over the motion's own size (40 unless
 * set), so it is the same motion in object lengths. A px value scales its drawings; any other value, and every `more`
 * value, scales its slopes. The box's place and the viewport scale too, so nothing leaves the view that did not.
 */
export function atSize(m: Motion, size: number): Motion {
  const k = size / (m.sizePx ?? SIZE_PX);
  const scale = (s: Partial<Slopes>) => Object.fromEntries(Object.entries(s).map(([key, v]) => [key, v * k])) as Partial<Slopes>;
  const px = (m.unit ?? "px") === "px";
  const [x, y] = m.at ?? AT;
  const [w, h] = m.viewport ?? VIEWPORT;
  return {
    ...m,
    sizePx: size,
    value: px ? m.value.map(([ms, v]): [number, number] => [ms, v * k]) : m.value,
    ...(!px && m.slopes ? { slopes: scale(m.slopes) } : {}),
    ...(m.more ? { more: m.more.map((o) => ({ ...o, slopes: scale(o.slopes) })) } : {}),
    at: [x * k, y * k],
    viewport: [w * k, h * k],
  };
}

/**
 * A motion as the envelope rule reads a stepped value (drawingJumps): the frames of the span plus MOVE_READ_AHEAD_MS,
 * the dot's slopes fitted on the span's frames, what the other fitted values explain over the whole read, the value's
 * drawings over the whole read, and the pops before the span's end. A step whose frame lies on a cut is skipped, as the
 * gate skips it.
 */
export function sweepRead(m: Motion): { pops: StepPop[]; drawings: Drawing[]; fit: ObjectFit } {
  const span = spanOfMotion(m);
  const n = Math.floor((span + MOVE_READ_AHEAD_MS) / FRAME_MS + 1e-6) + 1;
  const last = Math.floor(span / FRAME_MS + 1e-6);
  const loop = m.loop ?? false;
  const sample = (t: Timed) => Array.from({ length: n }, (_, f) => timedAt(t, f * FRAME_MS, loop));
  const gone = m.gone ? sample(m.gone).flatMap((g, f) => (g > 0.5 ? [f] : [])) : [];
  const c: SteppedCase = {
    drawings: holdsOf(sample(m.value)),
    ...(m.unit ? { unit: m.unit } : {}),
    ...(m.sizePx ? { sizePx: m.sizePx } : {}),
    ...(m.slopes ? { slopes: m.slopes } : {}),
    ...(m.more ? { more: m.more.map((o) => ({ holds: holdsOf(sample(o.value)), slopes: o.slopes })) } : {}),
    ...(gone.length > 0 ? { gone } : {}),
    ...(m.at ? { at: m.at } : {}),
    ...(m.viewport ? { viewport: m.viewport } : {}),
  };
  const frames = seriesOf(c);
  const inSpan = frames.slice(0, last + 1);
  const fit = fitSlopes(inSpan, OBJECT, movesOf(c), false);
  const drawings = drawingsOf(frames, VALUE, OBJECT, stillTol(series(inSpan, VALUE)), viewOf(c), false);
  const cuts = m.cuts ?? [];
  const skip = (f: number) => {
    const ms = (f - 1) * FRAME_MS;
    return cuts.some((t) => t >= ms - FRAME_MS && t <= ms + 2 * FRAME_MS);
  };
  const pops = stepPops(drawings, unitOf(c), fit.slopes.get(VALUE) ?? null, skip, frames.length - 1, fit.shifted, explainedBy(frames, fit, VALUE)).filter((p) => p.atFrame <= last);
  return { pops, drawings, fit };
}

/**
 * A stepped fixture page (stepped-pages.ts) as a motion: the dot's box as stepped.js draws it (left 600, top 320, the
 * page's size), moved by y as its unit says. A dot faded or scaled to nothing is gone. A turned dot keeps its box: a
 * look value's steps never read it.
 */
export function pageMotion(p: SteppedPage): Motion {
  const s = p.sizePx ?? SIZE_PX;
  const unit = p.unit ?? "px";
  const value: Timed = p.drawings.map(([ms, v], i) => {
    if (typeof v !== "number") throw new Error("pageMotion takes numbers only");
    const end = i + 1 < p.drawings.length ? p.drawings[i + 1]![0] : (p.periodMs ?? ms + 1e7);
    return [end - ms, v];
  });
  const v0 = value[0]![1];
  const goneAt = (v: number) => (unit === "opacity" || unit === "scale") && v <= 0;
  return {
    value,
    ...(unit === "px" ? {} : { unit }),
    sizePx: unit === "scale" ? s * v0 : s,
    ...(unit === "scale" ? { slopes: { w: s, h: s } } : {}),
    ...(value.some(([, v]) => goneAt(v)) ? { gone: value.map(([ms, v]): [number, number] => [ms, goneAt(v) ? 1 : 0]) } : {}),
    at: [600 + s / 2, 320 + s / 2 + (unit === "px" ? v0 : 0)],
    ...(p.periodMs !== undefined ? { loop: true } : {}),
    ...(p.cuts ? { cuts: p.cuts } : {}),
  };
}

/** A pose of a cel drawing: its box's centre (x, y) and size (w, h), and any look values. */
type Pose = Record<string, number>;

/**
 * A motion drawn as cel: drawings of a pose, each shown some ms, built by `hold` (the pose again), `draw` (a new pose)
 * and `move` (a drawing at each share of the way to a pose); `pingpong` adds the same drawings in reverse, so the loop
 * goes back the way it came.
 */
export class Cel {
  readonly ds: [ms: number, pose: Pose][] = [];
  private cur: Pose;
  constructor(first: Pose) {
    this.cur = first;
  }
  hold(ms: number) {
    this.ds.push([ms, { ...this.cur }]);
    return this;
  }
  draw(p: Pose, ms: number) {
    this.cur = { ...this.cur, ...p };
    return this.hold(ms);
  }
  move(to: Pose, shares: number[], ms: number) {
    const from = { ...this.cur };
    for (const f of shares) this.draw(Object.fromEntries(Object.entries(to).map(([k, v]) => [k, from[k]! + (v - from[k]!) * f])), ms);
    return this;
  }
  pingpong() {
    this.ds.push(...[...this.ds].reverse());
    return this;
  }
  /** One part of the pose, timed. */
  track(name: string): Timed {
    return this.ds.map(([ms, p]) => [ms, p[name]!]);
  }
}

/** Box coordinates each cel part draws, 1 px per px: x the centre x, y the centre y, w the width, h the height. */
const CEL_SLOPES: Record<string, Slopes> = {
  x: { cx: 1, cy: 0, w: 0, h: 0 },
  y: { cx: 0, cy: 1, w: 0, h: 0 },
  w: { cx: 0, cy: 0, w: 1, h: 0 },
  h: { cx: 0, cy: 0, w: 0, h: 1 },
};

/**
 * A cel loop judged on its part `judged` (x, y, w or h): the box is [x − w/2, y − h/2, w, h], the parts that change
 * besides it move the box too, and the first pose must be square (one size).
 */
export function celMotion(cel: Cel, judged: "x" | "y" | "w" | "h", loop = true): Motion {
  const p0 = cel.ds[0]![1];
  if (p0.w !== p0.h) throw new Error("celMotion needs a square first pose");
  const changes = (k: string) => cel.ds.some(([, p]) => p[k] !== p0[k]);
  return {
    value: cel.track(judged),
    slopes: CEL_SLOPES[judged]!,
    sizePx: p0.w!,
    at: [p0.x!, p0.y!],
    more: ["x", "y", "w", "h"].filter((k) => k !== judged && changes(k)).map((k) => ({ value: cel.track(k), slopes: CEL_SLOPES[k]! })),
    ...(loop ? { loop: true } : {}),
  };
}

/** A timed track from a value per drawing, `rate` drawings a second, over `ms`. */
export const byDrawing = (rate: number, ms: number, v: (t: number) => number): Timed =>
  Array.from({ length: Math.round((ms * rate) / 1000) }, (_, k): [number, number] => [1000 / rate, v(k / rate)]);
/** A timed track from a value per 1/60 s frame, over `frames` frames. */
export const byFrame = (frames: number, v: (f: number) => number): Timed => Array.from({ length: frames }, (_, f): [number, number] => [FRAME_MS, v(f)]);

// ---------------------------------------------------------------------------------------------------------------------
// The stepped sweep's cases.

/**
 * What a sweep case must give: "pass" (no pop before the span's end), the kind of the first pop (the one the gate
 * prints), any of a list of kinds where the rules allow either, or "fail" (any pop) for the sampled grid of generated
 * faults.
 */
export type Expect = "pass" | "fail" | StepPop["kind"] | StepPop["kind"][];
/**
 * One sweep case: a motion named by its behaviour, and what the rule must give. A px motion runs at object sizes of
 * 12, 40 and 120 px (atSize) unless `fixed` says it already sets its size; any other runs at its own size. `offView`
 * says the box leaves the viewport and is gone there, as it is on the fixture page the case is read from.
 */
export type SweepCase = { name: string; motion: Motion; expect: Expect; fixed?: true; offView?: true };

/** Drawing lengths in ms: ones, twos, threes and fours at 24 and 30 drawings a second. */
const R = { ones24: 1000 / 24, twos24: 1000 / 12, threes24: 125, fours24: 1000 / 6, ones30: 1000 / 30, twos30: 1000 / 15, threes30: 100 };
const F = FRAME_MS;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
/** Spacing charts: where each drawing of a move sits, the last at 1. */
const sio = (n: number) => range(n).map((k) => (1 - Math.cos((Math.PI * k) / n)) / 2);
const lin = (n: number) => range(n).map((k) => k / n);
const halving = (n: number) => range(n).map((k) => (k === n ? 1 : 1 - 2 ** -k));
const thirds = (n: number) => range(n).map((k) => (k === n ? 1 : 1 - (2 / 3) ** k));
const easeIn = (n: number) => range(n).map((k) => (k / n) ** 2);
const easeOut = (n: number) => range(n).map((k) => 1 - (1 - k / n) ** 2);
const eis = (p: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;

const [X0, Y0, GROUND] = [300, 360, 520];
const ball = (size: number, x = X0, y = Y0) => new Cel({ x, y, w: size, h: size });
/** A ball of `size` px there and back over `travel` px of x on `chart`, each drawing `ms` long, resting `rest` ms at each end. */
const pingPong = (size: number, travel: number, chart: number[], ms: number, rest = 250) => ball(size).hold(rest).move({ x: X0 + travel }, chart, ms).hold(rest).pingpong();
/** The centre y of a ball of height `h` that sits `lift` px above the ground. */
const above = (h: number, lift: number) => GROUND - h / 2 - lift;
/** A train of `n` twos drawings of `step` px along x, drawing `at` set `bump` px instead, then a hold and a slow way back. */
const train = (size: number, step: number, bump: number, at = 6, n = 12) => {
  const c = ball(size).hold(400);
  let x = X0;
  for (let k = 0; k < n; k++) c.draw({ x: (x += k === at ? bump : step) }, R.twos24);
  return c.hold(400).move({ x: X0 }, sio(12), R.twos24);
};
/** A twos train of 10 drawings of `step` px along x, drawing 6 knocked `off` px in y and back. */
const knocked = (off: number, step: number) => {
  const c = ball(40).hold(400);
  let x = X0;
  for (let k = 0; k < 10; k++) c.draw({ x: (x += step), y: Y0 + (k === 5 ? off : 0) }, R.twos24);
  return c.hold(400).move({ x: X0 }, sio(10), R.twos24);
};
/** A move along x on `chart`, each drawing `ms` long, between 400 ms holds, and a slow way back. */
const moveOn = (size: number, travel: number, chart: number[], ms: number) => ball(size).hold(400).move({ x: X0 + travel }, chart, ms).hold(400).move({ x: X0 }, sio(10), R.twos24);
const swapped = (c: number[], a: number, b: number) => {
  const out = [...c];
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
};
/** A decaying bounce on twos (hops of 200, 110 and 50 px), one contact drawing each; `squash` squashes it. */
const bounce = (size: number, squash: boolean, contactMs = R.twos24) => {
  const c = ball(size, X0, above(size, 0)).hold(500);
  for (const [lift, n] of [[200, 10], [110, 8], [50, 6]] as const) {
    for (let k = 1; k < n; k++) c.draw({ w: size, h: size, y: above(size, lift * 4 * (k / n) * (1 - k / n)) }, R.twos24);
    c.draw(squash ? { w: size * 1.25, h: size * 0.75, y: above(size * 0.75, 0) } : { y: above(size, 0) }, contactMs);
  }
  return c.draw({ w: size, h: size, y: above(size, 0) }, 600);
};
/** One cel part at a time: a look value as a motion on a still box. */
const look = (track: Timed, unit: string, sizePx = 40, loop = true): Motion => ({ value: track, unit, sizePx, at: [640, Y0], ...(loop ? { loop: true } : {}) });
/** A cel loop of a look part `name` (o, r) of a box `size` px, from its first pose. */
const lookCel = (cel: Cel, name: string, unit: string, size: number) => look(cel.track(name), unit, size);
/** A square of `size` px at the centre with look values `o` (opacity) and `r` (degrees). */
const square = (size: number, extra: Pose = {}) => new Cel({ x: 640, y: Y0, w: size, h: size, o: 1, r: 0, ...extra });

/** A drift of x along a 40 px dot's box at `x0` (centre x = x0 + 20 + x), as a px value. */
const alongX = (value: Timed, x0: number, extra: Partial<Motion> = {}): Motion => ({ value, slopes: { cx: 1, cy: 0 }, at: [x0 + 20, 360], ...extra });

/**
 * A creep of 2 px a drawing on twos along x, then two key holds of `holdMs` with a snap of `jump` px between them, then
 * the creep on, a rest and a slow way back.
 */
const forgedHolds = (jump: number, holdMs = 7 * F) => {
  const c = ball(40).hold(400);
  let x = X0;
  for (let k = 0; k < 15; k++) c.draw({ x: (x += 2) }, 2 * F);
  c.draw({ x }, holdMs).draw({ x: (x += jump) }, holdMs);
  for (let k = 0; k < 15; k++) c.draw({ x: (x += 2) }, 2 * F);
  return c.hold(400).move({ x: X0 }, sio(10), R.twos24);
};

/** Cases from the stepped rule's table and the stepped pages that were judged wrongly: each must fail with its kind. */
export const REVIEW_FAULTS: SweepCase[] = [
  // A snap between two key holds of 100 to 250 ms is no rest-to-rest move: it is judged against the steps just past
  // the holds, and a snap of more than a length is a teleport between them. A pop in the first drawings after load
  // leaves the start, a rest.
  { name: "a 0.9-length snap between two 117 ms holds in a creep of 2 px a drawing", motion: celMotion(forgedHolds(36), "x"), expect: "spike" },
  { name: "a 0.95-length snap between two 117 ms holds in a creep of 2 px a drawing", motion: celMotion(forgedHolds(38), "x"), expect: "spike" },
  { name: "a 2-length snap between two 117 ms holds in a creep of 2 px a drawing", motion: celMotion(forgedHolds(80), "x"), expect: ["teleport", "spike"] },
  { name: "a 2-length snap between two 200 ms holds in a creep of 2 px a drawing", motion: celMotion(forgedHolds(80, 12 * F), "x"), expect: ["teleport", "spike"] },
  { name: "a 10-length pop 50 ms after load, held to the end", motion: alongX([[3 * F, 0], [1e7, 400]], 200), expect: "teleport", fixed: true },
  // A release from a hold is judged by the spike against the steps after it.
  { name: "an anticipation, then a release drawing at 70% of the move", motion: celMotion(ball(40).hold(400).move({ x: X0 - 14 }, sio(3), R.twos24).hold(300).move({ x: X0 + 200 }, [0.7, 0.88, 0.96, 1], R.twos24).hold(400).move({ x: X0 }, sio(10), R.twos24), "x"), expect: "spike" },
  // Two 0.6 s holds at the read's start, and a release out of the second: the read's start cuts the second hold's
  // left side short, which must not make it a moving drawing.
  { name: "a release drawing at 70% out of the second of two 0.6 s holds at the read's start", motion: celMotion(ball(40).hold(600).draw({ x: X0 + 32 }, 600).move({ x: X0 + 232 }, [0.7, 0.88, 0.96, 1], R.twos24).hold(600), "x", false), expect: "spike" },
  { name: "a snappy ease out of a hold whose first drawing covers 65%", motion: celMotion(ball(40).hold(500).move({ x: X0 + 200 }, [0.65, 0.85, 0.95, 1], R.twos24).hold(500).move({ x: X0 }, sio(10), R.twos24), "x"), expect: "spike" },
  // Pops in a train.
  { name: "one 60 px step in a train of 10 px steps on a 40 px dot", motion: celMotion(train(40, 10, 60), "x"), expect: "spike" },
  { name: "one 60 px step in a train of 10 px steps on a 200 px object", motion: celMotion(train(200, 10, 60), "x"), expect: "spike" },
  { name: "one 20 px step in a train of 4 px steps on an 8 px dot", motion: celMotion(train(8, 4, 20), "x"), expect: "spike" },
  { name: "one 60 px step in a drift of 5 px steps", motion: celMotion(train(40, 5, 60, 7, 14), "x"), expect: "spike" },
  { name: "three in-betweens missing from a move on ones", motion: celMotion(moveOn(40, 240, sio(14).filter((_, k) => k < 5 || k > 7), R.ones24), "x"), expect: "spike" },
  { name: "one in-between missing from a move on threes, so one step covers two", motion: celMotion(moveOn(40, 200, sio(10).filter((_, k) => k !== 5), R.threes24), "x"), expect: "spike" },
  { name: "a dot in a staggered group that skips ahead two drawings, then holds one", motion: celMotion(ball(40).hold(300 + 2 * R.twos24).move({ x: X0 + 200 }, sio(8).map((f, k) => (k === 3 ? sio(8)[5]! : f)), R.twos24).hold(600).move({ x: X0 }, sio(8), R.twos24).hold(300 + 2 * R.twos24), "x"), expect: "spike" },
  // Rest to rest.
  { name: "a jump of 2 lengths in one drawing between 0.6 s holds", motion: celMotion(ball(40).hold(600).draw({ x: X0 + 80 }, 600).move({ x: X0 }, sio(8), R.twos24), "x"), expect: "teleport" },
  { name: "a dot that jumps 2.5 lengths between holds while its group moves", motion: celMotion(ball(40).hold(600).draw({ x: X0 + 100 }, 600).move({ x: X0 }, sio(8), R.twos24), "x"), expect: "teleport" },
  { name: "an even train of 1.5-length steps at 2 drawings a second", motion: celMotion(pingPong(40, 240, lin(4), 500, 500), "x"), expect: "teleport" },
  { name: "a dot that teleports 3 lengths between 0.5 s holds, and back", motion: alongX([[500, 0], [500, 120]], 620, { loop: true }), expect: "teleport" },
  { name: "a slideshow with a 1-frame in-between halfway, 3 lengths a slide", motion: alongX([[1000, 0], [F, 60], [1000, 120], [F, 60]], 300, { loop: true }), expect: "teleport" },
  { name: "a hold, one 2-frame drawing halfway, and a hold 10 lengths away", motion: alongX([[900, 420], [33.3, 620], [966.7, 820], [33.3, 620], [66.7, 420]], 420, { at: [440, 360], loop: true }), expect: "teleport" },
  { name: "a held dot that shows one 2-frame drawing 1.5 lengths off", motion: alongX([[800, 0], [33.3, 60], [666.7, 0]], 620, { loop: true }), expect: "teleport" },
  { name: "a teleport of 3 lengths between holds forged with a 0.05 px drift every frame", motion: alongX(byFrame(60, (n) => (n < 30 ? 0 : 120) + 0.05 * (n % 30)), 620, { loop: true }), expect: ["teleport", "spike"] },
  // A triangle of three holds, each leg through one 2-frame drawing halfway: no step comes back.
  ...(["x", "y"] as const).map((judged): SweepCase => {
    const P = [[420, 340], [820, 340], [620, 60]] as const;
    const parts = (i: 0 | 1): Timed => P.flatMap((a, k): Timed => [[766.7, a[i] + 20], [33.3, (a[i] + P[(k + 1) % 3]![i]) / 2 + 20]]);
    const [own, oth] = judged === "x" ? [0, 1] : [1, 0];
    return { name: `a triangle of holds through 2-frame drawings halfway, judged on ${judged}`, motion: { value: parts(own as 0 | 1), slopes: CEL_SLOPES[judged]!, at: [440, 360], more: [{ value: parts(oth as 0 | 1), slopes: CEL_SLOPES[judged === "x" ? "y" : "x"]! }], loop: true }, expect: "teleport" };
  }),
  // Gone gaps are bridged.
  { name: "a dot blanked one frame that comes back 10 lengths away", motion: alongX([[1000, 0], [1000, 400]], 380, { gone: [[1000 - F, 0], [F, 1], [1000, 0]], loop: true }), expect: "teleport" },
  { name: "a dot hidden for a 2-frame drawing that comes back 5 lengths away", motion: { ...alongX([[933.3, 0], [966.7, 200], [100, 0]], 520, { gone: [[900, 0], [33.3, 1], [966.7, 0], [33.3, 1], [66.7, 0]], loop: true }), more: [{ value: [[900, 1], [33.3, 0], [966.7, 1], [33.3, 0], [66.7, 1]], slopes: {} }] }, expect: "teleport" },
  { name: "a dot hidden for a 2-frame drawing halfway that comes back 5 lengths away", motion: alongX([[900, 0], [33.3, 100], [966.7, 200], [33.3, 100], [66.7, 0]], 520, { gone: [[900, 0], [33.3, 1], [966.7, 0], [33.3, 1], [66.7, 0]], loop: true }), expect: "teleport" },
  { name: "a teleport of 4 lengths between 0.55 s holds whose box is gone on each drawing's first frame", motion: alongX([[33 * F, 0], [33 * F, 160]], 620, { gone: [[F, 1], [32 * F, 0], [F, 1], [32 * F, 0]], loop: true }), expect: "teleport" },
  // Size parts: a snap between rests.
  { name: "a 40 px dot that snaps to 400 px wide between 0.6 s holds, as a px width", motion: { value: [[600, 40], [600, 400]], slopes: { cx: 0, cy: 0, w: 1, h: 1 }, loop: true }, expect: "teleport" },
  { name: "a 40 px dot that snaps to scale 10 between rests", motion: { value: [[500, 1], [1e7, 10]], unit: "scale" }, expect: "teleport" },
  { name: "a 40 px dot that snaps to 400 px wide through one 2-frame drawing 220 px wide", motion: { value: [[600, 40], [33.3, 220], [600, 400]], slopes: { cx: 0, cy: 0, w: 1, h: 1 }, loop: true }, expect: "teleport" },
  // A value with no slopes takes off what the fitted values explain, and its own size snap still fails: w and h snap
  // from 40 to 400 px together (so neither has slopes) as y lands from a hop.
  ...(["w", "h"] as const).map((judged): SweepCase => ({ name: `a dot that snaps from 40 to 400 px as it lands from a hop, judged on ${judged}`, motion: celMotion((() => {
    const c = ball(40, X0, above(40, 0)).hold(500);
    for (let k = 1; k <= 9; k++) c.draw({ y: above(40, 200 * 4 * (k / 10) * (1 - k / 10)) }, R.twos24);
    return c.draw({ w: 400, h: 400, y: above(400, 0) }, 600).draw({ w: 40, h: 40, y: above(40, 0) }, 500);
  })(), judged), expect: "teleport" })),
  // Two big steps in a row cannot shield each other.
  ...[
    ["two drawings of 4 lengths in a row in a creep of 1 px a drawing", 160, 320],
    ["one drawing of 2 lengths in a creep of 1 px a drawing", 80, 80],
  ].map(([name, a, b]): SweepCase => {
    const J = (u: number) => (u < 1 ? 0 : u < 1.02 ? (a as number) : (b as number));
    return { name: name as string, motion: alongX(byDrawing(30, 4000, (t) => (t < 2 ? 30 * t + J(t) : 30 * (4 - t) + (b as number) - J(t - 2))), 300, { loop: true }), expect: "spike" };
  }),
  // Excursions: off the path and back.
  { name: "a knock 0.6 lengths ahead and back in a slow train of 4 px steps", motion: celMotion((() => {
    const c = ball(40).hold(400);
    for (let k = 0; k < 10; k++) c.draw({ x: X0 + 4 * (k + 1) + (k === 5 ? 24 : 0) }, R.twos24);
    return c.hold(400).move({ x: X0 }, sio(10), R.twos24);
  })(), "x"), expect: "spike" },
  { name: "drawings 5 and 6 of a slow in and out swapped, on a 40 px dot", motion: celMotion(moveOn(40, 240, swapped(sio(10), 4, 5), R.twos24), "x"), expect: "outAndBack" },
  { name: "drawings 5 and 6 of a slow in and out swapped, on a 16 px dot", motion: celMotion(moveOn(16, 240, swapped(sio(10), 4, 5), R.twos24), "x"), expect: "outAndBack" },
  { name: "drawings 5 and 6 of a slow in and out swapped, on a 100 px object (0.74 lengths)", motion: celMotion(moveOn(100, 240, swapped(sio(10), 4, 5), R.twos24), "x"), expect: "spike" },
  { name: "drawings 3 and 7 of an even train swapped", motion: celMotion(moveOn(40, 200, swapped(lin(10), 2, 6), R.twos24), "x"), expect: "outAndBack" },
  { name: "a drawing knocked 1.5 lengths across a train's path and back", motion: celMotion(knocked(60, 20), "y"), expect: "teleport" },
  { name: "a drawing knocked 0.75 lengths across a train's path and back", motion: celMotion(knocked(30, 20), "y"), expect: "spike" },
  { name: "a drawing knocked 0.75 lengths across a slow train's path and back", motion: celMotion(knocked(30, 4), "y"), expect: "spike" },
  // Look values get the spike.
  { name: "a fade on twos with one drawing dropped to its end early, and back", motion: look([[400, 1], ...sio(8).map((f, k): [number, number] => [R.twos24, k === 2 ? 0.2 : 1 - 0.8 * f]), [400, 0.2], ...sio(8).map((f): [number, number] => [R.twos24, 0.2 + 0.8 * f])], "opacity", 60), expect: "spike" },
  { name: "a sway on twos with one drawing turned 40° further, and back", motion: look([[300, -20], ...sio(8).map((f, k): [number, number] => [R.twos24, -20 + 40 * f + (k === 3 ? 40 : 0)]), [300, 20], ...sio(8).map((f): [number, number] => [R.twos24, 20 - 40 * f])], "deg", 80), expect: "spike" },
];

/** Honest cases from the stepped rule's table and the stepped pages that were judged wrongly: each must pass. */
export const REVIEW_HONEST: SweepCase[] = [
  // Key holds with snaps and nothing slower around them: each snap is under a length, so it passes.
  { name: "key poses held 150 ms, each a 0.9-length snap from the last, in a loop", motion: celMotion(ball(40).hold(150).draw({ x: X0 + 36 }, 150).draw({ x: X0 + 72 }, 150).draw({ x: X0 + 36 }, 150).draw({ x: X0 }, 150).draw({ x: X0 - 36 }, 150).draw({ x: X0 - 72 }, 150).draw({ x: X0 - 36 }, 150), "x"), expect: "pass" },
  // A snap between two holds as fast as the creep around it is no pop.
  { name: "a 4 px snap between two 117 ms holds in a creep of 2 px a drawing", motion: celMotion(forgedHolds(4), "x"), expect: "pass" },
  // A small first drawing out of the start is no pop.
  { name: "a 0.3-length step 50 ms after load, held to the end", motion: alongX([[3 * F, 0], [1e7, 12]], 200), expect: "pass", fixed: true },
  // Releases and charts the spike passes (3 times or less).
  { name: "an anticipation, then a release at 50% of the move", motion: celMotion(ball(40).hold(400).move({ x: X0 - 14 }, sio(3), R.twos24).hold(300).move({ x: X0 + 200 }, [0.5, 0.8, 0.94, 1], R.twos24).hold(400).move({ x: X0 }, sio(10), R.twos24), "x"), expect: "pass" },
  { name: "a halving chart out of a hold, 2.5 lengths first", motion: celMotion(ball(40).hold(400).move({ x: X0 + 200 }, halving(6), R.twos24).hold(400).move({ x: X0 }, sio(8), R.twos24), "x"), expect: "pass" },
  { name: "a thirds chart into the key", motion: celMotion(ball(40).hold(400).move({ x: X0 + 200 }, thirds(7), R.twos24).hold(400).move({ x: X0 }, sio(8), R.twos24), "x"), expect: "pass" },
  { name: "a fall that eases in to a hard stop", motion: celMotion(ball(40, X0, 150).hold(400).move({ y: 390 }, easeIn(7), R.twos24).hold(500).move({ y: 150 }, sio(10), R.twos24), "y"), expect: "pass" },
  { name: "a drawn settle past the key and back", motion: celMotion((() => {
    const c = ball(40).hold(500);
    for (const f of [0.35, 0.75, 1.08, 0.97, 1.01, 1]) c.draw({ x: X0 + 200 * f }, R.twos24);
    return c.hold(500).move({ x: X0 }, sio(10), R.twos24);
  })(), "x"), expect: "pass" },
  { name: "a move, a moving hold creeping 1 px a drawing for 1 s, and a move on", motion: celMotion((() => {
    const c = ball(40).hold(400).move({ x: X0 + 150 }, sio(6), R.twos24);
    for (let k = 1; k <= 12; k++) c.draw({ x: X0 + 150 + k }, R.twos24);
    return c.move({ x: X0 + 300 }, sio(6), R.twos24).hold(400).move({ x: X0 }, sio(10), R.twos24);
  })(), "x"), expect: "pass" },
  { name: "a pose pop of 0.8 lengths between 0.6 s holds", motion: celMotion(ball(40).hold(600).draw({ x: X0 + 32 }, 600).move({ x: X0 }, sio(6), R.twos24), "x"), expect: "pass" },
  // Under SPIKE_MIN on a big object (a judgement: 0.2 lengths reads small).
  { name: "one 40 px step in a train of 10 px steps on a 200 px object", motion: celMotion(train(200, 10, 40), "x"), expect: "pass" },
  { name: "one 48 px step in a train of 10 px steps on a 200 px object", motion: celMotion(train(200, 10, 48), "x"), expect: "pass" },
  // Turns and alternations are no excursion.
  ...[24, 60].flatMap((size) => (["y", "w", "h"] as const).map((judged): SweepCase => ({ name: `a decaying bounce with a squashed contact drawing, ${size} px, judged on ${judged}`, motion: celMotion(bounce(size, true), judged), expect: "pass" }))),
  { name: "a decaying bounce with one contact drawing", motion: celMotion(bounce(24, false), "y"), expect: "pass" },
  { name: "a decaying bounce with its contact held two drawings", motion: celMotion(bounce(24, false, 2 * R.twos24), "y"), expect: "pass" },
  ...(["y", "w", "h"] as const).map((judged): SweepCase => ({ name: `a hop with a contact squash drawing, judged on ${judged}`, motion: celMotion((() => {
    const c = ball(40, X0, above(40, 0)).hold(500);
    for (let k = 1; k <= 9; k++) c.draw({ y: above(40, 200 * 4 * (k / 10) * (1 - k / 10)) }, R.twos24);
    return c.draw({ w: 52, h: 28, y: above(28, 0) }, R.twos24).draw({ w: 40, h: 40, y: above(40, 0) }, 500);
  })(), judged), expect: "pass" })),
  { name: "a hop that lands on a 0.5 s rest", motion: celMotion((() => {
    const c = ball(40, X0, above(40, 0)).hold(500);
    for (let k = 1; k <= 9; k++) c.draw({ y: above(40, 200 * 4 * (k / 10) * (1 - k / 10)) }, R.twos24);
    return c.draw({ y: above(40, 0) }, 500);
  })(), "y"), expect: "pass" },
  { name: "a yo-yo that falls easing in and is held 0.2 s at the bottom", motion: celMotion(ball(40, 640, 140).hold(300).move({ y: 380 }, easeIn(6), R.twos24).hold(100).pingpong(), "y"), expect: "pass" },
  { name: "an even walk of 1.2 lengths a drawing that turns at 0.4 s rests", motion: celMotion(pingPong(40, 288, lin(6), R.twos24, 400), "x"), expect: "pass" },
  { name: "a cartoon shake of 0.9 lengths each side every 2 frames, then a rest", motion: alongX([[1600, 0], ...Array.from({ length: 12 }, (_, k): [number, number] => [1000 / 30, k % 2 ? -18 : 18])], 620, { loop: true }), expect: "pass" },
  { name: "drawn staggers on ones: 12 px on, 6 px back", motion: celMotion((() => {
    const c = ball(40).hold(400);
    let x = X0;
    for (let k = 0; k < 16; k++) c.draw({ x: (x += k % 2 ? -6 : 12) }, R.ones24);
    return c.hold(400).move({ x: X0 }, sio(10), R.twos24);
  })(), "x"), expect: "pass" },
  { name: "an even train on fours with one accent drawing held three times as long", motion: celMotion((() => {
    const c = ball(40).hold(400);
    let x = X0;
    for (let k = 0; k < 10; k++) c.draw({ x: (x += 16) }, k === 4 ? 3 * R.fours24 : R.fours24);
    return c.hold(400).move({ x: X0 }, sio(10), R.twos24);
  })(), "x"), expect: "pass" },
  // Look values get the spike only.
  { name: "a cursor blink: opacity 1 and 0 for 0.5 s each, gone while hidden", motion: { ...look([[500, 1], [500, 0]], "opacity"), gone: [[500, 0], [500, 1]] }, expect: "pass" },
  { name: "an indicator blinking between opacity 1 and 0.35 for 0.5 s each", motion: look([[500, 1], [500, 0.35]], "opacity"), expect: "pass" },
  { name: "a neon flicker: opacity 1 and 0.2 on ones, then a hold", motion: lookCel((() => {
    const c = square(60).hold(800);
    for (const o of [0.2, 1, 0.2, 1, 0.2]) c.draw({ o }, R.ones24);
    return c.draw({ o: 1 }, 800);
  })(), "o", "opacity", 60), expect: "pass" },
  { name: "a fade to 0.15 on twos and back", motion: lookCel(square(60).hold(400).move({ o: 0.15 }, sio(8), R.twos24).hold(400).pingpong(), "o", "opacity", 60), expect: "pass" },
  { name: "a dial hand ticking 30° once a second", motion: look(Array.from({ length: 20 }, (_, k): [number, number] => [1000, 30 * k]), "deg", 40, false), expect: "pass" },
  { name: "a drawn shiver of ±10° on ones, then a rest", motion: lookCel((() => {
    const c = square(80).hold(600);
    for (let k = 0; k < 10; k++) c.draw({ r: k % 2 ? -10 : 10 }, R.ones24);
    return c.draw({ r: 0 }, 600);
  })(), "r", "deg", 80), expect: "pass" },
  { name: "a turn to 90° on fours, up to 23.6° a drawing", motion: lookCel(square(80).hold(400).move({ r: 90 }, sio(6), R.fours24).hold(400).pingpong(), "r", "deg", 80), expect: "pass" },
  { name: "a wheel turning 30° a drawing on fours, its angle growing", motion: look(Array.from({ length: 120 }, (_, k): [number, number] => [R.fours24, 30 * k]), "deg", 80, false), expect: "pass" },
  { name: "a wheel turning 30° a drawing on twos, its angle wrapped to 0 to 330", motion: look(Array.from({ length: 12 }, (_, k): [number, number] => [R.twos24, 30 * k]), "deg", 80), expect: "pass" },
  { name: "a sprite frame index cycling on twos", motion: look(Array.from({ length: 12 }, (_, k): [number, number] => [R.twos24, k % 4]), "index", 80), expect: "pass" },
  // Size parts get the teleport line only.
  ...(["x", "w"] as const).flatMap((judged) =>
    ([["twos", R.twos24], ["fours", R.fours24]] as const).map(([on, ms]): SweepCase => ({
      name: `a fast move with smear drawings on ${on}, judged on ${judged}`,
      motion: celMotion(ball(40, 200).hold(400).draw({ x: 230 }, ms).draw({ x: 330, w: 140 }, ms).draw({ x: 480, w: 160 }, ms).draw({ x: 580, w: 60 }, ms).draw({ x: 600, w: 40 }, ms).hold(400).move({ x: 200 }, sio(12), R.twos24), judged),
      expect: "pass",
    })),
  ),
  // One 2-frame smear drawing over the whole 400 px path: x as the box's left edge, and as its centre.
  ...(["x", "w"] as const).flatMap((judged) =>
    [
      ["the left edge", [[933.3, 420], [966.7, 820], [100, 420]], { cx: 1 }, { cx: 0.5, w: 1 }, 440],
      ["the centre", [[900, 440], [33.3, 640], [966.7, 840], [33.3, 640], [66.7, 440]], { cx: 1 }, { w: 1 }, 440],
    ].map(([edge, xs, xSlopes, wSlopes, cx]): SweepCase => {
      const ws: Timed = [[900, 40], [33.3, 440], [966.7, 40], [33.3, 440], [66.7, 40]];
      const [x, w] = [{ value: xs as Timed, slopes: { cx: 0, cy: 0, w: 0, h: 0, ...(xSlopes as Partial<Slopes>) } }, { value: ws, slopes: { cx: 0, cy: 0, w: 0, h: 0, ...(wSlopes as Partial<Slopes>) } }];
      const [own, oth] = judged === "x" ? [x, w] : [w, x];
      return { name: `one smear drawing over a 10-length path, x ${edge}, judged on ${judged}`, motion: { value: own.value, slopes: own.slopes, at: [cx as number, 360], more: [oth], loop: true }, expect: "pass" };
    }),
  ),
  { name: "a blink by scaleY on ones", motion: { value: [[1200, 1], [R.ones24, 0.5], [R.ones24, 0.05], [R.ones24, 0.05], [R.ones24, 0.5], [1200, 1]], unit: "scale", slopes: { w: 0, h: 40 }, loop: true }, expect: "pass" },
  { name: "a sparkle that pops in from nothing and holds", motion: { value: [[1000, 1], [1000, 0]], unit: "scale", gone: [[1000, 0], [1000, 1]], loop: true }, expect: "pass" },
  { name: "a scale pulse to 1.3 and back on twos", motion: { value: [[500, 1], ...sio(4).map((f): [number, number] => [R.twos24, 1 + 0.3 * f]), ...sio(4).map((f): [number, number] => [R.twos24, 1.3 - 0.3 * f]), [500, 1]], unit: "scale", sizePx: 60, loop: true }, expect: "pass" },
  // A ball that drops on twos at 30 and squashes for 2 drawings: y moves the box, the squash (a ratio) widens it,
  // flattens it and keeps it on the ground.
  ...(["y", "squash"] as const).map((judged): SweepCase => {
    const y = byDrawing(30, 2000, (t) => (t < 0.9 ? -200 * (1 - ((t - 0.45) / 0.45) ** 2) : 0));
    const sq: Timed = [[900, 0], [400 / 3, 0.4], [2000 - 900 - 400 / 3, 0]];
    const [ys, sqs] = [{ cx: 0, cy: 1, w: 0, h: 0 }, { cx: 0, cy: 20, w: 40, h: -40 }];
    return judged === "y"
      ? { name: "a drop on twos that squashes for 2 drawings, judged on y", motion: { value: y, slopes: ys, more: [{ value: sq, slopes: sqs }], loop: true }, expect: "pass" }
      : { name: "a drop on twos that squashes for 2 drawings, judged on its squash", motion: { value: sq, unit: "ratio", slopes: sqs, more: [{ value: y, slopes: ys }], loop: true }, expect: "pass" };
  }),
  // Threes and fours with steps over 1 length: no rests, so the spike only.
  { name: "a slow in and out on threes, 160 px on a 16 px ball", motion: celMotion(pingPong(16, 160, sio(8), R.threes24), "x"), expect: "pass" },
  { name: "a slow in and out on threes, 160 px on an 8 px ball", motion: celMotion(pingPong(8, 160, sio(8), R.threes24), "x"), expect: "pass" },
  { name: "a fast throw on threes, 3.3 lengths a drawing", motion: celMotion(ball(24, 200).hold(400).move({ x: 600 }, lin(5), R.threes24).hold(400).move({ x: 200 }, sio(12), R.twos24), "x"), expect: "pass" },
  { name: "a fast throw on twos, 3.3 lengths a drawing", motion: celMotion(ball(24, 200).hold(400).move({ x: 600 }, lin(5), R.twos24).hold(400).move({ x: 200 }, sio(12), R.twos24), "x"), expect: "pass" },
  { name: "an even train on fours, 1.2 lengths a drawing", motion: celMotion(pingPong(40, 288, lin(6), R.fours24, 400), "x"), expect: "pass" },
  { name: "an even train on threes at 30, 1.5 lengths a drawing", motion: celMotion(pingPong(40, 300, lin(5), R.threes30, 400), "x"), expect: "pass" },
  ...[5, 6].map((frames): SweepCase => ({
    name: `a march of 1.5-length steps in ${frames}-frame drawings with a 0.5 s hold at each end`,
    motion: alongX(byFrame(12 * frames + 60, (n) => {
      const half = 6 * frames + 30;
      const k = Math.min(6, Math.floor((n % half) / frames));
      return n < half ? 60 * k : 360 - 60 * k;
    }), 400, { loop: true }),
    expect: "pass",
  })),
  { name: "stop-motion with uneven holds of 2 to 4 frames, sliding 120 px and back", motion: alongX((() => {
    const holds = [2, 3, 2, 4, 3, 2, 3, 4];
    const out: Timed = [];
    for (let f = 0, k = 0; f < 180; f += holds[k % 8]!, k++) {
      const t = f / 60;
      out.push([Math.min(holds[k % 8]!, 180 - f) * F, 120 * (eis(t) - eis(t - 1.5))]);
    }
    return out;
  })(), 620, { loop: true }), expect: "pass" },
  { name: "a hop on twos at 30 with an eased rise and fall", motion: { value: byDrawing(30, 2000, (t) => -60 * (eis((t - 0.5) / 0.4) - eis((t - 1.2) / 0.4))), loop: true }, expect: "pass" },
  { name: "a fast hop on threes at 20, 0.65 lengths a drawing at its fastest", motion: { value: byDrawing(20, 2000, (t) => -100 * (eis((t - 0.5) / 0.3) - eis((t - 1.2) / 0.3))), loop: true }, expect: "pass" },
  // Fitted coordinates: a value is charged with its own part of the box only.
  ...(["y", "x"] as const).map((judged): SweepCase => ({ name: `a drop, a short rest, a roll and back by the same path, judged on ${judged}`, motion: celMotion(ball(40, X0, 160).hold(400).move({ y: above(40, 0) }, easeIn(6), R.twos24).hold(200).move({ x: X0 + 300 }, easeOut(8), R.twos24).hold(400).move({ y: 160 }, sio(8), R.twos24).move({ x: X0 }, sio(8), R.twos24), judged), expect: "pass" })),
  ...(["x", "y"] as const).map((judged): SweepCase => ({ name: `an L path with no rest at the corner, judged on ${judged}`, motion: celMotion(ball(40, X0, 200).hold(400).move({ x: X0 + 240 }, sio(8), R.twos24).move({ y: 440 }, sio(8), R.twos24).hold(400).move({ y: 200 }, sio(8), R.twos24).move({ x: X0 }, sio(8), R.twos24), judged), expect: "pass" })),
  ...(["x", "y"] as const).map((judged): SweepCase => ({ name: `a diagonal move as two values, judged on ${judged}`, motion: celMotion(ball(40, X0, 200).hold(400).move({ x: X0 + 300, y: 440 }, sio(8), R.twos24).hold(400).move({ x: X0, y: 200 }, sio(10), R.twos24), judged), expect: "pass" })),
  { name: "a stepped y bobbing at 8 drawings a second on a dot a smooth x sways 300 px", motion: { value: byDrawing(8, 2000, (t) => 6 * Math.sin(Math.PI * 4 * t + 0.3)), more: [{ value: byFrame(120, (f) => 300 * Math.sin((2 * Math.PI * f) / 120)), slopes: { cx: 1 } }], loop: true }, expect: "pass" },
  { name: "a facing flip on a walker: scaleX ±1 leaves the box as it is", motion: { value: Array.from({ length: 6 }, (_, k): [number, number] => [20 * F, k % 2 ? -1 : 1]), unit: "scale", slopes: { w: 0, h: 0 }, more: [{ value: byFrame(120, (i) => (i % 40 < 20 ? 5 * (i % 40) : 5 * (40 - (i % 40)))), slopes: { cx: 1 } }], at: [400, 360], loop: true }, expect: "pass" },
];

/**
 * A position run that goes out and comes back may sit next to a hold; a look value's run always needs
 * moving steps on both sides.
 */
export const RULING_CASES: SweepCase[] = [
  { name: "a position drop and back right before a hold", motion: { value: [...[0, -4.5, -9, -72, -13.5].map((v): [number, number] => [5 * F, v]), [1e7, -18]] }, expect: "spike" },
  { name: "an opacity drop and back right before a hold, on a still dot", motion: look([...[1, 0.95, 0.9, 0.2, 0.85].map((v): [number, number] => [5 * F, v]), [1e7, 0.8]], "opacity", 40, false), expect: "pass" },
  { name: "an opacity drop and back right before a hold, on a dot another value slides 3 px a frame", motion: { ...look([...[1, 0.95, 0.9, 0.2, 0.85].map((v): [number, number] => [5 * F, v]), [1e7, 0.8]], "opacity", 40, false), at: [400, 360], more: [{ value: [...byFrame(55, (i) => 3 * i), [1e7, 165]], slopes: { cx: 1 } }] }, expect: "pass" },
];

/** The stepped fixture pages that were judged wrongly, rebuilt by behaviour, and the honest stepped fixture pages. */
const REVIEWED_FAULT_KINDS: Record<string, Expect> = {
  "teleport in a slow drift": "spike",
  slideshow: "teleport",
  "pop before the first rest": "spike",
  "equal holds 3 lengths apart": "teleport",
  "pop in an even train": "spike",
  "pop in a long move": "spike",
  "pop out of a rest": "spike",
  // The rule's table: a walker that jumps ahead, has a drawing off its path or out of order, or wraps with no cut
  // fails as a spike or an excursion.
  "walker jumps ahead": ["spike", "outAndBack"],
  "walker drawing off its path": ["spike", "outAndBack"],
  "walker drawing out of order": ["spike", "outAndBack"],
  "walker wraps with no cut": ["spike", "outAndBack"],
};
export const PAGE_CASES: SweepCase[] = [
  ...Object.entries(HONEST).map(([name, p]): SweepCase => ({ name: `the honest fixture page ${name}`, motion: pageMotion(p), expect: "pass" })),
  ...Object.entries(REVIEWED_HONEST).map(([name, p]): SweepCase => ({ name: `the honest page: ${name}`, motion: pageMotion(p), expect: "pass" })),
  // The slideshow page draws its 400 px slide below the viewport.
  ...Object.entries(REVIEWED_FAULTY).map(([name, p]): SweepCase => ({ name: `the faulty page: ${name}`, motion: pageMotion(p), expect: REVIEWED_FAULT_KINDS[name]!, ...(name === "slideshow" ? { offView: true as const } : {}) })),
];

/**
 * The style sweep's grid in full (the browser sweep samples it): a lift of 1.5 lengths at every rate from 4 to 30
 * drawings a second, even and mixed holds, each spacing chart, 3 to 12 drawings and dots of 12, 40 and 120 px. Honest
 * lifts pass; each planted fault fails (its kind varies with the rate). A 3-drawing move from a rest whose first
 * drawing covers 60% passes and 65% fails as a spike; a one-way slideshow of 1.5-length steps fails as a teleport.
 */
const RATES = [4, 6, 8, 10, 12, 15, 20, 24, 30];
const SIZES = [12, 40, 120];
const TIMINGS: SweepSpec["timing"][] = ["even", "mixed"];
const CHARTS: SweepSpec["chart"][] = ["slowOut", "slowIn", "slowInOut", "even"];
const FAULTS: NonNullable<SweepSpec["fault"]>[] = ["pop60", "teleport", "nudge", "spike", "set"];
const grid = <T>(...axes: T[][]): T[][] => axes.reduce<T[][]>((out, axis) => out.flatMap((row) => axis.map((v) => [...row, v])), [[]]);
const specCase = (spec: SweepSpec, expect: Expect): SweepCase => ({ name: sweepSlug(spec), motion: pageMotion(sweepPage(spec)), expect, fixed: true });
export const GRID_HONEST: SweepCase[] = grid<number | string>(SIZES, TIMINGS, RATES, CHARTS, [3, 4, 6, 8, 12]).map(([sizePx, timing, rate, chart, drawings]) =>
  specCase({ rate: rate as number, timing: timing as SweepSpec["timing"], chart: chart as SweepSpec["chart"], drawings: drawings as number, sizePx: sizePx as number }, "pass"),
);
export const GRID_FAULTY: SweepCase[] = grid<number | string>(SIZES, TIMINGS, RATES, FAULTS, [6, 8, 12]).map(([sizePx, timing, rate, fault, drawings]) =>
  specCase({ rate: rate as number, timing: timing as SweepSpec["timing"], chart: "even", drawings: drawings as number, fault: fault as NonNullable<SweepSpec["fault"]>, sizePx: sizePx as number }, "fail"),
);
const edge = (first: number, expect: Expect): SweepCase[] => SIZES.flatMap((sizePx) => [8, 24].map((rate) => specCase({ rate, timing: "even", chart: "even", drawings: 3, shares: [first, 0.8, 1], sizePx }, expect)));
export const GRID_EDGES: SweepCase[] = [
  ...edge(0.6, "pass"),
  ...edge(0.65, "spike"),
  // At 120 px the slideshow's last slides are drawn above the viewport.
  ...SIZES.map((size): SweepCase => ({ name: `a one-way slideshow of 1.5-length steps at size ${size}`, motion: pageMotion(oneWaySlideshow(size)), expect: "teleport", fixed: true, ...(size === 120 ? { offView: true as const } : {}) })),
  // A fault the position-run rule fails, and two honest slow-ins an earlier draft of it failed, at every size.
  ...SIZES.flatMap((sizePx) => [
    specCase({ rate: 20, timing: "even", chart: "even", drawings: 6, fault: "spike", sizePx }, "spike"),
    specCase({ rate: 8, timing: "mixed", chart: "slowIn", drawings: 6, sizePx }, "pass"),
    specCase({ rate: 24, timing: "mixed", chart: "slowIn", drawings: 6, sizePx }, "pass"),
  ]),
];
