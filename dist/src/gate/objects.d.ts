import { type Frame } from "./harness.ts";
/**
 * The object record a page reports in `__state().objects`: each object's box in this frame, and the values that move
 * it (REFERENCE.md, "The objects a page reports").
 */
/** `[x, y, w, h]` in CSS px of the viewport: the smallest box that holds what is drawn, shadows left out. */
export type Box = [x: number, y: number, w: number, h: number];
/** `halo` (px, optional): how far the object's ink spreads past its box, as a shadow, glow, outline or stroke does. */
export type ObjectRecord = {
    box: Box;
    moves: string[];
    halo?: number;
};
/** The halo of an object whose record sets none... */
export declare const HALO_PX = 4;
/** The halo the gate reads for an object: its own when valid, else HALO_PX, capped at the larger of HALO_CAP_PX and the object's length. */
export declare function haloOf(r: ObjectRecord): number;
/**
 * The object each value moves, by value name. A record that is not `{ box, moves }` moves nothing: checkObjects
 * reports it.
 */
export declare function objectOf(objects: Record<string, ObjectRecord>): Map<string, string>;
/** An object that is not drawn in this frame reports a box of 1 by 1. */
export declare const isGone: (b: Box) => boolean;
/** A box that covers more than this share of the viewport is ambient: a moving background, a full-canvas glow. */
export declare const AMBIENT_SHARE = 0.5;
/** The area of `b` inside a viewport of `vw` by `vh` CSS px. */
export declare const areaIn: (b: Box, vw: number, vh: number) => number;
/** Gone for the jump rules and for `drawn`: a box of 1 by 1, or one wholly outside a viewport of `vw` by `vh` CSS px. */
export declare const goneIn: (b: Box, vw: number, vh: number) => boolean;
/** A value's slopes: how many px its object's centre x, centre y, width and height move per unit of the value; 0 for a coordinate that does not fit. */
export type Slopes = {
    cx: number;
    cy: number;
    w: number;
    h: number;
};
/**
 * fitSlopes for one object: each value in its moves with its slopes, or null where they cannot be told; and whether
 * the box was fitted scroll-shifted (its centre y plus the scroll), which the caller needs to measure a step with no
 * slopes (stepParts' `dScroll`).
 */
export type ObjectFit = {
    shifted: boolean;
    slopes: Map<string, Slopes | null>;
};
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
export declare function fitSlopes(frames: Frame[], object: string, moves: string[], scrolled: boolean): ObjectFit;
/** A change of a box's centre x, centre y, width and height, in px. */
export type BoxChange = [cx: number, cy: number, w: number, h: number];
export declare const NO_CHANGE: BoxChange;
/** The change of an object's box from frame `from` to frame `to` that some of its values explain (explainedBy). */
export type Explained = (from: number, to: number) => BoxChange;
/** For a value whose object has no fit: nothing is explained. */
export declare const NOTHING_EXPLAINED: Explained;
/**
 * What the values of `fit` with slopes, `name` left out, explain of their object's box change from frame `from` to
 * frame `to` of `frames`: each such value's change times its slopes, summed. A value with null slopes explains
 * nothing, and neither does one that is not a finite number in both frames. The centre y is in the fit's frame of
 * reference (scroll-shifted when `fit.shifted`). A value with null slopes measures a step by its box's change less
 * this (ownChange), so another value that moves the same box adds nothing to it.
 */
export declare function explainedBy(frames: Frame[], fit: ObjectFit, name: string): Explained;
/**
 * A value's own change of its box from drawn box `a` to drawn box `b`, for a value with null slopes: the boxes' change
 * in centre x, centre y, width and height, with `dScroll` (the scroll at b less the scroll at a) added to the centre y
 * when the object is fitted scroll-shifted (0 when it is not), less `explained` (explainedBy, across the same frames).
 */
export declare function ownChange(a: Box, b: Box, dScroll: number, explained: BoxChange): BoxChange;
/**
 * One step of a value, in px and in object lengths: how far it moves its object's centre (`position`, over the bigger
 * box's length) and how much it changes its width or height (`size`, over the smaller box's length).
 */
export type StepParts = {
    positionPx: number;
    sizePx: number;
    position: number;
    size: number;
};
/**
 * A step of a value by `dv` between the drawn boxes `a` and `b`. With slopes, the value's own part: its centre move
 * `hypot(cx·dv, cy·dv)` and its size change, the larger of `|w·dv|` and `|h·dv|`. With null slopes, its own change of
 * the box (ownChange, with `dScroll` and `explained`): the boxes' change less what the object's fitted values explain.
 * The lengths are always those of the real boxes. `explained` is unused with slopes.
 */
export declare function stepParts(a: Box, b: Box, slopes: Slopes | null, dv: number, dScroll: number, explained: BoxChange): StepParts;
/** A box follows a value when one of its four numbers changes by more than this (px) in a step where the value changes. */
export declare const FOLLOW_PX = 0.5;
/**
 * The `objects:` lines for a page's record. `objects` is the record from one `state()` (the names and what each moves);
 * `frames` carry `boxes` for the checks that run on every frame; `values` are the names of the values the page reports
 * and `units` their units. `vw` by `vh` is the viewport in CSS px, `scrolled` says the page is a scroll page, and
 * `cuts` are the bar's cuts in ms.
 */
export declare function checkObjects(frames: Frame[], objects: Record<string, ObjectRecord>, values: string[], units: Record<string, string>, vw: number, vh: number, scrolled: boolean, cuts: number[]): string[];
