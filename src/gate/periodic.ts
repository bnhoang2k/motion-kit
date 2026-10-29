import { FRAME_MS, type Frame, type GatePage } from "./harness.ts";
import { rangeOf, REST_FRAMES, series, stillEps } from "./series.ts";

/**
 * Designed loops: a value whose whole series repeats at one period, after a short lead-in. A loader's bounce, a
 * relay of hops, a breath, a badge that pops in and out. A ticking hand counts too: each period it moves on by the
 * same step. The envelope and overshoot rules give such a loop room a one-time motion does not get (each kind's
 * rules.md).
 */

/** A loop's period is 500 ms to 7500 ms... */
export const LOOP_PERIOD_MS = [500, 7500] as const;
/** ...after a lead-in of at most 2 s, counted from when the value first moves. */
export const LOOP_LEAD_MS = 2000;
/** The frames a loop is found in: the longest lead-in, then two of the longest periods, from when the value first moves. */
export const PERIODIC_SCAN_MS = LOOP_LEAD_MS + 2 * LOOP_PERIOD_MS[1];
/**
 * The shortest gap between a loop's beats: half the shortest period. A pair of equal beats makes the shortest period, so
 * a value whose own cycle is shorter (a flip-flop every frame, a buzz of 4 frames a cycle) repeats at 500 ms too, as every
 * multiple of its cycle does, but it is a buzz, not a loop.
 */
export const LOOP_BEAT_MS = LOOP_PERIOD_MS[0] / 2;

/** When `name` first moves in `frames` (the frame before its first step above the still tolerance), or null when it never does. */
export function firstMoveMs(frames: Frame[], name: string): number | null {
  const v = series(frames, name);
  const eps = stillEps(rangeOf(v));
  const first = v.findIndex((x, i) => i > 0 && Math.abs(x - v[0]!) > eps);
  return first < 0 ? null : frames[Math.max(0, first - 1)]!.ms;
}

/**
 * `periodMs`: the period. `leadMs`: from here on, every frame repeats one period later. `step`: how far the value
 * moves on each period (0, but for a ticking hand). `drift`: how far the loop moves on over the read after its lead-in,
 * in the unit of the value: the greater of `step` and the change of its swing (its crests and troughs move apart or
 * together) each period, times the periods. A loop that comes back to where it was each period has none, however many
 * periods are read; one that sinks, or grows, by less than the floor each period has the sum. `stillEachCycle`: each
 * cycle holds still for REST_FRAMES frame steps or more.
 */
export type Periodic = { periodMs: number; leadMs: number; step: number; drift: number; stillEachCycle: boolean };

/**
 * How far the loop of `xs` (a value) moves on over `periods` periods when each frame differs from the one a period later by
 * `ys`: its step each period (`step`), or the change of its swing each period (how the differences follow the value, a
 * least-squares slope of the difference on the value, times the value's range), the greater, times `periods`. Noise
 * that is not tied to the value, and a period known to a hair, average out of both.
 */
export function driftOver(xs: number[], ys: number[], step: number, periods: number): number {
  const n = xs.length;
  let swing = 0;
  if (n >= 2) {
    const [mx, my] = [xs.reduce((a, b) => a + b, 0) / n, ys.reduce((a, b) => a + b, 0) / n];
    let [cov, varx] = [0, 0];
    for (let i = 0; i < n; i++) {
      cov += (xs[i]! - mx) * (ys[i]! - my);
      varx += (xs[i]! - mx) ** 2;
    }
    if (varx > 0) swing = Math.abs((cov / varx) * (Math.max(...xs) - Math.min(...xs)));
  }
  return periods * Math.max(Math.abs(step), swing);
}

/**
 * The period of a value's frame steps after `fromMs`, or null. The steps cross a level going up once or more each
 * period (after dipping a tenth of their range below it); each crossing time is read between frames, by a straight
 * line. The period is the shortest gap from the first crossing, within LOOP_PERIOD_MS, that maps every crossing onto
 * another within one frame, measured over as many periods as the frames hold, so a period off the frame grid comes
 * out to a fraction of a millisecond. The level is the steps' mid level, or else their lower or upper quarter: a
 * step that peaks right at one level crosses it in some cycles and not in others.
 */
export function periodOf(frames: Frame[], name: string, fromMs: number): number | null {
  return crossingPeriod(frames, name, fromMs)?.periodMs ?? null;
}

/** `periodMs`: periodOf's period. `beatMs`: the shortest gap from the first crossing that maps every crossing onto another, whatever its length. */
type CrossingPeriod = { periodMs: number; beatMs: number };

function crossingPeriod(frames: Frame[], name: string, fromMs: number): CrossingPeriod | null {
  const v = series(frames, name);
  const i0 = frames.findIndex((f) => f.ms >= fromMs - 1e-6);
  if (i0 < 0) return null;
  const d = v.slice(i0 + 1).map((x, k) => x - v[i0 + k]!);
  if (!d.every(Number.isFinite)) return null;
  const [lo, hi] = [Math.min(...d), Math.max(...d)];
  if (!(hi - lo > stillEps(rangeOf(v)))) return null;
  // A crossing counts once the steps have been below the level by a tenth of their range since the last one, so
  // noise around the level (a value that holds still with sub-floor jitter) adds none. It ends above the level by
  // more than the still tolerance: a hold, whose steps are zero, sits on the mid level of a move that goes and comes
  // back at one speed, and its rounding must not decide where it crosses. An exact hold below the level arms it too,
  // as a badge that rests between springs: a hold has no jitter to count twice.
  const band = 0.1 * (hi - lo);
  const eps = stillEps(hi - lo);
  for (const q of [0.5, 0.25, 0.75]) {
    const level = lo + q * (hi - lo);
    const above = level + eps;
    const ups: number[] = [];
    let armed = false;
    for (let k = 0; k + 1 < d.length; k++) {
      if (d[k]! < level - band || (Math.abs(d[k]!) <= eps && d[k]! < level - eps)) armed = true;
      if (armed && d[k]! <= above && d[k + 1]! > above) {
        ups.push(k + Math.max(0, (level - d[k]!) / (d[k + 1]! - d[k]!)));
        armed = false;
      }
    }
    const p = periodOfCrossings(ups);
    if (p !== null) return p;
  }
  return null;
}

/**
 * The shortest gap from the first crossing that maps every crossing onto another (periodOf), in ms, within
 * LOOP_PERIOD_MS, and the shortest such gap of any length (the beat), or null.
 */
function periodOfCrossings(ups: number[]): CrossingPeriod | null {
  const near = (x: number) => ups.some((c) => Math.abs(c - x) <= 1);
  let beat: number | null = null;
  for (const c of ups.slice(1)) {
    const p = c - ups[0]!;
    if (!ups.every((x) => x + p > ups[ups.length - 1]! + 1 || near(x + p))) continue;
    beat ??= p * FRAME_MS;
    if (p * FRAME_MS < LOOP_PERIOD_MS[0] - FRAME_MS || p * FRAME_MS > LOOP_PERIOD_MS[1] + FRAME_MS) continue;
    const m = Math.floor((ups[ups.length - 1]! - ups[0]! + 1) / p);
    const far = ups.reduce((best, x) => (Math.abs(x - ups[0]! - m * p) < Math.abs(best - ups[0]! - m * p) ? x : best), ups[0]!);
    return { periodMs: ((far - ups[0]!) / m) * FRAME_MS, beatMs: beat };
  }
  return null;
}

/**
 * Whether the value `name` on `page` is a loop, read from `frames` (seek frames from 0 over PERIODIC_SCAN_MS, or past the
 * first move by that long: the page is read further when the value moves late) and from exact seeks one period later. A
 * loop: from some time in its first LOOP_LEAD_MS after it first moves, every frame's value one period later is the same
 * plus one fixed step, within `tolerance`, for at least one whole period. The period is periodOf's, or the first of its
 * multiples, up to LOOP_PERIOD_MS, that repeats: two equal hops with different settles cross their mid level at half the
 * true period. A value whose own beat is shorter than LOOP_BEAT_MS repeats at 500 ms too, but it is a buzz, no loop.
 */
export async function periodicOf(page: GatePage, frames: Frame[], name: string, tolerance: number): Promise<Periodic | null> {
  const start = firstMoveMs(frames, name);
  if (start === null) return null;
  const scanEnd = start + PERIODIC_SCAN_MS;
  const read = frames[frames.length - 1]!.ms < scanEnd - FRAME_MS ? await page.frames(0, scanEnd) : frames;
  const found = crossingPeriod(read, name, start + LOOP_LEAD_MS);
  if (found === null || found.beatMs < LOOP_BEAT_MS - FRAME_MS) return null;
  for (let k = 1; k * found.periodMs <= LOOP_PERIOD_MS[1] + FRAME_MS; k++) {
    const loop = await repeatsAt(page, read, name, tolerance, refinedPeriod(read, name, k * found.periodMs, start + LOOP_LEAD_MS), start);
    if (loop) return loop;
  }
  return null;
}

/**
 * The period within one frame of `p` at which the frames after LOOP_LEAD_MS best repeat (least squares, each frame
 * against the frames one period later, read between frames by a straight line, less the median step). Noise on a
 * value jitters its crossing times, and so periodOf's estimate; this needs no seeks.
 */
export function refinedPeriod(frames: Frame[], name: string, p: number, fromMs = LOOP_LEAD_MS): number {
  const v = series(frames, name);
  const t0 = frames[0]!.ms;
  const at = (ms: number) => {
    const x = (ms - t0) / FRAME_MS;
    const i = Math.floor(x);
    return i + 1 < v.length ? v[i]! + (v[i + 1]! - v[i]!) * (x - i) : Number.NaN;
  };
  const cost = (q: number) => {
    const d = frames.filter((f) => f.ms >= fromMs - 1e-6).map((f, i) => at(f.ms + q) - (f.values[name] ?? Number.NaN)).filter(Number.isFinite);
    if (d.length === 0) return Number.POSITIVE_INFINITY;
    const step = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)]!;
    return d.reduce((sum, x) => sum + (x - step) ** 2, 0) / d.length;
  };
  let best = p;
  let bestCost = cost(p);
  for (const dq of [0.5, 0.02]) {
    const c = best;
    for (let q = c - (dq === 0.5 ? FRAME_MS : 0.5); q <= c + (dq === 0.5 ? FRAME_MS : 0.5) + 1e-9; q += dq) {
      const k = cost(q);
      if (k < bestCost) [best, bestCost] = [q, k];
    }
  }
  return best;
}

/**
 * The loop of `name` at period `p`, or null. A frame holds still when it stays within half of `tolerance` over the next
 * REST_FRAMES frame steps: noise below the unit floor cannot be seen, and the slow turn of a bounce still moves more.
 */
async function repeatsAt(page: GatePage, frames: Frame[], name: string, tolerance: number, p: number, startMs = 0): Promise<Periodic | null> {
  const end = frames[frames.length - 1]!.ms;
  const base = frames.filter((f) => f.ms + p <= end + 1e-6);
  const later = await page.framesAt(base.map((f) => f.ms + p));
  const diff = base.map((f, i) => (later[i]!.values[name] ?? Number.NaN) - (f.values[name] ?? Number.NaN));
  const settled = diff.filter((_, i) => base[i]!.ms >= startMs + LOOP_LEAD_MS - 1e-6).sort((a, b) => a - b);
  if (settled.length === 0) return null;
  const step = settled[Math.floor(settled.length / 2)]!;
  let last = -1;
  diff.forEach((x, i) => {
    if (!(Math.abs(x - step) <= tolerance)) last = i;
  });
  const leadMs = last < 0 ? 0 : base[last]!.ms + FRAME_MS;
  if (leadMs - startMs > LOOP_LEAD_MS + 1e-6 || end - p - leadMs < p - 1e-6) return null;
  const v = series(frames, name);
  const kept = base.map((_, i) => i).filter((i) => base[i]!.ms >= leadMs - 1e-6);
  const drift = driftOver(kept.map((i) => base[i]!.values[name] ?? Number.NaN), kept.map((i) => diff[i]!), step, (end - leadMs) / p);
  const cycle = frames.map((f, i) => i).filter((i) => frames[i]!.ms >= leadMs - 1e-6 && frames[i]!.ms <= leadMs + p + 1e-6);
  const stillEachCycle = cycle.some((i) => {
    const w = v.slice(i, i + REST_FRAMES + 1);
    return w.length === REST_FRAMES + 1 && Math.max(...w) - Math.min(...w) <= tolerance / 2;
  });
  return { periodMs: p, leadMs, step, drift, stillEachCycle };
}
