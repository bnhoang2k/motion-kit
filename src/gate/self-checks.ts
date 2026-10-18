import { FRAME_MS, openPage, replayInput, type Frame, type GatePage, type InputSamples } from "./harness.ts";
import { inputChanges } from "./synthetic-input.ts";

/**
 * The checks on the gates themselves: a gate cannot pass on nothing, no sudden jumps, and the
 * real clock. Each returns its failures, one line each, prefixed with its own name.
 *
 * Each check reports only its own cause. A value that the page never records is for
 * `missingChannel` (or `zeroFrames`, when no frame records any value) to report, so `suddenJumps`
 * and `realClockGap` skip it. A gate runs them all, so the cause is still reported once.
 */

/** The part of trace.json these checks read. */
export type TraceChannels = { channels: { name: string }[] };

/** Fails for each clock hook the page does not define. */
export async function noHook(page: GatePage): Promise<string[]> {
  const h = await page.hooks();
  const out: string[] = [];
  if (!h.seek) out.push("noHook: the page has no window.__seek");
  if (!h.state) out.push("noHook: the page has no window.__state");
  return out;
}

/** Fails for each selector that matches 0 elements. */
export async function emptySelector(page: GatePage, selectors: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of selectors) if ((await page.page.locator(s).count()) === 0) out.push(`emptySelector: ${s} matches 0 elements`);
  return out;
}

const recorded = (frames: Frame[]) => frames.filter((f) => Object.keys(f.values).length > 0);

/** Fails when no frame holds a value: a gate that compares nothing cannot pass. */
export function zeroFrames(frames: Frame[]): string[] {
  return recorded(frames).length > 0 ? [] : [`zeroFrames: 0 of ${frames.length} frames hold a value`];
}

/** Fails for each trace channel that a recorded frame lacks. Frames with no value at all are for `zeroFrames`. */
export function missingChannel(trace: TraceChannels, frames: Frame[]): string[] {
  const rec = recorded(frames);
  const out: string[] = [];
  for (const { name } of trace.channels) {
    const lacking = rec.filter((f) => !Object.hasOwn(f.values, name)).length;
    if (rec.length > 0 && lacking > 0) out.push(`missingChannel: ${name} is in trace.json, but ${lacking} of ${rec.length} frames lack it`);
  }
  return out;
}

/** suddenJumps looks closer at a frame step only when the value moves at least this share of its whole range in it. */
const JUMP_SHARE = 0.05;
/**
 * A smooth change over a step h scales like h^p for some p near 1, so halving the step scales it by
 * 2^-p. Inside this band (p from about 0.3 to 2.3) the change counts as smooth. A jump inside the
 * step gives a ratio of 0 or 1: the jump lands wholly in the shorter step or wholly outside it.
 */
const HALVING_BAND = [0.2, 0.8] as const;

/**
 * A step jumps when it moves more than this many times the step beside it. suddenJumps uses it to
 * judge a pointer step, and the live regrab rule to judge a press.
 */
export const JUMP_FACTOR = 2.5;

/**
 * Seeks t, t + dt/2 and t + dt/4 for every frame step where a value moves at least JUMP_SHARE of
 * its range, and fails each value whose change does not halve with the step. A cut in `cuts`
 * (ms) exempts the steps within one frame of it. With pointer `input`, a step in which the pointer
 * moves is exempt when it keeps the pace: under ?seek the pointer holds one position per frame, so
 * a value that follows it moves in one step there by design. The step keeps the pace when its
 * change is at most JUMP_FACTOR times the larger of the frame steps before and after it on that
 * value; a pop in a move's frame does not. Scroll input gets no exemption.
 */
export async function suddenJumps(page: GatePage, channels: string[], cuts: number[], spanMs = 3000, input: InputSamples | null = null): Promise<string[]> {
  const moves = input?.kind === "pointer" ? inputChanges(input, { flags: false, end: false }) : [];
  const dt = FRAME_MS;
  const frames = await page.frames(0, spanMs, dt);
  const valueAt = async (ms: number, name: string) => {
    await page.seek(ms);
    return (await page.state()).values[name] ?? Number.NaN;
  };
  const out: string[] = [];
  for (const name of channels) {
    const vs = frames.map((f) => f.values[name]);
    if (vs.length < 2 || vs.some((v) => v === undefined)) continue;
    const series = vs as number[];
    const range = Math.max(...series) - Math.min(...series);
    if (!(range > 0)) continue;
    for (let i = 0; i + 1 < series.length; i++) {
      const t = frames[i]!.ms;
      const d1 = series[i + 1]! - series[i]!;
      if (Math.abs(d1) < JUMP_SHARE * range) continue;
      if (cuts.some((c) => c >= t - dt && c <= t + 2 * dt)) continue;
      const moved = moves.some((m) => m > t + 1e-6 && m <= t + dt + 1e-6);
      const beside = Math.max(i > 0 ? Math.abs(series[i]! - series[i - 1]!) : 0, i + 2 < series.length ? Math.abs(series[i + 2]! - series[i + 1]!) : 0);
      if (moved && Math.abs(d1) <= JUMP_FACTOR * beside) continue;
      const d2 = (await valueAt(t + dt / 2, name)) - series[i]!;
      const d4 = (await valueAt(t + dt / 4, name)) - series[i]!;
      const r2 = d2 / d1;
      const r4 = d2 === 0 ? Number.NaN : d4 / d2;
      const smooth = (r: number) => r >= HALVING_BAND[0] && r <= HALVING_BAND[1];
      if (!smooth(r2) || !smooth(r4)) {
        out.push(`suddenJumps: ${name} moves ${round(d1)} in the frame after ${round(t)} ms, and ${round(d2)} in its first half; no cut marks it`);
        break;
      }
    }
  }
  return out;
}

/** The clock gap realClockGap injects into the live loop. */
export const GAP_MS = 2000;
/** realClockGap injects the gap after this many live frames, while the page is still moving. */
const GAP_AFTER_FRAMES = 6;
/**
 * A value's one-frame budget is the largest change seen between two consecutive 1/60 s seek frames,
 * times this margin. The margin lets a page cap its time step at up to 4 frames (about 67 ms), so a
 * 50 ms cap passes. A page with no cap moves through the whole 2000 ms gap in one frame.
 */
const BUDGET_MARGIN = 4;

export interface RealClockGapOptions {
  /** The recorded input. The live run replays it with `replayInput` unless `drive` is given. Open `page` with the same samples. */
  input?: InputSamples;
  /** Starts input on the live page; it runs before the live frames are read. */
  drive?: (live: GatePage) => Promise<void>;
  /** How far the seek frames that set the budget reach, in ms. */
  spanMs?: number;
}

/**
 * Runs the page once on its live rAF loop with one 2000 ms timestamp jump injected, and fails each
 * value that moves more than its one-frame budget in any live frame. `page` must be a `?seek`
 * page: its seek frames set the budget. The live run opens the same file with the same options.
 * A page that moves only on input needs `input` or `drive`, or its loop never reaches the gap,
 * and the check fails.
 */
export async function realClockGap(page: GatePage, opts: RealClockGapOptions = {}): Promise<string[]> {
  const { input, spanMs = 3000 } = opts;
  const drive = opts.drive ?? (input ? (live: GatePage) => replayInput(live, input) : undefined);
  if (page.options.seek === false) throw new Error("realClockGap needs a ?seek page to set the one-frame budget");
  const seekFrames = await page.frames(0, spanMs);
  const budget = new Map<string, number>();
  for (let i = 1; i < seekFrames.length; i++) {
    for (const [name, v] of Object.entries(seekFrames[i]!.values)) {
      const was = seekFrames[i - 1]!.values[name];
      if (was === undefined) continue;
      budget.set(name, Math.max(budget.get(name) ?? 0, Math.abs(v - was)));
    }
  }
  const live = await openPage(page.file, { ...page.options, seek: false, clockGap: { afterFrames: GAP_AFTER_FRAMES, ms: GAP_MS } });
  try {
    if (drive) await drive(live);
    const { frames, gapIndex } = await live.liveFrames();
    if (gapIndex === null) {
      const hint = frames.length === 0 && !drive ? "; a page that moves only on input needs input or drive" : "";
      return [`realClockGap: the live loop ran ${frames.length} frames and stopped before the ${GAP_MS} ms gap${hint}`];
    }
    const out: string[] = [];
    for (const [name, maxStep] of budget) {
      const allowed = maxStep * BUDGET_MARGIN;
      let worst = { move: 0, at: -1 };
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1]!.values[name];
        const b = frames[i]!.values[name];
        if (a === undefined || b === undefined) continue;
        const move = Math.abs(b - a);
        if (move > worst.move) worst = { move, at: i };
      }
      if (worst.move > allowed * (1 + 1e-9) + 1e-9) {
        const when = worst.at === gapIndex ? `in the frame after the ${GAP_MS} ms gap` : `in live frame ${worst.at}`;
        out.push(`realClockGap: ${name} moves ${round(worst.move)} ${when}; its one-frame budget is ${round(allowed)}`);
      }
    }
    return out;
  } finally {
    await live.close();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
