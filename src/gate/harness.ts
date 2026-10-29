import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import type { InputSamples } from "../core/trace.ts";
import type { Box, ObjectRecord } from "./objects.ts";
import { lineAt, poses, restsOf, type Pose } from "./poses.ts";
import { rangeOf, REST_FRAMES, stillTol } from "./series.ts";

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
export type Frame = { ms: number; values: Record<string, number>; boxes?: Record<string, Box>; scroll?: number };

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
  viewport?: { width: number; height: number };
  /** Live pages only: adds `ms` to every rAF timestamp and to `performance.now()` from frame `afterFrames + 1` on, once. */
  clockGap?: { afterFrames: number; ms: number };
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
  hooks(): Promise<{ seek: boolean; state: boolean }>;
  seek(ms: number): Promise<void>;
  state(): Promise<GateState>;
  /** Seeks every `stepMs` from `fromMs` to `toMs`, both ends included, and reads the values at each. */
  frames(fromMs: number, toMs: number, stepMs?: number): Promise<Frame[]>;
  /** Seeks each time in `times` (ms), in order, and reads the values at each. */
  framesAt(times: number[]): Promise<Frame[]>;
  /** As `frames`, with every value as the page holds it: a stepped value as its drawings, not its pose line. */
  rawFrames(fromMs: number, toMs: number, stepMs?: number): Promise<Frame[]>;
  /** The viewport in CSS px: what a box is wholly outside of when it is off screen (objects.ts `goneIn`). */
  viewport(): Promise<{ width: number; height: number }>;
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
  liveFrames(framesAfterGap?: number): Promise<{ frames: Frame[]; gapIndex: number | null }>;
  /**
   * Live pages: the values after each frame the page logged from index `from` on, and the index to read from next. A read
   * every few dozen ms can step over a value that moves for a frame or two; this one sees every frame.
   */
  liveLog(from: number): Promise<{ frames: Frame[]; next: number }>;
  close(): Promise<void>;
}

export const FRAME_MS = 1000 / 60;

/** After the drive, `liveFrames` waits this long for the first live frame before it lets the loop count as quiet. */
const FIRST_FRAME_WAIT_MS = 250;

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
  const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number");
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
    const objects = {};
    if (s && typeof s.objects === "object" && s.objects !== null && !Array.isArray(s.objects)) {
      const shaped = Object.values(s.objects).every((o) => o && typeof o === "object" && isBox(o.box) && Array.isArray(o.moves) && o.moves.every((m) => typeof m === "string"));
      const copy = (o) => Object.assign({ box: Array.from(o.box), moves: Array.from(o.moves) }, o.halo !== undefined ? { halo: o.halo } : {});
      for (const [k, o] of Object.entries(s.objects)) objects[k] = shaped ? copy(o) : o;
    }
    return { values: pick(s && s.values), events: pick(s && s.events), units, objects };
  };
  const read = (ms) => {
    const s = state();
    const f = { ms, values: s.values };
    const names = Object.keys(s.objects);
    if (names.length > 0) {
      f.boxes = {};
      for (const k of names) {
        const o = s.objects[k];
        if (o && isBox(o.box)) f.boxes[k] = Array.from(o.box);
      }
      f.scroll = window.scrollY;
    }
    return f;
  };
  const seek = (ms) => { need("__seek"); window.__seek(ms); note(); };
  const frames = (from, to, step) => {
    need("__seek");
    need("__state");
    const out = [];
    for (let i = 0; from + i * step <= to + 1e-9; i++) {
      const ms = from + i * step;
      seek(ms);
      out.push(read(ms));
    }
    return out;
  };
  const framesAt = (times) => {
    need("__seek");
    need("__state");
    return times.map((ms) => { seek(ms); return read(ms); });
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
      lastReal: number | null;
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

type RawReads = Pick<GatePage, "seek" | "state" | "frames" | "framesAt">;

/** The times `from`, `from + step`, ... through `to`, as the page's `frames` steps them. */
function gridTimes(from: number, to: number, step: number): number[] {
  const times: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) times.push(from + i * step);
  return times;
}

/**
 * The reads of a `?seek` page, each time read once. The page is a pure function of time and its fixed input, so its
 * frame at a time is the same whenever it is read, and a gate that reads the same stretch again (each rule reads the
 * whole span, and a rule re-reads a stretch to look closer) need not render it again: a frame costs the page its whole
 * render, and the repeats were most of the time a heavy page took. A frame comes back as a copy, so a caller may change
 * it. A read still leaves the page where it would have left it, at the last time asked for. A live page is not a
 * function of time, and is not wrapped.
 */
function onceEach(reads: RawReads): RawReads {
  const seen = new Map<number, Frame>();
  /** The time the page stands at: the last it was seeked to, or null before any seek. */
  let at: number | null = null;
  const framesAt = async (times: number[]): Promise<Frame[]> => {
    const missing = [...new Set(times.filter((t) => !seen.has(t)))];
    if (missing.length > 0) {
      const read = await reads.framesAt(missing);
      missing.forEach((t, i) => seen.set(t, read[i]!));
      at = missing[missing.length - 1]!;
    }
    const last = times[times.length - 1];
    if (last !== undefined && at !== last) {
      await reads.seek(last);
      at = last;
    }
    return times.map((t) => structuredClone(seen.get(t)!));
  };
  return {
    seek: async (ms) => {
      await reads.seek(ms);
      at = ms;
    },
    state: reads.state,
    frames: (fromMs, toMs, stepMs = FRAME_MS) => framesAt(gridTimes(fromMs, toMs, stepMs)),
    framesAt,
  };
}

/** After the last frame asked for, the harness reads ahead until each stepped value has started this many more drawings... */
const LOOKAHEAD_DRAWINGS = 4;
/** ...or this many frames (4 s), in steps of LOOKAHEAD_STEP frames. */
const LOOKAHEAD_FRAMES = 240;
const LOOKAHEAD_STEP = 30;

/**
 * The reads of a `?seek` page with stepped values. The page is a pure function of time and its fixed input, so its
 * raw values on the 1/60 s grid are read once, from frame 0, and kept. A stepped value then reads as its pose line
 * (poses.ts), except inside the input window when `input` is given (OpenOptions.steppedInputRaw); every other value
 * reads as the page reports it. The pose line at a frame depends on the drawings around it, so the harness reads
 * ahead (LOOKAHEAD_DRAWINGS) past the last frame asked for.
 */
function steppedReads(raw: RawReads, names: string[], input: number[][] | null): RawReads & Pick<GatePage, "rawFrames"> {
  const grid: Record<string, number>[] = [];
  const boxGrid: (Record<string, Box> | undefined)[] = [];
  const scrollGrid: (number | undefined)[] = [];
  const memo = new Map<string, { ps: Pose[]; rests: boolean[] }>();
  let now = 0;
  let rawWindow: [number, number] | null | undefined = input ? undefined : null;
  const posesOf = (name: string) => {
    let m = memo.get(name);
    if (!m) {
      const v = grid.map((g) => g[name] ?? Number.NaN);
      const ps = poses(v, stillTol(v));
      m = { ps, rests: restsOf(ps) };
      memo.set(name, m);
    }
    return m;
  };
  const fill = async (to: number) => {
    if (grid.length > to) return;
    const times = Array.from({ length: to + 1 - grid.length }, (_, k) => (grid.length + k) * FRAME_MS);
    for (const f of await raw.framesAt(times)) {
      grid.push(f.values);
      boxGrid.push(f.boxes);
      scrollGrid.push(f.scroll);
    }
    memo.clear();
  };
  /** The grid through frame `hi`, and far enough past it that each stepped value's poses around `hi` are whole. */
  const ensure = async (hi: number) => {
    await fill(hi);
    const short = () => names.some((n) => posesOf(n).ps.filter((p) => p.start > hi).length < LOOKAHEAD_DRAWINGS);
    while (grid.length - 1 < hi + LOOKAHEAD_FRAMES && short()) await fill(Math.min(hi + LOOKAHEAD_FRAMES, grid.length - 1 + LOOKAHEAD_STEP));
  };
  const onGrid = (ms: number) => {
    const i = Math.round(ms / FRAME_MS);
    return Math.abs(i * FRAME_MS - ms) < 1e-6 ? i : null;
  };
  /** The input window: from the first sample until every stepped value's line holds still REST_FRAMES steps after the last. */
  const inputWindow = async (): Promise<[number, number] | null> => {
    if (rawWindow !== undefined) return rawWindow;
    const [start, end] = [input![0]![0]!, input![input!.length - 1]![0]!];
    const i0 = Math.ceil(end / FRAME_MS - 1e-6);
    await fill(i0 + LOOKAHEAD_FRAMES + REST_FRAMES);
    const still = (n: string, i: number) => {
      const { ps, rests } = posesOf(n);
      const at = (k: number) => lineAt(ps, rests, k) ?? grid[k]![n] ?? Number.NaN;
      const v = grid.map((g) => g[n] ?? Number.NaN);
      const eps = stillTol(v);
      for (let k = i; k < i + REST_FRAMES; k++) if (!(Math.abs(at(k + 1) - at(k)) <= eps)) return false;
      return true;
    };
    let i = i0;
    while (i < i0 + LOOKAHEAD_FRAMES && !names.every((n) => still(n, i))) i++;
    rawWindow = [start, i * FRAME_MS];
    return rawWindow;
  };
  const lined = (ms: number, values: Record<string, number>) => {
    if (rawWindow && ms >= rawWindow[0] - 1e-6 && ms <= rawWindow[1] + 1e-6) return values;
    const out = { ...values };
    for (const n of names) {
      if (!(n in out)) continue;
      const { ps, rests } = posesOf(n);
      const x = lineAt(ps, rests, ms / FRAME_MS);
      if (x !== null) out[n] = x;
    }
    return out;
  };
  /** The raw values at each time: from the grid where it can, by seeking elsewhere. The page is left at the last time. */
  const rawAt = async (times: number[], ahead: boolean): Promise<Frame[]> => {
    if (times.length === 0) return [];
    const hi = Math.ceil(Math.max(...times) / FRAME_MS - 1e-6);
    await (ahead ? ensure(hi) : fill(hi));
    const off = times.filter((t) => onGrid(t) === null);
    const sought = new Map((off.length > 0 ? await raw.framesAt(off) : []).map((f) => [f.ms, f]));
    now = times[times.length - 1]!;
    await raw.seek(now);
    return times.map((ms) => {
      const i = onGrid(ms);
      const [values, boxes, scroll] = i !== null ? [grid[i]!, boxGrid[i], scrollGrid[i]] : [sought.get(ms)!.values, sought.get(ms)!.boxes, sought.get(ms)!.scroll];
      return { ms, values: { ...values }, ...(boxes ? { boxes: { ...boxes }, scroll: scroll! } : {}) };
    });
  };
  const grid0 = gridTimes;
  const framesAt = async (times: number[]) => {
    const fs = await rawAt(times, true);
    if (input) await inputWindow();
    return fs.map((f) => ({ ...f, values: lined(f.ms, f.values) }));
  };
  return {
    seek: async (ms) => {
      now = ms;
      await raw.seek(ms);
    },
    state: async () => {
      const s = await raw.state();
      await ensure(Math.ceil(now / FRAME_MS - 1e-6));
      if (input) await inputWindow();
      return { ...s, values: lined(now, s.values) };
    },
    frames: (fromMs, toMs, stepMs = FRAME_MS) => framesAt(grid0(fromMs, toMs, stepMs)),
    framesAt,
    rawFrames: (fromMs, toMs, stepMs = FRAME_MS) => rawAt(grid0(fromMs, toMs, stepMs), false),
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
  const context = await b.newContext({ reducedMotion: options.reducedMotion ? "reduce" : "no-preference", deviceScaleFactor: options.pixelRatio ?? 1, ...(options.viewport ? { viewport: options.viewport } : {}) });
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
  const pageReads: RawReads = {
    seek: (ms) => page.evaluate((t) => (window as unknown as GateWindow).__gate.seek(t), ms),
    state: () => page.evaluate(() => (window as unknown as GateWindow).__gate.state()),
    frames: (fromMs, toMs, stepMs = FRAME_MS) => page.evaluate(([a, z, s]) => (window as unknown as GateWindow).__gate.frames(a, z, s), [fromMs, toMs, stepMs] as const),
    framesAt: (times) => page.evaluate((ts) => (window as unknown as GateWindow).__gate.framesAt(ts), times),
  };
  const raw = options.seek === false ? pageReads : onceEach(pageReads);
  const inputRaw = options.steppedInputRaw && Array.isArray(options.input) && options.input.length > 0 ? (options.input as number[][]) : null;
  const stepped = options.seek !== false && (options.stepped ?? []).length > 0 ? steppedReads(raw, options.stepped!, inputRaw) : null;
  return {
    file,
    options: { ...options },
    page,
    hooks: () => page.evaluate(() => (window as unknown as GateWindow).__gate.hooks()),
    ...(stepped ?? { ...raw, rawFrames: raw.frames }),
    viewport: () => page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    changedElements: () => page.evaluate(() => (window as unknown as GateWindow).__gate.changed()),
    console: () => [...messages],
    rafCountAfter: (ms, windowMs) => page.evaluate(([a, w]) => (window as unknown as GateWindow).__gate.clock.rafCount(a, w), [ms, windowMs] as const),
    async liveFrames(framesAfterGap = 10) {
      // A loop a tap starts may run its first frame after the input that started it has ended, so the quiet
      // test below must not pass before one frame has run. A page with no loop waits this long for nothing.
      await page.waitForFunction(() => (window as unknown as GateWindow).__gate.clock.lastReal !== null, undefined, { timeout: FIRST_FRAME_WAIT_MS, polling: 10 }).catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "TimeoutError")) throw e;
      });
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
    liveLog: (from) =>
      page.evaluate((i) => {
        const log = (window as unknown as GateWindow).__gate.clock.log;
        return { frames: log.slice(i), next: log.length };
      }, from),
    close: () => context.close(),
  };
}
