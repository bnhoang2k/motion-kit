import { type Frame, type GatePage } from "./harness.ts";
/**
 * Designed loops: a value whose whole series repeats at one period, after a short lead-in. A loader's bounce, a
 * relay of hops, a breath, a badge that pops in and out. A ticking hand counts too: each period it moves on by the
 * same step. The envelope and overshoot rules give such a loop room a one-time motion does not get (each kind's
 * rules.md).
 */
/** A loop's period is 500 ms to 7500 ms... */
export declare const LOOP_PERIOD_MS: readonly [500, 7500];
/** ...after a lead-in of at most 2 s, counted from when the value first moves. */
export declare const LOOP_LEAD_MS = 2000;
/** The frames a loop is found in: the longest lead-in, then two of the longest periods, from when the value first moves. */
export declare const PERIODIC_SCAN_MS: number;
/**
 * The shortest gap between a loop's beats: half the shortest period. A pair of equal beats makes the shortest period, so
 * a value whose own cycle is shorter (a flip-flop every frame, a buzz of 4 frames a cycle) repeats at 500 ms too, as every
 * multiple of its cycle does, but it is a buzz, not a loop.
 */
export declare const LOOP_BEAT_MS: number;
/** When `name` first moves in `frames` (the frame before its first step above the still tolerance), or null when it never does. */
export declare function firstMoveMs(frames: Frame[], name: string): number | null;
/**
 * `periodMs`: the period. `leadMs`: from here on, every frame repeats one period later. `step`: how far the value
 * moves on each period (0, but for a ticking hand). `drift`: how far the loop moves on over the read after its lead-in,
 * in the unit of the value: the greater of `step` and the change of its swing (its crests and troughs move apart or
 * together) each period, times the periods. A loop that comes back to where it was each period has none, however many
 * periods are read; one that sinks, or grows, by less than the floor each period has the sum. `stillEachCycle`: each
 * cycle holds still for REST_FRAMES frame steps or more.
 */
export type Periodic = {
    periodMs: number;
    leadMs: number;
    step: number;
    drift: number;
    stillEachCycle: boolean;
};
/**
 * How far the loop of `xs` (a value) moves on over `periods` periods when each frame differs from the one a period later by
 * `ys`: its step each period (`step`), or the change of its swing each period (how the differences follow the value, a
 * least-squares slope of the difference on the value, times the value's range), the greater, times `periods`. Noise
 * that is not tied to the value, and a period known to a hair, average out of both.
 */
export declare function driftOver(xs: number[], ys: number[], step: number, periods: number): number;
/**
 * The period of a value's frame steps after `fromMs`, or null. The steps cross a level going up once or more each
 * period (after dipping a tenth of their range below it); each crossing time is read between frames, by a straight
 * line. The period is the shortest gap from the first crossing, within LOOP_PERIOD_MS, that maps every crossing onto
 * another within one frame, measured over as many periods as the frames hold, so a period off the frame grid comes
 * out to a fraction of a millisecond. The level is the steps' mid level, or else their lower or upper quarter: a
 * step that peaks right at one level crosses it in some cycles and not in others.
 */
export declare function periodOf(frames: Frame[], name: string, fromMs: number): number | null;
/**
 * Whether the value `name` on `page` is a loop, read from `frames` (seek frames from 0 over PERIODIC_SCAN_MS, or past the
 * first move by that long: the page is read further when the value moves late) and from exact seeks one period later. A
 * loop: from some time in its first LOOP_LEAD_MS after it first moves, every frame's value one period later is the same
 * plus one fixed step, within `tolerance`, for at least one whole period. The period is periodOf's, or the first of its
 * multiples, up to LOOP_PERIOD_MS, that repeats: two equal hops with different settles cross their mid level at half the
 * true period. A value whose own beat is shorter than LOOP_BEAT_MS repeats at 500 ms too, but it is a buzz, no loop.
 */
export declare function periodicOf(page: GatePage, frames: Frame[], name: string, tolerance: number): Promise<Periodic | null>;
/**
 * The period within one frame of `p` at which the frames after LOOP_LEAD_MS best repeat (least squares, each frame
 * against the frames one period later, read between frames by a straight line, less the median step). Noise on a
 * value jitters its crossing times, and so periodOf's estimate; this needs no seeks.
 */
export declare function refinedPeriod(frames: Frame[], name: string, p: number, fromMs?: number): number;
