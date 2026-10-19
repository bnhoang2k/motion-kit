import type { Page } from "playwright";
import type { InputSamples } from "../core/trace.ts";
/**
 * The fixed-clock harness. It opens a page from file:// in headless Chromium and drives it
 * through the page hooks.
 *
 * Page hook contract:
 * - Under `?seek` the page starts no live loop.
 * - `window.__seek(ms)` re-runs the page from 0 to `ms`: whole 1/60 s steps, then one shorter
 *   step for the remainder, so a time between two frames (t + dt/2) is reachable. On the way it
 *   feeds the page `window.__input`, which the harness sets before the page loads.
 * - `window.__state()` returns `{ values, events, units? }` read from the page's own state object,
 *   never from computed styles: `values` holds the traced numbers, `events` the named times in ms,
 *   and the optional `units` names the unit of a value (`px`, `deg`, `ratio`, `opacity`, `scale`, `s`).
 *
 * The harness reads computed styles in one place only: `changedElements()`, for coverage.
 */
export type GateState = {
    values: Record<string, number>;
    events: Record<string, number>;
    units: Record<string, string>;
};
export type Frame = {
    ms: number;
    values: Record<string, number>;
};
export interface OpenOptions {
    /** Set as `window.__input` before the page loads: the recorded input samples. */
    input?: unknown[];
    /** Opens with `prefers-reduced-motion: reduce`. */
    reducedMotion?: boolean;
    /** Adds `?seek` to the URL (the default). False opens the page on its live rAF loop. */
    seek?: boolean;
    /** Live pages only: adds `ms` to every rAF timestamp and to `performance.now()` from frame `afterFrames + 1` on, once. */
    clockGap?: {
        afterFrames: number;
        ms: number;
    };
}
export interface GatePage {
    readonly file: string;
    readonly options: Readonly<OpenOptions>;
    /** The Playwright page, for the kind rules that drive a pointer, a scroll or the page visibility. */
    readonly page: Page;
    /** Which of the two clock hooks the page defines. */
    hooks(): Promise<{
        seek: boolean;
        state: boolean;
    }>;
    seek(ms: number): Promise<void>;
    state(): Promise<GateState>;
    /** Seeks every `stepMs` from `fromMs` to `toMs`, both ends included, and reads the values at each. */
    frames(fromMs: number, toMs: number, stepMs?: number): Promise<Frame[]>;
    /** Seeks each time in `times` (ms), in order, and reads the values at each. */
    framesAt(times: number[]): Promise<Frame[]>;
    /** A CSS selector for each element whose transform, opacity or filter differs from its load-time look at any seek so far. */
    changedElements(): Promise<string[]>;
    /** Console messages as `<type>: <text>`, and uncaught errors as `pageerror: <message>`. */
    console(): string[];
    /** Live pages: rAF callbacks the page ran from `ms` to `ms + windowMs` after the page's time origin, on the real clock. */
    rafCountAfter(ms: number, windowMs: number): Promise<number>;
    /**
     * Live pages: waits until `framesAfterGap` frames ran after the clock gap, or the loop went quiet
     * for 300 ms, or 5 s passed. Returns the values after each frame (`ms` is the rAF timestamp the page
     * saw) and the index of the first frame after the gap, or null when the gap never came.
     */
    liveFrames(framesAfterGap?: number): Promise<{
        frames: Frame[];
        gapIndex: number | null;
    }>;
    close(): Promise<void>;
}
export declare const FRAME_MS: number;
export type { InputSamples };
/** Waits `ms` on the wall clock. */
export declare const sleep: (ms: number) => Promise<void>;
/**
 * Replays recorded input on a live page with real Playwright input, timed by the wall clock:
 * each sample fires when its `ms` has passed since the replay started. Pointer samples become
 * mouse down, moves and up. Scroll samples become `scrollTo` steps, which fire real scroll
 * events at exact positions (a wheel would smooth-scroll past them).
 */
export declare function replayInput(live: GatePage, input: InputSamples): Promise<void>;
export declare const PLAYWRIGHT_MISSING = "The gate needs Playwright's Chromium. Install it with: pnpm add -D playwright && pnpm exec playwright install chromium";
/** Playwright, or null when it cannot be imported. Never throws. */
export declare function playwrightOrNull(): Promise<typeof import("playwright") | null>;
/** Closes the shared browser. The next `openPage` starts a new one. */
export declare function closeBrowser(): Promise<void>;
/** Opens `file` (a path) from file:// in a fresh browser context, with the gate hooks installed. */
export declare function openPage(file: string, options?: OpenOptions): Promise<GatePage>;
