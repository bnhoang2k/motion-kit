import { type GatePage } from "./harness.ts";
import type { RuleContext } from "./kind-gate.ts";
/**
 * The drawn check: the boxes a page reports in `__state().objects` hold what really changes on screen. It screenshots
 * pairs of frames, finds the pixels that change between the two, and checks them against each object's box grown by
 * its halo. A page that reports no objects is not read.
 */
/** Frame pairs compared... */
export declare const DRAWN_SAMPLES = 24;
/** ...at least this many of them spread evenly over the frames the rules read; the rest at events. */
export declare const DRAWN_EVEN = 8;
/** At most this many of the event pairs are stepped drawing boundaries. */
export declare const DRAWN_BOUNDARIES = 16;
/** A pixel changes when one of its channels moves by more than this, of 255. */
export declare const DRAWN_TOL = 8;
/**
 * Inside a changing solid object's own box (unpadded, in either frame), a pixel changes for the ghost test when one of
 * its channels moves by more than this, of 255: a faint or fading object still shows its change.
 */
export declare const DRAWN_SOFT_TOL = 2;
/**
 * A pair fails when more than this share of its changed pixels, or more than DRAWN_STRAY_PX of them, are covered by no
 * object.
 */
export declare const DRAWN_STRAY = 0.01;
export declare const DRAWN_STRAY_PX = 64;
/** A box moves when its centre, width or height changes by more than this, in CSS px. */
export declare const DRAWN_MOVE_PX = 2;
/**
 * A box that moves DRAWN_MOVE_PX or less per frame is compared with the first later frame, up to this many on, where
 * it has moved more.
 */
export declare const DRAWN_SLOW_FRAMES = 30;
/**
 * Changed pixels inside an ambient box that no solid box holds are grouped into clusters: the viewport is cut into
 * cells of this many by this many px, a cell is on when one of its pixels changed, and on cells join when the cells
 * around them (one cell out, diagonals too) touch.
 */
export declare const CLUSTER_CELL = 4;
/**
 * A cluster is compact when its on cells fill at least this share of their bounding box and that box covers less than
 * CLUSTER_SHARE of the viewport: a spot, not the background's own change.
 */
export declare const CLUSTER_FILL = 0.25;
export declare const CLUSTER_SHARE = 0.25;
/** A pair with this many clusters or more changes its background in many patches: none of them is stray. */
export declare const CLUSTER_MANY = 3;
/**
 * Tightness: the changed pixels an object alone holds reach an edge of its box, clipped to the viewport, when they come
 * within this share of what they span inside that box along the edge's axis (across for left and right, down for top
 * and bottom), plus TIGHT_PX, of it. Ink past an edge (a halo's) reaches it.
 */
export declare const TIGHT_SIDE = 0.25;
/** ...plus this many px, for the rounding of a box's edges to pixels. */
export declare const TIGHT_PX = 1;
/** A listed cut must change more than this share of the viewport... */
export declare const CUT_SHARE = 0.5;
/** ...or more than this many times the most pixels any other pair changes. */
export declare const CUT_TIMES = 3;
/** `[x0, y0, x1, y1]` in CSS px. A pixel belongs to it when the pixel's centre does, edges included. */
export type Rect = [number, number, number, number];
/**
 * The pairs `drawnRead` compared: the times of their two frames in ms; the objects whose box moved more than
 * DRAWN_MOVE_PX, went gone or came back between them; and the event the pair was chosen for: "cut", "gone <object>",
 * "back <object>", "slow <object>", "jump <object>" or "drawing <value>", or null for a pair spread evenly.
 */
export type DrawnPair = {
    a: number;
    b: number;
    moved: string[];
    event: string | null;
};
/** What drawnRead reads from the rule context. */
export type DrawnContext = Pick<RuleContext, "kind" | "spanMs" | "stepped" | "cuts">;
/**
 * Whether every pixel of `r` in a viewport of `vw` by `vh` lies in one of `others`, by pixel centres. True when `r`
 * holds no pixel.
 */
export declare function coveredBy(r: Rect, others: Rect[], vw: number, vh: number): boolean;
/** The `drawn:` lines for `page` (drawnRead). */
export declare function drawn(page: GatePage, ctx: DrawnContext): Promise<string[]>;
/**
 * The `drawn:` lines for `page`, read over 0 to the context's span; the pairs compared; and notes, information lines
 * that never fail the page. The shots are taken on fresh pages of the page's own browser context (same input, pixel
 * ratio and reduced motion), each sought right before its shot, so nothing another read left on screen is shot: a
 * stepped page's reads look ahead and leave it drawn at a later frame. The boxes are the raw ones read for those
 * frames. A pair (pickPairs) may span a scroll: its pixels and boxes are then compared in both frames of reference
 * (DIFF_PIXELS, moveAcross), and each side of frame a counts both where it was in the viewport and where the document
 * carried it.
 *
 * - **Covered.** Each object's box is grown by its halo (haloOf). A changed pixel (DRAWN_TOL) is covered when the
 *   grown box of an object that changed in the pair holds it: its box moved, resized, went gone or came back, a value
 *   in its `moves` changed by more than its still tolerance, or its `moves` is empty. A grown box that covers more
 *   than AMBIENT_SHARE of the viewport is ambient: the changed pixels only it holds form clusters (COUNT), and only
 *   compact ones, one or two in a pair, are stray. A pair fails when more than DRAWN_STRAY of its changed pixels, or
 *   more than DRAWN_STRAY_PX, are stray.
 * - **Unjudged.** In a pair with CLUSTER_MANY clusters or more, or where a solid object's grown box overlaps a cluster
 *   that is not compact, the object is not judged for ghosts or tightness: the background changes around it. An object
 *   unjudged in every pair where it truly changed gets a note, not a line.
 * - **Ghosts.** An object whose box moves more than DRAWN_MOVE_PX, goes gone or comes back fails when no pixel changes
 *   where its box was, or where it went: its grown box in that frame, less the grown boxes of the other solid objects
 *   that changed. Inside a changing solid object's own box a change of DRAWN_SOFT_TOL counts. A side the others hide
 *   wholly is skipped, a gone side has no box, and an object whose own box lies inside the others' grown boxes moves
 *   with them and is not judged. A step to or from a gone gap of HOLD_MS or more (or one that runs to the
 *   edge of the frames read) that shows no change is also compared from its fade reference (fadeRef) to its gone
 *   frame, and fails only when that shows none either. A shorter gone gap is judged on its pair alone.
 * - **Tightness.** The changed pixels a solid object alone holds (inside its grown boxes, outside the other changers')
 *   must come within TIGHT_SIDE of what they span along each edge's axis, plus TIGHT_PX, of both of its long edges
 *   and one of its short edges, in frame b's box (frame a's when b is gone) clipped to the viewport (reachOf: an
 *   edge the viewport cuts off is not judged, nor, when less than half the box shows, the two across it). Each event pair where it moved and is judged must pass; an
 *   object in none passes when, over the pairs where it truly changed and is judged, each of those edges is reached
 *   in some pair. A pair where it holds no changed pixel tells nothing.
 * - **Cuts.** A listed cut is read over two frame steps: its pair, and the step into the pair's first frame, since a
 *   page may switch its scene at the cut or after it. The larger change of the two must be more than CUT_SHARE of the
 *   viewport, or more than CUT_TIMES the most pixels any other pair changes. Neither step is judged for anything else,
 *   whichever pair it is sampled as, and neither sets that most.
 *
 * Each cause prints its first pair: one line for pixels outside the objects, one per object that moves with nothing
 * drawn, one per object whose box is bigger than what it draws, and one per cut that changes little.
 */
export declare function drawnRead(page: GatePage, ctx: DrawnContext): Promise<{
    lines: string[];
    pairs: DrawnPair[];
    notes: string[];
}>;
