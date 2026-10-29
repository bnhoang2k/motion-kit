import type { Frame } from "./harness.ts";
/** A value that holds still for this many frame steps is at rest. */
export declare const REST_FRAMES = 3;
/** A chain of motion ends where the value holds still this long (about 100 ms: a starting value is tested against this). */
export declare const HOLD_MS = 100;
/**
 * A drawing of a stepped value is held when it is shown HOLD_MS or more and at least this many times as long as the
 * drawings on each side of it (poses.ts `heldPoses`).
 */
export declare const HOLD_RATIO = 2;
/**
 * A drawing of a stepped value shown this long or more is a rest (poses.ts `isRestDrawing`): below four drawings a
 * second, motion stops reading as continuous, so a jump between two rests is seen as a jump.
 */
export declare const REST_MS = 250;
/** The names of every value any frame holds. */
export declare function valueNames(frames: Frame[]): string[];
/** A value's series over the frames; NaN where a frame lacks it. */
export declare function series(frames: Frame[], name: string): number[];
export declare function rangeOf(vs: number[]): number;
/**
 * The range of the finite values in `vs`, with the one lowest and the one highest left out: one wild frame cannot set
 * it. With fewer than 3 values, the plain range.
 */
export declare function robustRange(vs: number[]): number;
/** A change smaller than this does not count as motion for a value with this range. */
export declare const stillEps: (range: number) => number;
/** A value's tolerance floor: its unit's floor (TOLERANCE_FLOORS), or 1% of its range for a unit with none. */
export declare const unitFloor: (unit: string | undefined, range: number) => number;
/** The still tolerance of a value's series: stillEps of its robustRange, so one wild frame cannot set it. */
export declare const stillTol: (vs: number[]) => number;
/**
 * When the last move in `frames` ends: the time of the frame after the last step in which a value not
 * in `ignore` moves, or null when none moves.
 */
export declare function lastMoveMs(frames: Frame[], ignore?: Set<string>): number | null;
/** A value moves at one steady speed when its frame steps over this long, at the end of the frames read, are all alike. */
export declare const STEADY_MS = 500;
/** ...alike meaning each within this share of the median step (or stillEps of the window's own range, when that is larger). */
export declare const STEADY_SHARE = 0.01;
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
export declare function steadyStep(frames: Frame[], name: string, sinceMs?: number): number | null;
/**
 * Whether `name` never moves faster than `step` a frame in `frames` (by more than STEADY_SHARE of it, plus stillEps of
 * its range). A value that only speeds up to a steady speed (a ramp-in, a hand's hold that lets go) has come from rest
 * onto its drift; one that slides on faster than it then drifts (an entrance) has come to it.
 */
export declare function neverFasterThan(frames: Frame[], name: string, step: number): boolean;
/**
 * Whether `name` was already moving at the steady speed `step` (steadyStep's, in the direction the value ends moving)
 * before `ms`: the frame step just before `ms` is within steadyStep's tolerance of `step`. A value at rest, one that moved
 * another way, or one that was still speeding up or breathing back and forth before `ms` was not moving at that speed.
 */
export declare function movedAtSpeedBefore(frames: Frame[], name: string, ms: number, step: number): boolean;
/**
 * Whether `name` ends at the same steady speed in `quiet` as in `frames` (the speed `step` is steadyStep's of `frames`): its
 * steadyStep in `quiet` is within STEADY_SHARE of `step`, and it moves the same way. `quiet` is the page read with no input,
 * so a value that moves like this with or without the input was not started by the input.
 */
export declare function sameSteadyStep(quiet: Frame[], frames: Frame[], name: string, step: number): boolean;
