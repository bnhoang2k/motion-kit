import type { Frame } from "./harness.ts";

/** A value that holds still for this many frame steps is at rest. */
export const REST_FRAMES = 3;

/** A chain of motion ends where the value holds still this long (about 100 ms: a starting value is tested against this). */
export const HOLD_MS = 100;
/**
 * A drawing of a stepped value is held when it is shown HOLD_MS or more and at least this many times as long as the
 * drawings on each side of it (poses.ts `heldPoses`).
 */
export const HOLD_RATIO = 2;
/**
 * A drawing of a stepped value shown this long or more is a rest (poses.ts `isRestDrawing`): below four drawings a
 * second, motion stops reading as continuous, so a jump between two rests is seen as a jump.
 */
export const REST_MS = 250;

/** The names of every value any frame holds. */
export function valueNames(frames: Frame[]): string[] {
  return [...new Set(frames.flatMap((f) => Object.keys(f.values)))];
}

/** A value's series over the frames; NaN where a frame lacks it. */
export function series(frames: Frame[], name: string): number[] {
  return frames.map((f) => (Object.hasOwn(f.values, name) ? f.values[name]! : Number.NaN));
}

export function rangeOf(vs: number[]): number {
  const ok = vs.filter(Number.isFinite);
  return ok.length === 0 ? 0 : Math.max(...ok) - Math.min(...ok);
}

/**
 * The range of the finite values in `vs`, with the one lowest and the one highest left out: one wild frame cannot set
 * it. With fewer than 3 values, the plain range.
 */
export function robustRange(vs: number[]): number {
  const ok = vs.filter(Number.isFinite).sort((a, b) => a - b);
  return ok.length < 3 ? rangeOf(ok) : ok[ok.length - 2]! - ok[1]!;
}

/** A change smaller than this does not count as motion for a value with this range. */
export const stillEps = (range: number) => Math.max(1e-9, 1e-4 * range);

/** The still tolerance of a value's series: stillEps of its robustRange, so one wild frame cannot set it. */
export const stillTol = (vs: number[]) => stillEps(robustRange(vs));

/**
 * When the last move in `frames` ends: the time of the frame after the last step in which a value not
 * in `ignore` moves, or null when none moves.
 */
export function lastMoveMs(frames: Frame[], ignore: Set<string> = new Set()): number | null {
  const names = valueNames(frames).filter((n) => !ignore.has(n));
  const eps = new Map(names.map((n) => [n, stillTol(series(frames, n))]));
  for (let i = frames.length - 2; i >= 0; i--) {
    if (names.some((n) => Math.abs((frames[i + 1]!.values[n] ?? 0) - (frames[i]!.values[n] ?? 0)) > eps.get(n)!)) return frames[i + 1]!.ms;
  }
  return null;
}
