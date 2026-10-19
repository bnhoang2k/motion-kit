import { type Frame, type GatePage, type InputSamples } from "./harness.ts";
/**
 * The checks on the gates themselves: a gate cannot pass on nothing, no sudden jumps, and the
 * real clock. Each returns its failures, one line each, prefixed with its own name.
 *
 * Each check reports only its own cause. A value that the page never records is for
 * `missingChannel` (or `zeroFrames`, when no frame records any value) to report, so `suddenJumps`
 * and `realClockGap` skip it. A gate runs them all, so the cause is still reported once.
 */
/** The part of trace.json these checks read. */
export type TraceChannels = {
    channels: {
        name: string;
    }[];
};
/** Fails for each clock hook the page does not define. */
export declare function noHook(page: GatePage): Promise<string[]>;
/** Fails for each selector that matches 0 elements. */
export declare function emptySelector(page: GatePage, selectors: string[]): Promise<string[]>;
/** Fails when no frame holds a value: a gate that compares nothing cannot pass. */
export declare function zeroFrames(frames: Frame[]): string[];
/** Fails for each trace channel that a recorded frame lacks. Frames with no value at all are for `zeroFrames`. */
export declare function missingChannel(trace: TraceChannels, frames: Frame[]): string[];
/**
 * A step jumps when it moves more than this many times the step beside it. suddenJumps uses it to
 * judge a pointer step, and the live regrab rule to judge a press.
 */
export declare const JUMP_FACTOR = 2.5;
/**
 * Seeks t, t + dt/2 and t + dt/4 for every frame step where a value moves at least JUMP_SHARE of
 * its range, and fails each value whose change does not halve with the step. A cut in `cuts`
 * (ms) exempts the steps within one frame of it. With pointer `input`, a step in which the pointer
 * moves is exempt when it keeps the pace: under ?seek the pointer holds one position per frame, so
 * a value that follows it moves in one step there by design. The step keeps the pace when its
 * change is at most JUMP_FACTOR times the larger of the frame steps before and after it on that
 * value; a pop in a move's frame does not. Scroll input gets no exemption.
 */
export declare function suddenJumps(page: GatePage, channels: string[], cuts: number[], spanMs?: number, input?: InputSamples | null): Promise<string[]>;
/** The clock gap realClockGap injects into the live loop. */
export declare const GAP_MS = 2000;
export interface RealClockGapOptions {
    /** The recorded input. The live run replays it with `replayInput` unless `drive` is given. Open `page` with the same samples. */
    input?: InputSamples;
    /** Starts input on the live page; it runs before the live frames are read. */
    drive?: (live: GatePage) => Promise<void>;
    /** How far the seek frames that set the budget reach, in ms. */
    spanMs?: number;
}
/**
 * Runs the page once on its live rAF loop with one 2000 ms timestamp jump injected, and fails each
 * value that moves more than its one-frame budget in any live frame. `page` must be a `?seek`
 * page: its seek frames set the budget. The live run opens the same file with the same options.
 * A page that moves only on input needs `input` or `drive`, or its loop never reaches the gap,
 * and the check fails.
 */
export declare function realClockGap(page: GatePage, opts?: RealClockGapOptions): Promise<string[]>;
