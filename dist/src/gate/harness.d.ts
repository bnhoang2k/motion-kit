import type { Page } from "playwright";
import type { InputSamples } from "../core/trace.ts";
import type { Box, ObjectRecord } from "./objects.ts";
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
 *   and the optional `units` names the unit of a value (`px`, `deg`, `ratio`, `opacity`, `scale`, `s`). The optional
 *   `objects` names the things on screen: `{ [name]: { box: [x, y, w, h], moves: [value names], halo? } }` (objects.ts).
 *   The box is the one of the frame `__seek` just drew.
 *
 * The harness reads computed styles in one place only: `changedElements()`, for coverage.
 */
export type GateState = {
    values: Record<string, number>;
    events: Record<string, number>;
    units: Record<string, string>;
    /**
     * The page's object record; `{}` when it reports none. An entry that is not `{ box, moves }` passes through as it
     * came, for `checkObjects` to name, and so does a `halo` that is not a number.
     */
    objects: Record<string, ObjectRecord>;
};
/**
 * `boxes` is present only when the page reports objects, and `scroll` (`window.scrollY`, CSS px) on exactly the frames
 * that carry `boxes`.
 */
export type Frame = {
    ms: number;
    values: Record<string, number>;
    boxes?: Record<string, Box>;
    scroll?: number;
};
export interface OpenOptions {
    /** Set as `window.__input` before the page loads: the recorded input samples. */
    input?: unknown[];
    /** Opens with `prefers-reduced-motion: reduce`. */
    reducedMotion?: boolean;
    /** Adds `?seek` to the URL (the default). False opens the page on its live rAF loop. */
    seek?: boolean;
    /** Device pixels per CSS px for screenshots (default 1). The frame sheet uses 2, so a crop stays sharp. */
    pixelRatio?: number;
    /** The viewport in CSS px (default: the browser's). Pages the gate opens from this one in its context share it. */
    viewport?: {
        width: number;
        height: number;
    };
    /** Live pages only: adds `ms` to every rAF timestamp and to `performance.now()` from frame `afterFrames + 1` on, once. */
    clockGap?: {
        afterFrames: number;
        ms: number;
    };
    /**
     * Values a bar holds in drawings on purpose (trace.json `stepped`). Under `?seek`, `state()`, `frames()` and
     * `framesAt()` report each as its pose line (poses.ts `lineAt`); `rawFrames()` reports what the page holds. The
     * harness reads the page's 1/60 s grid from 0 once and keeps it, reading up to 4 s past the last frame asked for.
     */
    stepped?: string[];
    /**
     * Live and scroll pages: the stepped values read raw inside the input window, from the input's first sample until
     * every stepped value's pose line rests after its last one. The input drives them there, and the input rules judge
     * what the hand sees. The line rests where the drawings rest, so it meets them at both ends of the window.
     */
    steppedInputRaw?: boolean;
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
    /** As `frames`, with every value as the page holds it: a stepped value as its drawings, not its pose line. */
    rawFrames(fromMs: number, toMs: number, stepMs?: number): Promise<Frame[]>;
    /** The viewport in CSS px: what a box is wholly outside of when it is off screen (objects.ts `goneIn`). */
    viewport(): Promise<{
        width: number;
        height: number;
    }>;
    /** A CSS selector for each element whose transform, opacity or filter differs from its load-time look at any seek so far. */
    changedElements(): Promise<string[]>;
    /** Console messages as `<type>: <text>`, and uncaught errors as `pageerror: <message>`. */
    console(): string[];
    /** Live pages: rAF callbacks the page ran from `ms` to `ms + windowMs` after the page's time origin, on the real clock. */
    rafCountAfter(ms: number, windowMs: number): Promise<number>;
    /**
     * Live pages: first waits up to 250 ms for the first live frame (a loop a tap starts may run after the
     * input has ended), then waits until `framesAfterGap` frames ran after the clock gap, or the loop went quiet
     * for 300 ms, or 5 s passed. Returns the values after each frame (`ms` is the rAF timestamp the page
     * saw) and the index of the first frame after the gap, or null when the gap never came.
     */
    liveFrames(framesAfterGap?: number): Promise<{
        frames: Frame[];
        gapIndex: number | null;
    }>;
    /**
     * Live pages: the values after each frame the page logged from index `from` on, and the index to read from next. A read
     * every few dozen ms can step over a value that moves for a frame or two; this one sees every frame.
     */
    liveLog(from: number): Promise<{
        frames: Frame[];
        next: number;
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
