import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
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

export type GateState = { values: Record<string, number>; events: Record<string, number>; units: Record<string, string> };
export type Frame = { ms: number; values: Record<string, number> };

export interface OpenOptions {
  /** Set as `window.__input` before the page loads: the recorded input samples. */
  input?: unknown[];
  /** Opens with `prefers-reduced-motion: reduce`. */
  reducedMotion?: boolean;
  /** Adds `?seek` to the URL (the default). False opens the page on its live rAF loop. */
  seek?: boolean;
  /** Live pages only: adds `ms` to every rAF timestamp and to `performance.now()` from frame `afterFrames + 1` on, once. */
  clockGap?: { afterFrames: number; ms: number };
}

export interface GatePage {
  readonly file: string;
  readonly options: Readonly<OpenOptions>;
  /** The Playwright page, for the kind rules that drive a pointer, a scroll or the page visibility. */
  readonly page: Page;
  /** Which of the two clock hooks the page defines. */
  hooks(): Promise<{ seek: boolean; state: boolean }>;
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
  liveFrames(framesAfterGap?: number): Promise<{ frames: Frame[]; gapIndex: number | null }>;
  close(): Promise<void>;
}

export const FRAME_MS = 1000 / 60;

export type { InputSamples };

/** Waits `ms` on the wall clock. */
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Replays recorded input on a live page with real Playwright input, timed by the wall clock:
 * each sample fires when its `ms` has passed since the replay started. Pointer samples become
 * mouse down, moves and up. Scroll samples become `scrollTo` steps, which fire real scroll
 * events at exact positions (a wheel would smooth-scroll past them).
 */
export async function replayInput(live: GatePage, input: InputSamples): Promise<void> {
  const start = performance.now();
  const at = async (ms: number) => {
    const wait = start + ms - performance.now();
    if (wait > 0) await sleep(wait);
  };
  const { mouse } = live.page;
  if (input.kind === "pointer") {
    let down = false;
    for (const [ms, x, y, flag] of input.samples) {
      await at(ms);
      await mouse.move(x, y);
      const press = flag !== 0;
      if (press !== down) await (press ? mouse.down() : mouse.up());
      down = press;
    }
    if (down) await mouse.up();
  } else {
    for (const [ms, y] of input.samples) {
      await at(ms);
      await live.page.evaluate((top) => window.scrollTo(0, top), y);
    }
  }
}

export const PLAYWRIGHT_MISSING =
  "The gate needs Playwright's Chromium. Install it with: pnpm add -D playwright && pnpm exec playwright install chromium";

/** Playwright, or null when it cannot be imported. Never throws. */
export async function playwrightOrNull(): Promise<typeof import("playwright") | null> {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

let browser: Promise<Browser> | undefined;

async function launch(): Promise<Browser> {
  const pw = await playwrightOrNull();
  if (!pw) throw new Error(PLAYWRIGHT_MISSING);
  return pw.chromium.launch({ headless: true });
}

/** Closes the shared browser. The next `openPage` starts a new one. */
export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = undefined;
  if (b) await (await b).close();
}

/**
 * Installed before any page script. It wraps `requestAnimationFrame` to log each live frame (and
 * to inject the clock gap), and defines `window.__gate`, the in-page side of the harness. Kept as
 * plain JS source so that nothing a test runner adds to compiled functions reaches the page.
 */
const GATE_INIT = String.raw`(function (cfg) {
  if (cfg.input !== undefined) window.__input = cfg.input;
  const realNow = performance.now.bind(performance);
  const rAF = window.requestAnimationFrame.bind(window);
  const clock = { offset: 0, frames: 0, lastTs: null, gapIndex: null, lastReal: null, calls: [], log: [] };
  performance.now = () => realNow() + clock.offset;
  const readValues = () => {
    if (typeof window.__state !== "function") return {};
    try {
      const s = window.__state();
      const out = {};
      if (s && typeof s.values === "object" && s.values !== null)
        for (const [k, v] of Object.entries(s.values)) if (typeof v === "number") out[k] = v;
      return out;
    } catch (e) {
      return {};
    }
  };
  window.requestAnimationFrame = (cb) => rAF((ts) => {
    if (ts !== clock.lastTs) {
      clock.lastTs = ts;
      clock.frames += 1;
      if (cfg.gap && clock.gapIndex === null && clock.frames === cfg.gap.afterFrames + 1) {
        clock.offset += cfg.gap.ms;
        clock.gapIndex = clock.log.length;
      }
    }
    const t = ts + clock.offset;
    clock.calls.push(realNow());
    clock.lastReal = realNow();
    cb(t);
    const last = clock.log[clock.log.length - 1];
    if (last && last.ms === t) last.values = readValues();
    else clock.log.push({ ms: t, values: readValues() });
  });
  clock.settled = (after) => {
    const quiet = clock.lastReal === null ? realNow() > 1500 : realNow() - clock.lastReal > 300;
    if (clock.gapIndex !== null) return quiet || clock.log.length >= clock.gapIndex + after;
    return quiet;
  };
  clock.rafCount = (from, windowMs) => new Promise((done) => {
    const end = from + windowMs;
    const wait = () => {
      if (realNow() >= end) done(clock.calls.filter((c) => c >= from && c < end).length);
      else setTimeout(wait, Math.max(1, end - realNow()));
    };
    wait();
  });

  const KEYS = ["transform", "opacity", "filter"];
  const PLAIN = "none|1|none";
  const look = (el) => { const cs = getComputedStyle(el); return KEYS.map((k) => cs.getPropertyValue(k)).join("|"); };
  let base = null;
  const changed = new Set();
  const baseline = () => { base = new Map(); for (const el of document.querySelectorAll("body *")) base.set(el, look(el)); };
  const note = () => {
    if (base === null) return;
    for (const el of document.querySelectorAll("body *")) if (look(el) !== (base.has(el) ? base.get(el) : PLAIN)) changed.add(el);
  };
  const selector = (el) => {
    const parts = [];
    let e = el;
    while (e && e !== document.body && !e.id) {
      const p = e.parentElement;
      const tag = e.tagName.toLowerCase();
      const same = p ? Array.from(p.children).filter((c) => c.tagName === e.tagName) : [e];
      parts.unshift(same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(e) + 1) + ")" : tag);
      e = p;
    }
    const root = e && e.id ? "#" + CSS.escape(e.id) : "body";
    return parts.length === 0 ? root : root + " > " + parts.join(" > ");
  };
  const need = (name) => { if (typeof window[name] !== "function") throw new Error("the page has no window." + name); };
  const state = () => {
    need("__state");
    const s = window.__state();
    const pick = (o) => {
      const out = {};
      if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (typeof v === "number") out[k] = v;
      return out;
    };
    const units = {};
    if (s && typeof s.units === "object" && s.units !== null)
      for (const [k, u] of Object.entries(s.units)) if (typeof u === "string") units[k] = u;
    return { values: pick(s && s.values), events: pick(s && s.events), units };
  };
  const seek = (ms) => { need("__seek"); window.__seek(ms); note(); };
  const frames = (from, to, step) => {
    need("__seek");
    need("__state");
    const out = [];
    for (let i = 0; from + i * step <= to + 1e-9; i++) {
      const ms = from + i * step;
      seek(ms);
      out.push({ ms, values: state().values });
    }
    return out;
  };
  const framesAt = (times) => {
    need("__seek");
    need("__state");
    return times.map((ms) => { seek(ms); return { ms, values: state().values }; });
  };
  window.__gate = {
    clock, baseline, seek, state, frames, framesAt,
    hooks: () => ({ seek: typeof window.__seek === "function", state: typeof window.__state === "function" }),
    changed: () => Array.from(changed).filter((el) => el.isConnected).map(selector),
  };
})`;

interface GateWindow {
  __gate: {
    clock: {
      log: Frame[];
      gapIndex: number | null;
      settled(after: number): boolean;
      rafCount(from: number, windowMs: number): Promise<number>;
    };
    baseline(): void;
    seek(ms: number): void;
    state(): GateState;
    frames(from: number, to: number, step: number): Frame[];
    framesAt(times: number[]): Frame[];
    hooks(): { seek: boolean; state: boolean };
    changed(): string[];
  };
}

/** Opens `file` (a path) from file:// in a fresh browser context, with the gate hooks installed. */
export async function openPage(file: string, options: OpenOptions = {}): Promise<GatePage> {
  browser ??= launch();
  let b: Browser;
  try {
    b = await browser;
  } catch (e) {
    browser = undefined;
    throw e;
  }
  const context = await b.newContext({ reducedMotion: options.reducedMotion ? "reduce" : "no-preference" });
  const cfg = { input: options.input, gap: options.clockGap ?? null };
  await context.addInitScript({ content: `${GATE_INIT}(${JSON.stringify(cfg)});` });
  const page = await context.newPage();
  const messages: string[] = [];
  page.on("console", (m) => void messages.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => void messages.push(`pageerror: ${e.message}`));
  const url = pathToFileURL(path.resolve(file));
  if (options.seek !== false) url.search = "seek";
  try {
    await page.goto(url.href, { waitUntil: "load" });
    await page.evaluate(() => (window as unknown as GateWindow).__gate.baseline());
  } catch (e) {
    await context.close();
    throw e;
  }
  // Each callback below runs in the page, so it reaches the gate through `window`, not a closure.
  return {
    file,
    options: { ...options },
    page,
    hooks: () => page.evaluate(() => (window as unknown as GateWindow).__gate.hooks()),
    seek: (ms) => page.evaluate((t) => (window as unknown as GateWindow).__gate.seek(t), ms),
    state: () => page.evaluate(() => (window as unknown as GateWindow).__gate.state()),
    frames: (fromMs, toMs, stepMs = FRAME_MS) => page.evaluate(([a, z, s]) => (window as unknown as GateWindow).__gate.frames(a, z, s), [fromMs, toMs, stepMs] as const),
    framesAt: (times) => page.evaluate((ts) => (window as unknown as GateWindow).__gate.framesAt(ts), times),
    changedElements: () => page.evaluate(() => (window as unknown as GateWindow).__gate.changed()),
    console: () => [...messages],
    rafCountAfter: (ms, windowMs) => page.evaluate(([a, w]) => (window as unknown as GateWindow).__gate.clock.rafCount(a, w), [ms, windowMs] as const),
    async liveFrames(framesAfterGap = 10) {
      // A loop that never settles is read as it stands after 5 s. Any other error is real. The wait
      // polls on a timer: its default rAF polling would run through the wrapped rAF and count as frames.
      await page
        .waitForFunction((n) => (window as unknown as GateWindow).__gate.clock.settled(n), framesAfterGap, { timeout: 5000, polling: 50 })
        .catch((e: unknown) => {
          if (!(e instanceof Error && e.name === "TimeoutError")) throw e;
        });
      return page.evaluate(() => {
        const c = (window as unknown as GateWindow).__gate.clock;
        return { frames: c.log, gapIndex: c.gapIndex };
      });
    },
    close: () => context.close(),
  };
}
