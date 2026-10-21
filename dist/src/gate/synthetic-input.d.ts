import type { KindName } from "../core/types.ts";
import { type GatePage, type InputSamples } from "./harness.ts";
/**
 * The input the kind gate plays when no recorded input exists. Every time sits on the 1/60 s
 * frame grid, so a `?seek` page sees each change at a frame boundary.
 *
 * - live: a press at the viewport center, a drag along a 300 px curve over 600 ms, one sample per
 *   frame, then the release after the last sample. The curve goes right at a steady speed while it
 *   dips down and comes back up (x and y are not in proportion), so a value that follows one axis
 *   cannot pass for following the other.
 * - scroll: 3 wheel ticks of 100 px down, 50 ms apart, then 3 ticks up after a pause. The
 *   samples hold the window's scroll position, `[ms, scrollY]`. The ticks come close together, as
 *   in a flick, so the live run's clock gap (after 6 frames) lands while most of the scroll is
 *   still ahead: a page with no time-step cap then moves past its one-frame budget.
 * - choreo and sim: a tap at the viewport center: a press, lifted one frame later. A page that
 *   starts its motion on load and ignores the tap is judged on its load motion instead (see
 *   `inputAndSpan` in kind-gate.ts).
 * - idle: none.
 *
 * The input starts 250 ms in, so the page shows a still start first. A page that is still moving
 * then from its load motion gets its input 250 ms after that motion ends (see `inputStartAfter` in
 * kind-gate.ts), so the input meets a page at rest.
 */
/** Playwright's default viewport is 1280 by 720 px. */
export declare const VIEWPORT_CENTER: readonly [640, 360];
export declare const INPUT_START_MS: number;
export declare const DRAG_PX = 300;
export declare const DRAG_MS: number;
export declare const TICK_PX = 100;
/** The synthetic input for `kind`, starting at `startMs` (a 1/60 s frame time, INPUT_START_MS or later). */
export declare function syntheticInput(kind: KindName, startMs?: number): InputSamples | null;
/** The first and last sample times, in ms. */
export declare function inputSpan(input: InputSamples): {
    start: number;
    end: number;
};
/**
 * Every time the input changes: the first sample, each sample whose values change, and (with `end`)
 * the last sample's time, after which the pointer is up. With `flags` false, a change of a pointer
 * sample's `down` flag alone does not count, so only the moves do.
 */
export declare function inputChanges(input: InputSamples | null, { flags, end }?: {
    flags?: boolean;
    end?: boolean;
}): number[];
/**
 * Plays the input on a live page with real Playwright input. Pointer samples go through
 * `replayInput` (down, moves, up). Scroll samples become wheel ticks at the viewport center: one
 * tick for each change in the scroll position, at that sample's time. Both gates play a live run
 * this way: setting exact positions would skip a page that smooths the wheel itself.
 */
export declare function driveInput(live: GatePage, input: InputSamples): Promise<void>;
