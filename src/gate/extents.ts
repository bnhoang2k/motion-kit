import { TOLERANCE_FLOORS } from "../core/trace.ts";
import { FRAME_MS, type Frame } from "./harness.ts";
import { goneIn, type Box, type ObjectRecord } from "./objects.ts";
import { HOLD_MS } from "./series.ts";

/**
 * Declared extents (a bar's trace.json `extents`): a value that is an edge of many moving parts, such as the box around
 * 24 cards on one canvas. It turns when another part becomes the extreme one, not because a body passes its rest, so
 * the envelope's pulse attack and the overshoot rule leave it out. The name is guarded here: in every frame the value
 * must be that edge of the union of its parts' boxes, the parts must be a group, the edge must pass from one part to
 * another, and no part may turn round and come to rest while it holds the edge (a body that does is passing its rest,
 * whoever else is beside it, and however it drifts across the edge).
 */

/** The edges of a union of boxes a value may be: its top, bottom, left or right coordinate, or its width or height. */
export const EDGES = ["top", "bottom", "left", "right", "width", "height"] as const;
export type Edge = (typeof EDGES)[number];
/** One declared extent: the edge it is, and the names of the objects (in `__state().objects`) whose boxes it is the edge of. */
export type Extent = { edge: Edge; parts: string[] };
/** Declared extents by the name of the value that holds each. */
export type Extents = Record<string, Extent>;

/** More than this share of the frames where any part is drawn must draw 2 parts or more, or the parts are no group. */
export const GROUP_SHARE = 0.5;

const isEdge = (e: unknown): e is Edge => (EDGES as readonly unknown[]).includes(e);

/** The extents a trace declares, or none: an entry that is not `{ edge, parts }` with a known edge and text parts is left out. */
export function extentsOf(trace: { extents?: unknown } | undefined): Extents {
  const raw = trace?.extents;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Extents = {};
  for (const [name, e] of Object.entries(raw)) {
    const x = e as { edge?: unknown; parts?: unknown } | null;
    if (typeof x !== "object" || x === null || !isEdge(x.edge) || !Array.isArray(x.parts) || !x.parts.every((p) => typeof p === "string" && p !== "")) continue;
    out[name] = { edge: x.edge, parts: x.parts as string[] };
  }
  return out;
}

/** `edge` of the union of `boxes` (at least one). */
export function edgeOf(boxes: Box[], edge: Edge): number {
  const top = Math.min(...boxes.map((b) => b[1]));
  const bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  const left = Math.min(...boxes.map((b) => b[0]));
  const right = Math.max(...boxes.map((b) => b[0] + b[2]));
  return { top, bottom, left, right, width: right - left, height: bottom - top }[edge];
}

/** The sides of a box an edge is made of: a width or a height has both of its sides. */
type Side = "top" | "bottom" | "left" | "right";
const SIDES: Record<Edge, Side[]> = { top: ["top"], bottom: ["bottom"], left: ["left"], right: ["right"], width: ["left", "right"], height: ["top", "bottom"] };
/** The sides whose extreme is the lowest coordinate. */
const LOW = new Set<Side>(["top", "left"]);
const coordOf = (b: Box, s: Side) => (s === "top" ? b[1] : s === "bottom" ? b[1] + b[3] : s === "left" ? b[0] : b[0] + b[2]);

type Drawn = { name: string; box: Box }[];

/** The parts of `parts` drawn in frame `f`: not gone (1 by 1), not wholly off the viewport (goneIn), and with finite coordinates. */
function drawnIn(f: Frame, parts: string[], vw: number, vh: number): Drawn {
  return parts.flatMap((name) => {
    const box = f.boxes?.[name];
    return box !== undefined && box.every(Number.isFinite) && !goneIn(box, vw, vh) ? [{ name, box }] : [];
  });
}

/** Who holds the edge among `drawn` (at least one): for each side of the edge, the part at its extreme (the first listed where two tie). */
function holdersOf(drawn: Drawn, edge: Edge): string[] {
  return SIDES[edge].map((side) => {
    const sign = LOW.has(side) ? 1 : -1;
    const at = (d: Drawn[number]) => sign * coordOf(d.box, side);
    return drawn.reduce((a, d) => (at(d) < at(a) ? d : a)).name;
  });
}

/** The parts drawn in both `a` and `b`, as each frame's drawn parts. */
function commonOf(a: Drawn, b: Drawn): [Drawn, Drawn] {
  const both = new Set(a.map((d) => d.name).filter((n) => b.some((d) => d.name === n)));
  return [a.filter((d) => both.has(d.name)), b.filter((d) => both.has(d.name))];
}

/**
 * Frames each side of a turn, in frame steps, where a part is read for turning round: a short one sees a sharp bounce, a
 * long one (about 130 ms, a little more than HOLD_MS) a soft overshoot that turns slowly.
 */
const TURN_WINDOWS = [4, 8];
/**
 * A turn is not read where three parts or more hold the edge, on that side, in turn within HOLDERS_MS of it (before or
 * after): there the value is the edge of many parts. A body that passes its rest and hides beside one decoy holds the edge
 * with that decoy alone, so two holders are read for a turn. A ring of cards, a row or a stack hands the edge over to a
 * third part and on around a card's turn, and the card's own wobble (its edge turns as it tilts or flips) is the edge of
 * the group, not a body past its rest. The window is local on purpose: three holders at some other time (a fade-in, an
 * intro shuffle, a decoy that took the edge long before) do not excuse a turn made later.
 */
export const MANY_HOLDERS = 3;
/** The time each side of a turn in which the parts that hold the edge are counted for `MANY_HOLDERS`. */
export const HOLDERS_MS = 1000;

/** Frame steps a part's coordinate must hold within the px floor to be at rest (HOLD_MS). */
const REST_STEPS = Math.ceil(HOLD_MS / FRAME_MS - 1e-6);
/** HOLDERS_MS in frame steps. */
const HOLDERS_STEPS = Math.round(HOLDERS_MS / FRAME_MS);

/**
 * Whether the coordinate `c` of one part (undefined where the part is not drawn) comes to rest as its own body would after
 * turning at frame `k` from going `dir`: after it has come back from the turn by the px floor, it holds within the px floor for
 * REST_STEPS frame steps, the part drawn all the while and holding the edge from the turn to then (`holds`). A body that
 * passes its rest and settles at the edge does. A card on a circle does not: it goes on past its apex and gives the edge to
 * the next card before it rests, so the value turns where one part takes over from another and not with the part.
 */
function comesToRest(c: (number | undefined)[], holds: boolean[], k: number, dir: number): boolean {
  const floor = TOLERANCE_FLOORS.px!;
  let end = k + 1;
  while (end < c.length && holds[end] && c[end] !== undefined) end++;
  let j = k + 1;
  while (j < end && !(dir * (c[k]! - c[j]!) >= floor)) j++;
  for (; j + REST_STEPS < end; j++) {
    const xs = c.slice(j, j + REST_STEPS + 1) as number[];
    if (Math.max(...xs) - Math.min(...xs) <= floor) return true;
  }
  return false;
}

/**
 * The first frame where a part that holds the edge turns round, with the part's name; or none. A part is judged along the
 * edge's own coordinate (its top, bottom, left or right: a width or a height has two), and not on the whole of its motion,
 * which a drift across the edge would hide a turn in. It turns round when that coordinate goes one way by the px floor or
 * more over the 4 or 8 frame steps before a frame and back by as much over the 4 or 8 after it, and then comes to rest
 * still holding the edge (`comesToRest`): a body past its rest. A card on a circle goes through its apex the same way, and
 * goes on.
 * A turn with MANY_HOLDERS parts or more holding the side in turn within HOLDERS_MS of it is not read: it is the edge of a group.
 */
function turnsRound(frames: Frame[], parts: string[], edge: Edge, vw: number, vh: number): { part: string; ms: number } | undefined {
  const floor = TOLERANCE_FLOORS.px!;
  const drawn = frames.map((f) => drawnIn(f, parts, vw, vh));
  let found: { part: string; k: number } | undefined;
  for (const side of SIDES[edge]) {
    const sign = LOW.has(side) ? 1 : -1;
    const best = drawn.map((d) => (d.length === 0 ? Number.NaN : Math.min(...d.map((x) => sign * coordOf(x.box, side)))));
    const coords = new Map<string, (number | undefined)[]>(parts.map((name) => [name, drawn.map((d) => { const x = d.find((y) => y.name === name); return x && coordOf(x.box, side); })]));
    const holds = new Map<string, boolean[]>([...coords].map(([name, c]) => [name, c.map((x, k) => x !== undefined && sign * x - best[k]! <= floor * (1 + 1e-9))]));
    // The part at the extreme of this side in each frame where any part is drawn.
    const first = drawn.map((d) => (d.length === 0 ? undefined : d.reduce((a, x) => (sign * coordOf(x.box, side) < sign * coordOf(a.box, side) ? x : a)).name));
    // Whether MANY_HOLDERS parts or more hold the side in the HOLDERS_MS each side of frame k.
    const manyAround = (k: number) => new Set(first.slice(Math.max(0, k - HOLDERS_STEPS), k + HOLDERS_STEPS + 1).filter((n) => n !== undefined)).size >= MANY_HOLDERS;
    for (let k = 0; k < frames.length && (!found || k < found.k); k++) {
      for (const name of parts) {
        if (!holds.get(name)![k]) continue;
        const c = coords.get(name)!;
        for (const m of TURN_WINDOWS) {
          if (k - m < 0 || k + m >= frames.length) continue;
          const [before, here, after] = [c[k - m], c[k], c[k + m]];
          // A part that is not drawn all the way through the window comes or goes: that is no turn.
          if (before === undefined || here === undefined || after === undefined) continue;
          const [a, b] = [here - before, after - here];
          if (Math.abs(a) >= floor && Math.abs(b) >= floor && a * b < 0 && comesToRest(c, holds.get(name)!, k, Math.sign(a)) && !manyAround(k)) {
            found = { part: name, k };
            break;
          }
        }
        if (found?.k === k) break;
      }
    }
  }
  return found && { part: found.part, ms: frames[found.k]!.ms };
}

/** Whether the edge passes from one part to another: in some step the part at its extreme, among those drawn in both frames, is not the same. */
function handsOver(frames: Frame[], parts: string[], edge: Edge, vw: number, vh: number): boolean {
  for (let k = 0; k + 1 < frames.length; k++) {
    const [a, b] = commonOf(drawnIn(frames[k]!, parts, vw, vh), drawnIn(frames[k + 1]!, parts, vw, vh));
    if (a.length < 2) continue;
    const [ha, hb] = [holdersOf(a, edge), holdersOf(b, edge)];
    if (ha.some((n, i) => n !== hb[i])) return true;
  }
  return false;
}

/** The first part to hold the edge, in the first frame where any part is drawn (for a message). */
const firstHolder = (frames: Frame[], parts: string[], edge: Edge, vw: number, vh: number): string => {
  for (const f of frames) {
    const d = drawnIn(f, parts, vw, vh);
    if (d.length > 0) return holdersOf(d, edge)[0]!;
  }
  return parts[0]!;
};

/**
 * What is wrong with one extent's name, at its first line (undefined when nothing is): the declaration (a value the page
 * reports, in `px`, 2 or more distinct parts that are objects of the record), the geometry, and the group.
 * - in some frame where a part is drawn (not gone, and not wholly off the viewport: goneIn), the value is not that edge
 *   of the union of the drawn parts' boxes, within the px floor. A frame where no part is drawn is not judged, and a
 *   frame whose value is not a number is the `values` rule's to report;
 * - 2 parts or more are drawn in no more than GROUP_SHARE of the frames where any part is drawn, so the parts are no
 *   group: a single body, or one with a part beside it that is never drawn, cannot be named.
 */
function edgeLine(frames: Frame[], name: string, { edge, parts: listed }: Extent, objects: Record<string, ObjectRecord | unknown>, units: Record<string, string>, vw: number, vh: number): string | undefined {
  const floor = TOLERANCE_FLOORS.px!;
  const parts = [...new Set(listed)];
  if (!frames.some((f) => Object.hasOwn(f.values, name))) return `extents: ${name} is not a value the page reports`;
  if (units[name] !== "px") return `extents: ${name} is not a px value; an edge is in px`;
  if (parts.length < 2) return `extents: ${name} names ${parts.length} part${parts.length === 1 ? "" : "s"}; an extent is the edge of 2 or more parts, and a single body cannot be named`;
  const unknown = parts.find((p) => !Object.hasOwn(objects, p));
  if (unknown !== undefined) return `extents: ${name} names ${unknown}, which is not an object the page reports`;
  let any = 0;
  let group = 0;
  for (const f of frames) {
    const drawn = drawnIn(f, parts, vw, vh);
    if (drawn.length === 0) continue;
    any++;
    if (drawn.length >= 2) group++;
    const v = f.values[name];
    if (v !== undefined && Number.isFinite(v) && !(Math.abs(v - edgeOf(drawn.map((d) => d.box), edge)) <= floor * (1 + 1e-9))) return `extents: ${name} is not the ${edge} of its parts at ${+f.ms.toFixed(1)} ms`;
  }
  if (!(group > GROUP_SHARE * any)) return `extents: ${name} has 2 parts drawn in ${group} of ${any} frames where any is; an extent is the edge of parts drawn together`;
  return undefined;
}

/**
 * What is wrong with the way one extent's edge moves, at its first line (undefined when nothing is). Its turns are the
 * handing over of the edge, not a body passing its rest, so:
 * - the edge passes from one part to another at least once: in some step the part at its extreme, among the parts drawn in
 *   both frames, is another. An edge held by one part throughout is that body's own value, however many parts sit beside it;
 * - no part turns round and comes to rest (`turnsRound`: along the edge's own coordinate, one way and then back by the px
 *   floor or more on each side, over a window of 4 or 8 frame steps, then still for HOLD_MS) in a frame where it holds the
 *   edge (is within the px floor of its extreme). A part that goes on round an arc past its apex, or stops, is no turn. A
 *   turn made by one part is a body passing its rest, which the `overshoot` rule and the envelope's pulse bound judge, so
 *   the value is no extent.
 */
function holderLine(frames: Frame[], name: string, { edge, parts: listed }: Extent, vw: number, vh: number): string | undefined {
  const parts = [...new Set(listed)];
  if (!handsOver(frames, parts, edge, vw, vh)) return `extents: ${name} is held by ${firstHolder(frames, parts, edge, vw, vh)} throughout; an extent is an edge that passes from one part to another`;
  const turn = turnsRound(frames, parts, edge, vw, vh);
  if (turn) return `extents: ${name} has ${turn.part} turn round at ${+turn.ms.toFixed(1)} ms while it holds the edge and then comes to rest; a body that passes its rest is no handover`;
  return undefined;
}

/**
 * The `extents:` lines for a page's declared extents: `edgeLine`'s, else `holderLine`'s, for each. `frames` carry `boxes`;
 * `objects` is the record from one `state()`; `units` are the units of the values; `vw` by `vh` is the viewport in CSS px.
 */
export function checkExtents(frames: Frame[], extents: Extents, objects: Record<string, ObjectRecord | unknown>, units: Record<string, string>, vw: number, vh: number): string[] {
  return Object.entries(extents).flatMap(([name, e]) => {
    const line = edgeLine(frames, name, e, objects, units, vw, vh) ?? holderLine(frames, name, e, vw, vh);
    return line === undefined ? [] : [line];
  });
}

/** The declaration, the geometry and the group of each extent (`edgeLine`), without how its edge moves (`holderLine`). */
export function checkEdges(frames: Frame[], extents: Extents, objects: Record<string, ObjectRecord | unknown>, units: Record<string, string>, vw: number, vh: number): string[] {
  return Object.entries(extents).flatMap(([name, e]) => {
    const line = edgeLine(frames, name, e, objects, units, vw, vh);
    return line === undefined ? [] : [line];
  });
}

/**
 * The frame steps in which the set of drawn parts of an extent changes (a part comes back or goes gone in the next frame),
 * by the time of the frame before the step, in ms. Each maps to how far the edge moved, in that step, over the parts
 * drawn in both frames (0 when none is): the edge of the union jumps at such a step because who is in the union changed,
 * not because a body moved, so the envelope's pop test judges the step on that change instead of on the edge's. A part
 * drawn in both frames that jumps in the step still shows in it.
 */
export function membershipSteps(frames: Frame[], extent: Extent, vw: number, vh: number): Map<number, number> {
  const parts = [...new Set(extent.parts)];
  const out = new Map<number, number>();
  for (let k = 0; k + 1 < frames.length; k++) {
    const [a, b] = [drawnIn(frames[k]!, parts, vw, vh), drawnIn(frames[k + 1]!, parts, vw, vh)];
    if (a.length === b.length && a.every((d, i) => d.name === b[i]!.name)) continue;
    const [ca, cb] = commonOf(a, b);
    out.set(frames[k]!.ms, ca.length === 0 ? 0 : edgeOf(cb.map((d) => d.box), extent.edge) - edgeOf(ca.map((d) => d.box), extent.edge));
  }
  return out;
}
