import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOLERANCE_FLOORS } from "../core/bar.ts";
import { KINDS } from "../core/kinds.ts";
import type { KindName } from "../core/types.ts";
import { kitRoot, readTextFile } from "../core/kit-root.ts";
import { audit, literalExemption, type PageScript } from "./audit.ts";
import { FRAME_MS, openPage, sleep, type Frame, type GatePage, type InputSamples, type OpenOptions } from "./harness.ts";
import { drawnRead } from "./drawn.ts";
import { checkExtents, extentsOf, membershipSteps, type Extents } from "./extents.ts";
import type { LeadWindow } from "./leads.ts";
import { checkObjects, objectOf } from "./objects.ts";
import { heldPoses, poses } from "./poses.ts";
import { drawingJumps, noHook, realClockGap, roundLengths, suddenJumps, zeroFrames } from "./self-checks.ts";
import { driveInput, INPUT_START_MS, inputChanges, inputSpan, syntheticInput } from "./synthetic-input.ts";
import { runChecks, type Check, type Verdict } from "./verdict.ts";
import { HOLD_MS, lastMoveMs, movedAtSpeedBefore, neverFasterThan, rangeOf, REST_FRAMES, sameSteadyStep, series, steadyStep, stillEps, stillTol, unitFloor, valueNames } from "./series.ts";
import { causedWindows, causesOf, repeatCause, type Cause } from "./causes.ts";
import { firstMoveMs, LOOP_LEAD_MS, LOOP_PERIOD_MS, periodicOf, PERIODIC_SCAN_MS, type Periodic } from "./periodic.ts";

export { rangeOf, REST_FRAMES, series, stillEps, unitFloor, valueNames };

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
   * A live or scroll page is also read to SETTLE_MS past the end of the sequence the input starts (liveSpan), however
   * long that is, up to SEQUENCE_SCAN_MS past the input.
   */
  spanMs?: number;
  /** What starts the motion on a choreo or sim page (causesOf the input). The other kinds do not read it. */
  causes?: Cause[];
  /** Values a copied bar's trace.json marks as held in drawings on purpose. The page reads them as their pose lines. */
  stepped?: string[];
  /** Values a copied bar's trace.json marks as a control's keyframe tween beside the bodies. A sim page's `energyFalls` leaves them out. */
  tweens?: string[];
  /**
   * Values a copied bar's trace.json declares as an edge of many moving parts, by value name, with the edge and the parts
   * (extents.ts). The `extents` rule guards each one; the envelope's pulse attack and the `overshoot` rule leave out
   * those whose guard passes.
   */
  extents?: Extents;
  /**
   * Where rules put notes: information lines that never change the verdict. kindGate makes one per run and copies it
   * into KindVerdict `notes`.
   */
  notes?: string[];
};
export type KindRule = { name: string; check(page: GatePage, ctx: RuleContext): Promise<string[]> };
/** `distances` and `notes` are information lines: they never change the verdict. */
export type KindVerdict = Verdict & { kind: KindName | null; distances: string[]; notes: string[] };

/** A move a cut ends sooner than this after it starts is cut off: its pops are not judged. */
const CUT_OFF_MS = 100;
/** The least the `?seek` frames reach, in ms, when the input starts INPUT_START_MS in. A sequence that runs on is read to its end (liveSpan, causedSpan). */
export const SPAN_MS = 3000;
/** An idle page's rules read this many periods of its longest designed loop, after its lead-in. */
export const IDLE_PERIODS_READ = 2;
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

/** Kinds whose motion starts from causes: their shared rules read the caused windows and leave loops out. */
export const CAUSED_KINDS: readonly KindName[] = ["choreo", "sim"];
const isCaused = (ctx: RuleContext) => CAUSED_KINDS.includes(ctx.kind);
/** On a choreo or sim page the rules read at least this long after the last cause stops: sim's 4 s rest bound, then a second more. */
export const CAUSE_SETTLE_MS = 5000;
/** How far past the last cause's stop the gate looks for the end of a choreo or sim sequence. The rules read SETTLE_MS past that end. */
export const SEQUENCE_SCAN_MS = 15000;
/** How long after its synthetic tap the gate looks for an answer, to tell a tap-started page from a load-started one. */
const TAP_PROBE_MS = 1500;

/** How long the gate watches a page with no input for its load motion to end. */
export const LOAD_SCAN_MS = 15000;
/** A live page is at rest when no value moves more than this between two reads 50 ms apart. */
const LIVE_STILL = 1e-3;

/** Kinds a page may name that have no knobs and no kind gate yet: one-shot moves use `feels` and `moves`. */
const GATELESS_KINDS = ["oneshot"];

/**
 * A kind's rules, and on a live or scroll page `inputLeads`: the stepped values its input rule judges inside the input
 * window (leads.ts leadWindow), and that window, which the envelope rule leaves out for them.
 */
type KindRules = { rules: KindRule[]; inputLeads?: (page: GatePage, ctx: RuleContext) => Promise<LeadWindow> };
const KIND_RULES: Partial<Record<KindName, () => Promise<KindRules>>> = {
  live: () => import("../../kinds/live/gate.ts"),
  idle: () => import("../../kinds/idle/gate.ts"),
  scroll: () => import("../../kinds/scroll/gate.ts"),
  choreo: () => import("../../kinds/choreo/gate.ts"),
  sim: () => import("../../kinds/sim/gate.ts"),
};

// ---- shared helpers for the rules -----------------------------------------------------------

export const round = (n: number) => Math.round(n * 1000) / 1000;

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

/** The page is at rest when each value but its loops changes by no more than its floor over this long. */
export const REST_WINDOW_MS = 1000;

/**
 * Polls a live page's values every 50 ms until it is at rest, and returns the page's clock (`performance.now()`) when it
 * came to rest, or null when it is still moving after `timeoutMs`. Values named in `ignore` (loops) are not read.
 *
 * It came to rest when no value moved more than LIVE_STILL between two reads 50 ms apart for 150 ms (the clock at the third
 * quiet read is what the rAF count starts from), and the page is at rest only when, over the last REST_WINDOW_MS, each
 * value's total change is within `floors[name]` (LIVE_STILL for a value with no floor): a creep too slow for the first
 * test to see (0.001 in 50 ms is 0.02 a second) is still moving. A value a read lacks is moving.
 */
export async function waitForRest(live: GatePage, timeoutMs = 5000, ignore: Set<string> = new Set(), floors: Record<string, number> = {}): Promise<number | null> {
  const end = performance.now() + timeoutMs;
  let prev: Record<string, number> | null = null;
  let quiet = 0;
  let restAt: number | null = null;
  const reads: { at: number; values: Record<string, number> }[] = [];
  while (performance.now() < end) {
    const at = performance.now();
    const values = Object.fromEntries(Object.entries((await live.state()).values).filter(([k]) => !ignore.has(k)));
    const moved = prev === null || Object.keys({ ...values, ...prev }).some((k) => !(Math.abs((values[k] ?? Number.NaN) - (prev![k] ?? Number.NaN)) <= LIVE_STILL));
    quiet = moved ? 0 : quiet + 1;
    if (moved) restAt = null;
    else if (quiet >= 3 && restAt === null) restAt = await live.page.evaluate(() => performance.now());
    prev = values;
    reads.push({ at, values });
    while (reads.length > 1 && reads[1]!.at <= at - REST_WINDOW_MS) reads.shift();
    if (restAt !== null && at - reads[0]!.at >= REST_WINDOW_MS - 1e-6 && settledOver(reads, floors)) return restAt;
    await sleep(50);
  }
  return null;
}

/** Whether every value in `reads` stays within its floor (LIVE_STILL with none) from its lowest read to its highest. */
function settledOver(reads: { values: Record<string, number> }[], floors: Record<string, number>): boolean {
  const names = new Set(reads.flatMap((r) => Object.keys(r.values)));
  return [...names].every((n) => {
    const vs = reads.map((r) => r.values[n] ?? Number.NaN);
    return Math.max(...vs) - Math.min(...vs) <= (floors[n] ?? LIVE_STILL);
  });
}

// ---- the rules for every kind ---------------------------------------------------------------

/** A pulse's attack, from its start to its peak, is 40 to 120 ms. */
export const ATTACK_MS = [40, 120] as const;
/** A pulse comes back toward where it started: it ends within this share of its peak. */
const PULSE_RETURN = 0.5;
/** A pulse peaks within this long of its start. A slower rise and fall is a move or a loop, not a flash. */
const PULSE_PEAK_MS = 500;
/** How far the gate looks for a pulse-shaped value's repeats. 15 s holds 3 starts of a 5 s loop. */
const LOOP_SCAN_MS = 15000;
/** A value is a loop when it starts the same way 3 or more times, evenly spaced (within 1 frame). */
const LOOP_STARTS = 3;

type Onset = { name: string; i: number; ms: number; rising: boolean };

/** One 1/60 s frame that covers more than this share of a smooth start's whole change is a pop. */
const POP_SHARE = 0.5;

/** A chain of moves whose every leg lasts no more than this many frames is a flick, not a swing: its frames are judged for a pop. */
const FLICK_FRAMES = 2;

/**
 * Every place a value starts to move after holding still for 2 frame steps (the page counts as
 * still before its first frame), outside the windows (motion the input drives) and away from a cut.
 */
function onsets(frames: Frame[], windows: [number, number][], cuts: number[]): Onset[] {
  const out: Onset[] = [];
  const inWindow = (ms: number) => windows.some((w) => ms + FRAME_MS >= w[0] - 1e-6 && ms <= w[1] + 1e-6);
  for (const name of valueNames(frames)) {
    const v = series(frames, name);
    const eps = stillTol(v);
    const moving = (i: number) => i >= 0 && Math.abs(v[i + 1]! - v[i]!) > eps;
    const starts = new Set<number>();
    for (let i = 0; i + 1 < frames.length; i++) {
      // A start, or, while the value moves, the first frame step past the frames a cut leaves out (below): what
      // follows a cut is new motion.
      const afterCut = i > 0 && cuts.some((c) => frames[i - 1]!.ms <= c + 2 * FRAME_MS + 1e-6 && frames[i]!.ms > c + 2 * FRAME_MS + 1e-6);
      if (!moving(i) || (!afterCut && (moving(i - 1) || moving(i - 2)))) continue;
      const ms = frames[i]!.ms;
      if (inWindow(ms)) continue;
      if (!afterCut && cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS)) continue;
      if (starts.has(i)) continue;
      starts.add(i);
      out.push({ name, i, ms, rising: v[i + 1]! > v[i]! });
    }
  }
  return out;
}

/**
 * An onset's frames until the value rests, or until a cut (what follows a cut is new motion, which may jump): its
 * whole change (the farthest it goes, either way, so an anticipation dip before the move does not count as the move),
 * its swing (the highest value less the lowest, over those frames), where it ends, and whether it ends at rest (`held`:
 * the value held still for REST_FRAMES steps, not cut and not out of frames).
 */
function segment(frames: Frame[], o: Onset, eps: number, cuts: number[] = []) {
  const v = series(frames, o.name);
  let end = o.i;
  let still = 0;
  const cutIn = (j: number) => cuts.some((c) => c >= frames[j]!.ms + FRAME_MS / 2 - 1e-6 && c <= frames[j + 1]!.ms + FRAME_MS / 2 + 1e-6);
  let cut = false;
  for (let j = o.i; j + 1 < frames.length && still < REST_FRAMES; j++) {
    if (j > o.i && cutIn(j)) {
      cut = true;
      break;
    }
    still = Math.abs(v[j + 1]! - v[j]!) > eps ? 0 : still + 1;
    end = j + 1;
  }
  let peak = o.i;
  let [lo, hi] = [v[o.i]!, v[o.i]!];
  for (let j = o.i; j <= end; j++) {
    if (Math.abs(v[j]! - v[o.i]!) > Math.abs(v[peak]! - v[o.i]!)) peak = j;
    if (Number.isFinite(v[j]!)) [lo, hi] = [Math.min(lo, v[j]!), Math.max(hi, v[j]!)];
  }
  const dir = v[peak]! >= v[o.i]! ? 1 : -1;
  return { v, dir, end, peak, cut, held: !cut && still >= REST_FRAMES, range: hi - lo, total: dir * (v[peak]! - v[o.i]!), left: dir * (v[end]! - v[o.i]!) };
}

/**
 * A pulse's attack, from seeks every eighth of a frame around its start and its peak. A stepped value's is read on its
 * drawings, not its pose line, which reaches each drawing one drawing late: from half a drawing before its first new
 * drawing (the motion starts somewhere in the drawing before it, as a smooth start is read at the middle of its
 * frame) to the start of its peak drawing.
 */
async function pulseAttack(page: GatePage, o: Onset, peakMs: number, dir: number, eps: number, stepped = false): Promise<number> {
  if (stepped) return drawingAttack(page, o, peakMs, dir, eps);
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
 * A stepped onset's attack on its drawings (pulseAttack), read up to `peakMs`, where its pose line peaks: from half its
 * first new drawing's length before that drawing starts to the start of its peak drawing.
 */
async function drawingAttack(page: GatePage, o: Onset, peakMs: number, dir: number, eps: number): Promise<number> {
  const raw = await page.rawFrames(Math.max(0, o.ms - FRAME_MS), peakMs + FRAME_MS);
  const x = raw.map((f) => f.values[o.name] ?? Number.NaN);
  const k0 = x.findIndex((y) => Math.abs(y - x[0]!) > eps);
  if (k0 < 0) return 0;
  let best = k0;
  for (let k = k0; k < x.length; k++) if (dir * (x[k]! - x[best]!) > 0) best = k;
  const k1 = x.findIndex((y, k) => k > k0 && Math.abs(y - x[k0]!) > eps);
  const drawing = k1 < 0 ? 0 : raw[k1]!.ms - raw[k0]!.ms;
  return raw[best]!.ms - raw[k0]!.ms + drawing / 2;
}

/**
 * The chain of moves that the onset at frame `i` belongs to, and whether it comes back to where it started and holds
 * there. A chain is a row of moves with no hold of HOLD_MS or more between them: it reaches back from `i` to `first`
 * and on from `end`, the frame the onset's own segment ended at (a rest of REST_FRAMES steps), to `last`, while the
 * value moves again within HOLD_MS. It comes home when it ends within OVERSHOOT_SHARE of its farthest reach (at least
 * `floor`) of where it started, held there for REST_FRAMES steps.
 */
function chainOf(v: number[], i: number, end: number, eps: number, floor: number): { first: number; last: number; home: boolean } {
  const holdSteps = Math.ceil(HOLD_MS / FRAME_MS - 1e-6);
  let first = i;
  for (let k = i, still = 0; k > 0 && still < holdSteps; k--) {
    if (Math.abs(v[k]! - v[k - 1]!) > eps) [first, still] = [k - 1, 0];
    else still++;
  }
  let last = end - REST_FRAMES;
  let held = true;
  for (let k = end, still = REST_FRAMES; still < holdSteps; k++) {
    if (k + 1 >= v.length) {
      held = false;
      break;
    }
    if (Math.abs(v[k + 1]! - v[k]!) > eps) [last, still] = [k + 1, 0];
    else still++;
  }
  if (!held) return { first, last, home: false };
  const reach = Math.max(...v.slice(first, last + 1).map((x) => Math.abs(x - v[first]!)));
  return { first, last, home: Math.abs(v[last]! - v[first]!) <= Math.max(floor, OVERSHOOT_SHARE * reach) };
}

/**
 * The longest leg of `name` between `fromMs` and `toMs`, in ms, read every eighth of a frame: a leg is a run of
 * sub-steps that move the value (by more than an eighth of `eps`) the one way. A hold or a turn ends it.
 */
async function longestLegMs(page: GatePage, name: string, fromMs: number, toMs: number, eps: number): Promise<number> {
  const dt = FRAME_MS / 8;
  const x = (await page.frames(Math.max(0, fromMs), toMs, dt)).map((f) => f.values[name] ?? Number.NaN);
  let [best, run, dir] = [0, 0, 0];
  for (let k = 1; k < x.length; k++) {
    const d = x[k]! - x[k - 1]!;
    const s = Math.abs(d) > eps / 8 ? Math.sign(d) : 0;
    [run, dir] = s !== 0 && s === dir ? [run + 1, dir] : [s !== 0 ? 1 : 0, s];
    best = Math.max(best, run);
  }
  return best * dt;
}

/**
 * What is wrong with one onset: a pop (against its whole change), a pulse attack out of bounds, or a fade that rises.
 * The pulse and fade tests keep the whole change. A move that comes back to where it started and holds there (a shake,
 * a bob) has no pop test here: its frames are part of a swing that goes both ways, so a frame is a share of the swing
 * that no whole change measures, and the suddenJumps rule reads the motion between its frames instead. A value that is
 * an `extent` (a checked edge of many moving parts) has no attack bound: it turns when another part becomes the extreme
 * one, which is no flash. Its `frames` carry the edge as the parts drawn through it moved it (`byMotion`): in a step that
 * changes who is in its union (a part comes back or goes gone) the jump of who is in is left out, so a part that jumps in
 * that step is a pop, as against the motion alone, and the one that came or went is not. An onset whose whole
 * change is below its unit's tolerance floor (TOLERANCE_FLOORS: 0.5 px, 0.002 scale, 0.01 opacity, ...) is too
 * small to see, so it has no problem: a spring or a smoothed scroll that snaps to rest at the end of a still stretch.
 */
async function onsetProblems(page: GatePage, frames: Frame[], o: Onset, unit: string | undefined, isLoop: (o: Onset) => Promise<boolean>, stepped: boolean, caused = false, cuts: number[] = [], isDesigned: (o: Onset) => Promise<boolean> = isLoop, extent = false): Promise<string[]> {
  const eps = stillTol(series(frames, o.name));
  const seg = segment(frames, o, eps, cuts);
  const at = `${o.name} at ${round(o.ms)} ms`;
  const out: string[] = [];
  const floor = unit !== undefined && Object.hasOwn(TOLERANCE_FLOORS, unit) ? TOLERANCE_FLOORS[unit]! : 0;
  if (!(seg.total > eps) || seg.total < floor) return out;
  // A stepped value's frames here are its pose line; its pops are judged at its drawing rate (envelope). A move a cut
  // ends within CUT_OFF_MS of its start is cut off, as one the frames end: its whole change is not on screen.
  const cutOff = seg.cut && frames[seg.end]!.ms - o.ms < CUT_OFF_MS - 1e-6;
  // A move that comes back to where it started and holds there (the "home" test of judgeChain), as a shake or a bob, has
  // no pop test while it swings: the suddenJumps rule reads its motion between frames. Nor has a move in a chain of
  // moves that holds for less than HOLD_MS between them and comes home as a whole (a tada, a bounce with a pause at its
  // top). A chain whose every leg lasts FLICK_FRAMES frames or less is a flick, and its frames are judged as any move's:
  // against its whole swing (the move itself) or its whole change (a chain); a smooth leg that short is no cusp for
  // suddenJumps to find, and only the frame it lands in tells it apart from a snap. Every other move, a start with an
  // anticipation dip included, is judged against its whole change.
  const chain = chainOf(seg.v, o.i, seg.end, eps, floor);
  const segHome = seg.held && Math.abs(seg.v[seg.end]! - seg.v[o.i]!) <= Math.max(floor, OVERSHOOT_SHARE * seg.total);
  const home = segHome || chain.home;
  const popBase = segHome ? seg.range : seg.total;
  let flick: boolean | undefined;
  for (let j = o.i; j < seg.end && !stepped && !cutOff; j++) {
    const step = Math.abs(seg.v[j + 1]! - seg.v[j]!);
    if (step > POP_SHARE * popBase * (1 + 1e-9)) {
      if (home) flick ??= (await longestLegMs(page, o.name, frames[chain.first]!.ms - FRAME_MS, frames[Math.max(chain.last, seg.end)]!.ms + FRAME_MS, eps)) <= FLICK_FRAMES * FRAME_MS + 1e-6;
      if (home && !flick) continue;
      out.push(`${at} covers ${Math.round((step / popBase) * 100)}% of its whole change in the one frame after ${round(frames[j]!.ms)} ms; that is a pop`);
      break;
    }
  }
  // Inside a caused sequence anything that comes back halfway is a pulse, however slow: a dip through black is no fade.
  // A stepped value's pose line reaches its peak drawing one drawing late: whether it peaks in time is read on its drawings.
  const peaksIn = stepped ? await drawingAttack(page, o, frames[seg.peak]!.ms, seg.dir, eps) : frames[seg.peak]!.ms - o.ms;
  const pulse = seg.left <= PULSE_RETURN * seg.total && (caused || peaksIn <= PULSE_PEAK_MS);
  if (pulse && !caused && !extent && !(await isLoop(o))) {
    const ms = await pulseAttack(page, o, frames[seg.peak]!.ms, seg.dir, eps, stepped);
    if (ms < ATTACK_MS[0] || ms > ATTACK_MS[1]) out.push(`${at} is a pulse that peaks ${Math.round(ms)} ms after it starts; a pulse's attack is ${ATTACK_MS[0]} to ${ATTACK_MS[1]} ms`);
  } else if (!pulse && unit === "opacity" && seg.dir < 0 && !(await isDesigned(o))) {
    for (let j = o.i; j < seg.end; j++) {
      if (seg.v[j + 1]! - seg.v[j]! > eps) {
        out.push(`${o.name} rises at ${round(frames[j]!.ms)} ms, during the fade that starts at ${round(o.ms)} ms; fades only fall`);
        break;
      }
    }
  }
  return out;
}

/** A loop is a value whose starts, or whose peaks of equal height, repeat at a fixed period: this many times or more. */
const evenly = (times: number[]) => {
  if (times.length < LOOP_STARTS) return false;
  const gaps = times.slice(1).map((t, k) => t - times[k]!);
  return Math.max(...gaps) - Math.min(...gaps) <= FRAME_MS + 1e-6;
};

/** The last of `times` is within one period (the last gap), plus a frame, of `endMs`: the repeats run to the end of the frames read. */
const repeatsTo = (times: number[], endMs: number) => times.length > 1 && endMs - times[times.length - 1]! <= times[times.length - 1]! - times[times.length - 2]! + FRAME_MS + 1e-6;

/**
 * Whether the loop sort takes a value that moves at one steady speed for a loop. With a first cause after load (`causeMs`
 * above 0: a tap on a choreo or sim page, the first input sample on a live or scroll page) the value must move the same
 * with no input: `quiet`, the page's frames read with no input, ends at the same steady speed, so the cause did not start
 * it (a marquee that starts a little after load, one that eases in, a strip a hand holds and lets go), and `quiet` itself must
 * hold that speed from the end of its lead-in, as a value with no cause must: a breath that turns into a creep from load is no
 * loop on a page that also answers a tap. A fling clamped
 * to a minimum speed, a breath that a creep follows, a tween with no clamp are at rest or breathing in `quiet`, whichever way the
 * breath was going when the cause came. Without `quiet` the value itself must have been moving at that speed in the frame
 * before the cause (movedAtSpeedBefore). With no cause (an idle page, or a page that starts on load) it must hold that speed
 * from the end of its lead-in, LOOP_LEAD_MS after it first moves, to the end of the frames: a ramp up to the speed is that
 * lead-in, a breath that turns into a creep later is not.
 */
function steadyLoop(frames: Frame[], name: string, causeMs: number | undefined, quiet: Frame[] | undefined): boolean {
  if (causeMs !== undefined && causeMs > 0) {
    const step = steadyStep(frames, name);
    if (step === null) return false;
    return quiet ? sameSteadyStep(quiet, frames, name, step) && holdsFromLeadIn(quiet, name) : movedAtSpeedBefore(frames, name, causeMs, step);
  }
  return holdsFromLeadIn(frames, name);
}

/** Whether `name` holds one steady speed from the end of its lead-in, LOOP_LEAD_MS after it first moves, to the end of `frames`. */
function holdsFromLeadIn(frames: Frame[], name: string): boolean {
  const from = firstMoveMs(frames, name);
  return from !== null && steadyStep(frames, name, from + LOOP_LEAD_MS) !== null;
}

/** Whether `drift`, how far a loop moves on over the read, is more than its unit's `floor`: a loop comes back to where it was. */
const drifted = (drift: number, floor: number) => drift > floor + 1e-9;

/**
 * The values in `frames` that loop by their onsets or by one steady speed: the two branches of the loop sort that read
 * the frames alone (loopSet adds the values periodOf finds). A value that starts the same way (an onset in the same
 * direction) 3 or more times at a fixed period of LOOP_PERIOD_MS's lower bound or more, as the envelope's loop test reads
 * it, and keeps its range each period: every period's swing is as large as the first's, and, but for a value in deg
 * (a hand that ticks round), it starts and tops out at the same levels: each period's levels and swing are the first's,
 * within the unit floor (and what a crest known only to a frame can be off). A per-period step in px, scale or opacity (a
 * staircase) or a swing that grows each beat is no loop, however small: the drift of the whole read is held to the floor. The
 * starts repeat to the end: the last start is within one period, plus a frame, of the last frame. A piece that steps
 * or breathes a few times and holds stops before the end, so it is no loop. A value that moves at one steady speed over
 * the last 500 ms (steadyStep: a marquee, a strip that drifts) is a loop too, whatever it did before a hand held it or
 * eased it back to its drift. `causeMs` is when the first cause starts: a tap on a choreo or sim page, the first input
 * sample on a live or scroll page (0 or none for a page with no input, or that starts on load). With a cause the steady
 * value must move the same in `quiet`, the frames read with no input; with none it must hold that speed from the end of
 * its lead-in (steadyLoop). A value that starts at a cause and never stops (a tween with no clamp, a body with no friction, a fling
 * clamped to a minimum speed) looks the same at the end of the read, and is a fault the span and rest rules must still see.
 */
export function loopNames(frames: Frame[], windows: [number, number][], cuts: number[], causeMs?: number, units: Record<string, string> = {}, quiet?: Frame[]): Set<string> {
  const out = new Set<string>();
  const os = onsets(frames, windows, cuts);
  for (const name of valueNames(frames)) {
    for (const rising of [true, false]) {
      const mine = os.filter((o) => o.name === name && o.rising === rising);
      const starts = mine.map((o) => o.ms);
      if (evenly(starts) && starts[1]! - starts[0]! >= LOOP_PERIOD_MS[0] - FRAME_MS && repeatsTo(starts, frames[frames.length - 1]!.ms) && holdsEachPeriod(frames, name, mine, units[name])) out.add(name);
    }
    if (out.has(name)) continue;
    // A value that moves at one steady speed to the end (a marquee, a strip that drifts) has no onsets.
    if (steadyLoop(frames, name, causeMs, quiet)) out.add(name);
  }
  return out;
}

/**
 * Whether the value `name` keeps its swing each period between the onsets `starts`: each period's range (its highest
 * frame less its lowest) matches the first period's, and, but for a value in deg, so do its lowest and highest frames,
 * so the value starts each period where it started the last. The levels are compared across the read, the last period
 * against the first (every period against the first), so a sub-floor change each period that adds up fails; each match
 * is within the unit's floor, and a crest known only to a frame can be off by half the bend of the frames at it. (A period's change is judged with the same test as a periodic loop's, drifted.)
 */
function holdsEachPeriod(frames: Frame[], name: string, starts: Onset[], unit: string | undefined): boolean {
  const v = series(frames, name);
  const periods = starts.slice(1).map((o, k) => v.slice(starts[k]!.i, o.i + 1));
  const floor = unitFloor(unit, rangeOf(v));
  /**
   * How far the crest the frame at `at` stands for can be above (or below) it: half the bend of the frames there (the
   * second difference), as a smooth crest sampled at any phase is within an eighth of it and a corner within a half. The
   * frame step beside it where the period's frames end.
   */
  const beside = (p: number[], at: number) =>
    at > 0 && at + 1 < p.length ? Math.abs(p[at - 1]! - 2 * p[at]! + p[at + 1]!) / 2 : Math.max(Math.abs(p[at]! - (p[at - 1] ?? p[at]!)), Math.abs(p[at]! - (p[at + 1] ?? p[at]!)));
  /** ...for a level held for more than a frame, its smallest: the hold is known to the frame between two like it. */
  const besideLevel = (p: number[], level: number) => Math.min(...p.map((x, at) => (x === level ? beside(p, at) : Number.POSITIVE_INFINITY)));
  const levels = periods.map((p) => {
    const [lo, hi] = [Math.min(...p), Math.max(...p)];
    return { lo, hi, loBy: besideLevel(p, lo), hiBy: besideLevel(p, hi) };
  });
  const first = levels[0]!;
  const off = (get: (l: (typeof levels)[number]) => number, by: (l: (typeof levels)[number]) => number) => levels.some((l) => drifted(Math.abs(get(l) - get(first)) - by(l) - by(first), floor));
  const swing = !off((l) => l.hi - l.lo, (l) => l.loBy + l.hiBy);
  return swing && (unit === "deg" || (!off((l) => l.lo, (l) => l.loBy) && !off((l) => l.hi, (l) => l.hiBy)));
}

/**
 * The frames of `page` read with no input, as far as `frames` reach, when the loop sort needs them: the page plays input, it
 * has a first cause after load (`causeMs`), and a value moves at one steady speed to the end (steadyLoop asks whether it
 * moves so with no input too). One more page open, and only then. Otherwise undefined.
 */
async function quietFrames(page: GatePage, frames: Frame[], causeMs: number | undefined): Promise<Frame[] | undefined> {
  if (causeMs === undefined || !(causeMs > 0) || !Array.isArray(page.options?.input) || page.options.input.length === 0) return undefined;
  if (!valueNames(frames).some((n) => steadyStep(frames, n) !== null)) return undefined;
  const { input: _input, steppedInputRaw: _raw, ...rest } = page.options;
  const quiet = await openPage(page.file, rest);
  try {
    return await quiet.frames(0, frames[frames.length - 1]!.ms);
  } finally {
    await quiet.close();
  }
}

/**
 * The loops among the values of `frames`: loopNames' (onsets, steady speed) and every value periodicFor finds. This is
 * the one sort every rule reads (rolesOf), and the one that finds where a sequence ends (causedSpan). With a first cause
 * the steady speeds are judged against the page read with no input (quietFrames).
 */
export async function loopSet(page: GatePage, frames: Frame[], cuts: number[], causeMs?: number): Promise<Set<string>> {
  const { units } = await page.state();
  const loops = loopNames(frames, [], cuts, causeMs, units, await quietFrames(page, frames, causeMs));
  for (const name of valueNames(frames)) if (!loops.has(name) && (await periodicFor(page, name, units[name])) !== null) loops.add(name);
  return loops;
}

/** What the choreo and sim rules do with a value: a loop may run forever, a position (px or deg) is a body, the rest are other. */
export type Role = "loop" | "position" | "other";
const roleMemo = new WeakMap<GatePage, Promise<Map<string, Role>>>();

/**
 * Each value's role, read once per page from its frames over LOOP_SCAN_MS (a choreo or sim page: loopScanEnd) with the gate's input:
 * loopSet finds the loops, and a value in px or deg that is no loop is a position.
 */
export function rolesOf(page: GatePage, ctx: RuleContext): Promise<Map<string, Role>> {
  let memo = roleMemo.get(page);
  if (!memo) {
    memo = (async () => {
      const frames = await page.frames(0, Math.max(loopScanEnd(ctx.causes ?? causesOf(ctx.input)), spanOf(ctx)));
      const { units } = await page.state();
      const loops = await loopSet(page, frames, ctx.cuts, firstCauseMs(ctx.causes ?? causesOf(ctx.input)));
      return new Map(valueNames(frames).map((n): [string, Role] => [n, loops.has(n) ? "loop" : units[n] === "px" || units[n] === "deg" ? "position" : "other"]));
    })();
    roleMemo.set(page, memo);
  }
  return memo;
}

/** The loops among `roles`. */
export const loopsIn = (roles: Map<string, Role>) => new Set([...roles].filter(([, r]) => r === "loop").map(([n]) => n));

/** `rule`, run only on a page with a loop: a choreo or sim page's loops get the idle rules. */
export function forLoops(rule: KindRule): KindRule {
  return { name: rule.name, check: async (page, ctx) => (loopsIn(await rolesOf(page, ctx)).size > 0 ? rule.check(page, ctx) : []) };
}

/**
 * The windows of motion a person caused, which the envelope and overshoot rules leave out. On a
 * live, idle or scroll page: the input window. On a choreo or sim page: each cause's caused window,
 * from the cause to the end of the sequence it starts, pauses and loops not counted.
 */
export async function exemptWindows(page: GatePage, frames: Frame[], ctx: RuleContext): Promise<[number, number][]> {
  if (!isCaused(ctx)) {
    const w = inputWindow(frames, ctx.input);
    return w ? [w] : [];
  }
  return causedWindows(frames, ctx.causes ?? causesOf(ctx.input), loopsIn(await rolesOf(page, ctx)));
}

/**
 * On a choreo or sim page, the stretches envelope leaves out: each scroll burst, and each press whose pointer moves
 * while it is down (a drag may carry a value), to one frame past its stop. A tap starts a sequence the rule judges:
 * its pieces may not pop and its fades only fall, however late they start. The pulse attack bound is for flashes the
 * page plays by itself, so a caused shake or toss is not held to it, and a caused dip that comes back halfway is a
 * pulse however slow, so a fade through black is no fade that rises again.
 */
function carriedWindows(ctx: RuleContext): [number, number][] {
  const samples = ctx.input?.kind === "pointer" ? (ctx.input.samples as [number, number, number, ...number[]][]) : [];
  const drags = (c: Cause) =>
    samples.some((q) => q[0] >= c.startMs - 1e-6 && q[0] <= c.stopMs + 1e-6 && (q[1] !== c.at?.[0] || q[2] !== c.at?.[1]));
  return (ctx.causes ?? causesOf(ctx.input)).filter((c) => c.kind === "scroll" || (c.kind === "press" && drags(c))).map((c) => [c.startMs, c.stopMs + FRAME_MS]);
}

/** The windows envelope leaves out: the input's on a live, idle or scroll page, carriedWindows on a choreo or sim page. */
const envelopeWindows = async (page: GatePage, frames: Frame[], ctx: RuleContext) => (isCaused(ctx) ? carriedWindows(ctx) : exemptWindows(page, frames, ctx));

/**
 * Envelope: no pop, a pulse has a 40 to 120 ms attack, fades only fall, and one capped time step.
 * An onset whose whole change is below its unit's tolerance floor is left out.
 * A pop is one frame that covers more than half of an onset's whole change. A pulse rises from
 * rest to a peak within 500 ms and then comes back toward where it started (a flash, a badge
 * pulse); ordinary moves, tweens, springs and loops have no attack bound, and neither has a checked extent (an edge of
 * many moving parts, from a bar's trace.json `extents`). A value whose starts
 * repeat at a fixed period (3 or more, within 1 frame, over 15 s) is a loop. Motion the input drives,
 * and motion that starts at a cut, are left out; on a choreo or sim page only a drag or a scroll burst drives it
 * (carriedWindows). A stepped value's pops are judged on its drawings, in lengths of its object (drawingJumps), and the
 * rest of the rule reads its pose line. On a live or scroll page the stepped values the input rule judges (inputLeads)
 * are left out from the input's first sample to the end of the raw window, where they rest after the input, so a step
 * the input rule reports is not reported again here; every other stepped value is judged there too.
 */
const envelope: KindRule = {
  name: "envelope",
  async check(page, ctx) {
    // Onsets inside the span are read on to their rest, up to SETTLE_MS past it, so a move the span cuts is whole.
    const frames = await page.frames(0, spanOf(ctx) + SETTLE_MS);
    const { units } = await page.state();
    const out: string[] = [];
    const flagged = new Set<string>();
    let long: Onset[] | undefined;
    const isDesigned = async (o: Onset) => {
      if (isCaused(ctx) && loopsIn(await rolesOf(page, ctx)).has(o.name)) return true;
      const loop = await periodicFor(page, o.name, units[o.name]);
      return loop !== null && o.ms >= loop.leadMs - 1e-6;
    };
    const isLoop = async (o: Onset) => {
      if (await isDesigned(o)) return true;
      if (!long) {
        const lf = await page.frames(0, LOOP_SCAN_MS);
        long = onsets(lf, await envelopeWindows(page, lf, ctx), ctx.cuts);
      }
      const starts = long.filter((x) => x.name === o.name && x.rising === o.rising).map((x) => x.ms);
      if (starts.length < LOOP_STARTS) return false;
      const gaps = starts.slice(1).map((t, k) => t - starts[k]!);
      return Math.max(...gaps) - Math.min(...gaps) <= FRAME_MS + 1e-6;
    };
    const windows = await envelopeWindows(page, frames, ctx);
    const caused = isCaused(ctx) ? await exemptWindows(page, frames, ctx) : [];
    const extentSteps = await checkedExtents(page, ctx);
    const stepped = new Set(ctx.stepped ?? []);
    const reported = new Set(valueNames(frames));
    const objects = stepped.size > 0 ? (await page.state()).objects : {};
    const inputLeads = stepped.size > 0 && !isCaused(ctx) && ctx.input ? await (await KIND_RULES[ctx.kind]?.())?.inputLeads?.(page, ctx) : undefined;
    for (const name of [...stepped].filter((n) => reported.has(n))) {
      // `ms` is the frame before the step: the input rule judges the steps into frames inside its window.
      const left = (ms: number) =>
        inputLeads
          ? inputLeads.names.includes(name) && ms + FRAME_MS >= inputLeads.window[0] - 1e-6 && ms + FRAME_MS <= inputLeads.window[1] + 1e-6
          : windows.some((w) => ms + FRAME_MS >= w[0] - 1e-6 && ms <= w[1] + 1e-6);
      const skip = (ms: number) => left(ms) || ctx.cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS);
      const pop = (await drawingJumps(page, name, objects, spanOf(ctx), units[name], ctx.kind === "scroll", skip))[0];
      if (!pop) continue;
      flagged.add(name);
      const [at, L] = [round(pop.atMs), roundLengths(pop.lengths)];
      const drawings = `${pop.drawings} drawing${pop.drawings === 1 ? "" : "s"}`;
      out.push(
        pop.kind === "spike"
          ? `envelope: ${name} at ${at} ms jumps ${L} of its object's length in ${drawings}, ${roundLengths(pop.ratio)} times the drawings around it; that is a pop`
          : pop.kind === "teleport"
            ? `envelope: ${name} at ${at} ms jumps ${L} object lengths between two rests; that is a teleport`
            : `envelope: ${name} at ${at} ms jumps ${L} object lengths and back in one drawing; that is a teleport`,
      );
    }
    // A checked extent is read as its parts moved it: the jump of who is in its union, as a part comes back or goes gone, is left out.
    const read = byMotion(frames, extentSteps);
    for (const o of onsets(read, windows, ctx.cuts)) {
      if (flagged.has(o.name) || o.ms > spanOf(ctx) + 1e-6) continue;
      const inCause = caused.some((w) => o.ms + FRAME_MS >= w[0] - 1e-6 && o.ms <= w[1] + 1e-6);
      const problems = await onsetProblems(page, read, o, units[o.name], isLoop, stepped.has(o.name), inCause, ctx.cuts, isDesigned, extentSteps.has(o.name));
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
 * One stretch of a value moving one way: from `s` to its farthest point `ext`, in direction `d`. `dip` is where its
 * speed last fell below a tenth of its top speed in this stretch.
 */
type Leg = { s: number; ext: number; d: number; startMs: number; extMs: number; extI: number; vmax: number; dip: { x: number; v: number; ms: number } | null };

/**
 * A level in a chain: where it starts, each turn (a leg's farthest point), and each soft stop, where a move nearly
 * stops (below a tenth of its top speed) and then speeds up again the same way (past twice the dip and a fifth of the
 * top): the level a move came to rest at when the next move started before it was still. A slow tail into a turn is
 * no stop.
 */
type Level = { x: number; ms: number; soft: boolean; slop?: number; held?: boolean };

/** A leg turns, and a level counts as passed, only past this share of the move's travel. */
const OVERSHOOT_SHARE = 0.02;
/** A turn after which the value swings back more than this many times its last swing starts a new move. */
const GROWS = 3;

/**
 * Where a stepped value's chains end (`overshootIn`'s `holdAt`): the frame each held drawing (poses.ts `heldPoses`)
 * gives way to the next, where its pose line reaches it, from its raw frames `raw`. A slow drawing among slow ones
 * (threes into ones) holds nothing.
 */
export function heldDrawings(raw: number[]): Set<number> {
  const ps = poses(raw, stillTol(raw));
  const held = heldPoses(ps);
  return new Set(ps.slice(1).filter((_, k) => held[k]).map((p) => p.start));
}

/**
 * The first place a value passes the level it comes to rest at, then comes back to it. The value is read in chains: a
 * chain ends at a hold (it holds still for HOLD_MS, or `holdAt` names the frame), at a skipped frame, and at the end
 * of the frames. A chain is a row of levels (Level); a soft stop, or a turn after which the value swings back more
 * than GROWS times its last swing, or goes farther from the move's start than it has been, ends one move and starts
 * the next. Each move is judged against the level it stops at: the hold, the soft stop or the turn where the next
 * move starts. The last move of a chain the frames cut off has no stop, and is not judged.
 * - A move that ends back at its start, held there, with its first turn within 500 ms, passes no rest: a shake, a
 *   beat, a hop that lands. It is judged as pulses. Otherwise (the next move starts from there with no hold, as in an
 *   endless bounce, or it is an opacity value) each swing past its start is an overshoot of its first swing.
 * - A move whose first turn is its farthest point, within 500 ms, and that comes back at least halfway is a pulse.
 * - Otherwise each turn that passes the stop, in the move's direction, by more than `floor` and more than 2% of the
 *   move, overshoots it: by how far it passes, against the move from its start to its stop.
 */
type Overshoot = { ms: number; by: number; move: number };

function judgeChain(levels: Level[], held: boolean, floor: number, allow: (hit: Overshoot) => boolean, returns = true): Overshoot | null {
  const n = levels.length;
  const swing = (j: number) => Math.abs(levels[j]!.x - levels[j - 1]!.x);
  const cuts = [0];
  let far = 0;
  let slop = 0;
  // A chain held back where it started is a shake, which may grow (a wobble that winds up): no turn of it goes on.
  const reach = Math.max(...levels.map((l) => Math.abs(l.x - levels[0]!.x)));
  const home = held && Math.abs(levels[n - 1]!.x - levels[0]!.x) <= Math.max(floor, OVERSHOOT_SHARE * reach);
  for (let j = 1; j + 1 < n; j++) {
    const from = levels[cuts[cuts.length - 1]!]!.x;
    const dist = Math.abs(levels[j]!.x - from);
    // A held turn short of the farthest the move has gone ends it: the value came to rest there.
    const heldShort = levels[j]!.held === true && dist < far - Math.max(floor, OVERSHOOT_SHARE * far);
    if (dist > far) [far, slop] = [dist, levels[j]!.slop ?? 0];
    // A new move starts at a turn after which the value swings back more than GROWS times its last swing, or, in a
    // chain that does not come home, goes on farther from where this move started than it has been (past the frame
    // step beside its farthest turn, which a sharp turn, as a ball's landing, can miss its extreme by).
    const goesOn = !home && Math.abs(levels[j + 1]!.x - from) > far + Math.max(floor, OVERSHOOT_SHARE * far, slop);
    if (levels[j]!.soft || heldShort || swing(j + 1) > GROWS * swing(j) || goesOn) {
      cuts.push(j);
      far = 0;
      slop = 0;
    }
  }
  cuts.push(n - 1);
  for (let g = 0; g + 1 < cuts.length; g++) {
    const [a, b] = [cuts[g]!, cuts[g + 1]!];
    const inner = levels.slice(a + 1, b);
    if (inner.length === 0) continue;
    // A move the frames cut off has no stop to judge it against.
    if (b === n - 1 && !held) continue;
    const [s, r] = [levels[a]!, levels[b]!];
    const reach = Math.max(...inner.map((l) => Math.abs(l.x - s.x)));
    const first = inner[0]!;
    const toFirst = Math.abs(first.x - s.x);
    let hit: Overshoot | null = null;
    if (Math.abs(r.x - s.x) <= Math.max(floor, OVERSHOOT_SHARE * reach)) {
      const d = Math.sign(s.x - first.x);
      const need = Math.max(floor, OVERSHOOT_SHARE * toFirst);
      // Held at its start, a move that peaks within PULSE_PEAK_MS is pulses (an opacity value's never is: it never
      // passes where it rests).
      if (b === n - 1 && returns && first.ms - s.ms <= PULSE_PEAK_MS) continue;
      for (const l of inner.slice(1)) if (d * (l.x - s.x) > need && (!hit || d * (l.x - s.x) > hit.by)) hit = { ms: l.ms, by: d * (l.x - s.x), move: toFirst };
    } else {
      const total = Math.abs(r.x - s.x);
      const d = Math.sign(r.x - s.x);
      const pulse = toFirst >= reach - 1e-9 && first.ms - s.ms <= PULSE_PEAK_MS && Math.sign(first.x - s.x) * (r.x - s.x) <= PULSE_RETURN * toFirst;
      if (pulse) continue;
      const need = Math.max(floor, OVERSHOOT_SHARE * total);
      for (const l of inner) if (d * (l.x - r.x) > need && (!hit || d * (l.x - r.x) > hit.by)) hit = { ms: l.ms, by: d * (l.x - r.x), move: total };
    }
    if (hit && !allow(hit)) return hit;
  }
  return null;
}

function overshootIn(frames: Frame[], v: number[], floor: number, eps: number, skip: (ms: number) => boolean, allow: (hit: Overshoot) => boolean = () => false, holdAt: Set<number> = new Set(), returns = true): Overshoot | null {
  let levels: Level[] = [];
  let cur: Leg | null = null;
  let still = 0;
  const holdSteps = Math.ceil(HOLD_MS / FRAME_MS - 1e-6);
  const leg = (s: number, d: number, startMs: number, extI: number, ext = s, extMs = startMs): Leg => ({ s, ext, d, startMs, extMs, extI, vmax: 0, dip: null });
  // A turn's frame can miss its true extreme by up to the frame step beside it.
  const slopAt = (k: number) => Math.max(k > 0 ? Math.abs(v[k]! - v[k - 1]!) : 0, k + 1 < v.length ? Math.abs(v[k + 1]! - v[k]!) : 0);
  // A turn the value holds still at for REST_FRAMES frame steps or more is held.
  const heldAt = (k: number) => {
    let n = 0;
    while (k + n + 1 < v.length && Math.abs(v[k + n + 1]! - v[k + n]!) <= eps) n++;
    return n >= REST_FRAMES;
  };
  const turn = (c: Leg): Level => ({ x: c.ext, ms: c.extMs, soft: false, slop: slopAt(c.extI), held: heldAt(c.extI) });
  /** Judge the chain that ends at level `x` at `ms`, held there or cut off. */
  const close = (x: number, ms: number, held: boolean): Overshoot | null => {
    if (cur && cur.d !== 0 && Math.abs(cur.ext - x) > eps && cur.extMs < ms) levels.push(turn(cur));
    return judgeChain([...levels, { x, ms, soft: false }], held, floor, allow, returns);
  };
  for (let i = 0; i < frames.length; i++) {
    const ms = frames[i]!.ms;
    const x = v[i]!;
    if (skip(ms)) { levels = []; cur = null; still = 0; continue; }
    if (cur === null) { cur = leg(x, 0, ms, i); levels = [{ x, ms, soft: false }]; continue; }
    const step = Math.abs(x - v[i - 1]!);
    const wasStill = still;
    still = step > eps ? 0 : still + 1;
    if (still >= holdSteps || holdAt.has(i)) {
      const hit = close(x, ms, true);
      if (hit) return hit;
      cur = leg(x, 0, ms, i);
      levels = [{ x, ms, soft: false }];
      continue;
    }
    if (cur.d === 0) {
      if (Math.abs(x - cur.s) > floor) Object.assign(cur, { d: Math.sign(x - cur.s), ext: x, extMs: ms, extI: i, vmax: step });
      continue;
    }
    const ahead = Math.sign(x - v[i - 1]!) === cur.d;
    // Held still for REST_FRAMES frame steps, then on the same way at any speed: it stopped there.
    if (wasStill >= REST_FRAMES && step > eps && ahead) {
      levels.push({ x: v[i - 1]!, ms: frames[i - 1]!.ms, soft: true });
      cur = { ...leg(v[i - 1]!, cur.d, frames[i - 1]!.ms, i, x, ms), vmax: step };
      continue;
    }
    if (step > cur.vmax) cur.vmax = step;
    if (step < 0.1 * cur.vmax && (cur.dip === null || step < cur.dip.v)) cur.dip = { x, v: step, ms };
    else if (cur.dip !== null && ahead && step > Math.max(2 * cur.dip.v, 0.2 * cur.vmax)) {
      levels.push({ x: cur.dip.x, ms: cur.dip.ms, soft: true });
      cur = { ...leg(cur.dip.x, cur.d, cur.dip.ms, i, x, ms), vmax: step };
      continue;
    }
    if (cur.d * (x - cur.ext) > 0) Object.assign(cur, { ext: x, extMs: ms, extI: i });
    else if (cur.d * (cur.ext - x) > Math.max(floor, OVERSHOOT_SHARE * cur.d * (cur.ext - cur.s))) {
      levels.push(turn(cur));
      cur = { ...leg(cur.ext, -cur.d, cur.extMs, i, x, ms), vmax: step };
    }
  }
  const last = frames.length - 1;
  return last >= 0 && cur ? close(v[last]!, frames[last]!.ms, false) : null;
}

/** Inside a designed loop, a settle may pass its rest by at most this share of its move. */
export const LOOP_OVERSHOOT = 0.5;

type PeriodicMemo = { frames: Promise<Frame[]>; byName: Map<string, Promise<Periodic | null>> };
const periodicMemo = new WeakMap<GatePage, PeriodicMemo>();
/** The loops idleSpan's probe found, by file, for the rule page to take over (the seek frames are the same). */
const probedLoops = new Map<string, PeriodicMemo>();

function periodicMemoOf(page: GatePage): PeriodicMemo {
  let memo = periodicMemo.get(page);
  if (!memo) {
    memo = { frames: page.frames(0, PERIODIC_SCAN_MS), byName: new Map() };
    periodicMemo.set(page, memo);
  }
  return memo;
}

/**
 * Whether value `name` on `page` is a designed loop (periodic.ts), read once per page and value. A value that moves on by
 * a step each period (a staircase), or whose swing grows or shrinks each period, is a loop only when what it adds up to over
 * the read (`drift`) is within its unit's floor, or in deg, a hand that ticks round: in any other unit it is a move that
 * never stops, however small each period's step.
 */
export function periodicFor(page: GatePage, name: string, unit: string | undefined): Promise<Periodic | null> {
  const memo = periodicMemoOf(page);
  let found = memo.byName.get(name);
  if (!found) {
    const frames = memo.frames;
    found = frames.then(async (fs) => {
      const floor = unitFloor(unit, rangeOf(series(fs, name)));
      const loop = await periodicOf(page, fs, name, floor);
      return loop && unit !== "deg" && drifted(loop.drift, floor) ? null : loop;
    });
    memo.byName.set(name, found);
  }
  return found;
}

/**
 * Overshoot: only motion a person caused may pass its rest and come back, and opacity never does.
 * Motion the input drives is left out, from the input's first sample until the page rests after
 * the last one (on a choreo or sim page, each caused window), and so are cuts. An opacity value is left out only until the input's last sample,
 * so the settle after a release is judged too. Below a unit's tolerance floor nothing is judged. A checked extent (an
 * edge of many moving parts, from a bar's trace.json `extents`) is left out. A designed loop
 * (periodicFor) may settle past its rest by up to LOOP_OVERSHOOT of its move, when each cycle holds still for
 * REST_FRAMES frame steps; before its lead-in ends it is judged as any other motion (on a choreo or sim page, a move a
 * cause started: the lead-in of a loop a tap starts may pass its rest, as a spring does).
 */
const overshoot: KindRule = {
  name: "overshoot",
  async check(page, ctx) {
    const frames = await page.frames(0, spanOf(ctx));
    const { units } = await page.state();
    const wins = await exemptWindows(page, frames, ctx);
    const samples = ctx.input?.samples ?? [];
    const lastSample = samples.length > 0 ? (samples[samples.length - 1] as number[])[0]! : null;
    // An opacity value is left out only while the hand acts: to the input's last sample, or on a
    // choreo or sim page to each cause's stop.
    const opacityWins: [number, number][] = isCaused(ctx)
      ? (ctx.causes ?? causesOf(ctx.input)).filter((c) => c.kind !== "load").map((c): [number, number] => [c.startMs, c.stopMs])
      : wins.map((w): [number, number] => [w[0], lastSample ?? w[1]]);
    const nearCut = (ms: number) => ctx.cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS);
    const stepped = new Set(ctx.stepped ?? []);
    const raw = stepped.size > 0 ? await page.rawFrames(0, spanOf(ctx)) : [];
    const extentSteps = await checkedExtents(page, ctx);
    const out: string[] = [];
    for (const name of valueNames(frames)) {
      // A checked extent turns when another part becomes the extreme one, not because a body passes its rest.
      if (extentSteps.has(name)) continue;
      const v = series(frames, name);
      // A stepped value's frames are its pose line, which glides through a held drawing: its chains end there too.
      const holdAt = stepped.has(name) ? heldDrawings(series(raw, name)) : new Set<number>();
      const unit = units[name];
      const opacity = unit === "opacity";
      const floor = unitFloor(unit, rangeOf(v));
      const loop = opacity ? null : await periodicFor(page, name, unit);
      // On a choreo or sim page a cause starts a loop's lead-in too (a spring that settles into a breath): from the cause that
      // started the loop until the loop starts, its move may pass its rest, as any move a person caused. A loop that moved
      // before the first cause is the page's own, and a tap in its lead-in does not make its spring the tap's.
      const born = loop && isCaused(ctx) ? firstMoveMs(frames, name) : null;
      const starter = born === null ? undefined : (ctx.causes ?? causesOf(ctx.input)).filter((c) => c.kind !== "load" && c.startMs <= born + 2 * FRAME_MS + 1e-6).pop();
      const lead: [number, number][] = loop && starter ? [[starter.startMs, loop.leadMs]] : [];
      const skip = (ms: number) => nearCut(ms) || (opacity ? opacityWins : [...wins, ...lead]).some((w) => ms >= w[0] - FRAME_MS - 1e-6 && ms <= w[1] + 1e-6);
      const hit = overshootIn(frames, v, floor, stillTol(v), skip, undefined, holdAt, !opacity);
      if (!hit) continue;
      const passes = `overshoot: ${name} passes its rest by ${round(hit.by)} at ${round(hit.ms)} ms`;
      // A designed loop may settle past its rest by up to LOOP_OVERSHOOT of its move, when each cycle holds still.
      if (loop && !loop.stillEachCycle) {
        out.push(`${passes} and comes back; a loop may settle past its rest only when each cycle holds still for ${REST_FRAMES} frames or more`);
        continue;
      }
      if (loop) {
        const over = overshootIn(frames, v, floor, stillTol(v), skip, (h) => h.ms >= loop.leadMs - 1e-6 && h.by <= LOOP_OVERSHOOT * h.move * (1 + 1e-9), holdAt);
        if (over && over.ms >= loop.leadMs - 1e-6) out.push(`overshoot: ${name} passes its rest by ${round(over.by)} at ${round(over.ms)} ms, ${Math.round((over.by / over.move) * 100)}% of its move; a loop may pass its rest by at most ${LOOP_OVERSHOOT * 100}% of its move`);
        else if (over) out.push(`overshoot: ${name} passes its rest by ${round(over.by)} at ${round(over.ms)} ms and comes back, before its loop starts; only motion a person caused may overshoot`);
        continue;
      }
      const why = opacity ? "opacity never overshoots" : "only motion a person caused may overshoot";
      out.push(`${passes} and comes back; ${why}`);
    }
    return out;
  },
};

/** The floor of each value but `loops` that `frames` (and a page with no frames, its units) hold: its unit's floor, at least LIVE_STILL. */
export function restFloors(frames: Frame[], units: Record<string, string>, loops: Set<string>): Record<string, number> {
  const names = new Set([...valueNames(frames), ...Object.keys(units)]);
  return Object.fromEntries([...names].filter((n) => !loops.has(n)).map((n) => [n, Math.max(LIVE_STILL, unitFloor(units[n], rangeOf(series(frames, n))))]));
}

/**
 * How far each value moves in one frame while the input plays (from a frame before its first sample to a frame after its
 * last), the most any frame step takes it. A live page reads the pointer once a frame, and the gate's pointer events
 * come on the wall clock, so the last move of the hand can reach a frame later than in the `?seek` run, or not at all: a value
 * the hand drives lands up to this far from where its `?seek` frames end (restApart's `slack`).
 */
export function inputSlack(seek: Frame[], input: InputSamples | null): Record<string, number> {
  if (!input || input.samples.length === 0) return {};
  const { start, end } = inputSpan(input);
  const inside = seek.filter((f) => f.ms >= start - FRAME_MS - 1e-6 && f.ms <= end + FRAME_MS + 1e-6);
  return Object.fromEntries(
    valueNames(seek).map((n) => {
      const v = series(inside, n);
      return [n, Math.max(0, ...v.slice(1).map((x, i) => Math.abs(x - v[i]!)).filter(Number.isFinite))];
    }),
  );
}

/**
 * The check of the live page's rest against the `?seek` frames' (loopStopsAtRest, and resumes after a return): the first
 * value but the loops whose live rest `values` is more than its tolerance from its `?seek` rest, the last frame of `seek`,
 * on either side, or that `values` does not report at all. The tolerance is the value's unit floor or its `slack`
 * (inputSlack), the greater. A page stops short of its `?seek` rest when its live loop ends early, and goes past it when it
 * overruns (a panel that flies on past its slot, a badge that grows to 3): both are a live page that does not play the
 * sequence the `?seek` frames show. A page that draws random values (a burst of particles) is expected to seed them as `?seek`
 * does, so that a live run lands where its `?seek` frames end; a page that draws unseeded random values live can fail this
 * compare. A value the `?seek` frames never report at the end is not compared. Null when every value meets its `?seek` rest.
 * A live page may run its frames longer than 1/60 s, but a page that has stopped lands where its `?seek` frames end,
 * whatever its frame times were.
 */
export function restApart(
  values: Record<string, number>,
  seek: Frame[],
  loops: Set<string>,
  units: Record<string, string>,
  slack: Record<string, number> = {},
): { name: string; live: number | null; seek: number } | null {
  const last = seek[seek.length - 1]?.values ?? {};
  for (const n of valueNames(seek).filter((x) => !loops.has(x))) {
    const sv = last[n];
    if (sv === undefined || !Number.isFinite(sv)) continue;
    const lv = values[n];
    if (lv === undefined || !Number.isFinite(lv)) return { name: n, live: null, seek: sv };
    const tol = Math.max(unitFloor(units[n], rangeOf(series(seek, n))), slack[n] ?? 0, 1e-6);
    if (Math.abs(lv - sv) > tol) return { name: n, live: lv, seek: sv };
  }
  return null;
}

/**
 * How long the gate lets a live page play before it looks for rest: the end of the sequence the `?seek` frames show (the last
 * move of a value that is no loop), or none when that move reaches the end of the scan, since a sequence that never ends in the
 * frames (span says so) has no end to wait for, and the live page is judged for rest where it stands.
 */
export function sequenceWaitMs(seek: Frame[], loops: Set<string>, ctx: RuleContext): number {
  const end = lastMoveMs(seek, loops) ?? 0;
  return end > loopScanEnd(ctx.causes ?? causesOf(ctx.input)) - REST_FRAMES * FRAME_MS + 1e-6 ? 0 : end;
}

/**
 * The loop stops at rest: 0 rAF callbacks in the second after rest. An idle page loops while it is on screen, so it is
 * checked at its still frame under reduced motion. On every other kind the page rests when every value but its loops
 * holds still after its sequence ends, as the `?seek` frames show it: a pause inside the sequence (a fade-out, a blank
 * beat, then the next element) is no rest. The gate drives the input, waits for the last move of the seek frames, then
 * for rest (waitForRest: each value's total change over the last second within its floor, on a page with a loop too);
 * every value but the loops must then rest where the seek frames do (restApart). A page with a loop keeps its clock
 * running, and its kind's rules check that the loop pauses off screen.
 */
const loopStopsAtRest: KindRule = {
  name: "loopStopsAtRest",
  async check(page, ctx) {
    const idle = ctx.kind === "idle";
    const loops = idle ? new Set<string>() : loopsIn(await rolesOf(page, ctx));
    const seek = idle ? [] : await page.frames(0, spanOf(ctx));
    const { units } = await page.state();
    const sequenceEnd = idle ? 0 : sequenceWaitMs(seek, loops, ctx);
    const live = await reopen(page, { seek: false, ...(idle ? { reducedMotion: true } : {}) });
    try {
      const t0 = performance.now();
      if (!idle) await drive(live, ctx);
      await sleep(Math.max(0, t0 + sequenceEnd - performance.now()));
      const rest = await waitForRest(live, 5000, loops, restFloors(seek, units, loops));
      if (rest === null) return [`loopStopsAtRest: the page is still moving 5 s after ${idle ? "it loads under reduced motion" : "the input ends"}`];
      // A loop keeps the clock running: on a page with one, the rest of the page resting is enough.
      if (loops.size === 0) {
        const n = await live.rafCountAfter(rest, 1000);
        if (n > 0) return [`loopStopsAtRest: ${n} rAF callbacks ran in the second after the page came to rest${idle ? " under reduced motion" : ""}`];
      }
      if (!idle) {
        const apart = restApart((await live.state()).values, seek, loops, units, inputSlack(seek, ctx.input));
        if (apart) return [`loopStopsAtRest: the live page comes to rest with ${apart.name} ${apart.live === null ? "never reported" : `at ${round(apart.live)}`}, where its ?seek frames end at ${round(apart.seek)}; the live loop stopped before its sequence ended`];
      }
      return [];
    } finally {
      await live.close();
    }
  },
};

const NOISY = /^(error|warning|assert|pageerror): /;

/**
 * The browser's own GL performance note, such as `GPU stall due to ReadPixels`. Chromium writes up to 4 of them in the
 * first WebGL context of a fresh browser; a page can neither cause nor stop them, and which page sees them depends on run
 * order. consoleClean leaves out this one warning. A page's own warning and every error still count.
 */
export const BROWSER_NOTE = /^warning: \[\.WebGL-[^\]]*\]GL Driver Message \([^)]*\bPerformance\b/;

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
        ...page.console().filter((m) => NOISY.test(m) && !BROWSER_NOTE.test(m)).map((m) => `consoleClean: ${m} (the ?seek run)`),
        ...live.console().filter((m) => NOISY.test(m) && !BROWSER_NOTE.test(m)).map((m) => `consoleClean: ${m} (the live run)`),
      ];
    } finally {
      await live.close();
    }
  },
};

/**
 * Two states are the same when every value sits within 2% of its range (at least 0.001). A value that comes back on
 * screen each time it moves on by a whole turn or step (`wraps`: 360 for an angle, a ticking loop's step) is compared
 * modulo each, within 2% of its range or of that turn, the less.
 */
function sameState(a: Record<string, number>, b: Record<string, number>, ranges: Map<string, number>, wraps: (n: string) => number[] = () => []): boolean {
  return [...ranges].every(([n, r]) => {
    const d = (a[n] ?? Number.NaN) - (b[n] ?? Number.NaN);
    if (Math.abs(d) <= Math.max(1e-3, 0.02 * r)) return true;
    return wraps(n).some((m) => Math.abs((((d % m) + 1.5 * m) % m) - 0.5 * m) <= Math.max(1e-3, 0.02 * Math.min(r, m)));
  });
}

/** An angle comes back on screen after a whole turn. */
const turns = (units: Record<string, string>) => (n: string) => (units[n] === "deg" ? [360] : []);

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

/**
 * Whether the input moves the loop `name`, beyond its own motion: in the frames `within` selects, `normal` (read with the
 * input) differs from `bare` (the same page read with no input) by more than `eps` and by more than the loop's own swing
 * (`swing`, its range over one period). A loop is left out of "answers the input" only as far as it explains the motion: a
 * value that is both dragged and a loop (the drag ends inside the loop's lead-in) still has to answer under reduced motion,
 * but a loop that begins at the release differs from the page with no input by its own swing at most, and holds still
 * under reduced motion by rule.
 */
function movedByInput(normal: Frame[], bare: Frame[], name: string, within: (f: Frame) => boolean, eps: number, swing: number): boolean {
  const alone = new Map(bare.map((f) => [f.ms, f.values[name]]));
  const gap = Math.max(eps, swing);
  return normal.filter(within).some((f) => Math.abs((f.values[name] ?? Number.NaN) - (alone.get(f.ms) ?? Number.NaN)) > gap);
}

/** `page`'s frames from 0 to `toMs` ms, read with no input. */
async function bareFrames(page: GatePage, toMs: number): Promise<Frame[]> {
  const bare = await reopen(page, { input: [] });
  try {
    return await bare.frames(0, toMs);
  } finally {
    await bare.close();
  }
}

/** `ranges` without the loops: a loop has no start or end state to show, so the blank-start check leaves it out. */
const withoutLoops = (ranges: Map<string, number>, loops: Set<string>) => new Map([...ranges].filter(([n]) => !loops.has(n)));

/**
 * The values of the loop `n` over one period of its swing: the page's frames over one period from when its lead-in ends
 * (periodicFor), or, for a loop periodicFor does not find, the later half of `normal`.
 */
async function swingOf(page: GatePage, normal: Frame[], n: string, units: Record<string, string>): Promise<number[]> {
  const found = await periodicFor(page, n, units[n]);
  const frames = found
    ? (await periodicMemoOf(page).frames).filter((f) => f.ms >= found.leadMs - 1e-6 && f.ms <= found.leadMs + found.periodMs + 1e-6)
    : normal.filter((f) => f.ms >= (normal[normal.length - 1]?.ms ?? 0) / 2);
  return frames.map((f) => f.values[n] ?? Number.NaN);
}

/**
 * The loops the blank-start check leaves out, of `loops`: those whose start state the loop comes back to. A steady value
 * (steadyStep) is left out unless it came to its speed from a faster one (neverFasterThan: a slide-on that comes to a slow
 * drift, an entrance whose last 500 ms look like a marquee's). A hand that turns on in deg is left out: it comes back after
 * a turn. Any other loop is left out when its start state lies inside its own swing, within the tolerance sameState allows:
 * the page's frames over one period from when its lead-in ends (periodicFor), or, for a loop periodicFor does not find,
 * the later half of `normal`. A loop whose swing no frames hold is left out too, since its swing is not known. A value
 * that fades in from 0 and then glows starts outside its swing: it is an entrance, though it loops after.
 */
async function restingLoops(page: GatePage, normal: Frame[], loops: Set<string>, units: Record<string, string>, ranges: Map<string, number>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const n of loops) {
    const drift = steadyStep(normal, n);
    if (drift !== null) {
      if (neverFasterThan(normal, n, drift)) out.add(n);
      continue;
    }
    if (units[n] === "deg") {
      out.add(n);
      continue;
    }
    const v = await swingOf(page, normal, n, units);
    const [lo, hi, start] = [Math.min(...v), Math.max(...v), normal[0]?.values[n] ?? Number.NaN];
    const tol = Math.max(1e-3, 0.02 * (ranges.get(n) ?? 0));
    if (v.length === 0 || !Number.isFinite(lo + hi + start) || (start >= lo - tol && start <= hi + tol)) out.add(n);
  }
  return out;
}

/**
 * A blank start state: a start the page leaves and never comes back to without reduced motion (an entrance). A value
 * that wraps (sameState) comes back when it has moved on by a whole turn. `ranges` holds the values it judges: the
 * callers leave the loops out (withoutLoops).
 */
function blankStill(normal: Frame[], reduced: Frame[], ranges: Map<string, number>, wraps: (n: string) => number[]): string[] {
  const same = (a: Record<string, number>, b: Record<string, number>) => sameState(a, b, ranges, wraps);
  const start = normal[0]?.values ?? {};
  const left = normal.findIndex((f) => !same(f.values, start));
  const blank = left >= 0 && normal.slice(left).every((f) => !same(f.values, start));
  const still = reduced[reduced.length - 1]?.values;
  return blank && still && same(still, start) ? ["reducedMotion: the still frame under reduced motion is the blank start state; show the end state instead"] : [];
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
  const loops = loopsIn(await rolesOf(page, ctx));
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
    if (!loops.has(n) && answers(normal) && !answers(rf)) out.push(`reducedMotion: ${n} answers the input without reduced motion, but not with it; input still answers under reduced motion`);
  }
  out.push(...blankStill(normal, rf, withoutLoops(ranges, await restingLoops(page, normal, loops, units, ranges)), turns(units)));
  return out;
}

/** Under reduced motion a choreo or sim page shows a state held at least this long, away from its start, in a sequence that comes back. */
export const HOLD_SHOWN_MS = 500;
/** The reduced-motion check on a choreo or sim page plays the last cause once more this long after its sequence ends. */
export const REDUCED_REPEAT_MS = 500;

/** A value's value at the last frame at or before `ms`. */
const valueAt = (frames: Frame[], ms: number, n: string) => [...frames].reverse().find((f) => f.ms <= ms + 1e-6)?.values[n] ?? Number.NaN;

/** Where a value holds still without reduced motion, from `from` to `to` ms, in the caused window that ends at `end` at `endLevel`. */
type Held = { name: string; level: number; from: number; to: number; cause: number; end: number; endLevel: number };

/**
 * Where each value in `names` holds still, without reduced motion, for HOLD_SHOWN_MS or longer, away from where it
 * started, in a caused window that ends where it began (a toast that slides in, holds and slides out). A window in which
 * the value goes back to its first frame from a start elsewhere is a replay: reduced motion may skip it.
 */
function heldStates(normal: Frame[], windows: [number, number][], names: string[], ranges: Map<string, number>, tol: (n: string) => number): Held[] {
  const held: Held[] = [];
  for (const n of names) {
    const eps = stillEps(ranges.get(n)!);
    for (const [s, e] of windows) {
      const start = valueAt(normal, s - FRAME_MS / 2, n);
      const endLevel = valueAt(normal, e, n);
      if (!(Math.abs(endLevel - start) <= tol(n))) continue;
      const first = normal[0]?.values[n] ?? Number.NaN;
      const run = normal.filter((f) => f.ms >= s - 1e-6 && f.ms <= e + 1e-6);
      if (!(Math.abs(start - first) <= tol(n)) && run.some((f) => Math.abs((f.values[n] ?? Number.NaN) - first) <= tol(n))) continue;
      let from = 0;
      for (let i = 1; i <= run.length; i++) {
        if (i < run.length && Math.abs((run[i]!.values[n] ?? 0) - (run[i - 1]!.values[n] ?? 0)) <= eps) continue;
        const level = run[from]!.values[n] ?? Number.NaN;
        if (run[i - 1]!.ms - run[from]!.ms >= HOLD_SHOWN_MS - 1e-6 && Math.abs(level - start) > tol(n)) held.push({ name: n, level, from: run[from]!.ms, to: run[i - 1]!.ms, cause: s, end: e, endLevel });
        from = i;
      }
    }
  }
  return held;
}

/**
 * Reduced motion on a choreo or sim page. The gate plays the page's input with its last cause played once more,
 * REDUCED_REPEAT_MS after its sequence ends (the toggle run), with and without reduced motion. Under reduced motion,
 * each value changes only in the frame the input changes or the one after it, or where it leaves a held state (below).
 * Each value but the loops:
 * - ends every caused window where it ends without reduced motion (within its unit floor or 2% of its range): input
 *   still answers, and reduced motion shows the end state. A value already at that end (an entrance shown finished,
 *   a sequence that replays, a shake that comes back) need not move; the repeat shows whether a second cause answers;
 * - in a window that ends where it began and is no replay, shows each state held HOLD_SHOWN_MS or longer away from
 *   that start, for as long as it holds. It may enter the state in one frame from the cause until the hold starts,
 *   and leave it in one frame, onto the sequence's end, from when the hold ends until the sequence ends.
 * The blank-start check reads the run up to the repeat.
 */
async function causedReduced(page: GatePage, ctx: RuleContext): Promise<string[]> {
  const loops = loopsIn(await rolesOf(page, ctx));
  const { units } = await page.state();
  const causes = ctx.causes ?? causesOf(ctx.input);
  const last = causes[causes.length - 1]!;
  const at = (lastMoveMs(await page.frames(0, spanOf(ctx)), loops) ?? last.stopMs) + REDUCED_REPEAT_MS;
  const input = repeatCause(ctx.input, last, at);
  const to = at + spanOf(ctx) - last.startMs;
  const run = async (reducedMotion: boolean) => {
    const p = await reopen(page, { input: input.samples, reducedMotion });
    try {
      return await p.frames(0, to);
    } finally {
      await p.close();
    }
  };
  const normal = await run(false);
  const rf = await run(true);
  const all = valueNames([...normal, ...rf]);
  const names = all.filter((n) => !loops.has(n));
  const ranges = new Map(all.map((n) => [n, Math.max(rangeOf(series(normal, n)), rangeOf(series(rf, n)))]));
  const tol = (n: string) => Math.max(unitFloor(units[n], ranges.get(n)!), 0.02 * ranges.get(n)!);
  const windows = causedWindows(normal, causesOf(input), loops);
  const held = heldStates(normal, windows, names, ranges, tol);
  const changes = inputChanges(input);
  const out: string[] = [];
  for (const n of all) {
    const v = series(rf, n);
    const eps = stillEps(ranges.get(n)!);
    for (let i = 1; i + 1 < rf.length; i++) {
      if (!(Math.abs(v[i + 1]! - v[i]!) > eps)) continue;
      const [a, b] = [rf[i]!.ms, rf[i + 1]!.ms];
      if (changes.some((c) => c > a - FRAME_MS - 1e-6 && c <= b + 1e-6)) continue;
      // The reduced path may enter a held state in one frame, from its cause until it holds, and leave it in one frame,
      // onto the sequence's end, from when it stops holding until the sequence ends.
      const lands = (h: Held, to: number) => h.name === n && Math.abs(v[i + 1]! - to) <= tol(n);
      if (held.some((h) => lands(h, h.level) && a >= h.cause - FRAME_MS - 1e-6 && a <= h.from + 1e-6)) continue;
      if (held.some((h) => lands(h, h.endLevel) && a >= h.to - 2 * FRAME_MS - 1e-6 && a <= h.end + 1e-6)) continue;
      out.push(`reducedMotion: ${n} still moves at ${round(a)} ms, more than one frame after the input last changed; under reduced motion the target is reached in 1 frame`);
      break;
    }
  }
  for (const n of names) {
    for (const [s, e] of windows) {
      const [nv, rv] = [valueAt(normal, e, n), valueAt(rf, e, n)];
      if (Math.abs(nv - rv) <= tol(n)) continue;
      const again = s >= at - 1e-6 ? `the cause played again at ${round(s)} ms` : `the cause at ${round(s)} ms`;
      out.push(`reducedMotion: ${n} rests at ${round(rv)} after ${again} under reduced motion, and at ${round(nv)} without it; reduced motion shows the sequence's end state`);
      break;
    }
    // The hold's last frame is where the page starts to leave it, so it need not show there.
    const missed = held.find((h) => h.name === n && rf.some((f) => f.ms >= h.from - 1e-6 && f.ms <= h.to - FRAME_MS + 1e-6 && !(Math.abs((f.values[n] ?? Number.NaN) - h.level) <= tol(n))));
    if (missed) out.push(`reducedMotion: ${n} holds at ${round(missed.level)} from ${round(missed.from)} to ${round(missed.to)} ms after the cause at ${round(missed.cause)} ms and comes back, but not under reduced motion; reduced motion shows a held state too`);
  }
  const before = (fs: Frame[]) => fs.filter((f) => f.ms < at - 1e-6);
  out.push(...blankStill(before(normal), before(rf), withoutLoops(ranges, await restingLoops(page, before(normal), loops, units, ranges)), turns(units)));
  return out;
}

/**
 * Reduced motion: input still answers, the target is reached in 1 frame, and the still frame is not
 * the blank start state. A choreo or sim page has its own check (causedReduced). The blank start state is a start the page leaves and never comes back to
 * without reduced motion (an entrance). A scroll page instead moves between stepped states (steppedStates).
 */
export const reducedMotion: KindRule = {
  name: "reducedMotion",
  async check(page, ctx) {
    if (ctx.kind === "scroll") return steppedStates(page, ctx);
    if (isCaused(ctx)) return causedReduced(page, ctx);
    const normal = await page.frames(0, spanOf(ctx));
    const reduced = await reopen(page, { reducedMotion: true });
    let rf: Frame[];
    try {
      // An idle page has no input, so under reduced motion nothing moves after its first frame: read it as long as
      // its loops are looked for, so a motion that starts late is seen.
      rf = await reduced.frames(0, ctx.kind === "idle" ? Math.max(spanOf(ctx), PERIODIC_SCAN_MS) : spanOf(ctx));
    } finally {
      await reduced.close();
    }
    const out: string[] = [];
    const { units } = await page.state();
    const loops = loopsIn(await rolesOf(page, ctx));
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
      const inSpan = (f: Frame) => f.ms >= start - 1e-6 && f.ms <= end + FRAME_MS + 1e-6;
      let bare: Promise<Frame[]> | undefined;
      for (const n of names) {
        if (!moves(normal, n) || moves(rf, n)) continue;
        if (loops.has(n)) {
          bare ??= bareFrames(page, normal[normal.length - 1]!.ms);
          if (!movedByInput(normal, await bare, n, inSpan, stillEps(ranges.get(n)!), rangeOf(await swingOf(page, normal, n, units)))) continue;
        }
        out.push(`reducedMotion: ${n} answers the input without reduced motion, but not with it; input still answers under reduced motion`);
      }
    }
    // A loop has no start or end state to show: the blank-start check leaves it out, a ticking hand and a marquee with it.
    out.push(...blankStill(normal, rf, withoutLoops(ranges, await restingLoops(page, normal, loops, units, ranges)), turns(units)));
    return out;
  },
};

/**
 * Stepped values (a bar's trace.json `stepped`): each must be a value the page reports, it must change over the
 * span, and it must move an object in `__state().objects`, whose length its drawings are judged in. A frozen value
 * marked stepped would hide nothing, but it marks nothing either.
 */
export const stepped: KindRule = {
  name: "stepped",
  async check(page, ctx) {
    const names = ctx.stepped ?? [];
    if (names.length === 0) return [];
    const frames = await page.rawFrames(0, spanOf(ctx));
    const reported = new Set(valueNames(frames));
    const owner = objectOf((await page.state()).objects);
    return names.flatMap((name) => {
      if (!reported.has(name)) return [`stepped: ${name} is not a value the page reports`];
      const out = rangeOf(series(frames, name)) > 0 ? [] : [`stepped: ${name} never changes`];
      if (!owner.has(name)) out.push(`stepped: ${name} moves no object; a stepped value names its object in __state().objects`);
      return out;
    });
  },
};

/**
 * The first peak in frames `from` to `end` of `v` (a local extreme of its distance from `start`) that is further out
 * than an earlier peak by more than `floor`, with that earlier peak's distance; null when the swings never grow. A
 * peak is the last frame of a run at its height, so a hold at the top counts once. A peak within `floor` of `start` is
 * noise, not a swing, and does not count.
 */
function swingGrows(frames: Frame[], v: number[], from: number, end: number, start: number, floor: number): { ms: number; d: number; d0: number } | null {
  let lowest = Number.POSITIVE_INFINITY;
  for (let i = from + 1; i < end; i++) {
    const d = Math.abs(v[i]! - start);
    if (d <= floor || !(d >= Math.abs(v[i - 1]! - start) && d > Math.abs(v[i + 1]! - start))) continue;
    if (d - lowest > floor) return { ms: frames[i]!.ms, d, d0: lowest };
    lowest = Math.min(lowest, d);
  }
  return null;
}

/**
 * Tweens (a bar's trace.json `tweens`): a control that acts out its meaning with a keyframe tween beside the bodies, a
 * tile that bobs or shakes as it is tapped. The sim gate's `energyFalls` leaves a named value out: a CSS ease segment
 * ends at zero speed and the next starts at 0.4 of its mean speed, which reads as a bounce that rises, and a kick at a
 * body's apex looks the same, so motion alone cannot tell them apart. So the name is guarded: each must be a value the
 * page reports, it must change, and after every cause it must end where it was just before that cause (within its
 * unit's floor) and hold still there. A thrown body lands elsewhere, so it cannot be named. A window a later cause cuts
 * off while the value still moves is not read at its end, and the next window's start is the home the value left.
 * A returning body would pass all that, a ball that hops 10, 20, then 40 px and lands at 0 each time, so inside each
 * window the peaks (the value's local extremes, as distance from home) must not grow: a bob has equal peaks, a shake
 * falling ones, and a later peak further out than an earlier one by more than the floor is a bounce that rises. A
 * peak within the floor of home is noise and does not count. A small dip before a larger swing (an anticipation) reads
 * as a swing that grows, so it is left out of the class. Only a
 * sim page may name tweens.
 */
export const tweens: KindRule = {
  name: "tweens",
  async check(page, ctx) {
    const names = ctx.tweens ?? [];
    if (names.length === 0) return [];
    if (ctx.kind !== "sim") return ["tweens: only a sim page may name tweens"];
    const frames = await page.frames(0, spanOf(ctx));
    const reported = new Set(valueNames(frames));
    const { units } = await page.state();
    const causes = ctx.causes ?? causesOf(ctx.input);
    const hint = "a tween comes back to where it started and holds there";
    return names.flatMap((name) => {
      if (!reported.has(name)) return [`tweens: ${name} is not a value the page reports`];
      const v = series(frames, name);
      const range = rangeOf(v);
      if (!(range > 0)) return [`tweens: ${name} never changes`];
      const [eps, floor] = [stillEps(range), unitFloor(units[name], range)];
      let home: number | null = null;
      for (let k = 0; k < causes.length; k++) {
        const to = frames.findIndex((f) => f.ms > (causes[k + 1]?.startMs ?? Number.POSITIVE_INFINITY) + 1e-6);
        const end = to < 0 ? frames.length - 1 : to - 1;
        const from = frames.reduce((at, f, i) => (f.ms <= causes[k]!.startMs + 1e-6 ? i : at), 0);
        const last = k + 1 === causes.length;
        const still = end - REST_FRAMES >= from && v.slice(end - REST_FRAMES, end + 1).every((x, i, w) => i === 0 || Math.abs(x - w[i - 1]!) <= eps);
        const at = `after the cause at ${round(causes[k]!.startMs)} ms`;
        const start = home ?? v[from]!;
        const swing = swingGrows(frames, v, from, end, start, floor);
        if (swing) return [`tweens: ${name} swings further from home at ${round(swing.ms)} ms (${round(swing.d)} after ${round(swing.d0)}); a tween's swings never grow`];
        if (!still) {
          if (last) return [`tweens: ${name} still moves at the end of the frames ${at}; ${hint}`];
          home ??= v[from]!;
          continue;
        }
        if (Math.abs(v[end]! - start) > floor) return [`tweens: ${name} ends at ${round(v[end]!)} ${at}, not at ${round(start)} where it was just before it; ${hint}`];
        home = null;
      }
      return [];
    });
  },
};

/**
 * Objects: the record a page reports in `__state().objects` is whole in every frame the rules read, each `px` value
 * moves its box, and each box spike has a cause (objects.ts `checkObjects`). A page that reports none passes.
 */
export const objects: KindRule = {
  name: "objects",
  async check(page, ctx) {
    const frames = await page.rawFrames(0, spanOf(ctx));
    const s = await page.state();
    const { width, height } = await page.viewport();
    return checkObjects(frames, s.objects, valueNames(frames), s.units, width, height, ctx.kind === "scroll", ctx.cuts);
  },
};

/**
 * Extents (a bar's trace.json `extents`): a value that is an edge of many moving parts, such as the box around 24 cards
 * on one canvas. It turns when another part becomes the extreme one, not because a body passes its rest, so a checked
 * extent has no pulse attack bound in the envelope and is left out of `overshoot`; pops, fades, values and every kind
 * rule still read it. The name is guarded (extents.ts `checkExtents`): in every frame the value is that edge of the union
 * of its drawn parts' boxes, within the px floor; the parts are a group; the edge passes from one part to another at least
 * once; and no part turns round and comes to rest while it holds the edge. So a single body cannot be named, with a part beside it or
 * without. A page that declares none passes. The `drawn` rule checks each part's box against the screen.
 */
export const extents: KindRule = {
  name: "extents",
  async check(page, ctx) {
    const declared = ctx.extents ?? {};
    if (Object.keys(declared).length === 0) return [];
    return extentLines(page, ctx, declared);
  },
};

/** The `extents:` lines for `declared` on the frames the rules read (the same read as `objects`). */
async function extentLines(page: GatePage, ctx: RuleContext, declared: Extents): Promise<string[]> {
  const frames = await page.rawFrames(0, spanOf(ctx));
  const s = await page.state();
  const { width, height } = await page.viewport();
  return checkExtents(frames, declared, s.objects, s.units, width, height);
}

/** The steps of a checked extent where who is in its union changes, by the frame's time in whole microseconds: how far the edge moved over the parts drawn in both frames. */
type MembershipSteps = Map<number, number>;

/** checkedExtents' results, by page: one read of the guard serves the envelope and overshoot rules. */
const checkedByPage = new WeakMap<GatePage, Promise<Map<string, MembershipSteps>>>();

/**
 * The declared extents whose guard passes, by value name: the values the envelope's pulse attack and `overshoot` leave
 * out. Each maps to its membership steps: the frame steps where a part comes back or goes gone, with how far the edge
 * moved in that step over the parts drawn in both frames (membershipSteps). The envelope reads the extent as its parts
 * moved it (`byMotion`).
 */
export function checkedExtents(page: GatePage, ctx: RuleContext): Promise<Map<string, MembershipSteps>> {
  const declared = ctx.extents ?? {};
  if (Object.keys(declared).length === 0) return Promise.resolve(new Map());
  let known = checkedByPage.get(page);
  if (!known) {
    known = (async () => {
      // The envelope reads SETTLE_MS past the span, and so does the membership.
      const frames = await page.rawFrames(0, spanOf(ctx) + SETTLE_MS);
      const { width, height } = await page.viewport();
      const out = new Map<string, MembershipSteps>();
      for (const [name, e] of Object.entries(declared)) {
        if ((await extentLines(page, ctx, { [name]: e })).length > 0) continue;
        out.set(name, new Map([...membershipSteps(frames, e, width, height)].map(([ms, change]) => [Math.round(ms * 1000), change])));
      }
      return out;
    })();
    checkedByPage.set(page, known);
  }
  return known;
}

/**
 * `frames` with each checked extent's value read as its parts moved it: in a step where a part comes back or goes gone
 * the edge's own jump (who is in the union changed) is replaced by how far the edge moved over the parts drawn in both
 * frames, and every other step is the edge's own. So the envelope's pop test and its whole change see the motion alone: a
 * card that jumps in the step in which another comes back is a pop, and the arrival of the first cards, which swings the
 * edge across the viewport, no longer makes it small. A frame without a number is left as it is.
 */
function byMotion(frames: Frame[], steps: Map<string, MembershipSteps>): Frame[] {
  if (steps.size === 0) return frames;
  const acc = new Map<string, number>();
  return frames.map((f, i) => {
    let values = f.values;
    for (const [name, at] of steps) {
      const x = f.values[name];
      const before = i > 0 ? frames[i - 1]!.values[name] : undefined;
      if (x === undefined || !Number.isFinite(x)) {
        acc.delete(name);
        continue;
      }
      const last = acc.get(name);
      const moved = before === undefined || !Number.isFinite(before) ? undefined : (at.get(Math.round(frames[i - 1]!.ms * 1000)) ?? x - before);
      const next = last === undefined || moved === undefined ? x : last + moved;
      acc.set(name, next);
      if (values === f.values) values = { ...f.values };
      values[name] = next;
    }
    return values === f.values ? f : { ...f, values };
  });
}

/**
 * Drawn: the boxes in a page's object record hold what changes on screen, judged on screenshot pairs (drawn.ts). A
 * page that reports no objects passes. Its notes go to the run's notes.
 */
export const drawn: KindRule = {
  name: "drawn",
  async check(page, ctx) {
    const read = await drawnRead(page, { ...ctx, spanMs: spanOf(ctx) });
    ctx.notes?.push(...read.notes);
    return read.lines;
  },
};

/**
 * Values: each value the page reports is a finite number in every frame, from the first frame that holds it on. A
 * value that turns NaN or Infinity, or goes missing, for a frame hides what it does there from every other rule, while
 * the renderer drops the bad frame and the value jumps.
 */
export const values: KindRule = {
  name: "values",
  async check(page, ctx) {
    // An idle page is read as long as its loops are looked for, as under reduced motion: a bad frame may come late.
    const frames = await page.rawFrames(0, ctx.kind === "idle" ? Math.max(spanOf(ctx), PERIODIC_SCAN_MS) : spanOf(ctx));
    const out: string[] = [];
    for (const name of valueNames(frames)) {
      const first = frames.findIndex((f) => Object.hasOwn(f.values, name));
      const at = (f: Frame) => (Object.hasOwn(f.values, name) ? f.values[name] : undefined);
      const bad = frames.findIndex((f, i) => i >= first && !Number.isFinite(at(f)));
      if (bad < 0) continue;
      const x = at(frames[bad]!);
      out.push(`values: ${name} is ${x === undefined ? "missing" : String(x)} at ${round(frames[bad]!.ms)} ms; a value the page reports is a finite number in every frame once it appears`);
    }
    return out;
  },
};

/**
 * Sudden jumps: no value moves in one frame step what it should spread over the step (self-checks.ts suddenJumps). The
 * gate seeks each step that moves a share of the value's range, or far more than the steps beside it, at sub-steps, and
 * judges whether the change lands in one of them. A value that is not a finite number in every frame is for `values`,
 * and a stepped value is read on its drawings by `stepped`, so both are left out. A page that moves a value in whole
 * frames only cannot be read between frames: the run of steps is skipped with a note.
 */
export const suddenJumpsRule: KindRule = {
  name: "suddenJumps",
  async check(page, ctx) {
    const span = spanOf(ctx);
    const frames = await page.frames(0, span);
    const drawings = new Set(ctx.stepped ?? []);
    const names = valueNames(frames).filter((n) => !drawings.has(n) && series(frames, n).every(Number.isFinite));
    return suddenJumps(page, names, ctx.cuts, span, ctx.input, [], ctx.kind === "scroll", ctx.notes, frames, await checkedExtents(page, ctx));
  },
};

export const ALL_RULES: KindRule[] = [envelope, overshoot, loopStopsAtRest, consoleClean, reducedMotion, stepped, tweens, objects, extents, drawn, values, suddenJumpsRule];

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

type Trace = { input?: { kind?: unknown; samples?: unknown }; cuts?: unknown; samples?: unknown; stepped?: unknown; tweens?: unknown; extents?: unknown };

/** The values a trace marks as stepped (held in drawings on purpose), or none. */
export const steppedOf = (trace: { stepped?: unknown } | undefined): string[] =>
  Array.isArray(trace?.stepped) ? trace.stepped.filter((n): n is string => typeof n === "string") : [];

/** The values a trace marks as a control's keyframe tween (the sim gate's energyFalls leaves them out), or none. */
export const tweensOf = (trace: { tweens?: unknown } | undefined): string[] =>
  Array.isArray(trace?.tweens) ? trace.tweens.filter((n): n is string => typeof n === "string") : [];

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

/**
 * A bar's own recorded input (trace.json `input`), or null when the page plays the synthetic input: a live bar's
 * drag (2 samples or more), or a choreo or sim bar's pointer or scroll input (1 sample or more).
 */
function recordedInput(kind: KindName, trace: Trace | undefined): InputSamples | null {
  const input = trace?.input;
  if (!Array.isArray(input?.samples)) return null;
  if (kind === "live" && input.kind === "pointer" && input.samples.length >= 2) return input as InputSamples;
  if (CAUSED_KINDS.includes(kind) && (input.kind === "pointer" || input.kind === "scroll") && input.samples.length >= 1) return input as InputSamples;
  return null;
}

/** When the first of `causes` starts. */
const firstCauseMs = (causes: Cause[]) => Math.min(...causes.map((c) => c.startMs));

/** When the last cause in `input` stops, or 0 with none. */
const lastStop = (input: InputSamples | null) => Math.max(0, ...causesOf(input).map((c) => c.stopMs));

/**
 * How far the gate reads a choreo or sim page to sort its loops from its sequences: LOOP_SCAN_MS, or SEQUENCE_SCAN_MS
 * past the last cause's stop, the later. causedSpan finds where the sequence ends and rolesOf sorts the loops, both over
 * this one read, so they agree on what loops.
 */
export const loopScanEnd = (causes: Cause[]) => Math.max(LOOP_SCAN_MS, Math.max(0, ...causes.map((c) => c.stopMs)) + SEQUENCE_SCAN_MS);

/**
 * Where the sequence `input` starts ends on `page` (open with that input): the last move of a value that is no loop, looked
 * for up to SEQUENCE_SCAN_MS past the last cause's stop, and whether a value still moves at the end of that read (`cut`). A
 * choreo or sim page's loops are sorted with its first cause (loopSet's `causeMs`), as rolesOf does.
 */
async function sequenceEnd(page: GatePage, input: InputSamples, cuts: number[], causeMs?: number): Promise<{ endMs: number; cut: boolean }> {
  const scan = loopScanEnd(causesOf(input));
  const frames = await page.frames(0, scan);
  const end = lastMoveMs(frames, await loopSet(page, frames, cuts, causeMs)) ?? 0;
  return { endMs: end, cut: end > scan - REST_FRAMES * FRAME_MS + 1e-6 };
}

/**
 * How far the rules read on a choreo or sim page playing `input` (open on `page`): CAUSE_SETTLE_MS past the last
 * cause's stop, or SETTLE_MS past the end of the sequence it starts, the later (sequenceEnd).
 */
async function causedSpan(page: GatePage, input: InputSamples, cuts: number[]): Promise<{ spanMs: number; cut: boolean }> {
  const { endMs, cut } = await sequenceEnd(page, input, cuts, firstCauseMs(causesOf(input)));
  return { spanMs: Math.max(lastStop(input) + CAUSE_SETTLE_MS, endMs + SETTLE_MS), cut };
}

/** A choreo or sim page still moving SEQUENCE_SCAN_MS past the last cause's stop: the rules do not read its end. */
export const sequenceCutLine = (input: InputSamples | null) =>
  `span: a value still moves ${SEQUENCE_SCAN_MS} ms after the last cause stops at ${round(lastStop(input))} ms; the rules read a sequence for ${SEQUENCE_SCAN_MS / 1000} s at most`;

/**
 * A choreo or sim page's input and span. A bar plays its recorded input. Any other page gets the synthetic tap after
 * its load motion; when no value answers the tap within TAP_PROBE_MS, the page starts by itself, and the gate judges
 * its load motion with no input. The rules read to the end of the sequence the input starts (causedSpan).
 */
async function causedInputAndSpan(file: string, kind: KindName, trace: Trace | undefined): Promise<InputAndSpan> {
  const recorded = recordedInput(kind, trace);
  const cuts = Array.isArray(trace?.cuts) ? trace.cuts.filter((c): c is number => typeof c === "number") : [];
  const stepped = steppedOf(trace);
  if (recorded) {
    const page = await openPage(file, { input: recorded.samples, stepped });
    try {
      const { spanMs, cut } = await causedSpan(page, recorded, cuts);
      return { input: recorded, spanMs: Math.max(recordedSpan(recorded, rowTimes(trace)), spanMs), cut };
    } finally {
      await page.close();
    }
  }
  // A bar whose original had no input starts on load, as its trace does: no tap.
  if (trace?.input?.kind === "none") return { input: null, spanMs: Math.max(SPAN_MS, CAUSE_SETTLE_MS, ...rowTimes(trace).map((t) => t + SETTLE_MS)) };
  let quiet: GatePage | undefined;
  let tapped: GatePage | undefined;
  let start = INPUT_START_MS;
  let answers = true;
  let span = { spanMs: 0, cut: false };
  try {
    quiet = await openPage(file, { stepped });
    start = inputStartAfter(await quiet.frames(0, LOAD_SCAN_MS));
    const tap = syntheticInput(kind, start)!;
    tapped = await openPage(file, { input: tap.samples, stepped });
    const [a, b] = [await quiet.frames(start, start + TAP_PROBE_MS), await tapped.frames(start, start + TAP_PROBE_MS)];
    const names = valueNames([...a, ...b]);
    answers = names.some((n) => {
      const eps = stillEps(Math.max(rangeOf(series(a, n)), rangeOf(series(b, n))));
      return a.some((f, i) => Math.abs((f.values[n] ?? Number.NaN) - (b[i]?.values[n] ?? Number.NaN)) > eps);
    });
    if (answers) span = await causedSpan(tapped, tap, cuts);
  } catch (e) {
    // As inputAndSpan: a page that cannot open fails the gate's start; one with no clock hook fails noHook.
    if (!quiet) throw e;
  } finally {
    await quiet?.close();
    await tapped?.close();
  }
  if (!answers) return { input: null, spanMs: Math.max(SPAN_MS, start + CAUSE_SETTLE_MS) };
  const input = syntheticInput(kind, start)!;
  return { input, spanMs: Math.max(SPAN_MS + (start - INPUT_START_MS), lastStop(input) + CAUSE_SETTLE_MS, span.spanMs), cut: span.cut };
}

/**
 * The input the gate plays and how far the rules' seek frames reach. A live bar plays its recorded drag, over its
 * recordedSpan. Every other page with input plays the synthetic input, which waits for the page's load motion to end
 * (inputStartAfter).
 */
/** The input the gate plays, how far the rules read, and whether a choreo or sim sequence runs past what they read. */
type InputAndSpan = { input: InputSamples | null; spanMs: number; cut?: boolean };

async function inputAndSpan(file: string, kind: KindName, trace: Trace | undefined): Promise<InputAndSpan> {
  if (CAUSED_KINDS.includes(kind)) return causedInputAndSpan(file, kind, trace);
  const recorded = recordedInput(kind, trace);
  if (recorded) return { input: recorded, ...(await liveSpan(file, recorded, recordedSpan(recorded, rowTimes(trace)), trace)) };
  if (syntheticInput(kind) === null) return { input: null, spanMs: await idleSpan(file, trace) };
  let probe: GatePage | undefined;
  let start = INPUT_START_MS;
  try {
    probe = await openPage(file, { stepped: steppedOf(trace) });
    start = inputStartAfter(await probe.frames(0, LOAD_SCAN_MS));
  } catch (e) {
    // A page that cannot open is the gate failing to start: the CLI exits 2. A page with no clock hook opens but
    // cannot be scanned; the noHook check reports that.
    if (!probe) throw e;
  } finally {
    await probe?.close();
  }
  const input = syntheticInput(kind, start);
  return { input, ...(await liveSpan(file, input!, SPAN_MS + (start - INPUT_START_MS), trace)) };
}

/**
 * How far the rules read a live or scroll page playing `input`: `floorMs` (SPAN_MS past the input's start, or a recorded
 * input's span), or SETTLE_MS past the end of the sequence the input starts, the later. A page's toast that holds 4 s, its
 * beat, its second element all happen before that end: the end is where the page stops (sequenceEnd), not a fixed time.
 */
async function liveSpan(file: string, input: InputSamples, floorMs: number, trace: Trace | undefined): Promise<{ spanMs: number; cut?: boolean }> {
  const cuts = Array.isArray(trace?.cuts) ? trace.cuts.filter((c): c is number => typeof c === "number") : [];
  let page: GatePage | undefined;
  try {
    page = await openPage(file, { input: input.samples, stepped: steppedOf(trace), steppedInputRaw: true });
    const { endMs, cut } = await sequenceEnd(page, input, cuts, firstCauseMs(causesOf(input)));
    return { spanMs: Math.max(floorMs, endMs + SETTLE_MS), cut };
  } catch (e) {
    // As above: a page that cannot open fails the gate's start; one with no clock hook fails noHook.
    if (!page) throw e;
    return { spanMs: floorMs };
  } finally {
    await page?.close();
  }
}

/**
 * How far the rules read an idle page: SPAN_MS, through the lead-in and IDLE_PERIODS_READ periods of its longest designed
 * loop (periodic.ts), or SETTLE_MS past the last move of a value that is no designed loop, the latest, and at most
 * PERIODIC_SCAN_MS, the frames the loops are found in, or a copied bar's last trace row. So a pop, a spring or a settle late in a long loop, or a
 * one-time move after 3 s, is read, and a loop that comes back to its start comes back inside the read.
 */
async function idleSpan(file: string, trace: Trace | undefined): Promise<number> {
  let probe: GatePage | undefined;
  try {
    probe = await openPage(file, { stepped: steppedOf(trace) });
    const { units } = await probe.state();
    const memo = periodicMemoOf(probe);
    const frames = await memo.frames;
    let span = SPAN_MS;
    const loops = new Set<string>();
    for (const n of valueNames(frames)) {
      const loop = await periodicFor(probe, n, units[n]);
      if (!loop) continue;
      loops.add(n);
      span = Math.max(span, loop.leadMs + IDLE_PERIODS_READ * loop.periodMs);
    }
    const last = lastMoveMs(frames, loops);
    if (last !== null) span = Math.max(span, last + SETTLE_MS);
    probedLoops.set(file, memo);
    // A copied bar that lists cuts lists them only as far as its trace runs: the rules read it no further.
    const rows = Array.isArray(trace?.cuts) && trace.cuts.length > 0 ? rowTimes(trace) : [];
    return Math.min(span, PERIODIC_SCAN_MS, rows.length > 0 ? Math.max(SPAN_MS, ...rows) : Number.POSITIVE_INFINITY);
  } catch (e) {
    // As inputAndSpan: a page that cannot open fails the gate's start; one with no clock hook fails noHook.
    if (!probe) throw e;
    return SPAN_MS;
  } finally {
    await probe?.close();
  }
}

/**
 * The input the kind gate would play on `file` and how far its seek frames reach. A page with no marker, an unknown
 * kind or a kind with no gate plays no input over SPAN_MS. The frame sheet draws the page with this, so it shows what
 * the gate judges.
 */
export async function pageInput(file: string): Promise<{ input: InputSamples | null; spanMs: number }> {
  const picked = pageKind(readFileSync(file, "utf8"), file);
  if ("failure" in picked || !KIND_RULES[picked.kind as KindName]) return { input: null, spanMs: SPAN_MS };
  return inputAndSpan(file, picked.kind as KindName, traceOf(path.dirname(file), picked.bar));
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
  const { input, spanMs, cut } = await inputAndSpan(file, kind, trace);
  const stepped = steppedOf(trace);
  const ctx: RuleContext = { kind, input, cuts, spanMs, causes: causesOf(input), stepped, tweens: tweensOf(trace), extents: extentsOf(trace), notes: [] };
  // On a live or scroll page the input drives the motion: inside the input window, stepped values read as drawings.
  const steppedInputRaw = kind === "live" || kind === "scroll";
  let opened: Promise<GatePage> | undefined;
  const page = () =>
    (opened ??= openPage(file, { ...(ctx.input ? { input: ctx.input.samples } : {}), stepped, steppedInputRaw }).then((p) => {
      // An idle page's probe already looked for its loops on the same seek frames.
      const probed = ctx.input ? undefined : probedLoops.get(file);
      if (probed) periodicMemo.set(p, probed);
      probedLoops.delete(file);
      return p;
    }));
  const checks: Record<string, Check> = {
    audit: () => audited.failures,
    noHook: async () => noHook(await page()),
    zeroFrames: async () => zeroFrames(await (await page()).frames(0, spanMs)),
    span: () => [...inputPastSpan(input, spanMs), ...(cut ? [sequenceCutLine(input)] : [])],
  };
  for (const r of [...ALL_RULES, ...rules]) checks[r.name] = async () => r.check(await page(), ctx);
  try {
    return { ...(await runChecks(checks)), kind, distances: audited.distances, notes: [...notes, ...ctx.notes!] };
  } finally {
    if (opened) await opened.then((p) => p.close()).catch(() => undefined);
  }
}
