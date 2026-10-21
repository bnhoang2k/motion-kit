import { type Frame, type GatePage } from "./harness.ts";
/**
 * Designed loops: a value whose whole series repeats at one period, after a short lead-in. A loader's bounce, a
 * relay of hops, a breath, a badge that pops in and out. A ticking hand counts too: each period it moves on by the
 * same step. The envelope and overshoot rules give such a loop room a one-time motion does not get (each kind's
 * rules.md).
 */
/** A loop's period is 500 ms to 7500 ms... */
export declare const LOOP_PERIOD_MS: readonly [500, 7500];
/** ...after a lead-in of at most 2 s. */
export declare const LOOP_LEAD_MS = 2000;
/** The frames a loop is found in: the longest lead-in, then two of the longest periods. */
export declare const PERIODIC_SCAN_MS: number;
/**
 * `periodMs`: the period. `leadMs`: from here on, every frame repeats one period later. `step`: how far the value
 * moves on each period (0, but for a ticking hand). `stillEachCycle`: each cycle holds still for REST_FRAMES frame
 * steps or more.
 */
export type Periodic = {
    periodMs: number;
    leadMs: number;
    step: number;
    stillEachCycle: boolean;
};
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
 * Whether the value `name` on `page` is a loop, read from `frames` (seek frames from 0 over PERIODIC_SCAN_MS) and from
 * exact seeks one period later. A loop: from some time in its first LOOP_LEAD_MS on, every frame's value one period
 * later is the same plus one fixed step, within `tolerance`, for at least one whole period. The period is periodOf's,
 * or the first of its multiples, up to LOOP_PERIOD_MS, that repeats: two equal hops with different settles cross
 * their mid level at half the true period.
 */
export declare function periodicOf(page: GatePage, frames: Frame[], name: string, tolerance: number): Promise<Periodic | null>;
/**
 * The period within one frame of `p` at which the frames after LOOP_LEAD_MS best repeat (least squares, each frame
 * against the frames one period later, read between frames by a straight line, less the median step). Noise on a
 * value jitters its crossing times, and so periodOf's estimate; this needs no seeks.
 */
export declare function refinedPeriod(frames: Frame[], name: string, p: number): number;
