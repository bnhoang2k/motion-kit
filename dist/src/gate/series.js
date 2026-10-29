import { TOLERANCE_FLOORS } from "../core/trace.js";
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
export function valueNames(frames) {
    return [...new Set(frames.flatMap((f) => Object.keys(f.values)))];
}
/** A value's series over the frames; NaN where a frame lacks it. */
export function series(frames, name) {
    return frames.map((f) => (Object.hasOwn(f.values, name) ? f.values[name] : Number.NaN));
}
export function rangeOf(vs) {
    const ok = vs.filter(Number.isFinite);
    return ok.length === 0 ? 0 : Math.max(...ok) - Math.min(...ok);
}
/**
 * The range of the finite values in `vs`, with the one lowest and the one highest left out: one wild frame cannot set
 * it. With fewer than 3 values, the plain range.
 */
export function robustRange(vs) {
    const ok = vs.filter(Number.isFinite).sort((a, b) => a - b);
    return ok.length < 3 ? rangeOf(ok) : ok[ok.length - 2] - ok[1];
}
/** A change smaller than this does not count as motion for a value with this range. */
export const stillEps = (range) => Math.max(1e-9, 1e-4 * range);
/** A value's tolerance floor: its unit's floor (TOLERANCE_FLOORS), or 1% of its range for a unit with none. */
export const unitFloor = (unit, range) => unit !== undefined && Object.hasOwn(TOLERANCE_FLOORS, unit) ? TOLERANCE_FLOORS[unit] : 0.01 * range;
/** The still tolerance of a value's series: stillEps of its robustRange, so one wild frame cannot set it. */
export const stillTol = (vs) => stillEps(robustRange(vs));
/**
 * When the last move in `frames` ends: the time of the frame after the last step in which a value not
 * in `ignore` moves, or null when none moves.
 */
export function lastMoveMs(frames, ignore = new Set()) {
    const names = valueNames(frames).filter((n) => !ignore.has(n));
    const eps = new Map(names.map((n) => [n, stillTol(series(frames, n))]));
    for (let i = frames.length - 2; i >= 0; i--) {
        if (names.some((n) => Math.abs((frames[i + 1].values[n] ?? 0) - (frames[i].values[n] ?? 0)) > eps.get(n)))
            return frames[i + 1].ms;
    }
    return null;
}
/** A value moves at one steady speed when its frame steps over this long, at the end of the frames read, are all alike. */
export const STEADY_MS = 500;
/** ...alike meaning each within this share of the median step (or stillEps of the window's own range, when that is larger). */
export const STEADY_SHARE = 0.01;
/**
 * The frame step of a value that moves at one steady speed (a marquee, a strip that drifts), or null when it does not:
 * every step over the last STEADY_MS of `frames` is within `max(stillEps(window range), STEADY_SHARE of the median step)`
 * of the median step, and the median is above stillEps of the value's range over all the frames. The steadiness is
 * judged on the window alone, so a value that slows down (a long tail of a big move) is no steady speed however large
 * its whole-series range is: a lead-in move, a hand that holds the value, or an ease back to the drift does not matter,
 * only the end does. With `sinceMs`, the window starts there when that is earlier than the last STEADY_MS: the value must
 * hold its speed from `sinceMs` to the end of the frames. Frames that do not cover STEADY_MS, or a frame in the window
 * without the value, give null.
 */
export function steadyStep(frames, name, sinceMs) {
    const v = series(frames, name);
    const end = frames[frames.length - 1]?.ms;
    if (end === undefined || frames[0].ms > end - STEADY_MS + 1e-6)
        return null;
    const from = frames.findIndex((f) => f.ms >= Math.min(end - STEADY_MS, sinceMs ?? Number.POSITIVE_INFINITY) - 1e-6);
    const window = v.slice(from);
    const steps = window.slice(1).map((x, i) => x - window[i]);
    if (steps.length === 0 || !steps.every(Number.isFinite))
        return null;
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    if (!(Math.abs(median) > stillEps(rangeOf(v))))
        return null;
    const tol = Math.max(stillEps(rangeOf(window)), STEADY_SHARE * Math.abs(median));
    return steps.every((d) => Math.abs(d - median) <= tol) ? Math.abs(median) : null;
}
/**
 * Whether `name` never moves faster than `step` a frame in `frames` (by more than STEADY_SHARE of it, plus stillEps of
 * its range). A value that only speeds up to a steady speed (a ramp-in, a hand's hold that lets go) has come from rest
 * onto its drift; one that slides on faster than it then drifts (an entrance) has come to it.
 */
export function neverFasterThan(frames, name, step) {
    const v = series(frames, name);
    const limit = step * (1 + STEADY_SHARE) + stillEps(rangeOf(v));
    return v.slice(1).every((x, i) => !(Math.abs(x - v[i]) > limit));
}
/**
 * Whether `name` was already moving at the steady speed `step` (steadyStep's, in the direction the value ends moving)
 * before `ms`: the frame step just before `ms` is within steadyStep's tolerance of `step`. A value at rest, one that moved
 * another way, or one that was still speeding up or breathing back and forth before `ms` was not moving at that speed.
 */
export function movedAtSpeedBefore(frames, name, ms, step) {
    const v = series(frames, name);
    let i = frames.length - 1;
    while (i >= 0 && frames[i].ms >= ms - 1e-6)
        i--;
    if (i < 1 || v.length < 2)
        return false;
    const dir = Math.sign(v[v.length - 1] - v[v.length - 2]);
    const last = dir * (v[i] - v[i - 1]);
    return Number.isFinite(last) && Math.abs(last - step) <= Math.max(stillEps(rangeOf(v)), STEADY_SHARE * step);
}
/**
 * Whether `name` ends at the same steady speed in `quiet` as in `frames` (the speed `step` is steadyStep's of `frames`): its
 * steadyStep in `quiet` is within STEADY_SHARE of `step`, and it moves the same way. `quiet` is the page read with no input,
 * so a value that moves like this with or without the input was not started by the input.
 */
export function sameSteadyStep(quiet, frames, name, step) {
    const there = steadyStep(quiet, name);
    if (there === null)
        return false;
    const [a, b] = [series(quiet, name), series(frames, name)];
    const way = (v) => Math.sign(v[v.length - 1] - v[v.length - 2]);
    return way(a) === way(b) && Math.abs(there - step) <= Math.max(stillEps(rangeOf(b)), STEADY_SHARE * step);
}
