import { type Frame, type GatePage, type InputSamples } from "./harness.ts";
import { type ObjectRecord } from "./objects.ts";
import { type StepPop } from "./poses.ts";
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
 * ...or when the step moves more than this many times the larger frame step beside it (a long move hides a jump of
 * under JUMP_SHARE of its range, but the jump stands out from the steps beside it). A step jumps when it moves more
 * than this many times the step beside it. suddenJumps uses it to judge a step against the steps beside it, and
 * against the input's step in the same frame, and the live regrab rule to judge a press.
 */
export declare const JUMP_FACTOR = 2.5;
/**
 * Seeks every frame step where a value moves at least JUMP_SHARE of its range, or more than JUMP_FACTOR times the
 * larger frame step beside it, and the SUB_STEPS even sub-steps before and after it, and fails each value with a step
 * in which a span of 1, 2 or 4 sub-steps (SPANS) moves more than JUMP_FACTOR times the larger of the two spans of the
 * same width beside it, and carries at least JUMP_CARRIES of the step's change. A span counts when it overlaps the
 * step's own sub-steps, and may cross the frame edge. Seek times are held inside [0, spanMs]; a neighbour that falls
 * outside holds still, so it moves 0. Every such step is measured: a jump hidden in a fast move changes the step by
 * about what a smooth move would, and only the spans show it. A step that is too small to see (at most the value's
 * unit floor, TOLERANCE_FLOORS) is not examined, and a value whose whole range is within its unit floor is still and is
 * not judged. A NaN frame fails its value; a sub-step that is NaN fails its step. A speed corner or an ease changes
 * gradually and passes. A cut in `cuts` (ms) exempts the steps within one frame of it. With `input`, the step in which
 * a press lands (a pointer's first sample, or a press after a lift) or a scroll burst starts is exempt: the page answers
 * the input's start with a response that is out of proportion to the input's step, a thumb that jumps to the press, a
 * grab that tilts a body, a toast that shows on the first scroll tick, and the input has no pace yet to compare it
 * with. A response to a press is the page's answer to the input, not a pop of its own. Only the one step is exempt, so
 * a later pop is judged. A step in which the input moves is exempt when it keeps the input's pace: under ?seek the pointer holds
 * one position per frame and the scroll one position per sample, so a value that follows either moves in one step there by design. The step
 * keeps the pace when its change per px the input moves in that frame (the pointer's larger move along an axis, the
 * scroll's move) is at most JUMP_FACTOR times the lower median of that ratio in the other frames where both move,
 * whatever the value's unit. So two lurches in a row cannot excuse each other, a pop in a frame where the input holds
 * still has no pace to keep, and a value the input does not move is not excused by one frame. A value in `stepped` (trace.json) holds drawings on purpose, so it is
 * judged at its drawing rate instead (drawingJumps): no drawing may spike or teleport, in lengths of the object it
 * moves, with the same cut and pointer exemptions. `scrolled` says the bar's main kind is scroll: the flag the kind
 * gate's objects and envelope rules use, so both gates fit and measure a stepped value alike.
 *
 * `known` is the page's frames over the span (0 to spanMs, one frame a step) when the caller has them already.
 *
 * `members` are the membership steps of the checked extents (kind-gate.ts checkedExtents), by value: the frame steps,
 * by the frame's time in whole microseconds, where a part of the extent comes back or goes gone, with how far the edge
 * moved in that step over the parts drawn in both frames. The edge of the union jumps there because who is in it
 * changed, not because a body moved, so such a step is judged on that change instead of its own: a step whose change
 * over the parts drawn in both frames is under JUMP_SHARE of the value's range is exempt, with its sub-steps (the edge
 * of the parts that stay changes speed where the holder changes, so the steps beside it are no measure). A part that
 * jumps while it stays drawn by JUMP_SHARE of the range or more is in that change, so it is still a jump.
 *
 * A page that moves a value in whole frames only (WHOLE_FRAME_RUN) shows a hold and a jump at every frame: the gate
 * cannot read between its frames, so that run of steps is left out and one line goes to `notes`.
 */
export declare function suddenJumps(page: GatePage, channels: string[], cuts: number[], spanMs?: number, input?: InputSamples | null, stepped?: string[], scrolled?: boolean, notes?: string[], known?: Frame[], members?: Map<string, Map<number, number>>): Promise<string[]>;
/** A stepped value is read this much past the span, so the drawings around its last step there are whole. */
export declare const MOVE_READ_AHEAD_MS = 4000;
/**
 * The pops of stepped value `name` (poses.ts `stepPops`), from its raw frames and the raw boxes of the object that
 * moves it in `objects` (the page's record; none: it moves no object), in the page's viewport, with `atMs` where the
 * drawing after the pop's first step starts. Its steps are measured with its fitted slopes (fitSlopes on the span's
 * frames, the fit the objects rule checks), and a value with none takes off what the object's fitted values explain
 * (explainedBy, on the read's frames); `scrolled` says the page is a scroll page, the same flag the objects rule
 * fits with, so the drawings carry the scroll. Only pops inside the span count, and no step is judged where `skip`
 * (the frame before the step, in ms) is true; the frames are read MOVE_READ_AHEAD_MS further, so a step near the end
 * of the span is judged against the drawings after it, and a drawing that holds to the end of that read is a rest. The still tolerance that splits
 * the drawings comes from the value's range inside the span, one outlier left out at each end (robustRange): one wild
 * frame, past the span or at a cut, cannot merge drawings.
 */
export declare function drawingJumps(page: GatePage, name: string, objects: Record<string, ObjectRecord>, spanMs: number, unit: string | undefined, scrolled: boolean, skip: (ms: number) => boolean): Promise<(StepPop & {
    atMs: number;
})[]>;
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
/** Object lengths and speed ratios print to 2 decimals. */
export declare const roundLengths: (n: number) => number;
