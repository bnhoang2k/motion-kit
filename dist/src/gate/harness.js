import path from "node:path";
import { pathToFileURL } from "node:url";
import { lineAt, poses, restsOf } from "./poses.js";
import { rangeOf, REST_FRAMES, stillTol } from "./series.js";
export const FRAME_MS = 1000 / 60;
/** Waits `ms` on the wall clock. */
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/**
 * Replays recorded input on a live page with real Playwright input, timed by the wall clock:
 * each sample fires when its `ms` has passed since the replay started. Pointer samples become
 * mouse down, moves and up. Scroll samples become `scrollTo` steps, which fire real scroll
 * events at exact positions (a wheel would smooth-scroll past them).
 */
export async function replayInput(live, input) {
    const start = performance.now();
    const at = async (ms) => {
        const wait = start + ms - performance.now();
        if (wait > 0)
            await sleep(wait);
    };
    const { mouse } = live.page;
    if (input.kind === "pointer") {
        let down = false;
        for (const [ms, x, y, flag] of input.samples) {
            await at(ms);
            await mouse.move(x, y);
            const press = flag !== 0;
            if (press !== down)
                await (press ? mouse.down() : mouse.up());
            down = press;
        }
        if (down)
            await mouse.up();
    }
    else {
        for (const [ms, y] of input.samples) {
            await at(ms);
            await live.page.evaluate((top) => window.scrollTo(0, top), y);
        }
    }
}
export const PLAYWRIGHT_MISSING = "The gate needs Playwright's Chromium. Install it with: pnpm add -D playwright && pnpm exec playwright install chromium";
/** Playwright, or null when it cannot be imported. Never throws. */
export async function playwrightOrNull() {
    try {
        return await import("playwright");
    }
    catch {
        return null;
    }
}
let browser;
async function launch() {
    const pw = await playwrightOrNull();
    if (!pw)
        throw new Error(PLAYWRIGHT_MISSING);
    return pw.chromium.launch({ headless: true });
}
/** Closes the shared browser. The next `openPage` starts a new one. */
export async function closeBrowser() {
    const b = browser;
    browser = undefined;
    if (b)
        await (await b).close();
}
/**
 * Installed before any page script. It wraps `requestAnimationFrame` to log each live frame (and
 * to inject the clock gap), and defines `window.__gate`, the in-page side of the harness. Kept as
 * plain JS source so that nothing a test runner adds to compiled functions reaches the page.
 */
const GATE_INIT = String.raw `(function (cfg) {
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
function steppedReads(raw, names, input) {
    const grid = [];
    const boxGrid = [];
    const scrollGrid = [];
    const memo = new Map();
    let now = 0;
    let rawWindow = input ? undefined : null;
    const posesOf = (name) => {
        let m = memo.get(name);
        if (!m) {
            const v = grid.map((g) => g[name] ?? Number.NaN);
            const ps = poses(v, stillTol(v));
            m = { ps, rests: restsOf(ps) };
            memo.set(name, m);
        }
        return m;
    };
    const fill = async (to) => {
        if (grid.length > to)
            return;
        const times = Array.from({ length: to + 1 - grid.length }, (_, k) => (grid.length + k) * FRAME_MS);
        for (const f of await raw.framesAt(times)) {
            grid.push(f.values);
            boxGrid.push(f.boxes);
            scrollGrid.push(f.scroll);
        }
        memo.clear();
    };
    /** The grid through frame `hi`, and far enough past it that each stepped value's poses around `hi` are whole. */
    const ensure = async (hi) => {
        await fill(hi);
        const short = () => names.some((n) => posesOf(n).ps.filter((p) => p.start > hi).length < LOOKAHEAD_DRAWINGS);
        while (grid.length - 1 < hi + LOOKAHEAD_FRAMES && short())
            await fill(Math.min(hi + LOOKAHEAD_FRAMES, grid.length - 1 + LOOKAHEAD_STEP));
    };
    const onGrid = (ms) => {
        const i = Math.round(ms / FRAME_MS);
        return Math.abs(i * FRAME_MS - ms) < 1e-6 ? i : null;
    };
    /** The input window: from the first sample until every stepped value's line holds still REST_FRAMES steps after the last. */
    const inputWindow = async () => {
        if (rawWindow !== undefined)
            return rawWindow;
        const [start, end] = [input[0][0], input[input.length - 1][0]];
        const i0 = Math.ceil(end / FRAME_MS - 1e-6);
        await fill(i0 + LOOKAHEAD_FRAMES + REST_FRAMES);
        const still = (n, i) => {
            const { ps, rests } = posesOf(n);
            const at = (k) => lineAt(ps, rests, k) ?? grid[k][n] ?? Number.NaN;
            const v = grid.map((g) => g[n] ?? Number.NaN);
            const eps = stillTol(v);
            for (let k = i; k < i + REST_FRAMES; k++)
                if (!(Math.abs(at(k + 1) - at(k)) <= eps))
                    return false;
            return true;
        };
        let i = i0;
        while (i < i0 + LOOKAHEAD_FRAMES && !names.every((n) => still(n, i)))
            i++;
        rawWindow = [start, i * FRAME_MS];
        return rawWindow;
    };
    const lined = (ms, values) => {
        if (rawWindow && ms >= rawWindow[0] - 1e-6 && ms <= rawWindow[1] + 1e-6)
            return values;
        const out = { ...values };
        for (const n of names) {
            if (!(n in out))
                continue;
            const { ps, rests } = posesOf(n);
            const x = lineAt(ps, rests, ms / FRAME_MS);
            if (x !== null)
                out[n] = x;
        }
        return out;
    };
    /** The raw values at each time: from the grid where it can, by seeking elsewhere. The page is left at the last time. */
    const rawAt = async (times, ahead) => {
        if (times.length === 0)
            return [];
        const hi = Math.ceil(Math.max(...times) / FRAME_MS - 1e-6);
        await (ahead ? ensure(hi) : fill(hi));
        const off = times.filter((t) => onGrid(t) === null);
        const sought = new Map((off.length > 0 ? await raw.framesAt(off) : []).map((f) => [f.ms, f]));
        now = times[times.length - 1];
        await raw.seek(now);
        return times.map((ms) => {
            const i = onGrid(ms);
            const [values, boxes, scroll] = i !== null ? [grid[i], boxGrid[i], scrollGrid[i]] : [sought.get(ms).values, sought.get(ms).boxes, sought.get(ms).scroll];
            return { ms, values: { ...values }, ...(boxes ? { boxes: { ...boxes }, scroll: scroll } : {}) };
        });
    };
    const grid0 = (from, to, step) => {
        const times = [];
        for (let i = 0; from + i * step <= to + 1e-9; i++)
            times.push(from + i * step);
        return times;
    };
    const framesAt = async (times) => {
        const fs = await rawAt(times, true);
        if (input)
            await inputWindow();
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
            if (input)
                await inputWindow();
            return { ...s, values: lined(now, s.values) };
        },
        frames: (fromMs, toMs, stepMs = FRAME_MS) => framesAt(grid0(fromMs, toMs, stepMs)),
        framesAt,
        rawFrames: (fromMs, toMs, stepMs = FRAME_MS) => rawAt(grid0(fromMs, toMs, stepMs), false),
    };
}
/** Opens `file` (a path) from file:// in a fresh browser context, with the gate hooks installed. */
export async function openPage(file, options = {}) {
    browser ??= launch();
    let b;
    try {
        b = await browser;
    }
    catch (e) {
        browser = undefined;
        throw e;
    }
    const context = await b.newContext({ reducedMotion: options.reducedMotion ? "reduce" : "no-preference", deviceScaleFactor: options.pixelRatio ?? 1 });
    const cfg = { input: options.input, gap: options.clockGap ?? null };
    await context.addInitScript({ content: `${GATE_INIT}(${JSON.stringify(cfg)});` });
    const page = await context.newPage();
    const messages = [];
    page.on("console", (m) => void messages.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => void messages.push(`pageerror: ${e.message}`));
    const url = pathToFileURL(path.resolve(file));
    if (options.seek !== false)
        url.search = "seek";
    try {
        await page.goto(url.href, { waitUntil: "load" });
        await page.evaluate(() => window.__gate.baseline());
    }
    catch (e) {
        await context.close();
        throw e;
    }
    // Each callback below runs in the page, so it reaches the gate through `window`, not a closure.
    const raw = {
        seek: (ms) => page.evaluate((t) => window.__gate.seek(t), ms),
        state: () => page.evaluate(() => window.__gate.state()),
        frames: (fromMs, toMs, stepMs = FRAME_MS) => page.evaluate(([a, z, s]) => window.__gate.frames(a, z, s), [fromMs, toMs, stepMs]),
        framesAt: (times) => page.evaluate((ts) => window.__gate.framesAt(ts), times),
    };
    const inputRaw = options.steppedInputRaw && Array.isArray(options.input) && options.input.length > 0 ? options.input : null;
    const stepped = options.seek !== false && (options.stepped ?? []).length > 0 ? steppedReads(raw, options.stepped, inputRaw) : null;
    return {
        file,
        options: { ...options },
        page,
        hooks: () => page.evaluate(() => window.__gate.hooks()),
        ...(stepped ?? { ...raw, rawFrames: raw.frames }),
        viewport: () => page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        changedElements: () => page.evaluate(() => window.__gate.changed()),
        console: () => [...messages],
        rafCountAfter: (ms, windowMs) => page.evaluate(([a, w]) => window.__gate.clock.rafCount(a, w), [ms, windowMs]),
        async liveFrames(framesAfterGap = 10) {
            // A loop that never settles is read as it stands after 5 s. Any other error is real. The wait
            // polls on a timer: its default rAF polling would run through the wrapped rAF and count as frames.
            await page
                .waitForFunction((n) => window.__gate.clock.settled(n), framesAfterGap, { timeout: 5000, polling: 50 })
                .catch((e) => {
                if (!(e instanceof Error && e.name === "TimeoutError"))
                    throw e;
            });
            return page.evaluate(() => {
                const c = window.__gate.clock;
                return { frames: c.log, gapIndex: c.gapIndex };
            });
        },
        close: () => context.close(),
    };
}
