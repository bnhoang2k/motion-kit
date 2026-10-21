import { FRAME_MS, type Frame } from "./harness.ts";
import { series, stillTol } from "./series.ts";

/**
 * The object record a page reports in `__state().objects`: each object's box in this frame, and the values that move
 * it (REFERENCE.md, "The objects a page reports").
 */

/** `[x, y, w, h]` in CSS px of the viewport: the smallest box that holds what is drawn, shadows left out. */
export type Box = [x: number, y: number, w: number, h: number];
/** `halo` (px, optional): how far the object's ink spreads past its box, as a shadow, glow, outline or stroke does. */
export type ObjectRecord = { box: Box; moves: string[]; halo?: number };

/** The halo of an object whose record sets none... */
export const HALO_PX = 4;
/** ...and the most a halo counts for, unless the object is longer than this. */
const HALO_CAP_PX = 16;

const isHalo = (h: unknown): h is number => typeof h === "number" && Number.isFinite(h) && h >= 0;

/** The halo the gate reads for an object: its own when valid, else HALO_PX, capped at the larger of HALO_CAP_PX and the object's length. */
export function haloOf(r: ObjectRecord): number {
  return Math.min(isHalo(r.halo) ? r.halo : HALO_PX, Math.max(HALO_CAP_PX, lengthOf(r.box)));
}

/** An object's length: the larger of its box's width and height. */
const lengthOf = (b: Box) => Math.max(b[2], b[3]);
const cxOf = (b: Box) => b[0] + b[2] / 2;
const cyOf = (b: Box) => b[1] + b[3] / 2;

/**
 * The object each value moves, by value name. A record that is not `{ box, moves }` moves nothing: checkObjects
 * reports it.
 */
export function objectOf(objects: Record<string, ObjectRecord>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, o] of Object.entries(objects)) if (isRecord(o)) for (const v of o.moves) if (!out.has(v)) out.set(v, name);
  return out;
}

/** An object that is not drawn in this frame reports a box of 1 by 1. */
export const isGone = (b: Box) => b[2] <= 1 && b[3] <= 1;

/** A box that covers more than this share of the viewport is ambient: a moving background, a full-canvas glow. */
export const AMBIENT_SHARE = 0.5;

/** The area of `b` inside a viewport of `vw` by `vh` CSS px. */
export const areaIn = (b: Box, vw: number, vh: number) => Math.max(0, Math.min(b[0] + b[2], vw) - Math.max(b[0], 0)) * Math.max(0, Math.min(b[1] + b[3], vh) - Math.max(b[1], 0));

/** Gone for the jump rules and for `drawn`: a box of 1 by 1, or one wholly outside a viewport of `vw` by `vh` CSS px. */
export const goneIn = (b: Box, vw: number, vh: number) => isGone(b) || b[0] + b[2] <= 0 || b[1] + b[3] <= 0 || b[0] >= vw || b[1] >= vh;

/** A value's slopes: how many px its object's centre x, centre y, width and height move per unit of the value; 0 for a coordinate that does not fit. */
export type Slopes = { cx: number; cy: number; w: number; h: number };
/**
 * fitSlopes for one object: each value in its moves with its slopes, or null where they cannot be told; and whether
 * the box was fitted scroll-shifted (its centre y plus the scroll), which the caller needs to measure a step with no
 * slopes (stepParts' `dScroll`).
 */
export type ObjectFit = { shifted: boolean; slopes: Map<string, Slopes | null> };

/** A box coordinate fits its values when the joint fit explains this share of its variance (R²)... */
const FIT_R2 = 0.81;
/** ...on at least this many frames where the object is drawn. */
const FIT_MIN_FRAMES = 12;
/** A value that changes in fewer frame steps than this has too few changes to fit. */
const FIT_MIN_STEPS = 3;
/** Two values whose series correlate this closely (|r|) move together, and neither's part can be told. */
const SAME_MOVE_R = 0.99;
/** A coordinate whose range is this small (px) does not vary. */
const FLAT_PX = 1e-6;

/** fitSlopes' results, by the frames they were fitted on: one fit per object, frame series and scroll flag. */
const fits = new WeakMap<Frame[], Map<string, ObjectFit>>();

/**
 * Fits each of the object's box coordinates (centre x, centre y, width, height) jointly on all the values in `moves`,
 * by least squares over the frames where the object is drawn (not `isGone`; a box off the viewport is still a real
 * coordinate). A value's slopes are its coefficients in the coordinates that fit (R² ≥ FIT_R2); a coordinate with no
 * variance does not fit. A value gets null when no coordinate fits, when it changes in fewer than FIT_MIN_STEPS frame
 * steps, when it moves together with another value in `moves`, or when the object is drawn in fewer than
 * FIT_MIN_FRAMES frames. With `scrolled`, the object keeps the frame of reference, the viewport or scroll-shifted, in
 * which its centre y travels less over the run. The rules pass `rawFrames(0, spanOf(ctx))`; the result is kept for
 * that frames array, so rules that share it fit once.
 */
export function fitSlopes(frames: Frame[], object: string, moves: string[], scrolled: boolean): ObjectFit {
  let byKey = fits.get(frames);
  if (!byKey) fits.set(frames, (byKey = new Map()));
  const key = JSON.stringify([object, moves, scrolled]);
  let fit = byKey.get(key);
  if (!fit) byKey.set(key, (fit = fitObject(frames, object, moves, scrolled)));
  return fit;
}

function fitObject(frames: Frame[], object: string, moves: string[], scrolled: boolean): ObjectFit {
  const drawn = frames.filter((f) => {
    const b = f.boxes?.[object];
    return b !== undefined && b.every(Number.isFinite) && !isGone(b);
  });
  const coords = (shift: boolean) =>
    drawn.map((f) => {
      const b = f.boxes![object]!;
      return [cxOf(b), cyOf(b) + (shift ? (f.scroll ?? 0) : 0), b[2], b[3]];
    });
  const travel = (rows: number[][]) => rows.slice(1).reduce((sum, r, i) => sum + Math.abs(r[1]! - rows[i]![1]!), 0);
  const shifted = scrolled && travel(coords(true)) < travel(coords(false));
  const slopes = new Map<string, Slopes | null>(moves.map((v) => [v, null]));
  if (drawn.length < FIT_MIN_FRAMES) return { shifted, slopes };
  const rows = coords(shifted);
  // The values the fit can use: finite wherever the object is drawn, and not constant there.
  const cols = new Map<string, number[]>();
  for (const v of moves) {
    const col = drawn.map((f) => (Object.hasOwn(f.values, v) ? f.values[v]! : Number.NaN));
    if (col.every(Number.isFinite) && Math.max(...col) > Math.min(...col)) cols.set(v, col);
  }
  // Values that move together: the first stands in for them in the fit, so their joint motion is still explained.
  const together = new Set<string>();
  const used: string[] = [];
  for (const v of cols.keys()) {
    const twins = used.filter((u) => Math.abs(correlation(cols.get(u)!, cols.get(v)!)) >= SAME_MOVE_R);
    if (twins.length > 0) [v, ...twins].forEach((n) => together.add(n));
    else used.push(v);
  }
  if (used.length === 0) return { shifted, slopes };
  const X = used.map((v) => cols.get(v)!);
  const coefs = [0, 1, 2, 3].map((c) => fitColumn(X, rows.map((r) => r[c]!)));
  if (coefs.every((c) => c === null)) return { shifted, slopes };
  const steps = (col: number[]) => {
    const tol = stillTol(col);
    return col.slice(1).filter((x, i) => Math.abs(x - col[i]!) > tol).length;
  };
  used.forEach((v, j) => {
    if (together.has(v) || steps(cols.get(v)!) < FIT_MIN_STEPS) return;
    const [cx, cy, w, h] = coefs.map((c) => (c === null ? 0 : c[j]!)) as [number, number, number, number];
    slopes.set(v, { cx, cy, w, h });
  });
  return { shifted, slopes };
}

/** Pearson's r of two series of one length; 0 when either is constant. */
function correlation(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let [ab, aa, bb] = [0, 0, 0];
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * The least-squares coefficients of `y` on the columns of `X` (each a series of one length), with an intercept; null
 * when `y` does not vary, the columns cannot be told apart, or the fit explains less than FIT_R2 of y's variance.
 */
function fitColumn(X: number[][], y: number[]): number[] | null {
  if (Math.max(...y) - Math.min(...y) <= FLAT_PX) return null;
  const n = y.length;
  const k = X.length;
  // Centred and scaled to unit spread, so values of very different sizes solve as well as alike ones.
  const centred = X.map((col) => {
    const m = mean(col);
    const c = col.map((x) => x - m);
    const s = Math.sqrt(c.reduce((t, x) => t + x * x, 0)) || 1;
    return { c: c.map((x) => x / s), s };
  });
  const my = mean(y);
  const yc = y.map((v) => v - my);
  const G = centred.map((a) => centred.map((b) => a.c.reduce((t, x, i) => t + x * b.c[i]!, 0)));
  const r = centred.map((a) => a.c.reduce((t, x, i) => t + x * yc[i]!, 0));
  const beta = solve(G, r);
  if (beta === null) return null;
  let res = 0;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let j = 0; j < k; j++) fit += beta[j]! * centred[j]!.c[i]!;
    res += (yc[i]! - fit) ** 2;
    tot += yc[i]! ** 2;
  }
  if (1 - res / tot < FIT_R2) return null;
  return beta.map((b, j) => b / centred[j]!.s);
}

/** Solves `A x = b` by Gaussian elimination with partial pivoting; null when A is singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let i = c + 1; i < k; i++) if (Math.abs(M[i]![c]!) > Math.abs(M[p]![c]!)) p = i;
    if (Math.abs(M[p]![c]!) < 1e-9) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let i = 0; i < k; i++) {
      if (i === c) continue;
      const f = M[i]![c]! / M[c]![c]!;
      for (let j = c; j <= k; j++) M[i]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[k]! / row[i]!);
}

/** A change of a box's centre x, centre y, width and height, in px. */
export type BoxChange = [cx: number, cy: number, w: number, h: number];
export const NO_CHANGE: BoxChange = [0, 0, 0, 0];
/** The change of an object's box from frame `from` to frame `to` that some of its values explain (explainedBy). */
export type Explained = (from: number, to: number) => BoxChange;
/** For a value whose object has no fit: nothing is explained. */
export const NOTHING_EXPLAINED: Explained = () => NO_CHANGE;

/**
 * What the values of `fit` with slopes, `name` left out, explain of their object's box change from frame `from` to
 * frame `to` of `frames`: each such value's change times its slopes, summed. A value with null slopes explains
 * nothing, and neither does one that is not a finite number in both frames. The centre y is in the fit's frame of
 * reference (scroll-shifted when `fit.shifted`). A value with null slopes measures a step by its box's change less
 * this (ownChange), so another value that moves the same box adds nothing to it.
 */
export function explainedBy(frames: Frame[], fit: ObjectFit, name: string): Explained {
  const others = [...fit.slopes].filter((e): e is [string, Slopes] => e[0] !== name && e[1] !== null);
  if (others.length === 0) return NOTHING_EXPLAINED;
  return (from, to) => {
    const out: BoxChange = [0, 0, 0, 0];
    for (const [v, s] of others) {
      const d = (frames[to]?.values[v] ?? Number.NaN) - (frames[from]?.values[v] ?? Number.NaN);
      if (!Number.isFinite(d)) continue;
      [s.cx, s.cy, s.w, s.h].forEach((k, i) => (out[i]! += k * d));
    }
    return out;
  };
}

/**
 * A value's own change of its box from drawn box `a` to drawn box `b`, for a value with null slopes: the boxes' change
 * in centre x, centre y, width and height, with `dScroll` (the scroll at b less the scroll at a) added to the centre y
 * when the object is fitted scroll-shifted (0 when it is not), less `explained` (explainedBy, across the same frames).
 */
export function ownChange(a: Box, b: Box, dScroll: number, explained: BoxChange): BoxChange {
  return [cxOf(b) - cxOf(a) - explained[0], cyOf(b) - cyOf(a) + dScroll - explained[1], b[2] - a[2] - explained[2], b[3] - a[3] - explained[3]];
}

/**
 * One step of a value, in px and in object lengths: how far it moves its object's centre (`position`, over the bigger
 * box's length) and how much it changes its width or height (`size`, over the smaller box's length).
 */
export type StepParts = { positionPx: number; sizePx: number; position: number; size: number };

/**
 * A step of a value by `dv` between the drawn boxes `a` and `b`. With slopes, the value's own part: its centre move
 * `hypot(cx·dv, cy·dv)` and its size change, the larger of `|w·dv|` and `|h·dv|`. With null slopes, its own change of
 * the box (ownChange, with `dScroll` and `explained`): the boxes' change less what the object's fitted values explain.
 * The lengths are always those of the real boxes. `explained` is unused with slopes.
 */
export function stepParts(a: Box, b: Box, slopes: Slopes | null, dv: number, dScroll: number, explained: BoxChange): StepParts {
  const own = slopes ? null : ownChange(a, b, dScroll, explained);
  const positionPx = own ? Math.hypot(own[0], own[1]) : Math.hypot(slopes!.cx * dv, slopes!.cy * dv);
  const sizePx = own ? Math.max(Math.abs(own[2]), Math.abs(own[3])) : Math.max(Math.abs(slopes!.w * dv), Math.abs(slopes!.h * dv));
  return { positionPx, sizePx, position: positionPx / Math.max(lengthOf(a), lengthOf(b)), size: sizePx / Math.min(lengthOf(a), lengthOf(b)) };
}

const isBox = (b: unknown): b is Box => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number");
const isRecord = (o: unknown): o is ObjectRecord =>
  typeof o === "object" && o !== null && isBox((o as ObjectRecord).box) && Array.isArray((o as ObjectRecord).moves) && (o as ObjectRecord).moves.every((v) => typeof v === "string");

/** A box follows a value when one of its four numbers changes by more than this (px) in a step where the value changes. */
export const FOLLOW_PX = 0.5;
/** A box's centre move is a spike when it is more than this many object lengths... */
const SPIKE_LENGTHS = 1;
/** ...and more than this many times the largest centre move in the SPIKE_SIDE frame steps on each side. */
const SPIKE_RATIO = 3;
const SPIKE_SIDE = 3;

/**
 * The `objects:` lines for a page's record. `objects` is the record from one `state()` (the names and what each moves);
 * `frames` carry `boxes` for the checks that run on every frame; `values` are the names of the values the page reports
 * and `units` their units. `vw` by `vh` is the viewport in CSS px, `scrolled` says the page is a scroll page, and
 * `cuts` are the bar's cuts in ms.
 */
export function checkObjects(frames: Frame[], objects: Record<string, ObjectRecord>, values: string[], units: Record<string, string>, vw: number, vh: number, scrolled: boolean, cuts: number[]): string[] {
  const out: string[] = [];
  const mover = new Map<string, string[]>();
  const seen = [...new Set(frames.flatMap((f) => Object.keys(f.boxes ?? {})))];
  for (const name of new Set([...Object.keys(objects), ...seen])) {
    const o = objects[name];
    if (o === undefined) {
      const first = frames.find((f) => f.boxes?.[name] !== undefined)!;
      out.push(`objects: ${name} has a box at ${+first.ms.toFixed(1)} ms but is not in the record read from the page's state`);
    } else if (!isRecord(o)) {
      out.push(`objects: ${name} is not { box: [x, y, w, h], moves: [names] }`);
      continue;
    } else {
      for (const v of o.moves) {
        if (!values.includes(v)) out.push(`objects: ${v} in ${name}'s moves is not a reported value`);
        mover.set(v, [...(mover.get(v) ?? []), name]);
      }
      if (o.halo !== undefined && !isHalo(o.halo)) out.push(`objects: ${name} halo is not a finite number ≥ 0`);
    }
    const boxes = frames.map((f) => ({ ms: f.ms, box: f.boxes?.[name] }));
    const missing = boxes.filter((b) => b.box === undefined);
    if (missing.length > 0) out.push(`objects: ${name} has no box in ${missing.length} of ${frames.length} frames, the first at ${+missing[0]!.ms.toFixed(1)} ms`);
    const bad = boxes.find((b) => b.box !== undefined && !b.box.every(Number.isFinite));
    if (bad) out.push(`objects: ${name} box is not finite numbers at ${+bad.ms.toFixed(1)} ms`);
    const small = boxes.find((b) => b.box !== undefined && b.box.every(Number.isFinite) && (b.box[2] < 1 || b.box[3] < 1));
    if (small) out.push(`objects: ${name} box is under 1 px wide or high at ${+small.ms.toFixed(1)} ms`);
    if (o !== undefined) {
      if (!ambient(frames, name, o, vw, vh)) out.push(...unfollowed(frames, name, o.moves, units, scrolled));
      out.push(...uncaused(frames, name, o.moves, units, vw, vh, scrolled, cuts));
    }
  }
  for (const [v, names] of mover) if (names.length > 1) out.push(`objects: ${v} is moved by ${names.join(" and ")}; a value belongs to one object`);
  return out;
}

/**
 * Whether an object is ambient: in some frame where it is drawn, its box grown by its halo (haloOf) covers more than
 * AMBIENT_SHARE of the viewport. A background that pans inside its still box changes its look, not its place.
 */
function ambient(frames: Frame[], name: string, o: ObjectRecord, vw: number, vh: number): boolean {
  return frames.some((f) => {
    const b = f.boxes?.[name];
    if (b === undefined || !b.every(Number.isFinite) || isGone(b)) return false;
    const h = haloOf({ ...o, box: b });
    return areaIn([b[0] - h, b[1] - h, b[2] + 2 * h, b[3] + 2 * h], vw, vh) > AMBIENT_SHARE * vw * vh;
  });
}

/**
 * Each `px` value in `moves` that changes but its object's box does not follow (an ambient object is left out): it has
 * no slopes (fitSlopes), and in every frame step where it changes by more than its still tolerance, all four box
 * numbers change by FOLLOW_PX or less, in the frame of reference the object's fit kept (with the scroll added to y when
 * it is scroll-shifted). A value listed under a still box (a decoy owner) fails here, on a scroll page too.
 */
function unfollowed(frames: Frame[], name: string, moves: string[], units: Record<string, string>, scrolled: boolean): string[] {
  const fit = fitSlopes(frames, name, moves, scrolled);
  const still = (v: string) => {
    const tol = stillTol(series(frames, v));
    let changes = 0;
    for (let i = 1; i < frames.length; i++) {
      const [va, vb] = [frames[i - 1]!.values[v], frames[i]!.values[v]];
      const [a, b] = [frames[i - 1]!.boxes?.[name], frames[i]!.boxes?.[name]];
      if (va === undefined || vb === undefined || !(Math.abs(vb - va) > tol) || !a || !b) continue;
      const dScroll = fit.shifted ? (frames[i]!.scroll ?? 0) - (frames[i - 1]!.scroll ?? 0) : 0;
      if (a.some((x, k) => !(Math.abs(b[k]! - x + (k === 1 ? dScroll : 0)) <= FOLLOW_PX))) return false;
      changes++;
    }
    return changes > 0;
  };
  return moves.filter((v) => units[v] === "px" && fit.slopes.get(v) === null && still(v)).map((v) => `objects: ${v} changes but its object's box does not follow it`);
}

/**
 * The first spike of an object's box with no cause: a centre move of more than SPIKE_LENGTHS object lengths (of the
 * bigger box) in one frame step, and more than SPIKE_RATIO times the largest centre move in the SPIKE_SIDE steps on
 * each side, that its values do not cause. A value in `moves` that is not an `index` causes it when it changes in
 * that step and has no slopes (fitSlopes), since what it does to the box cannot be told; values with slopes cause
 * only what they explain (explainedBy), so the step is judged again on the box's move less that, in the fit's frame
 * of reference. Steps to or from a gone box (`goneIn`) are skipped, and so is a step at a cut. On a scroll page the
 * move must be a spike in the viewport and scroll-shifted alike. Steady fast motion is no spike; a still-jump-still
 * is. A move declared as a sprite index, a moving box listed with `moves: []`, and a jump sideways while the one
 * fitted value bobs the box up and down fail here.
 */
function uncaused(frames: Frame[], name: string, moves: string[], units: Record<string, string>, vw: number, vh: number, scrolled: boolean, cuts: number[]): string[] {
  const boxAt = (i: number) => {
    const b = frames[i]?.boxes?.[name];
    return b !== undefined && b.every(Number.isFinite) && !goneIn(b, vw, vh) ? b : null;
  };
  /** The centre move from frame i - 1 to frame i; null when either box is gone. */
  const moveAt = (i: number, shift: boolean) => {
    const [a, b] = [boxAt(i - 1), boxAt(i)];
    if (!a || !b) return null;
    const ds = shift ? (frames[i]!.scroll ?? 0) - (frames[i - 1]!.scroll ?? 0) : 0;
    const [dx, dy] = [cxOf(b) - cxOf(a), cyOf(b) - cyOf(a) + ds];
    return { px: Math.hypot(dx, dy), dx, dy, lengths: Math.max(lengthOf(a), lengthOf(b)) };
  };
  /** The step's move in object lengths when it is a spike, else null; with `less`, the move less that change. */
  const spike = (i: number, shift: boolean, less: BoxChange = NO_CHANGE) => {
    const m = moveAt(i, shift);
    if (!m) return null;
    const px = less === NO_CHANGE ? m.px : Math.hypot(m.dx - less[0], m.dy - less[1]);
    if (px / m.lengths <= SPIKE_LENGTHS) return null;
    let line = 0;
    for (let j = i - SPIKE_SIDE; j <= i + SPIKE_SIDE; j++) if (j !== i) line = Math.max(line, moveAt(j, shift)?.px ?? 0);
    return px > SPIKE_RATIO * line ? px / m.lengths : null;
  };
  const fit = fitSlopes(frames, name, moves, scrolled);
  const explained = explainedBy(frames, fit, "");
  const causes = moves.filter((v) => units[v] !== "index").map((v): [string, number, boolean] => [v, stillTol(series(frames, v)), fit.slopes.get(v) != null]);
  for (let i = 1; i < frames.length; i++) {
    const ms = frames[i - 1]!.ms;
    if (cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS)) continue;
    const ls = scrolled ? [spike(i, false), spike(i, true)] : [spike(i, false)];
    if (ls.some((l) => l === null)) continue;
    const changing = causes.filter(([v, tol]) => Math.abs((frames[i]!.values[v] ?? Number.NaN) - (frames[i - 1]!.values[v] ?? Number.NaN)) > tol);
    const at = `${+frames[i]!.ms.toFixed(1)} ms`;
    if (changing.length === 0) return [`objects: ${name} jumps ${+Math.min(...(ls as number[])).toFixed(2)} object lengths at ${at} with no value in its moves changing`];
    if (changing.some(([, , fitted]) => !fitted)) continue;
    const left = spike(i, scrolled && fit.shifted, explained(i - 1, i));
    if (left === null) continue;
    return [`objects: ${name} jumps ${+left.toFixed(2)} object lengths at ${at} more than the values in its moves explain`];
  }
  return [];
}
