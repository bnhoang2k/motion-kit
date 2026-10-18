import path from "node:path";
import { pathToFileURL } from "node:url";
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
    const context = await b.newContext({ reducedMotion: options.reducedMotion ? "reduce" : "no-preference" });
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
    return {
        file,
        options: { ...options },
        page,
        hooks: () => page.evaluate(() => window.__gate.hooks()),
        seek: (ms) => page.evaluate((t) => window.__gate.seek(t), ms),
        state: () => page.evaluate(() => window.__gate.state()),
        frames: (fromMs, toMs, stepMs = FRAME_MS) => page.evaluate(([a, z, s]) => window.__gate.frames(a, z, s), [fromMs, toMs, stepMs]),
        framesAt: (times) => page.evaluate((ts) => window.__gate.framesAt(ts), times),
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
