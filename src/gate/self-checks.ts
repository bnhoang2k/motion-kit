import { TOLERANCE_FLOORS } from "../core/trace.ts";
import { causesOf } from "./causes.ts";
import { FRAME_MS, openPage, replayInput, type Frame, type GatePage, type InputSamples } from "./harness.ts";
import { explainedBy, fitSlopes, NOTHING_EXPLAINED, objectOf, type ObjectRecord } from "./objects.ts";
import { drawingsOf, stepPops, type StepPop } from "./poses.ts";
import { series as seriesOf, stillEps, stillTol, unitFloor } from "./series.ts";
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

/** suddenJumps looks closer at a frame step when the value moves at least this share of its whole range in it... */
const JUMP_SHARE = 0.05;
/**
 * ...or when the step moves more than this many times the larger frame step beside it (a long move hides a jump of
 * under JUMP_SHARE of its range, but the jump stands out from the steps beside it). A step jumps when it moves more
 * than this many times the step beside it. suddenJumps uses it to judge a step against the steps beside it, and
 * against the input's step in the same frame, and the live regrab rule to judge a press.
 */
export const JUMP_FACTOR = 2.5;

/**
 * A page that moves a value in whole frames only (its seek ignores the part of a frame past the last whole one) shows
 * a hold and a jump at every frame boundary. The sub-steps cannot tell that from a snap, so a run of this many frames
 * in a row, each of which holds and then jumps, is the page's own clock, not a jump.
 */
const WHOLE_FRAME_RUN = 4;

/**
 * Every step that moves enough to examine is seeked again at this many even sub-steps, to tell a speed corner, an ease
 * or a fast tween from a jump. See SPANS for how the sub-steps are judged.
 */
const SUB_STEPS = 8;

/**
 * The widths, in sub-steps, of the spans suddenJumps judges. A jump lands in one sub-step, but a tween of a few
 * milliseconds is a jump at 60 fps and can split over two to four adjacent sub-steps, which would clear each other as
 * neighbours. A span of w sub-steps may move at most JUMP_FACTOR times the larger of the two spans of the same width
 * beside it, so a jump stands out at the width it lands in. An ease or a speed corner changes gradually, so every span
 * of it has a neighbour of about the same size. The sub-steps are real: suddenJumps seeks SUB_STEPS of them on each side
 * of the step too, and a span may cross the frame edge, so a sharp ease or a spring is compared with its own next
 * sub-steps and not with the frame's average speed.
 */
const SPANS = [1, 2, 4];

/**
 * The share of its frame step's change a span must carry to count as a jump. A measured value, such as the centre of
 * a cloud of grains that die one by one, can kink by a fraction of a pixel between sub-steps; next to a still or
 * kinked neighbour that tiny span stands out by ratio, though nothing on screen jumps. Every jump a viewer sees carries
 * far more of its frame: a hold, a jump and a hold carries all of it; a jump of half the speed inside a 100 px a frame
 * move carries 62.5 of 150.
 */
const JUMP_CARRIES = 1 / 3;

/**
 * A steep ease has a cusp: a power-law point |t|^a (0 < a < 1) where the speed has no bound and the value does not jump.
 * circInOut (Motion, GSAP, Penner) has a square root (a = 1/2) at its midpoint, and cubic-bezier(1,0,0,1), a plain CSS
 * ease, has a cube root (a = 1/3). The sub-steps at the cusp stand out from their neighbours by a ratio that grows as
 * the ease gets steeper (2.6 to 2.9 for the square root, 4.2 to 5.2 for the cube root), so no cap on the ratio can
 * tell a cusp from a jump. What tells them apart is the largest change in a window of the frame step as the window is
 * cut in half: a cusp's shrinks by about 2^-a (0.71 for a square root, 0.80 for a cube root, 0.82 for the start of
 * cubic-bezier(0,1,0,1)), a jump's keeps its size, since a jump lands in one window however narrow the window is (0.98
 * to 1.0 for a jump in a smooth move). The smallest jump that is examined at all, a third of a fast ramp's frame step,
 * goes 0.86 and then 0.92, since its smooth part shrinks and only that: that is the nearest a jump comes to a cusp.
 *
 * The frame step is read once at CUSP_FINE even sub-steps, and CUSP_EDGE sub-steps past each end of it, and the windows
 * slide over them (CUSP_WINDOWS sub-steps wide: 1/8, 1/16 and 1/32 of a frame); a window counts when it overlaps the
 * frame. Sliding makes the factor the same wherever in a sub-step the cusp falls: the largest single sub-step of each
 * grid would swing between 0.5 and 1.0 with the cusp's place, since the cell that holds the cusp's start can end at the
 * same time on three grids in a row. Reading past the frame's ends keeps a cusp in the last or first tenth of the frame
 * whole: an ease-out that leaves a hold at a vertical tangent late in the frame kept 1.0 at the first halving when the
 * read stopped at the frame's end.
 *
 * A step that stands out is a cusp, not a jump, when its largest window falls to at most CUSP_SHRINK of the one before at
 * both halvings (the second halving is 0.92 at the least for a jump, and 0.84 at the most for a cusp, so CUSP_SHRINK
 * sits between them).
 */
const CUSP_SHRINK = 0.88;
const CUSP_FINE = 256;
const CUSP_WINDOWS = [CUSP_FINE / 8, CUSP_FINE / 16, CUSP_FINE / 32] as const;
const CUSP_EDGE = CUSP_WINDOWS[0];

/**
 * A tween of a few milliseconds shrinks as the sub-steps get finer too (by 0.5, once they are shorter than it is), so
 * the shrink alone would call a flick of 2 to 20 ms a cusp. What a cusp has and a tween does not is the unbounded speed.
 * A span as wide as the one that stood out, centred on the steepest fine sub-step of the read (where a cusp is), is
 * read at CUSP_ZOOM even sub-steps, and the largest change in a window of CUSP_ZOOM_WINDOWS[0] of them is compared with
 * the largest in a window of CUSP_ZOOM_WINDOWS[1]: the windows slide over the sub-steps, so it does not matter where in a
 * sub-step the cusp falls. A cusp |t|^a changes by 4^-a of the wider window in the narrow one: 0.40 to 0.67 measured for
 * the ease-outs and ease-ins that leave or reach a hold, or turn, at a vertical tangent, at 64 start phases a frame (the
 * jump sweep, test/jump-sweep.test.ts). Centring the span matters: the span that stood out could start just after a cusp at
 * the start of an ease-out, and then read the bounded speed after it (0.31). A tween has a bounded speed, so its narrow window holds about a quarter of the wide one (0.25),
 * and no more than 0.33 for a flick of 2 to 20 ms that leaves a hold on an ease-out. The speed has no bound when the
 * ratio is at least CUSP_REACH, which sits between 0.33 and 0.40.
 */
const CUSP_ZOOM = 128;
const CUSP_ZOOM_WINDOWS = [2, 8] as const;
const CUSP_REACH = 0.36;

/**
 * A cusp of unbounded speed where the value leaves a hold or reaches one is an ease-out or an ease-in at a vertical
 * tangent (cubic-bezier(0,1,0,1), circOut, circIn), and it passes: the value is still, within stillEps of its range,
 * for a frame up to the cusp and moving a frame after it, or for a frame from it and moving a frame before it, at both
 * ends and the middle (three points, so a value that goes out and comes back is not still). An ease-out keeps
 * moving past its cusp, and an ease-in was moving before it; a flick of 2 to 10 ms is back at rest a frame later, or was
 * at rest a frame before, so it is no ease (a flick of 20 ms lasts more than a frame and passes at 45 to 46 of 64
 * phases, a known limit). So does one where the value turns: it runs one way for a frame into the cusp and back
 * for a frame out of it, at both ends and the middle (out on circIn and back on circOut, a bounce). Any other step that the shrink calls a cusp, of unbounded speed or bounded, is a flick
 * unless it is the middle of a steep ease. A flick of 2 to
 * 20 ms carries its whole change in its own few milliseconds, with a hold or a steady move around it, and it may be shaped
 * on circInOut or cubic-bezier(1,0,0,1), whose midpoint is a true cusp. A steep ease's middle, a true cusp or the straight
 * middle of cubic-bezier(x1,0,1-x1,1) with x1 from 0.9 to 0.995 (often far narrower than a frame), is the top of one bell,
 * and the rest of the ease is spread over the frames around it in the bell's flanks. A step is the middle of a steep ease
 * when both of these hold:
 *
 * - Each frame step beside it moves the same way, at least CUSP_FLANK of the step, and at least CUSP_SLOPE times the step
 *   beyond it. The ease's flanks carry 0.115 to 0.59 of the step, at any range (a range of 10 unit floors, such as scale
 *   1 to 1.02 or opacity 0.9 to 1, moves a flank of a quarter of the unit floor), and fall away by 1.30 to 2.7 (1.30 is a
 *   square-root cusp's, circInOut at 1200 ms). The tail of a flick that spans three
 *   frames carries at most 0.0063 of the step, beside a flick that comes from or goes to a hold a step moves 0, and beside
 *   a tween inside a steady move the step beyond moves as much (1.0 to 1.07).
 * - It bends smoothly from its middle into its flanks. A window that slides over the three frames (CUSP_ROW even
 *   sub-steps a frame) is halved from two frames to 1/16 of a frame (CUSP_BELL, in sub-steps), and each halving keeps no
 *   more of the change than the halving before it, give or take CUSP_BEND. The ease keeps less at each narrower halving
 *   (0.73 to 0.84 at the first, 0.51 to 0.76 at the last; at least 0.0002 less each time on an exact bezier or a library
 *   ease, and 0.00003 more at x1 = 0.999 on Motion's cubicBezier solver, which stops after 12 halvings). A tween on the
 *   flank or the top of a fast ease holds its size once the window covers it, so a halving keeps more than the one before
 *   (0.1 to 0.3 more for the tweens of 2 to 10 ms in the tests). The window reaches into the frames beside the step, so an
 *   ease frame next to a tween fails the bend too, and the failure line may name that frame instead of the tween's.
 */
const CUSP_SLOPE = 1.25;
const CUSP_FLANK = 0.02;
const CUSP_ROW = 64;
const CUSP_BELL = [2 * CUSP_ROW, CUSP_ROW, CUSP_ROW / 2, CUSP_ROW / 4, CUSP_ROW / 8, CUSP_ROW / 16] as const;
const CUSP_BEND = 0.02;

/**
 * The input's step over the frame after `ms`, in px: the farther the pointer moves along either axis, or the scroll
 * position moves (a scroll starts from 0, where the page opens), between the two frame times. The pointer and the
 * scroll hold their latest sample between samples, as the page reads them under ?seek. 0 with no input.
 */
function inputPace(input: InputSamples | null): (ms: number) => number {
  if (!input || input.samples.length === 0) return () => 0;
  const rows = input.samples as number[][];
  const at = (ms: number): number[] => {
    let held = input.kind === "pointer" ? rows[0]! : [0, 0];
    for (const r of rows) if (r[0]! <= ms + 1e-6) held = r;
    return held;
  };
  return input.kind === "pointer"
    ? (ms) => {
        const [a, b] = [at(ms), at(ms + FRAME_MS)];
        return Math.max(Math.abs(b[1]! - a[1]!), Math.abs(b[2]! - a[2]!));
      }
    : (ms) => Math.abs(at(ms + FRAME_MS)[1]! - at(ms)[1]!);
}

/**
 * Seeks every frame step where a value moves at least JUMP_SHARE of its range, or more than JUMP_FACTOR times the
 * larger frame step beside it, and the SUB_STEPS even sub-steps before and after it, and fails each value with a step
 * in which a span of 1, 2 or 4 sub-steps (SPANS) moves more than JUMP_FACTOR times the larger of the two spans of the
 * same width beside it, and carries at least JUMP_CARRIES of the step's change. A span counts when it overlaps the
 * step's own sub-steps, and may cross the frame edge. Seek times are held inside [0, spanMs]; a neighbour that falls
 * outside holds still, so it moves 0. Every such step is measured: a jump hidden in a fast move changes the step by
 * about what a smooth move would, and only the spans show it. A step that is too small to see (at most the value's
 * unit floor, TOLERANCE_FLOORS) is not examined, and a value whose whole range is within its unit floor is still and is
 * not judged. A NaN frame fails its value; a sub-step that is NaN fails its step. A speed corner or an ease changes
 * gradually and passes. A cut in `cuts` (ms) exempts the steps within one frame of it. With `input`, the step in which
 * a press lands (a pointer's first sample, or a press after a lift) or a scroll burst starts is exempt: the page answers
 * the input's start with a response that is out of proportion to the input's step, a thumb that jumps to the press, a
 * grab that tilts a body, a toast that shows on the first scroll tick, and the input has no pace yet to compare it
 * with. A response to a press is the page's answer to the input, not a pop of its own. Only the one step is exempt, so
 * a later pop is judged. A step in which the input moves is exempt when it keeps the input's pace: under ?seek the pointer holds
 * one position per frame and the scroll one position per sample, so a value that follows either moves in one step there by design. The step
 * keeps the pace when its change per px the input moves in that frame (the pointer's larger move along an axis, the
 * scroll's move) is at most JUMP_FACTOR times the lower median of that ratio in the other frames where both move,
 * whatever the value's unit. So two lurches in a row cannot excuse each other, a pop in a frame where the input holds
 * still has no pace to keep, and a value the input does not move is not excused by one frame. A value in `stepped` (trace.json) holds drawings on purpose, so it is
 * judged at its drawing rate instead (drawingJumps): no drawing may spike or teleport, in lengths of the object it
 * moves, with the same cut and pointer exemptions. `scrolled` says the bar's main kind is scroll: the flag the kind
 * gate's objects and envelope rules use, so both gates fit and measure a stepped value alike.
 *
 * `known` is the page's frames over the span (0 to spanMs, one frame a step) when the caller has them already.
 *
 * `members` are the membership steps of the checked extents (kind-gate.ts checkedExtents), by value: the frame steps,
 * by the frame's time in whole microseconds, where a part of the extent comes back or goes gone, with how far the edge
 * moved in that step over the parts drawn in both frames. The edge of the union jumps there because who is in it
 * changed, not because a body moved, so such a step is judged on that change instead of its own: a step whose change
 * over the parts drawn in both frames is under JUMP_SHARE of the value's range is exempt, with its sub-steps (the edge
 * of the parts that stay changes speed where the holder changes, so the steps beside it are no measure). A part that
 * jumps while it stays drawn by JUMP_SHARE of the range or more is in that change, so it is still a jump.
 *
 * A page that moves a value in whole frames only (WHOLE_FRAME_RUN) shows a hold and a jump at every frame: the gate
 * cannot read between its frames, so that run of steps is left out and one line goes to `notes`.
 */
export async function suddenJumps(page: GatePage, channels: string[], cuts: number[], spanMs = 3000, input: InputSamples | null = null, stepped: string[] = [], scrolled = false, notes: string[] = [], known?: Frame[], members: Map<string, Map<number, number>> = new Map()): Promise<string[]> {
  const moves = input?.kind === "pointer" ? inputChanges(input, { flags: false, end: false }) : [];
  const paceAt = inputPace(input);
  const dt = FRAME_MS;
  // The times a press lands or a scroll burst starts: the page sees each in the frame step that ends at or after it.
  const starts = causesOf(input).filter((c) => c.kind !== "load").map((c) => c.startMs);
  const out: string[] = [];
  // A stepped value jumps between its drawings on purpose: it is judged at its drawing rate instead.
  const state = await page.state();
  for (const name of channels.filter((n) => stepped.includes(n))) {
    const skip = (t: number) => cuts.some((c) => c >= t - dt && c <= t + 2 * dt) || moves.some((m) => m > t + 1e-6 && m <= t + dt + 1e-6);
    const pop = (await drawingJumps(page, name, state.objects ?? {}, spanMs, state.units[name], scrolled, skip))[0];
    if (pop) out.push(`suddenJumps: ${name} jumps ${roundLengths(pop.lengths)} object lengths in the drawing at ${round(pop.atMs)} ms, ${POP_WORDS[pop.kind]}; no cut marks it`);
  }
  channels = channels.filter((n) => !stepped.includes(n));
  const frames = known ?? (await page.frames(0, spanMs, dt));
  // Seeks are cached by time for each value, so neighbouring steps share the sub-steps between them.
  const seen = new Map<string, Map<string, number>>();
  const valueAt = async (ms: number, name: string) => {
    const at = Math.min(Math.max(ms, 0), spanMs);
    const cache = seen.get(name) ?? seen.set(name, new Map()).get(name)!;
    const key = at.toFixed(6);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    await page.seek(at);
    const v = (await page.state()).values[name] ?? Number.NaN;
    cache.set(key, v);
    return v;
  };
  for (const name of channels) {
    const vs = frames.map((f) => f.values[name]);
    if (vs.length < 2 || vs.some((v) => v === undefined)) continue;
    const series = vs as number[];
    const bad = series.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) {
      out.push(`suddenJumps: ${name} is ${String(series[bad])} at ${round(frames[bad]!.ms)} ms; a step of it cannot be measured`);
      continue;
    }
    const [low, high] = [Math.min(...series), Math.max(...series)];
    const range = high - low;
    // A value whose whole range is within its unit floor is still, and so is one with no unit that is only rounding.
    const unit = state.units[name];
    if (!(range > (unit !== undefined && Object.hasOwn(TOLERANCE_FLOORS, unit) ? unitFloor(unit, range) : 1e-9 * Math.max(1, Math.abs(low), Math.abs(high))))) continue;
    const floor = unitFloor(unit, range);
    // The frames are already read: they fill the cache at their own times.
    for (const f of frames) (seen.get(name) ?? seen.set(name, new Map()).get(name)!).set(f.ms.toFixed(6), f.values[name]!);
    // How far this value moves for each px the input moves, in each frame step where both move and the value moves visibly.
    const gains = new Map<number, number>();
    for (let i = 0; i + 1 < series.length; i++) {
      const [step, pace] = [Math.abs(series[i + 1]! - series[i]!), paceAt(frames[i]!.ms)];
      if (pace > 0 && step > floor) gains.set(i, step / pace);
    }
    // A step keeps the input's pace when the value moves no more than JUMP_FACTOR times as far per px of the input as
    // it does in the lowest-but-one of the other frames where both move. A value the input does not move has no gain
    // to keep, and one frame is no reference.
    const follows = (i: number) => {
      const own = gains.get(i);
      const others = [...gains].filter(([k]) => k !== i).map(([, g]) => g).sort((a, b) => a - b);
      return own !== undefined && others.length > 0 && own <= JUMP_FACTOR * others[Math.floor((others.length - 1) / 2)]!;
    };
    // A frame step that a cut, the start of the input or the input's pace explains is not judged, and nor are its
    // sub-steps when a neighbour is judged: a value that follows a scroll tick lands the tick's whole response in the
    // last sub-step of its frame.
    // A step where a part of a checked extent comes back or goes gone is judged on the change of the parts drawn in both frames.
    const steps = members.get(name);
    const commonAt = (k: number) => steps?.get(Math.round(frames[k]!.ms * 1000));
    const beside = (k: number) => Math.max(k > 0 ? Math.abs(series[k]! - series[k - 1]!) : 0, k + 2 < series.length ? Math.abs(series[k + 2]! - series[k + 1]!) : 0);
    const memberExempt = (k: number) => {
      const common = commonAt(k);
      return common !== undefined && Math.abs(common) < JUMP_SHARE * range;
    };
    const exempt = (k: number) =>
      k >= 0 && k + 1 < series.length && (cuts.some((c) => c >= frames[k]!.ms - dt && c <= frames[k]!.ms + 2 * dt) || starts.some((m) => m > frames[k]!.ms + 1e-6 && m <= frames[k]!.ms + dt + 1e-6) || follows(k) || memberExempt(k));
    const found: { i: number; line: string; held: boolean }[] = [];
    for (let i = 0; i + 1 < series.length; i++) {
      const t = frames[i]!.ms;
      const d1 = series[i + 1]! - series[i]!;
      if (Math.abs(d1) <= floor) continue;
      const next = beside(i);
      if (Math.abs(d1) < JUMP_SHARE * range && !(Math.abs(d1) > JUMP_FACTOR * next)) continue;
      if (exempt(i)) continue;
      // A jump stands out from the spans beside it at the width it lands in; an ease or a corner changes gradually.
      // The row holds 3 * n sub-steps: the step's own, and the real ones before and after it. `ratio` is the largest
      // that a span of 1, 2 or 4 sub-steps of SUB_STEPS (the same widths of time at n) that carries JUMP_CARRIES of the
      // step shows against the larger of the two spans of its width beside it; a NaN sub-step fails the step.
      const read = async (n: number, leaveOut = true) => {
        const marks: number[] = [];
        for (let j = -n; j <= 2 * n; j++) marks.push(await valueAt(t + (dt * j) / n, name));
        const row = marks.slice(1).map((v, j) => Math.abs(v - marks[j]!));
        if (leaveOut) for (const [k, frame] of [[0, i - 1], [2 * n, i + 1]] as const) if (exempt(frame)) row.fill(0, k, k + n);
        const span = (from: number, w: number) => row.slice(from, from + w).reduce((a, b) => a + b, 0);
        let ratio = 0;
        let best = { at: n, w: 1 };
        for (const w of SPANS.map((w) => (w * n) / SUB_STEPS)) {
          for (let at = n - (w - 1); at < 2 * n; at++) {
            const [own, beside] = [span(at, w), Math.max(span(at - w, w), span(at + w, w))];
            const r = beside === 0 ? Number.POSITIVE_INFINITY : own / beside;
            if (own >= JUMP_CARRIES * Math.abs(d1) && r > ratio) [ratio, best] = [r, { at, w }];
          }
        }
        return { marks, nan: row.some(Number.isNaN), ratio, best };
      };
      const { marks, nan, ratio, best } = await read(SUB_STEPS);
      if (!nan && !(ratio > JUMP_FACTOR)) continue;
      if (!nan) {
        // Leaving the excused frame's sub-steps out can make a speed corner stand out (a value that followed the hand at
        // a steady speed and stops dead the frame after): with them counted it does not, and it is no jump. The sub-steps
        // are cached, so this reads nothing more.
        const counted = await read(SUB_STEPS, false);
        if (!counted.nan && !(counted.ratio > JUMP_FACTOR)) continue;
        // However much it stands out, a cusp's largest window shrinks as the window is cut in half, and a jump's keeps its
        // size. The read runs CUSP_EDGE past each end of the frame, so a cusp at the frame's edge is read whole, and a window
        // counts when it overlaps the frame. One seek at a time: a read moves the page.
        const fine: number[] = [];
        for (let j = -CUSP_EDGE; j <= CUSP_FINE + CUSP_EDGE; j++) fine.push(await valueAt(t + (dt * j) / CUSP_FINE, name));
        const widest = (w: number) => {
          let most = 0;
          for (let k = Math.max(0, CUSP_EDGE - w + 1); k < CUSP_EDGE + CUSP_FINE && k + w < fine.length; k++) most = Math.max(most, Math.abs(fine[k + w]! - fine[k]!));
          return most;
        };
        const sizes = CUSP_WINDOWS.map(widest);
        const cusp = fine.every(Number.isFinite) && sizes[1]! <= sizes[0]! * CUSP_SHRINK && sizes[2]! <= sizes[1]! * CUSP_SHRINK;
        if (cusp) {
          // The span that stood out, as wide as it was, centred on the steepest fine sub-step in the frame (where a cusp
          // is), read at CUSP_ZOOM even sub-steps: a narrow window against a window four times as wide.
          let top = 0;
          for (let k = 0; k + 1 < fine.length; k++) if (Math.abs(fine[k + 1]! - fine[k]!) > Math.abs(fine[top + 1]! - fine[top]!)) top = k;
          const at = (k: number) => t + (dt * (k - CUSP_EDGE)) / CUSP_FINE;
          const mid = at(top + 0.5);
          const half = (dt * best.w) / SUB_STEPS / 2;
          const zoom: number[] = [];
          for (let j = 0; j <= CUSP_ZOOM; j++) zoom.push(await valueAt(mid - half + (2 * half * j) / CUSP_ZOOM, name));
          const widest = (k: number) => Math.max(...zoom.slice(k).map((v, j) => Math.abs(v - zoom[j]!)));
          const [narrow, wide] = [widest(CUSP_ZOOM_WINDOWS[0]), widest(CUSP_ZOOM_WINDOWS[1])];
          const pure = zoom.every(Number.isFinite) && wide > 0 && narrow / wide >= CUSP_REACH;
          // A cusp of unbounded speed where the value leaves a hold, or reaches one: still for a frame up to the cusp, or
          // for a frame from it, read at both ends and the middle. The cusp lies in the steepest fine sub-step or at its
          // edge, so the hold may end where that sub-step starts or where the one before it starts (or start where that
          // sub-step ends or where the one after it ends). The sub-step may lie past the frame's edge: a cusp at the very
          // end of the frame before moves this frame's step most.
          const eps = stillEps(range);
          const holds = async (from: number) => {
            const [a, b, c] = [await valueAt(from, name), await valueAt(from + dt / 2, name), await valueAt(from + dt, name)];
            return Math.abs(a - b) <= eps && Math.abs(b - c) <= eps;
          };
          // Or it turns there: the value runs one way for a frame into the cusp and back for a frame out of it (out on circIn
          // and back on circOut, a bounce at a vertical tangent), read at both ends and the middle of each frame.
          const turns = async (ms: number) => {
            const [a, b, c, d, e] = [ms - dt, ms - dt / 2, ms, ms + dt / 2, ms + dt];
            const [va, vb, vc, vd, ve] = [await valueAt(a, name), await valueAt(b, name), await valueAt(c, name), await valueAt(d, name), await valueAt(e, name)];
            return (vb - va) * (vc - vb) > 0 && (ve - vd) * (vd - vc) > 0 && (vc - vb) * (vd - vc) < 0;
          };
          // The hold must also end the move there: a cusp that leaves a hold is still moving a frame past it (a flick of a
          // few ms is back at rest one frame later, so it leaves one hold and reaches another), and a cusp that reaches a
          // hold was moving a frame before it.
          const leaves = async () => ((await holds(at(top) - dt)) || (await holds(at(top - 1) - dt))) && !(await holds(at(top + 1) + dt));
          const reaches = async () => ((await holds(at(top + 1))) || (await holds(at(top + 2)))) && !(await holds(at(top) - 2 * dt));
          const edge = async () => (await leaves()) || (await reaches()) || (await turns(at(top))) || (await turns(at(top + 1)));
          if (pure && (await edge())) continue;
          // Otherwise a cusp or a bounded speed is the middle of a steep ease only when it tops one bell: each frame step
          // beside it moves the same way, at least CUSP_FLANK of the step and CUSP_SLOPE times the step beyond it. Only
          // then is the row read.
          const stepAt = (k: number) => (k >= 0 && k + 1 < series.length ? series[k + 1]! - series[k]! : 0);
          const falls = (near: number, far: number) => Math.sign(stepAt(near)) === Math.sign(d1) && Math.abs(stepAt(near)) >= CUSP_FLANK * Math.abs(d1) && Math.abs(stepAt(near)) >= CUSP_SLOPE * Math.abs(stepAt(far));
          if (falls(i - 1, i - 2) && falls(i + 1, i + 2)) {
            // ...and it bends smoothly from its middle into its flanks: as a window that slides over the three frames
            // is halved from two frames to 1/16 of a frame, each halving keeps no more of the change than the one before it.
            const row: number[] = [];
            for (let j = -CUSP_ROW; j <= 2 * CUSP_ROW; j++) row.push(await valueAt(t + (dt * j) / CUSP_ROW, name));
            const across = (w: number) => Math.max(...row.slice(w).map((v, j) => Math.abs(v - row[j]!)));
            const spans = CUSP_BELL.map(across);
            const kept = spans.slice(1).map((v, k) => v / spans[k]!);
            if (row.every(Number.isFinite) && kept.every((v, k) => k === 0 || v <= kept[k - 1]! + CUSP_BEND)) continue;
          }
        }
      }
      const d2 = marks[SUB_STEPS + SUB_STEPS / 2]! - series[i]!;
      // Held through the whole frame, then the whole step at its end: a page that moves in whole frames only.
      const held = marks.slice(SUB_STEPS, 2 * SUB_STEPS).every((v) => Math.abs(v - series[i]!) <= 1e-9 * range);
      found.push({ i, held, line: `suddenJumps: ${name} moves ${round(d1)} in the frame after ${round(t)} ms, and ${round(d2)} in its first half; no cut marks it` });
    }
    // A run of WHOLE_FRAME_RUN frames in a row, each held and then jumping, is the page's clock.
    const whole = new Set<number>();
    let run: number[] = [];
    const flush = () => {
      if (run.length >= WHOLE_FRAME_RUN) for (const i of run) whole.add(i);
      run = [];
    };
    for (const f of found) {
      if (!(f.held && (run.length === 0 || f.i === run[run.length - 1]! + 1))) flush();
      if (f.held) run.push(f.i);
    }
    flush();
    if (whole.size > 0) notes.push(`note: suddenJumps cannot read ${name} between frames: the page moves it in whole frames only (${whole.size} frames), so those steps are not judged`);
    const rest = found.filter((f) => !whole.has(f.i));
    if (rest.length > 0) out.push(rest[0]!.line);
  }
  return out;
}

/** How suddenJumps names each kind of stepped pop. */
const POP_WORDS: Record<StepPop["kind"], string> = { spike: "a spike", teleport: "a teleport between two rests", outAndBack: "a teleport out and back" };

/** A stepped value is read this much past the span, so the drawings around its last step there are whole. */
export const MOVE_READ_AHEAD_MS = 4000;

/**
 * The pops of stepped value `name` (poses.ts `stepPops`), from its raw frames and the raw boxes of the object that
 * moves it in `objects` (the page's record; none: it moves no object), in the page's viewport, with `atMs` where the
 * drawing after the pop's first step starts. Its steps are measured with its fitted slopes (fitSlopes on the span's
 * frames, the fit the objects rule checks), and a value with none takes off what the object's fitted values explain
 * (explainedBy, on the read's frames); `scrolled` says the page is a scroll page, the same flag the objects rule
 * fits with, so the drawings carry the scroll. Only pops inside the span count, and no step is judged where `skip`
 * (the frame before the step, in ms) is true; the frames are read MOVE_READ_AHEAD_MS further, so a step near the end
 * of the span is judged against the drawings after it, and a drawing that holds to the end of that read is a rest. The still tolerance that splits
 * the drawings comes from the value's range inside the span, one outlier left out at each end (robustRange): one wild
 * frame, past the span or at a cut, cannot merge drawings.
 */
export async function drawingJumps(page: GatePage, name: string, objects: Record<string, ObjectRecord>, spanMs: number, unit: string | undefined, scrolled: boolean, skip: (ms: number) => boolean): Promise<(StepPop & { atMs: number })[]> {
  const frames = await page.rawFrames(0, spanMs + MOVE_READ_AHEAD_MS);
  const ms = (f: number) => f * FRAME_MS;
  const inSpan = frames.slice(0, Math.floor(spanMs / FRAME_MS + 1e-6) + 1);
  const object = objectOf(objects).get(name) ?? null;
  const fit = object === null ? null : fitSlopes(inSpan, object, objects[object]!.moves, scrolled);
  const judged = seriesOf(inSpan, name);
  const ds = drawingsOf(frames, name, object, stillTol(judged), await page.viewport(), scrolled);
  const explained = fit === null ? NOTHING_EXPLAINED : explainedBy(frames, fit, name);
  return stepPops(ds, unit, fit?.slopes.get(name) ?? null, (f) => skip(ms(f - 1)), frames.length - 1, fit?.shifted ?? false, explained)
    .filter((p) => ms(p.atFrame) <= spanMs + 1e-6)
    .map((p) => ({ ...p, atMs: ms(p.atFrame) }));
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
  // The live run reads every value raw, so the budget does too: a stepped value's budget is its largest drawing step.
  const seekFrames = await page.rawFrames(0, spanMs);
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
/** Object lengths and speed ratios print to 2 decimals. */
export const roundLengths = (n: number) => Math.round(n * 100) / 100;
