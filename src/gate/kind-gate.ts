import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOLERANCE_FLOORS } from "../core/bar.ts";
import { KINDS } from "../core/kinds.ts";
import type { KindName } from "../core/types.ts";
import { kitRoot, readTextFile } from "../core/kit-root.ts";
import { audit, literalExemption, type PageScript } from "./audit.ts";
import { FRAME_MS, openPage, sleep, type Frame, type GatePage, type InputSamples, type OpenOptions } from "./harness.ts";
import { noHook, realClockGap, zeroFrames } from "./self-checks.ts";
import { driveInput, INPUT_START_MS, inputChanges, inputSpan, syntheticInput } from "./synthetic-input.ts";
import { runChecks, type Check, type Verdict } from "./verdict.ts";

/**
 * Gate B, the kind gate. It needs no trace: it runs the static audit, then the rules every
 * page of a kind must meet (`kinds/<kind>/rules.md`). The rules for every kind live here; each
 * `kinds/<kind>/gate.ts` exports the rules of its own kind.
 *
 * Each rule returns its failures, one line each, starting with its own name. A rule reports only
 * its own cause: when a value a rule needs never moves, the rule that owns that cause reports it.
 * One exception: a rule that cannot aim at all (regrab, with no value that tracks the pointer)
 * fails too, so it never passes on nothing.
 */

export type RuleContext = {
  kind: KindName;
  /** The input the gate plays: the bar's recorded pointer input for a live bar, else the synthetic input (null for idle). */
  input: InputSamples | null;
  /** Times in ms where a copied bar's trace.json marks a cut. Motion that starts at a cut may jump. */
  cuts: number[];
  /**
   * How far the `?seek` frames reach, in ms. With the synthetic input: SPAN_MS, plus how long it waits for the page's
   * load motion. With a recorded input: SPAN_MS, the last trace row, or the last input sample plus SETTLE_MS, the latest.
   */
  spanMs?: number;
};
export type KindRule = { name: string; check(page: GatePage, ctx: RuleContext): Promise<string[]> };
/** `distances` and `notes` are information lines: they never change the verdict. */
export type KindVerdict = Verdict & { kind: KindName | null; distances: string[]; notes: string[] };

/** How far the `?seek` frames reach, in ms, when the input starts INPUT_START_MS in. */
export const SPAN_MS = 3000;
/** How far the rules' `?seek` frames reach for this context. */
export const spanOf = (ctx: RuleContext): number => ctx.spanMs ?? SPAN_MS;
/** After a recorded input's last sample, the rules read this long more, so the page can settle. */
export const SETTLE_MS = 1000;

/** The span of a recorded input: SPAN_MS, the last trace row, or the last input sample plus SETTLE_MS, the latest. */
export function recordedSpan(input: InputSamples, rowTimes: number[]): number {
  return Math.max(SPAN_MS, ...rowTimes, inputSpan(input).end + SETTLE_MS);
}

/** Fails when the input runs past the span: the rules would judge only part of it. */
export function inputPastSpan(input: InputSamples | null, spanMs: number): string[] {
  if (!input || input.samples.length === 0) return [];
  const { end } = inputSpan(input);
  return end > spanMs + 1e-6 ? [`span: the input runs to ${round(end)} ms, past the ${round(spanMs)} ms the rules read`] : [];
}

/** How long the gate watches a page with no input for its load motion to end. */
export const LOAD_SCAN_MS = 15000;
/** A value that holds still for this many frame steps is at rest. */
export const REST_FRAMES = 3;
/** A live page is at rest when no value moves more than this between two reads 50 ms apart. */
const LIVE_STILL = 1e-3;

/** Kinds a page may name that have no knobs and no kind gate yet: one-shot moves use `feels` and `moves`. */
const GATELESS_KINDS = ["oneshot"];

const KIND_RULES: Partial<Record<KindName, () => Promise<{ rules: KindRule[] }>>> = {
  live: () => import("../../kinds/live/gate.ts"),
  idle: () => import("../../kinds/idle/gate.ts"),
  scroll: () => import("../../kinds/scroll/gate.ts"),
};

// ---- shared helpers for the rules -----------------------------------------------------------

export const round = (n: number) => Math.round(n * 1000) / 1000;

/** The names of every value any frame holds. */
export function valueNames(frames: Frame[]): string[] {
  return [...new Set(frames.flatMap((f) => Object.keys(f.values)))];
}

/** A value's series over the frames; NaN where a frame lacks it. */
export function series(frames: Frame[], name: string): number[] {
  return frames.map((f) => f.values[name] ?? Number.NaN);
}

export function rangeOf(vs: number[]): number {
  const ok = vs.filter(Number.isFinite);
  return ok.length === 0 ? 0 : Math.max(...ok) - Math.min(...ok);
}

/** A change smaller than this does not count as motion for a value with this range. */
export const stillEps = (range: number) => Math.max(1e-9, 1e-4 * range);

/** The time of the first frame at or after `fromMs` from which every value holds still for REST_FRAMES steps, or the last frame's time. */
export function restAfter(frames: Frame[], fromMs: number): number {
  const names = valueNames(frames);
  const eps = new Map(names.map((n) => [n, stillEps(rangeOf(series(frames, n)))]));
  const still = (i: number) => names.every((n) => !(Math.abs((frames[i + 1]!.values[n] ?? 0) - (frames[i]!.values[n] ?? 0)) > eps.get(n)!));
  for (let i = 0; i + REST_FRAMES < frames.length; i++) {
    if (frames[i]!.ms < fromMs - 1e-6) continue;
    let ok = true;
    for (let k = 0; k < REST_FRAMES && ok; k++) ok = still(i + k);
    if (ok) return frames[i]!.ms;
  }
  return frames[frames.length - 1]?.ms ?? fromMs;
}

/** The span the input drives: from its first sample until the page rests after its last one. Null with no input. */
export function inputWindow(frames: Frame[], input: InputSamples | null): [number, number] | null {
  if (!input || input.samples.length === 0) return null;
  const { start, end } = inputSpan(input);
  return [start, restAfter(frames, end)];
}

/**
 * When the synthetic input starts, from the page's frames with no input (its load motion): INPUT_START_MS in, or
 * INPUT_START_MS after the last frame step in which a value moves, when that comes later. So the input meets a page
 * at rest, as it does on a page with no load motion. A page still moving in its last REST_FRAMES frame steps (a
 * loop) never settles, and keeps INPUT_START_MS. The time sits on the 1/60 s frame grid.
 */
export function inputStartAfter(frames: Frame[]): number {
  let lastMove = -1;
  for (const n of valueNames(frames)) {
    const v = series(frames, n);
    const eps = stillEps(rangeOf(v));
    for (let i = v.length - 2; i > lastMove; i--) if (Math.abs(v[i + 1]! - v[i]!) > eps) { lastMove = i; break; }
  }
  if (lastMove < 0 || lastMove >= frames.length - 1 - REST_FRAMES) return INPUT_START_MS;
  const ends = frames[lastMove + 1]!.ms;
  if (ends < INPUT_START_MS) return INPUT_START_MS;
  return Math.ceil((ends + INPUT_START_MS) / FRAME_MS - 1e-9) * FRAME_MS;
}

/** Opens the same file as `page` with the same input, changing only `options`. */
export function reopen(page: GatePage, options: OpenOptions): Promise<GatePage> {
  return openPage(page.file, { ...page.options, ...options });
}

/** Plays the input on a live page, when there is one. */
export async function drive(live: GatePage, ctx: RuleContext): Promise<void> {
  if (ctx.input) await driveInput(live, ctx.input);
}

/**
 * Polls a live page's values every 50 ms until no value has moved for 150 ms, and returns the
 * page's clock (`performance.now()`) at that point. Returns null when the page is still moving
 * after `timeoutMs`.
 */
export async function waitForRest(live: GatePage, timeoutMs = 5000): Promise<number | null> {
  const end = performance.now() + timeoutMs;
  let prev: Record<string, number> | null = null;
  let quiet = 0;
  while (performance.now() < end) {
    const { values } = await live.state();
    const moved = prev === null || Object.keys({ ...values, ...prev }).some((k) => !(Math.abs((values[k] ?? Number.NaN) - (prev![k] ?? Number.NaN)) <= LIVE_STILL));
    quiet = moved ? 0 : quiet + 1;
    prev = values;
    if (quiet >= 3) return live.page.evaluate(() => performance.now());
    await sleep(50);
  }
  return null;
}

// ---- the rules for every kind ---------------------------------------------------------------

/** A pulse's attack, from its start to its peak, is 40 to 120 ms. */
export const ATTACK_MS = [40, 120] as const;
/** One frame step that covers more than this share of an onset's whole change is a pop. */
const POP_SHARE = 0.5;
/** A pulse comes back toward where it started: it ends within this share of its peak. */
const PULSE_RETURN = 0.5;
/** A pulse peaks within this long of its start. A slower rise and fall is a move or a loop, not a flash. */
const PULSE_PEAK_MS = 500;
/** How far the gate looks for a pulse-shaped value's repeats. 15 s holds 3 starts of a 5 s loop. */
const LOOP_SCAN_MS = 15000;
/** A value is a loop when it starts the same way 3 or more times, evenly spaced (within 1 frame). */
const LOOP_STARTS = 3;

type Onset = { name: string; i: number; ms: number; rising: boolean };

/**
 * Every place a value starts to move after holding still for 2 frame steps (the page counts as
 * still before its first frame), outside the input window and away from a cut.
 */
function onsets(frames: Frame[], window: [number, number] | null, cuts: number[]): Onset[] {
  const out: Onset[] = [];
  for (const name of valueNames(frames)) {
    const v = series(frames, name);
    const eps = stillEps(rangeOf(v));
    const moving = (i: number) => i >= 0 && Math.abs(v[i + 1]! - v[i]!) > eps;
    for (let i = 0; i + 1 < frames.length; i++) {
      if (!moving(i) || moving(i - 1) || moving(i - 2)) continue;
      const ms = frames[i]!.ms;
      if (window && ms + FRAME_MS >= window[0] - 1e-6 && ms <= window[1] + 1e-6) continue;
      if (cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS)) continue;
      out.push({ name, i, ms, rising: v[i + 1]! > v[i]! });
    }
  }
  return out;
}

/**
 * An onset's frames until the value rests: its whole change (the farthest it goes, either way, so
 * an anticipation dip before the move does not count as the move) and where it ends.
 */
function segment(frames: Frame[], o: Onset, eps: number) {
  const v = series(frames, o.name);
  let end = o.i;
  let still = 0;
  for (let j = o.i; j + 1 < frames.length && still < REST_FRAMES; j++) {
    still = Math.abs(v[j + 1]! - v[j]!) > eps ? 0 : still + 1;
    end = j + 1;
  }
  let peak = o.i;
  for (let j = o.i; j <= end; j++) if (Math.abs(v[j]! - v[o.i]!) > Math.abs(v[peak]! - v[o.i]!)) peak = j;
  const dir = v[peak]! >= v[o.i]! ? 1 : -1;
  return { v, dir, end, peak, total: dir * (v[peak]! - v[o.i]!), left: dir * (v[end]! - v[o.i]!) };
}

/** A pulse's attack, from seeks every eighth of a frame around its start and its peak. */
async function pulseAttack(page: GatePage, o: Onset, peakMs: number, dir: number, eps: number): Promise<number> {
  const dt = FRAME_MS / 8;
  const at = (fs: Frame[]) => fs.map((f) => f.values[o.name] ?? Number.NaN);
  const start = at(await page.frames(o.ms, o.ms + FRAME_MS, dt));
  const k0 = start.findIndex((x) => Math.abs(x - start[0]!) > eps / 8);
  const startMs = o.ms + (Math.max(k0, 1) - 0.5) * dt;
  const near = await page.frames(Math.max(o.ms, peakMs - FRAME_MS), peakMs + FRAME_MS, dt);
  let best = near[0]!;
  for (const f of near) if (dir * ((f.values[o.name] ?? Number.NaN) - (best.values[o.name] ?? Number.NaN)) > 0) best = f;
  return best.ms - startMs;
}

/**
 * What is wrong with one onset: a pop, a pulse attack out of bounds, or a fade that rises. An onset whose whole
 * change is below its unit's tolerance floor (TOLERANCE_FLOORS: 0.5 px, 0.002 scale, 0.01 opacity, ...) is too small
 * to see, so it has no problem: a spring or a smoothed scroll that snaps to rest at the end of a still stretch.
 */
async function onsetProblems(page: GatePage, frames: Frame[], o: Onset, unit: string | undefined, isLoop: (o: Onset) => Promise<boolean>): Promise<string[]> {
  const eps = stillEps(rangeOf(series(frames, o.name)));
  const seg = segment(frames, o, eps);
  const at = `${o.name} at ${round(o.ms)} ms`;
  const out: string[] = [];
  const floor = unit !== undefined && Object.hasOwn(TOLERANCE_FLOORS, unit) ? TOLERANCE_FLOORS[unit]! : 0;
  if (!(seg.total > eps) || seg.total < floor) return out;
  for (let j = o.i; j < seg.end; j++) {
    const step = Math.abs(seg.v[j + 1]! - seg.v[j]!);
    if (step > POP_SHARE * seg.total * (1 + 1e-9)) {
      out.push(`${at} covers ${Math.round((step / seg.total) * 100)}% of its whole change in the one frame after ${round(frames[j]!.ms)} ms; that is a pop`);
      break;
    }
  }
  const pulse = seg.left <= PULSE_RETURN * seg.total && frames[seg.peak]!.ms - o.ms <= PULSE_PEAK_MS;
  if (pulse && !(await isLoop(o))) {
    const attack = await pulseAttack(page, o, frames[seg.peak]!.ms, seg.dir, eps);
    if (attack < ATTACK_MS[0] || attack > ATTACK_MS[1]) out.push(`${at} is a pulse that peaks ${Math.round(attack)} ms after it starts; a pulse's attack is ${ATTACK_MS[0]} to ${ATTACK_MS[1]} ms`);
  } else if (!pulse && unit === "opacity" && seg.dir < 0) {
    for (let j = o.i; j < seg.end; j++) {
      if (seg.v[j + 1]! - seg.v[j]! > eps) {
        out.push(`${o.name} rises at ${round(frames[j]!.ms)} ms, during the fade that starts at ${round(o.ms)} ms; fades only fall`);
        break;
      }
    }
  }
  return out;
}

/**
 * Envelope: no pop, a pulse has a 40 to 120 ms attack, fades only fall, and one capped time step.
 * An onset whose whole change is below its unit's tolerance floor is left out.
 * A pop is one frame that covers more than half of an onset's whole change. A pulse rises from
 * rest to a peak within 500 ms and then comes back toward where it started (a flash, a badge
 * pulse); ordinary moves, tweens, springs and loops have no attack bound. A value whose starts
 * repeat at a fixed period (3 or more, within 1 frame, over 15 s) is a loop. Motion the input drives,
 * and motion that starts at a cut, are left out.
 */
const envelope: KindRule = {
  name: "envelope",
  async check(page, ctx) {
    const frames = await page.frames(0, spanOf(ctx));
    const { units } = await page.state();
    const out: string[] = [];
    const flagged = new Set<string>();
    let long: Onset[] | undefined;
    const isLoop = async (o: Onset) => {
      if (!long) {
        const lf = await page.frames(0, LOOP_SCAN_MS);
        long = onsets(lf, inputWindow(lf, ctx.input), ctx.cuts);
      }
      const starts = long.filter((x) => x.name === o.name && x.rising === o.rising).map((x) => x.ms);
      if (starts.length < LOOP_STARTS) return false;
      const gaps = starts.slice(1).map((t, k) => t - starts[k]!);
      return Math.max(...gaps) - Math.min(...gaps) <= FRAME_MS + 1e-6;
    };
    for (const o of onsets(frames, inputWindow(frames, ctx.input), ctx.cuts)) {
      if (flagged.has(o.name)) continue;
      const problems = await onsetProblems(page, frames, o, units[o.name], isLoop);
      if (problems.length > 0) {
        flagged.add(o.name);
        out.push(...problems.map((p) => `envelope: ${p}`));
      }
    }
    const gap = await realClockGap(page, { spanMs: spanOf(ctx), ...(ctx.input ? { drive: (live: GatePage) => driveInput(live, ctx.input!) } : {}) });
    out.push(...gap.map((l) => `envelope: time step: ${l.replace(/^realClockGap: /, "")}`));
    return out;
  },
};

/**
 * The loop stops at rest: 0 rAF callbacks in the second after rest. A live or scroll page rests
 * after its input. An idle page loops while it is on screen, so it is checked at its still frame
 * under reduced motion.
 */
const loopStopsAtRest: KindRule = {
  name: "loopStopsAtRest",
  async check(page, ctx) {
    const idle = ctx.kind === "idle";
    const live = await reopen(page, { seek: false, ...(idle ? { reducedMotion: true } : {}) });
    try {
      if (!idle) await drive(live, ctx);
      const rest = await waitForRest(live);
      if (rest === null) return [`loopStopsAtRest: the page is still moving 5 s after ${idle ? "it loads under reduced motion" : "the input ends"}`];
      const n = await live.rafCountAfter(rest, 1000);
      return n === 0 ? [] : [`loopStopsAtRest: ${n} rAF callbacks ran in the second after the page came to rest${idle ? " under reduced motion" : ""}`];
    } finally {
      await live.close();
    }
  },
};

const NOISY = /^(error|warning|assert|pageerror): /;

/** The console stays clean: no error, warning or uncaught error, on the `?seek` run or the live run. */
const consoleClean: KindRule = {
  name: "consoleClean",
  async check(page, ctx) {
    await page.frames(0, spanOf(ctx));
    const live = await reopen(page, { seek: false });
    try {
      await drive(live, ctx);
      await sleep(300);
      return [
        ...page.console().filter((m) => NOISY.test(m)).map((m) => `consoleClean: ${m} (the ?seek run)`),
        ...live.console().filter((m) => NOISY.test(m)).map((m) => `consoleClean: ${m} (the live run)`),
      ];
    } finally {
      await live.close();
    }
  },
};

/** Two states are the same when every value sits within 2% of its range (at least 0.001). */
function sameState(a: Record<string, number>, b: Record<string, number>, ranges: Map<string, number>): boolean {
  return [...ranges].every(([n, r]) => Math.abs((a[n] ?? Number.NaN) - (b[n] ?? Number.NaN)) <= Math.max(1e-3, 0.02 * r));
}

/** Under reduced motion, a value on a scroll page takes at most this many still states over the sweep. */
export const STILL_STATES_MAX = 6;
/** Under reduced motion, an opacity value on a scroll page may reach its new state by a fade this long, at most. */
export const REDUCED_FADE_MS = 300;
/** The sweep scrolls this far in each step, one step every SWEEP_STEP_FRAMES frames. */
const SWEEP_STEP_PX = 50;
const SWEEP_STEP_FRAMES = 2;
/** The sweep goes down to the page's end, or this far when the page is longer. */
const SWEEP_MAX_PX = 5000;
/** The sweep holds this many frames at the bottom, and again at the top after it comes back. */
const SWEEP_HOLD_FRAMES = 30;

type ScrollInput = Extract<InputSamples, { kind: "scroll" }>;

/**
 * The scroll input of the reduced-motion sweep, one sample a frame from `startMs` (on the 1/60 s grid): down in
 * SWEEP_STEP_PX steps to `maxY` (at most SWEEP_MAX_PX), a hold, back up to the top in the same steps, and a hold.
 */
export function sweepInput(startMs: number, maxY: number): ScrollInput {
  const first = Math.round(startMs / FRAME_MS);
  const steps = Math.floor(Math.min(maxY, SWEEP_MAX_PX) / SWEEP_STEP_PX);
  const down = Array.from({ length: steps * SWEEP_STEP_FRAMES + 1 }, (_, k) => SWEEP_STEP_PX * Math.floor(k / SWEEP_STEP_FRAMES));
  const top = down[down.length - 1]!;
  const ys = [...down, ...Array<number>(SWEEP_HOLD_FRAMES).fill(top), ...[...down].reverse(), ...Array<number>(SWEEP_HOLD_FRAMES).fill(0)];
  return { kind: "scroll", samples: ys.map((y, i): [number, number] => [((first + i) * 1000) / 60, y]) };
}

/** A blank start state: a start the page leaves and never comes back to without reduced motion (an entrance). */
function blankStill(normal: Frame[], reduced: Frame[], ranges: Map<string, number>): string[] {
  const start = normal[0]?.values ?? {};
  const left = normal.findIndex((f) => !sameState(f.values, start, ranges));
  const blank = left >= 0 && normal.slice(left).every((f) => !sameState(f.values, start, ranges));
  const still = reduced[reduced.length - 1]?.values;
  return blank && still && sameState(still, start, ranges) ? ["reducedMotion: the still frame under reduced motion is the blank start state; show the end state instead"] : [];
}

/**
 * Reduced motion on a scroll page: stepped states. The gate sweeps the page down to its end and back (sweepInput), once
 * without reduced motion and once with it. Under reduced motion input still answers, but each value moves between a
 * few still states (STILL_STATES_MAX or fewer over the sweep), each reached in one frame, or by a fade of
 * REDUCED_FADE_MS at most for an opacity value. A continuous scroll-linked zoom or parallax fails. A value that, each
 * time it moves, lands on the scroll position (within one frame) is the scroll itself and is not judged.
 */
async function steppedStates(page: GatePage, ctx: RuleContext): Promise<string[]> {
  const maxY = await page.page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
  if (maxY < SWEEP_STEP_PX) return [`reducedMotion: the page scrolls ${round(maxY)} px; the reduced-motion sweep needs ${SWEEP_STEP_PX} px or more`];
  const sweep = sweepInput(ctx.input ? inputSpan(ctx.input).start : INPUT_START_MS, maxY);
  const { start, end } = inputSpan(sweep);
  const run = async (reducedMotion: boolean) => {
    const p = await reopen(page, { input: sweep.samples, reducedMotion });
    try {
      return await p.frames(0, end + SETTLE_MS);
    } finally {
      await p.close();
    }
  };
  const normal = await run(false);
  const rf = await run(true);
  const { units } = await page.state();
  const names = valueNames([...normal, ...rf]);
  const ranges = new Map(names.map((n) => [n, Math.max(rangeOf(series(normal, n)), rangeOf(series(rf, n)))]));
  const scrollAt = (ms: number) => [...sweep.samples].reverse().find((q) => q[0] <= ms + 1e-6)?.[1] ?? 0;
  const changes = inputChanges(sweep);
  const inSweep = (f: Frame) => f.ms >= start - 1e-6 && f.ms <= end + SETTLE_MS + 1e-6;
  const out: string[] = [];
  for (const n of names) {
    const v = series(rf, n);
    const eps = stillEps(ranges.get(n)!);
    const moves = v.map((x, i) => i > 0 && Math.abs(x - v[i - 1]!) > eps);
    const near = (x: number, ms: number) => [scrollAt(ms), scrollAt(ms - FRAME_MS)].some((y) => Math.abs(x - y) <= TOLERANCE_FLOORS.px!);
    if (moves.some(Boolean) && moves.every((m, i) => !m || near(v[i]!, rf[i]!.ms))) continue;
    const fade = units[n] === "opacity";
    // Each move lands within one frame of a scroll change, or within a short fade of one.
    for (let i = 1; i < rf.length; i++) {
      if (!moves[i]) continue;
      const [a, b] = [rf[i - 1]!.ms, rf[i]!.ms];
      const ok = changes.some((c) => c <= b + 1e-6 && (fade ? b - c <= REDUCED_FADE_MS + 1e-6 : c > a - FRAME_MS - 1e-6));
      if (ok) continue;
      out.push(
        fade
          ? `reducedMotion: ${n} still fades at ${round(a)} ms, more than ${REDUCED_FADE_MS} ms after the scroll last changed; under reduced motion a fade is short`
          : `reducedMotion: ${n} still moves at ${round(a)} ms, more than one frame after the input last changed; under reduced motion the target is reached in 1 frame`,
      );
      break;
    }
    // A few still states, not a continuous scroll-linked change.
    const tol = Math.max(1e-3, 0.02 * ranges.get(n)!);
    const stills = v.filter((x, i) => i > 0 && inSweep(rf[i]!) && !moves[i] && Number.isFinite(x)).sort((x, y) => x - y);
    let states = 0;
    let from = Number.NEGATIVE_INFINITY;
    for (const x of stills) if (x > from + tol) [states, from] = [states + 1, x];
    if (states > STILL_STATES_MAX) {
      out.push(`reducedMotion: ${n} takes ${states} still values as the page scrolls ${round(maxY)} px under reduced motion; a scroll page moves between a few still states (${STILL_STATES_MAX} or fewer), with no continuous scroll-linked change`);
    }
    // Input still answers.
    const answers = (frames: Frame[]) => rangeOf(frames.filter(inSweep).map((f) => f.values[n] ?? Number.NaN)) > eps;
    if (answers(normal) && !answers(rf)) out.push(`reducedMotion: ${n} answers the input without reduced motion, but not with it; input still answers under reduced motion`);
  }
  out.push(...blankStill(normal, rf, ranges));
  return out;
}

/**
 * Reduced motion: input still answers, the target is reached in 1 frame, and the still frame is not
 * the blank start state. The blank start state is a start the page leaves and never comes back to
 * without reduced motion (an entrance). A scroll page instead moves between stepped states (steppedStates).
 */
export const reducedMotion: KindRule = {
  name: "reducedMotion",
  async check(page, ctx) {
    if (ctx.kind === "scroll") return steppedStates(page, ctx);
    const normal = await page.frames(0, spanOf(ctx));
    const reduced = await reopen(page, { reducedMotion: true });
    let rf: Frame[];
    try {
      rf = await reduced.frames(0, spanOf(ctx));
    } finally {
      await reduced.close();
    }
    const out: string[] = [];
    const names = valueNames([...normal, ...rf]);
    const ranges = new Map(names.map((n) => [n, Math.max(rangeOf(series(normal, n)), rangeOf(series(rf, n)))]));
    const changes = inputChanges(ctx.input);
    for (const n of names) {
      const v = series(rf, n);
      const eps = stillEps(ranges.get(n)!);
      for (let i = 1; i + 1 < rf.length; i++) {
        if (!(Math.abs(v[i + 1]! - v[i]!) > eps)) continue;
        const [a, b] = [rf[i]!.ms, rf[i + 1]!.ms];
        if (changes.some((c) => c > a - FRAME_MS - 1e-6 && c <= b + 1e-6)) continue;
        out.push(`reducedMotion: ${n} still moves at ${round(a)} ms, more than one frame after the input last changed; under reduced motion the target is reached in 1 frame`);
        break;
      }
    }
    if (ctx.input) {
      const { start, end } = inputSpan(ctx.input);
      const moves = (frames: Frame[], n: string) => {
        const inSpan = frames.filter((f) => f.ms >= start - 1e-6 && f.ms <= end + FRAME_MS + 1e-6).map((f) => f.values[n] ?? Number.NaN);
        return rangeOf(inSpan) > stillEps(ranges.get(n)!);
      };
      for (const n of names) if (moves(normal, n) && !moves(rf, n)) out.push(`reducedMotion: ${n} answers the input without reduced motion, but not with it; input still answers under reduced motion`);
    }
    out.push(...blankStill(normal, rf, ranges));
    return out;
  },
};

export const ALL_RULES: KindRule[] = [envelope, loopStopsAtRest, consoleClean, reducedMotion];

// ---- the gate -------------------------------------------------------------------------------

const metaContent = (html: string, name: string): string | null => {
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    if (!new RegExp(`\\bname\\s*=\\s*["']${name}["']`, "i").test(m[0])) continue;
    const c = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(m[0]);
    return c ? c[1]!.trim() : "";
  }
  return null;
};

const readJson = (file: string): unknown => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);

/** The page's kind from its marker, and whether it is a copied bar; or the failure line. */
export function pageKind(html: string, file: string): { kind: string; bar: boolean } | { failure: string } {
  const slug = metaContent(html, "motion-kit-bar");
  if (slug !== null) {
    const barFile = path.join(path.dirname(file), "bar.json");
    let bar: unknown;
    try {
      bar = readJson(barFile);
    } catch (e) {
      return { failure: `kind: ${barFile} is not valid JSON: ${(e as Error).message}` };
    }
    if (bar === undefined) return { failure: `kind: the page names bar ${slug || "(empty)"}, but there is no bar.json next to it` };
    const kinds = (bar as { kinds?: unknown }).kinds;
    if (!Array.isArray(kinds) || typeof kinds[0] !== "string") return { failure: "kind: bar.json lists no kinds; its main kind comes first" };
    return { kind: kinds[0], bar: true };
  }
  const kind = metaContent(html, "motion-kit-kind");
  if (kind !== null) return { kind, bar: false };
  return { failure: 'kind: the page has no marker; add <meta name="motion-kit-kind" content="<kind>"> (or motion-kit-bar on a copied bar)' };
}

/** The local scripts the page loads with `<script src>`, for the audit. */
function localScripts(html: string, dir: string): PageScript[] {
  const out: PageScript[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1]!;
    if (/^[a-z][\w+.-]*:|^\/\//i.test(src)) continue;
    const file = path.resolve(dir, src.split(/[?#]/)[0]!);
    if (existsSync(file)) out.push({ src, text: readFileSync(file, "utf8") });
  }
  return out;
}

type Trace = { input?: { kind?: unknown; samples?: unknown }; cuts?: unknown; samples?: unknown };

/** The times of a trace's rows, `[ms, ...values]`. */
const rowTimes = (trace: Trace | undefined): number[] =>
  Array.isArray(trace?.samples) ? trace.samples.map((r: unknown) => (Array.isArray(r) ? r[0] : undefined)).filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];

/** A copied bar's trace.json, or undefined when the page is not a bar or has none that parses. */
function traceOf(dir: string, bar: boolean): Trace | undefined {
  if (!bar) return undefined;
  try {
    return readJson(path.join(dir, "trace.json")) as Trace | undefined;
  } catch {
    return undefined;
  }
}

/** A live bar's own recorded drag (trace.json `input`), or null when the page plays the synthetic input. */
function recordedInput(kind: KindName, trace: Trace | undefined): InputSamples | null {
  const input = trace?.input;
  if (kind === "live" && input?.kind === "pointer" && Array.isArray(input.samples) && input.samples.length >= 2) return input as InputSamples;
  return null;
}

/**
 * The input the gate plays and how far the rules' seek frames reach. A live bar plays its recorded drag, over its
 * recordedSpan. Every other page with input plays the synthetic input, which waits for the page's load motion to end
 * (inputStartAfter).
 */
async function inputAndSpan(file: string, kind: KindName, trace: Trace | undefined): Promise<{ input: InputSamples | null; spanMs: number }> {
  const recorded = recordedInput(kind, trace);
  if (recorded) return { input: recorded, spanMs: recordedSpan(recorded, rowTimes(trace)) };
  if (syntheticInput(kind) === null) return { input: null, spanMs: SPAN_MS };
  let probe: GatePage | undefined;
  let start = INPUT_START_MS;
  try {
    probe = await openPage(file);
    start = inputStartAfter(await probe.frames(0, LOAD_SCAN_MS));
  } catch (e) {
    // A page that cannot open is the gate failing to start: the CLI exits 2. A page with no clock hook opens but
    // cannot be scanned; the noHook check reports that.
    if (!probe) throw e;
  } finally {
    await probe?.close();
  }
  return { input: syntheticInput(kind, start), spanMs: SPAN_MS + (start - INPUT_START_MS) };
}

/**
 * Runs Gate B on one page: reads its marker, runs the static audit, then the gate checks on
 * nothing (a missing clock hook, zero frames, an input past the span) and every rule of the page's
 * kind. A page with no marker, an unknown kind, or a kind with no rules in this version fails; it
 * never passes. The audit skips its literal check only for a copy of one of the kit's own bars
 * (literalExemption): the bar's slug, with a MOTION block the same as the kit's, byte for byte.
 */
export async function kindGate(file: string): Promise<KindVerdict> {
  const html = readFileSync(file, "utf8");
  const dir = path.dirname(file);
  const root = kitRoot();
  const exemption = literalExemption(html, (slug) => readTextFile(path.join(root, "bars", slug, "index.html")));
  const audited = audit(html, localScripts(html, dir), { literals: !exemption.exempt });
  const notes = exemption.note ? [exemption.note] : [];
  const fail = (line: string, kind: KindName | null = null): KindVerdict => ({ status: "failed", failures: [line, ...audited.failures], kind, distances: audited.distances, notes });
  const picked = pageKind(html, file);
  if ("failure" in picked) return fail(picked.failure);
  const known = (KINDS as readonly string[]).includes(picked.kind);
  const load = known ? KIND_RULES[picked.kind as KindName] : undefined;
  if (!load) {
    if (!known && !GATELESS_KINDS.includes(picked.kind)) return fail(`kind: ${picked.kind || "(empty)"} is not a kind; the kinds are ${[...KINDS, ...GATELESS_KINDS].join(", ")}`);
    const ready = Object.keys(KIND_RULES).join(", ");
    return fail(`kind: ${picked.kind} has no kind gate in this version of motion-kit (only ${ready} do), so the page cannot pass`, known ? (picked.kind as KindName) : null);
  }
  const kind = picked.kind as KindName;
  const { rules } = await load();
  const trace = traceOf(dir, picked.bar);
  const cuts = Array.isArray(trace?.cuts) ? trace.cuts.filter((c): c is number => typeof c === "number") : [];
  const { input, spanMs } = await inputAndSpan(file, kind, trace);
  const ctx: RuleContext = { kind, input, cuts, spanMs };
  let opened: Promise<GatePage> | undefined;
  const page = () => (opened ??= openPage(file, ctx.input ? { input: ctx.input.samples } : {}));
  const checks: Record<string, Check> = {
    audit: () => audited.failures,
    noHook: async () => noHook(await page()),
    zeroFrames: async () => zeroFrames(await (await page()).frames(0, spanMs)),
    span: () => inputPastSpan(input, spanMs),
  };
  for (const r of [...ALL_RULES, ...rules]) checks[r.name] = async () => r.check(await page(), ctx);
  try {
    return { ...(await runChecks(checks)), kind, distances: audited.distances, notes };
  } finally {
    if (opened) await opened.then((p) => p.close()).catch(() => undefined);
  }
}
