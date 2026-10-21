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
/** The still tolerance of a value's series: stillEps of its robustRange, so one wild frame cannot set it. */
export declare const stillTol: (vs: number[]) => number;
/**
 * When the last move in `frames` ends: the time of the frame after the last step in which a value not
 * in `ignore` moves, or null when none moves.
 */
export declare function lastMoveMs(frames: Frame[], ignore?: Set<string>): number | null;
