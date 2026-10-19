/**
 * The trace.json contract: what a bar's recorded trace holds, and the check that says whether the
 * bar gate can play it. Pure: no browser, no file system. validate-bar and the bar gate both use it.
 */
/**
 * Recorded input, as trace.json holds it in `input: { kind, samples }`. One sample per 1/60 s,
 * each starting with its time in ms from the start of the input.
 * - `pointer`: `[ms, x, y]` or `[ms, x, y, down]` in page pixels. At a time t the pointer sits at
 *   the latest sample at or before t. It is down there unless that sample's `down` is 0, and it is
 *   up after the last sample. With no `down` flags, the samples are one press: down at the first
 *   sample, a move at each sample, up after the last. A 0 flag lifts the pointer until a later
 *   sample presses again.
 * - `scroll`: `[ms, scrollY]` in page pixels, the window's scroll position at that time.
 * A bar's trace.json input may carry the `down` flag too, so a recorded input can hold two presses.
 * `openPage({ input: samples })` hands the samples to the page as `window.__input`.
 */
export type InputSamples = {
    kind: "pointer";
    samples: ([ms: number, x: number, y: number] | [ms: number, x: number, y: number, down: 0 | 1])[];
} | {
    kind: "scroll";
    samples: [ms: number, scrollY: number][];
};
/**
 * The smallest tolerance a trace channel may have, by unit. A channel with one of these units
 * cannot be checked more tightly than this. The bar gate reads the same table.
 */
export declare const TOLERANCE_FLOORS: Readonly<Record<string, number>>;
/** One traced value. `read` is the key of `__state().values` that holds it on the page. */
export interface TraceChannel {
    name: string;
    /** One of the units in TOLERANCE_FLOORS. */
    unit: string;
    read: string;
    /** The elements this value moves. Coverage counts them as traced. */
    selectors: string[];
    /** max(2 * rebuildError, the unit's floor). */
    tolerance: number;
    /** The page's own error against the trace on this channel. */
    rebuildError: number;
}
/** A bar's trace.json: the bar's reference motion as numbers, never frames. */
export interface TraceJson {
    /** Always 60. */
    fps: number;
    /** The input that drives the motion, one sample per frame; pointer samples may carry the down flag. An idle bar has kind "none" and no samples. */
    input: InputSamples | {
        kind: "none";
        samples: [];
    };
    /** 2 to 5 channels. */
    channels: TraceChannel[];
    /**
     * Rows at 1/60 s frame times: `[ms, ...values]`, the values in channel order. Rows may skip
     * frames (a held frame, or time outside the traced windows). A value is
     * `null` where the trace has no value for that channel; the gate does not compare it.
     */
    samples: (number | null)[][];
    /** Named times in ms. */
    events: Record<string, number>;
    /** Times in ms where a value may jump. */
    cuts?: number[];
}
/** An event lands within 1 frame of its trace time. */
export declare const EVENT_MS = 17;
/** The gate seeks in 1/60 s frames, so the trace holds one sample per 1/60 s. */
export declare const TRACE_FPS = 60;
/** The tolerance a channel must have: 2 times the rebuild's error, and never below its unit's floor. */
export declare function toleranceFor(unit: string, rebuildError: number): number;
/**
 * Checks a parsed trace.json. `shape` lists what makes the trace unusable, so the gate cannot
 * play it. `tolerance` lists each channel whose tolerance is not max(2 * rebuildError, floor).
 */
export declare function checkTrace(value: unknown): {
    trace: TraceJson | undefined;
    shape: string[];
    tolerance: string[];
};
