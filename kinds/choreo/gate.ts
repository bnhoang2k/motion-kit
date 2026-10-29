import type { JSHandle } from "playwright";
import { TOLERANCE_FLOORS } from "../../src/core/bar.ts";
import { causedWindows, causesOf, repeatCause, type Cause } from "../../src/gate/causes.ts";
import { FRAME_MS, type Frame, type GatePage, type InputSamples } from "../../src/gate/harness.ts";
import { forLoops, loopsIn, rangeOf, reopen, REST_FRAMES, rolesOf, round, SEQUENCE_SCAN_MS, series, SETTLE_MS, spanOf, stillEps, valueNames, type KindRule } from "../../src/gate/kind-gate.ts";
import { VIEWPORT_CENTER } from "../../src/gate/synthetic-input.ts";
import { rules as idleRules } from "../idle/gate.ts";

/**
 * The choreo rules (kinds/choreo/rules.md). A choreo page plays a staggered sequence after a cause:
 * a tap, a scroll, or the page load. `interrupt` plays the cause's own trigger once more just before
 * and just after each piece starts, and every value must stay continuous and come to rest where the
 * page also rests without it. A stepped value's jump test reads its drawings, raw against raw. A loop on the page gets the idle rules: it pauses off screen. A loop has no rest to keep, but it may not jump after the second trigger (a restart of its lead-in or its phase).
 * A repeat that lands on a control the sequence brought under the cause's spot is a press on that control: the page
 * answers it as it should, and its rest is also one the page reaches when the control is pressed at rest.
 */

/** The second trigger lands this long before, and again this long after, each piece starts. */
export const INTERRUPT_MS = 8;
/** At most this many piece starts are tried, picked evenly across the sequences: 16 runs. */
export const MAX_BOUNDARIES = 8;
/** A value jumps when one frame moves it more than this many times its largest frame step in the clean run... */
export const JUMP_STEPS = 2.5;
/** ...plus this share of its range. */
export const JUMP_RANGE = 0.01;
/** A rest matches one of the page's own rests within this share of the value's range, or its unit's floor. */
const SAME_REST = 0.02;
/** The toggle run plays the second trigger this long after the clean sequence ends. */
const TOGGLE_AFTER_MS = 500;

/** A handle on the element under (x, y) in the `?seek` page as it is drawn now (null when none), and the centre and area of an element's box. */
const elementAt = (page: GatePage, [x, y]: readonly [number, number]) => page.page.evaluateHandle((p) => document.elementFromPoint(p[0], p[1]), [x, y] as const);
const centreOf = (el: JSHandle<Element | null>) => el.evaluate((e) => {
  const r = e?.getBoundingClientRect();
  return r ? { at: [r.x + r.width / 2, r.y + r.height / 2] as [number, number], area: r.width * r.height } : { at: [0, 0] as [number, number], area: 0 };
});

type Boundary = { cause: Cause; k: number; ms: number };

/** Where every value starts to move after a cause and before the next, merged when two fall within one frame. */
function boundariesOf(frames: Frame[], names: string[], causes: Cause[], k: number): number[] {
  const c = causes[k]!;
  const limit = causes[k + 1]?.startMs ?? Number.POSITIVE_INFINITY;
  const starts: number[] = [];
  for (const n of names) {
    const v = series(frames, n);
    const eps = stillEps(rangeOf(v));
    for (let i = 0; i + 1 < frames.length; i++) {
      const ms = frames[i]!.ms;
      if (ms < c.startMs - FRAME_MS - 1e-6 || frames[i + 1]!.ms > limit + 1e-6) continue;
      const moves = (j: number) => j >= 0 && Math.abs(v[j + 1]! - v[j]!) > eps;
      let heldBefore = true;
      for (let j = 1; j <= REST_FRAMES && heldBefore; j++) heldBefore = !moves(i - j) || frames[i - j]!.ms < c.startMs - FRAME_MS - 1e-6;
      if (moves(i) && heldBefore) starts.push(ms);
    }
  }
  starts.sort((a, b) => a - b);
  return starts.filter((ms, j) => j === 0 || ms - starts[j - 1]! > FRAME_MS + 1e-6);
}

/** At most `max` items, picked evenly from first to last. */
const evenPick = <T>(xs: T[], max: number): T[] => (xs.length <= max ? xs : Array.from({ length: max }, (_, j) => xs[Math.round((j * (xs.length - 1)) / (max - 1))]!));

const interrupt: KindRule = {
  name: "interrupt",
  async check(page, ctx) {
    const span = spanOf(ctx);
    const frames = await page.frames(0, span);
    const { units } = await page.state();
    const loops = loopsIn(await rolesOf(page, ctx));
    const names = valueNames(frames).filter((n) => !loops.has(n));
    const causes = ctx.causes ?? causesOf(ctx.input);
    const windows = causedWindows(frames, causes, loops);
    const seqEnd = (k: number) => {
      // A load has no caused window; its sequence ends where every value rests.
      const c = causes[k]!;
      if (c.kind !== "load") return windows[causes.slice(0, k).filter((x) => x.kind !== "load").length]![1];
      return causedWindows(frames, [{ ...c, kind: "press" }], loops)[0]![1];
    };
    const per = causes.map((c, k) => ({ c, k, b: boundariesOf(frames, names, causes, k) }));
    if (!per.some((p) => p.b.length >= 2)) {
      const first = per.find((p) => p.b.length === 1);
      return [first ? `interrupt: every value starts at ${round(first.b[0]!)} ms; one onset is not a sequence` : "interrupt: no value moves after the cause, so there is no sequence to interrupt"];
    }
    // The second trigger lands after the cause stops: a repeat inside the press would be the press itself.
    const tries: Boundary[] = per.filter((p) => p.b.length >= 2).flatMap((p) => p.b.filter((ms) => ms - INTERRUPT_MS > p.c.stopMs + 1e-6).map((ms) => ({ cause: p.c, k: p.k, ms })));
    // A loop is no piece of the sequence, so it has no rest to keep, but a second trigger may not make it jump either.
    const all = valueNames(frames);
    const ranges = new Map(all.map((n) => [n, rangeOf(series(frames, n))]));
    const floorOf = (n: string) => (units[n] !== undefined && Object.hasOwn(TOLERANCE_FLOORS, units[n]!) ? TOLERANCE_FLOORS[units[n]!]! : 0);
    const valueAt = (fs: Frame[], ms: number, n: string) => fs.reduce((best, f) => (Math.abs(f.ms - ms) < Math.abs(best.ms - ms) ? f : best), fs[0]!).values[n] ?? Number.NaN;
    // A run's frames, and its raw frames: a stepped value's jump test compares its drawings, raw against raw.
    const run = async (input: ReturnType<typeof repeatCause>, from: number, to: number): Promise<{ fs: Frame[]; raw: Frame[] }> => {
      const p = await reopen(page, { input: input.samples });
      try {
        return { fs: await p.frames(from, to), raw: await p.rawFrames(from, to) };
      } finally {
        await p.close();
      }
    };
    /** `ctx.input` as far as cause `k`: the later causes are not played, so a run that repeats cause `k` reads its answer alone. */
    const upTo = (k: number): InputSamples | null => {
      const next = causes[k + 1]?.startMs;
      if (!ctx.input || next === undefined) return ctx.input;
      return { ...ctx.input, samples: ctx.input.samples.filter((q) => q[0] < next - 1e-6) } as InputSamples;
    };
    /** The rest of `input` read from `from`: `length` and SETTLE_MS on, or up to SEQUENCE_SCAN_MS when the page still moves there. Null with no frames. */
    const restOf = async (input: InputSamples, from: number, length: number): Promise<Record<string, number> | null> => {
      const p = await reopen(page, { input: input.samples });
      try {
        let fs = await p.frames(from, from + length + SETTLE_MS);
        const still = (xs: Frame[]) => names.every((n) => {
          const v = series(xs, n).slice(-REST_FRAMES - 1);
          const eps = stillEps(Math.max(ranges.get(n)!, rangeOf(v)));
          return v.every((x, i) => i === 0 || !(Math.abs(x - v[i - 1]!) > eps));
        });
        if (fs.length > 0 && !still(fs)) fs = await p.frames(from, from + SEQUENCE_SCAN_MS);
        return fs.length > 0 ? fs[fs.length - 1]!.values : null;
      } finally {
        await p.close();
      }
    };
    const rawClean = await page.rawFrames(0, span);
    const out: string[] = [];
    const toggles = new Map<number, Record<string, number>>();
    // The rests after a press on a control that rode under the cause's spot, played at rest, by cause and press point.
    const pressed = new Map<string, Record<string, number>>();
    const under = new Map<number, JSHandle<Element | null>>();
    // The page with only the input up to cause k, where cause k is not the last: a later cause moves the control, and
    // the control is read where it rests after this cause alone.
    const solos = new Map<number, GatePage>();
    const soloOf = async (k: number): Promise<GatePage> => {
      if (!ctx.input || causes[k + 1] === undefined) return page;
      if (!solos.has(k)) solos.set(k, await reopen(page, { input: upTo(k)!.samples }));
      return solos.get(k)!;
    };
    /**
     * The centre of the element that sits under the cause's spot when the repeat lands at `at`, when it is not the one
     * under the spot when the cause lands: where the control rests, else where it rode. Null when it is the same
     * element, when there is none, or when it has no box. A control drawn on a canvas is not an element.
     */
    const control = async (t: Boundary, end: number, at: number): Promise<[number, number] | null> => {
      const spot = t.cause.kind === "press" ? t.cause.at! : t.cause.kind === "load" ? VIEWPORT_CENTER : null;
      if (!spot) return null;
      const solo = await soloOf(t.k);
      if (!under.has(t.k)) {
        await solo.seek(t.cause.startMs);
        under.set(t.k, await elementAt(solo, spot));
      }
      await solo.seek(at);
      const now = await elementAt(solo, spot);
      if (!(await solo.page.evaluate(([a, b]) => b !== null && a !== b, [under.get(t.k)!, now] as const))) return null;
      const rode = await centreOf(now);
      await solo.seek(end + TOGGLE_AFTER_MS);
      const rested = await centreOf(now);
      return rested.area > 0 ? rested.at : rode.area > 0 ? rode.at : null;
    };
    try {
      for (const t of evenPick(tries, MAX_BOUNDARIES)) {
        const end = seqEnd(t.k);
        const length = end - t.cause.startMs;
        if (!toggles.has(t.k)) {
          const at = end + TOGGLE_AFTER_MS;
          const rest = await restOf(repeatCause(upTo(t.k), t.cause, at), at, length);
          if (rest === null) ctx.notes?.push(`interrupt: the toggle run, which plays the cause at ${round(t.cause.startMs)} ms once more at ${round(at)} ms, has no frames to read, so its rest is not compared`);
          toggles.set(t.k, rest ?? {});
        }
        const inClean = (f: Frame) => f.ms >= t.cause.startMs - 1e-6 && f.ms <= end + FRAME_MS + 1e-6;
        const clean = rawClean.filter(inClean);
        for (const at of [t.ms - INTERRUPT_MS, t.ms + INTERRUPT_MS]) {
          const press = await control(t, end, at);
          // The rest of a press on the control belongs to the repeat that landed on it, not to every later repeat of the cause.
          const key = press ? `${t.k}:${round(press[0])},${round(press[1])}` : null;
          if (press && key && !pressed.has(key)) {
            const when = end + TOGGLE_AFTER_MS;
            const rest = await restOf(repeatCause(upTo(t.k), { ...t.cause, kind: "press", at: press }, when), when, length);
            if (rest === null) ctx.notes?.push(`interrupt: the run that presses the control at ${round(press[0])}, ${round(press[1])} at ${round(when)} ms has no frames to read, so its rest is not compared`);
            pressed.set(key, rest ?? {});
          }
          const to = Math.max(end, at) + length + SETTLE_MS;
          const { fs, raw } = await run(repeatCause(upTo(t.k), t.cause, at), at - FRAME_MS, to);
          for (const n of all) {
            const range = ranges.get(n)!;
            const cleanV = series(clean, n);
            const maxStep = Math.max(0, ...cleanV.slice(1).map((x, i) => Math.abs(x - cleanV[i]!)).filter(Number.isFinite));
            const rv = series(raw, n);
            const bound = JUMP_STEPS * maxStep + JUMP_RANGE * range;
            const cut = (ms: number) => ctx.cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS);
            const j = rv.findIndex((x, i) => i > 0 && !cut(raw[i - 1]!.ms) && Math.abs(x - rv[i - 1]!) > bound + 1e-9);
            if (j > 0) {
              out.push(`interrupt: ${n} jumps ${round(Math.abs(rv[j]! - rv[j - 1]!))} in one frame after the second trigger at ${round(at)} ms; its largest frame step without it is ${round(maxStep)}`);
              continue;
            }
            if (loops.has(n)) continue;
            const v = series(fs, n);
            const eps = stillEps(Math.max(range, rangeOf(v)));
            const tail = v.slice(-REST_FRAMES - 1);
            if (tail.some((x, i) => i > 0 && Math.abs(x - tail[i - 1]!) > eps)) {
              out.push(`interrupt: ${n} has not come to rest by ${round(to)} ms after the second trigger at ${round(at)} ms; nothing may be stuck moving`);
              continue;
            }
            const rest = v[v.length - 1]!;
            const own = [valueAt(frames, t.cause.startMs, n), valueAt(frames, end, n), toggles.get(t.k)![n] ?? Number.NaN];
            if (key) own.push(pressed.get(key)![n] ?? Number.NaN);
            const tol = Math.max(floorOf(n), SAME_REST * range, 1e-6);
            if (!own.some((x) => Math.abs(x - rest) <= tol)) {
              out.push(`interrupt: ${n} rests at ${round(rest)} after the second trigger at ${round(at)} ms, a state the page never rests at without it; a piece is stuck halfway`);
            }
          }
        }
      }
    } finally {
      for (const p of solos.values()) await p.close();
    }
    return [...new Set(out)];
  },
};

export const rules: KindRule[] = [interrupt, ...idleRules.map(forLoops)];
