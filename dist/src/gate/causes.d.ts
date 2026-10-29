import { type Frame, type InputSamples } from "./harness.ts";
/**
 * What starts a choreo or sim page's motion, read from the input the gate plays. Every press of a
 * pointer input is a cause, and so is every burst of scroll ticks. With no input the page load is
 * the one cause, at 0. A cause stops at its press's lift, at its burst's last tick, or at 0 for a load.
 */
export type Cause = {
    kind: "press" | "scroll" | "load";
    startMs: number;
    stopMs: number;
    /** A press's spot. */
    at?: [number, number];
    /** A scroll burst's first change in scroll position. */
    tick?: number;
};
/** Scroll ticks closer together than this are one burst. */
export declare const BURST_GAP_MS = 250;
/** Every cause in `input`, in time order. */
export declare function causesOf(input: InputSamples | null): Cause[];
/**
 * Each press or scroll cause's caused window: from its start to the end of the sequence it starts,
 * pauses included. The sequence ends at the first frame after which every value not in `loops`
 * holds still to the next cause's start (or the last frame), and never before the cause stops.
 * A load has no window: motion a page starts by itself is not caused.
 */
export declare function causedWindows(frames: Frame[], causes: Cause[], loops: Set<string>): [number, number][];
/**
 * `input` with `cause`'s trigger played once more at `atMs`: the same press at the same spot for the
 * same length, the same scroll tick, or a tap at the viewport center for a load. A pointer input that
 * ends down gets its lift as a sample one frame after its last, so the pointer is not held down
 * until the repeat.
 */
export declare function repeatCause(input: InputSamples | null, cause: Cause, atMs: number): InputSamples;
