import { FRAME_MS, type Frame, type InputSamples } from "./harness.ts";
import { rangeOf, series, stillEps, valueNames } from "./series.ts";
import { VIEWPORT_CENTER } from "./synthetic-input.ts";

/**
 * What starts a choreo or sim page's motion, read from the input the gate plays. Every press of a
 * pointer input is a cause, and so is every burst of scroll ticks. With no input the page load is
 * the one cause, at 0. A cause stops at its press's lift, at its burst's last tick, or at 0 for a load.
 */
export type Cause = {
  kind: "press" | "scroll" | "load";
  startMs: number;
  stopMs: number;
  /** A press's spot. */
  at?: [number, number];
  /** A scroll burst's first change in scroll position. */
  tick?: number;
};

/** Scroll ticks closer together than this are one burst. */
export const BURST_GAP_MS = 250;

const LOAD: Cause = { kind: "load", startMs: 0, stopMs: 0 };

type PointerSample = [number, number, number] | [number, number, number, 0 | 1];
const isDown = (s: PointerSample) => s[3] !== 0;

/** Every cause in `input`, in time order. */
export function causesOf(input: InputSamples | null): Cause[] {
  if (!input || input.samples.length === 0) return [{ ...LOAD }];
  if (input.kind === "pointer") {
    const s = input.samples as PointerSample[];
    const out: Cause[] = [];
    for (let i = 0; i < s.length; i++) {
      if (!isDown(s[i]!) || (i > 0 && isDown(s[i - 1]!))) continue;
      const lift = s.findIndex((q, j) => j > i && !isDown(q));
      out.push({ kind: "press", startMs: s[i]![0], stopMs: (lift < 0 ? s[s.length - 1]! : s[lift]!)[0], at: [s[i]![1], s[i]![2]] });
    }
    return out.length > 0 ? out : [{ ...LOAD }];
  }
  const out: Cause[] = [];
  let was = 0;
  for (const [ms, y] of input.samples) {
    const dy = y - was;
    was = y;
    if (dy === 0) continue;
    const last = out[out.length - 1];
    if (last && ms - last.stopMs < BURST_GAP_MS) last.stopMs = ms;
    else out.push({ kind: "scroll", startMs: ms, stopMs: ms, tick: dy });
  }
  return out.length > 0 ? out : [{ ...LOAD }];
}

/**
 * Each press or scroll cause's caused window: from its start to the end of the sequence it starts,
 * pauses included. The sequence ends at the first frame after which every value not in `loops`
 * holds still to the next cause's start (or the last frame), and never before the cause stops.
 * A load has no window: motion a page starts by itself is not caused.
 */
export function causedWindows(frames: Frame[], causes: Cause[], loops: Set<string>): [number, number][] {
  const names = valueNames(frames).filter((n) => !loops.has(n));
  const eps = new Map(names.map((n) => [n, stillEps(rangeOf(series(frames, n)))]));
  const moves = (i: number) => names.some((n) => Math.abs((frames[i + 1]!.values[n] ?? 0) - (frames[i]!.values[n] ?? 0)) > eps.get(n)!);
  const out: [number, number][] = [];
  causes.forEach((c, k) => {
    if (c.kind === "load") return;
    const limit = causes[k + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    let end = c.stopMs;
    for (let i = 0; i + 1 < frames.length; i++) {
      if (frames[i]!.ms < c.startMs - 1e-6 || frames[i + 1]!.ms > limit + 1e-6) continue;
      if (moves(i)) end = Math.max(end, frames[i + 1]!.ms);
    }
    out.push([c.startMs, end]);
  });
  return out;
}

/** `ms` on the 1/60 s grid (k * 1000 / 60, at full precision) when it sits within float noise of it. */
const onGrid = (ms: number) => {
  const k = Math.round(ms / FRAME_MS);
  return Math.abs(k * FRAME_MS - ms) < 1e-6 ? (k * 1000) / 60 : ms;
};

/** A tap: a press at `at` from `ms`, lifted `lengthMs` later (one frame at least). */
const tap = (ms: number, [x, y]: [number, number], lengthMs = FRAME_MS): PointerSample[] => [
  [ms, x, y, 1],
  [onGrid(ms + Math.max(lengthMs, FRAME_MS)), x, y, 0],
];

/**
 * `input` with `cause`'s trigger played once more at `atMs`: the same press at the same spot for the
 * same length, the same scroll tick, or a tap at the viewport center for a load. A pointer input that
 * ends down gets its lift as a sample one frame after its last, so the pointer is not held down
 * until the repeat.
 */
export function repeatCause(input: InputSamples | null, cause: Cause, atMs: number): InputSamples {
  if (cause.kind === "scroll" && input?.kind === "scroll") {
    const tick = cause.tick ?? 0;
    const before = input.samples.filter((s) => s[0] < atMs - 1e-6);
    const after = input.samples.filter((s) => s[0] >= atMs - 1e-6).map(([ms, y]): [number, number] => [ms, y + tick]);
    const y = before.length > 0 ? before[before.length - 1]![1] : 0;
    return { kind: "scroll", samples: [...before, [atMs, y + tick], ...after.filter((s) => s[0] > atMs + 1e-6)] };
  }
  const press = cause.kind === "press" ? tap(atMs, cause.at!, cause.stopMs - cause.startMs) : tap(atMs, [...VIEWPORT_CENTER]);
  const own = input?.kind === "pointer" ? ([...input.samples] as PointerSample[]) : [];
  const last = own[own.length - 1];
  if (last && isDown(last)) own.push([onGrid(last[0] + FRAME_MS), last[1], last[2], 0]);
  const samples = [...own, ...press].sort((a, b) => a[0] - b[0]);
  return { kind: "pointer", samples };
}
