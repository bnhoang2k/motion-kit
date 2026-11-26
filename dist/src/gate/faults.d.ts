import { type BarJson } from "../core/bar.ts";
/**
 * The planted faults of the bar gate (Gate A). Each one returns the page's HTML with one fault
 * planted, and the bar gate must fail the result. A fault that cannot be planted throws one clear
 * line, starting with the fault's name, so a test never passes on a fault that changed nothing.
 *
 * - `dial25`: the first `bar.json` dial, off by 25%. Its value in the page's `MOTION` block is
 *   wrapped and multiplied: `9.7/60` becomes `(9.7/60)*1.25`.
 * - `linear`: the first curve in the `MOTION` block, in source order, swapped for linear. A curve
 *   is one of: an array of 4 numbers whose first and third lie in 0 to 1 (cubic-bezier control
 *   points), which becomes `[0, 0, 1, 1]`; a string that names an easing (a CSS easing such as
 *   `ease-out` or `cubic-bezier(...)`, or a Motion easing name such as `easeOut`), which becomes
 *   `"linear"`; or a one-argument function (`(t) => ...`, `function (t) {...}`), which becomes
 *   `(t) => t`. A curve that is already linear is skipped. A bar.json `faults` entry named
 *   "linear" wins over all of these: a find-and-replace pair that makes the main curve linear,
 *   applied the same way as `own`. A bar whose main curve has no such form in MOTION (a spring set
 *   by omega and zeta, an exponential follow, a cosine in code) needs that entry, and the entry
 *   keeps a minor easing in MOTION from standing in for the main curve.
 * - `reducedIgnored`: every `prefers-reduced-motion` query in the page turns false, in script and
 *   in CSS: `(prefers-reduced-motion: reduce)` and `(prefers-reduced-motion)` become `not all`, and
 *   `(prefers-reduced-motion: no-preference)` becomes `(min-width: 0px)`, which always holds.
 * - `{ own: name }`: the `bar.json` `faults` entry with that name, a find-and-replace pair whose
 *   `find` occurs exactly once in the page.
 */
export type Fault = "dial25" | "linear" | "reducedIgnored" | {
    own: string;
};
export declare const STANDARD_FAULTS: readonly ["dial25", "linear", "reducedIgnored"];
/** The name of the `bar.json` `faults` entry that `linear` falls back to. */
export declare const LINEAR_FAULT = "linear";
/** Returns `html` with `fault` planted. Throws one clear line when the fault cannot be planted on this page. */
export declare function plantFault(html: string, fault: Fault, bar: BarJson): string;
