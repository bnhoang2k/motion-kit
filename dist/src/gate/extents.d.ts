import { type Frame } from "./harness.ts";
import { type Box, type ObjectRecord } from "./objects.ts";
/**
 * Declared extents (a bar's trace.json `extents`): a value that is an edge of many moving parts, such as the box around
 * 24 cards on one canvas. It turns when another part becomes the extreme one, not because a body passes its rest, so
 * the envelope's pulse attack and the overshoot rule leave it out. The name is guarded here: in every frame the value
 * must be that edge of the union of its parts' boxes, the parts must be a group, the edge must pass from one part to
 * another, and no part may turn round and come to rest while it holds the edge (a body that does is passing its rest,
 * whoever else is beside it, and however it drifts across the edge).
 */
/** The edges of a union of boxes a value may be: its top, bottom, left or right coordinate, or its width or height. */
export declare const EDGES: readonly ["top", "bottom", "left", "right", "width", "height"];
export type Edge = (typeof EDGES)[number];
/** One declared extent: the edge it is, and the names of the objects (in `__state().objects`) whose boxes it is the edge of. */
export type Extent = {
    edge: Edge;
    parts: string[];
};
/** Declared extents by the name of the value that holds each. */
export type Extents = Record<string, Extent>;
/** More than this share of the frames where any part is drawn must draw 2 parts or more, or the parts are no group. */
export declare const GROUP_SHARE = 0.5;
/** The extents a trace declares, or none: an entry that is not `{ edge, parts }` with a known edge and text parts is left out. */
export declare function extentsOf(trace: {
    extents?: unknown;
} | undefined): Extents;
/** `edge` of the union of `boxes` (at least one). */
export declare function edgeOf(boxes: Box[], edge: Edge): number;
/**
 * A turn is not read where three parts or more hold the edge, on that side, in turn within HOLDERS_MS of it (before or
 * after): there the value is the edge of many parts. A body that passes its rest and hides beside one decoy holds the edge
 * with that decoy alone, so two holders are read for a turn. A ring of cards, a row or a stack hands the edge over to a
 * third part and on around a card's turn, and the card's own wobble (its edge turns as it tilts or flips) is the edge of
 * the group, not a body past its rest. The window is local on purpose: three holders at some other time (a fade-in, an
 * intro shuffle, a decoy that took the edge long before) do not excuse a turn made later.
 */
export declare const MANY_HOLDERS = 3;
/** The time each side of a turn in which the parts that hold the edge are counted for `MANY_HOLDERS`. */
export declare const HOLDERS_MS = 1000;
/**
 * The `extents:` lines for a page's declared extents: `edgeLine`'s, else `holderLine`'s, for each. `frames` carry `boxes`;
 * `objects` is the record from one `state()`; `units` are the units of the values; `vw` by `vh` is the viewport in CSS px.
 */
export declare function checkExtents(frames: Frame[], extents: Extents, objects: Record<string, ObjectRecord | unknown>, units: Record<string, string>, vw: number, vh: number): string[];
/** The declaration, the geometry and the group of each extent (`edgeLine`), without how its edge moves (`holderLine`). */
export declare function checkEdges(frames: Frame[], extents: Extents, objects: Record<string, ObjectRecord | unknown>, units: Record<string, string>, vw: number, vh: number): string[];
/**
 * The frame steps in which the set of drawn parts of an extent changes (a part comes back or goes gone in the next frame),
 * by the time of the frame before the step, in ms. Each maps to how far the edge moved, in that step, over the parts
 * drawn in both frames (0 when none is): the edge of the union jumps at such a step because who is in the union changed,
 * not because a body moved, so the envelope's pop test judges the step on that change instead of on the edge's. A part
 * drawn in both frames that jumps in the step still shows in it.
 */
export declare function membershipSteps(frames: Frame[], extent: Extent, vw: number, vh: number): Map<number, number>;
