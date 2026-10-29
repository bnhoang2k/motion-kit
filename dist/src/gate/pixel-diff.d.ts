/**
 * The pixel diff shared by the frame sheet's crop (sheet.ts) and the drawn check (drawn.ts). It lives in a module of
 * its own, so neither imports the other.
 */
/**
 * Runs in a page: for each pair of PNG data URLs in `pairs`, calls `each(k, x, y, strong)` for every pixel (x, y) where
 * `differ(a, b, o)` holds between the two shots' RGBA data at byte offset `o` (`strong` true), with `k` the pair's
 * index. Both shots of a pair have one size; with `size` ([w, h] in px) each shot is drawn at that size first.
 *
 * With `soft` (`{ differ, rects }`), a pixel that `differ` passes over is still reported, with `strong` false, when
 * `soft.differ` holds for it and its centre lies inside one of `rects[k]` (`[x0, y0, x1, y1]` in px, edges included):
 * a second, finer tolerance inside given rects.
 *
 * With `shifts` (whole px per pair, or 0), pair k is a scroll pair: its second shot sits `shifts[k]` px further down
 * the document than its first. A pixel (x, y) of the second shot then differs only when it differs both from (x, y)
 * and from (x, y + shift) of the first: in viewport coordinates and in the document's. A pixel whose shifted source
 * lies outside the first shot is not reported, nor is one within the shift, in its column, of a still pixel: one the
 * same in viewport coordinates that the document did not carry, since it differs from where the scroll would take it
 * from (x, y + shift of the first shot) or to (x, y - shift of the second). A fixed or sticky header is still, and the
 * page next to it is not judged, since its shifted source can lie under the header. The soft test holds the same way.
 *
 * With `regions` (per scroll pair, or null), what the page reports about it: `a` and `b`, rects (as `rects` above) of
 * the objects that move in both frames of reference, where each lies in the first and the second shot; `free`, rects
 * in the second shot's coordinates where those objects' own change lies; `held`, rects of objects that hold still in
 * the viewport and do not change. A pixel is not still when it, or the pixel it is compared with across the scroll,
 * lies in a mover's rect of its own shot: there the difference is the object's, not fixed content's. Inside `free` a
 * pixel differs when it differs from its shifted source alone, and no still pixel near it hides it: an object that
 * moves with neither frame of reference (a parallax card), or across a flat background, changes the two frames in
 * different places. One whose shifted source lies outside the first shot is compared in viewport coordinates. A pixel
 * whose shifted source lies inside `held` is not reported: the page there was hidden under an object that held still.
 *
 * The last few decoded shots are kept, so a shot in several pairs is decoded once.
 */
export declare const DIFF_PIXELS: string;
