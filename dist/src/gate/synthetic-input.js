import { FRAME_MS, replayInput, sleep } from "./harness.js";
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
 * - idle: none.
 *
 * The input starts 250 ms in, so the page shows a still start first. A page that is still moving
 * then from its load motion gets its input 250 ms after that motion ends (see `inputStartAfter` in
 * kind-gate.ts), so the input meets a page at rest.
 */
/** Playwright's default viewport is 1280 by 720 px. */
export const VIEWPORT_CENTER = [640, 360];
export const INPUT_START_MS = 15 * FRAME_MS;
export const DRAG_PX = 300;
export const DRAG_MS = 36 * FRAME_MS;
/** How deep the drag's curve dips, as a share of how far it goes right. */
const DRAG_DIP = 0.4;
export const TICK_PX = 100;
const TICK_GAP_FRAMES = 3;
/** The ticks back up start this many frames after the first tick down. */
const UP_AFTER_FRAMES = 72;
/** The synthetic input for `kind`, starting at `startMs` (a 1/60 s frame time, INPUT_START_MS or later). */
export function syntheticInput(kind, startMs = INPUT_START_MS) {
    const first = Math.round(startMs / FRAME_MS);
    if (kind === "live") {
        const [x0, y0] = VIEWPORT_CENTER;
        const frames = Math.round(DRAG_MS / FRAME_MS);
        const unit = Array.from({ length: frames + 1 }, (_, i) => [i / frames, DRAG_DIP * Math.sin((Math.PI * i) / frames)]);
        let length = 0;
        for (let i = 1; i < unit.length; i++)
            length += Math.hypot(unit[i][0] - unit[i - 1][0], unit[i][1] - unit[i - 1][1]);
        const k = DRAG_PX / length;
        return {
            kind: "pointer",
            samples: unit.map(([u, w], i) => [(first + i) * FRAME_MS, x0 + k * u, y0 + k * w]),
        };
    }
    if (kind === "scroll") {
        const start = first;
        const ticks = [0, 1, 2].map((i) => start + i * TICK_GAP_FRAMES);
        const backs = [0, 1, 2].map((i) => start + UP_AFTER_FRAMES + i * TICK_GAP_FRAMES);
        const last = backs[backs.length - 1];
        const samples = [];
        for (let f = start; f <= last; f++) {
            const y = TICK_PX * (ticks.filter((t) => t <= f).length - backs.filter((t) => t <= f).length);
            samples.push([f * FRAME_MS, y]);
        }
        return { kind: "scroll", samples };
    }
    return null;
}
/** The first and last sample times, in ms. */
export function inputSpan(input) {
    const ms = input.samples.map((s) => s[0]);
    return { start: Math.min(...ms), end: Math.max(...ms) };
}
/**
 * Every time the input changes: the first sample, each sample whose values change, and (with `end`)
 * the last sample's time, after which the pointer is up. With `flags` false, a change of a pointer
 * sample's `down` flag alone does not count, so only the moves do.
 */
export function inputChanges(input, { flags = true, end = true } = {}) {
    if (!input || input.samples.length === 0)
        return [];
    const span = inputSpan(input);
    const out = end ? [span.start, span.end] : [span.start];
    const s = input.samples;
    const last = !flags && input.kind === "pointer" ? 3 : undefined;
    for (let i = 1; i < s.length; i++)
        if (s[i].slice(1, last).some((v, j) => v !== s[i - 1][j + 1]))
            out.push(s[i][0]);
    return out.sort((a, b) => a - b);
}
/**
 * Plays the input on a live page with real Playwright input. Pointer samples go through
 * `replayInput` (down, moves, up). Scroll samples become wheel ticks at the viewport center: one
 * tick for each change in the scroll position, at that sample's time. Both gates play a live run
 * this way: setting exact positions would skip a page that smooths the wheel itself.
 */
export async function driveInput(live, input) {
    if (input.kind === "pointer")
        return replayInput(live, input);
    const { mouse } = live.page;
    await mouse.move(...VIEWPORT_CENTER);
    const start = performance.now();
    // The page opens at the top, so the first sample is a change from scroll position 0.
    let was = 0;
    for (const [ms, y] of input.samples) {
        const dy = y - was;
        was = y;
        if (dy === 0)
            continue;
        const wait = start + ms - performance.now();
        if (wait > 0)
            await sleep(wait);
        await mouse.wheel(0, dy);
    }
}
