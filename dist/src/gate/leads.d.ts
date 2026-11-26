import type { Frame, GatePage, InputSamples } from "./harness.ts";
import { type RuleContext } from "./kind-gate.ts";
import { type ObjectRecord } from "./objects.ts";
import { type Drawing } from "./poses.ts";
/**
 * Values that follow the input, and stepped drawings that run ahead of it or jump off it. The live rules aim a regrab
 * with `tracks`; the live `follows` rule and the scroll rules judge `leads` inside the input window.
 */
/** A value tracks an input axis when it moves with it this closely during the input (|r|). */
export declare const TRACK_R = 0.9;
/**
 * A value that moves with an input axis: the sample index it follows (a pointer's x is 1, y is 2; a scroll position
 * is 1), and how many value units it moves per input unit.
 */
export type Track = {
    axis: 1 | 2;
    name: string;
    slope: number;
};
/**
 * Each value in `names` that moves with an input axis from the input's first sample to its last, on the axis it follows
 * best, with |r| TRACK_R or more.
 */
export declare function fits(frames: Frame[], input: InputSamples, names?: string[]): (Track & {
    r: number;
})[];
/**
 * For each input axis, the value that moves with it during the input, and how many value units it moves per input
 * unit. Each value goes to the one axis it follows best, so one value never aims both.
 */
export declare function tracks(frames: Frame[], input: InputSamples): Track[];
export declare function linearFit(x: number[], y: number[]): {
    slope: number;
    r: number;
} | null;
/** A prefix fit judges a step only once it spans at least this many frames (fittedGains). */
export declare const PREFIX_FRAMES = 12;
/**
 * How far a value moves per input unit along one input axis: `leads` predicts the value from it. `at(frame)`, when
 * given, is the gain that judges a step into that frame. A live follower's gain is its fit (`fittedGains`); a scroll
 * value's is read from its rests (`restGains`).
 */
export type Gain = {
    name: string;
    axis: 1 | 2;
    gain: number;
    at?: (frame: number) => number;
};
/**
 * The fitted gain of each value in `names` that tracks an input axis (`fits`, |r| TRACK_R or more over the whole
 * input). A step is judged with the prefix gain: the fit on the frames from the input's first sample to the frame
 * before the step, once that spans PREFIX_FRAMES frames and tracks; before then, the whole fit. So a step never moves
 * the gain that judges it, and a jump that stays ahead is not taken for a steeper gain.
 */
export declare function fittedGains(frames: Frame[], input: InputSamples, names: string[]): Gain[];
/**
 * Where the raw window ends, in ms: the first frame at or after the input's last sample from which the pose line
 * (poses.ts `lineAt`) of every value in `names` holds still for REST_FRAMES frame steps, at most RAW_WINDOW_FRAMES on
 * and never past the last frame. It is the window inside which the harness reads stepped values raw
 * (OpenOptions.steppedInputRaw), read here from `raw`, frames on the 1/60 s grid from frame 0.
 */
export declare function rawWindowEnd(raw: Frame[], input: InputSamples, names: string[]): number;
/**
 * The rest gain of each value in `names` on a one-axis input. A rest is the end of a stretch where the input holds one
 * value, from the input's first sample to the end of the raw window (rawWindowEnd), with the value still over the
 * stretch's last REST_FRAMES frame steps. The gain is the median of the gains read between consecutive rests, a pair
 * whose input is equal left out; with none, it is read from the anchor (the value in the frame before the first sample,
 * at the input before it moves: inputBefore) to the rest furthest from it in input, so with one rest from the anchor to
 * that rest. A value that chases the input (a smoothed scroll) lags it, so a least-squares fit of it is biased; at rest
 * it has caught up. A value with no rest, or a gain of 0, has no gain: stepLeads does not judge it (leadNames), and the
 * envelope rule's stepped pop checks judge it inside the input window instead.
 */
export declare function restGains(frames: Frame[], input: InputSamples, names: string[]): Gain[];
/** A drawing step lands ahead of the input when it lands more than this many of its value's drawing steps (quantum), plus the input's own travel over the drawing before it (× gain), ahead of where the input puts it. */
export declare const LEAD_STEPS = 1.5;
/**
 * A drawing step jumps off the input when its residual is more than this many times the largest of its quantum, the
 * input's travel over the drawing before it (× gain), and, when that drawing is brief (shown under HOLD_MS) and the
 * step into it was judged, that step's |Δvalue|. A step taken while the input holds still across it may instead be one
 * quantum more than a same-way step next to it whose drawing is brief (stepLeads): grid rounding of a smooth speed.
 */
export declare const OFF_STEPS = 1.5;
/** A value has a quantum only with at least this many non-zero drawing steps; with fewer, only excursions judge it. */
export declare const QUANTUM_STEPS = 3;
/**
 * A value's drawing step: the median |Δvalue| of the non-zero steps between drawings `ds` (the drawings of the judged
 * window), steps into or out of a gone drawing left out. Null with fewer than QUANTUM_STEPS such steps.
 */
export declare const quantum: (ds: Drawing[]) => number | null;
/** A press of the pointer: when (ms), and where, in the viewport's CSS px. */
export type Press = {
    ms: number;
    at: [x: number, y: number];
};
/** The presses of `input`: a pointer presses at each sample that is down (no flag, or 1) after one that is not, or at its first sample when that is down. A scroll has none. */
export declare function pressesOf(input: InputSamples): Press[];
/**
 * A stepped value's failing drawing step in the input window. `steps` is how many of its drawing steps (quantum) it
 * lands ahead (`ahead`) or off the input (`off`), to 2 decimals; an `excursion` (poses.ts `excursions`) carries its
 * `lengths` in object lengths and its outgoing step's size in drawing steps (0 with no quantum).
 */
export type Lead = {
    name: string;
    ms: number;
    steps: number;
    kind: "ahead" | "off" | "excursion";
    lengths?: number;
};
/**
 * What stepLeads reads besides the frames: the stepped values to judge (`names`), their units, the viewport in CSS px,
 * whether the page is a scroll page (drawingsOf and fitSlopes), and the end of the raw window in ms (rawWindowEnd).
 */
export type LeadRead = {
    names: string[];
    units: Record<string, string>;
    view: {
        width: number;
        height: number;
    };
    scrolled: boolean;
    windowEnd: number;
};
/**
 * The stepped values in `names` that stepLeads judges: each that moves an object in `objects` (the page's record), is
 * not an `index` (by `units`), and has a gain in `gains`. A value with no gain does not follow the input (it moves on
 * its own, or the input never lets it rest), so stepLeads does not judge it: the envelope rule's stepped pop checks
 * judge it inside the input window too (leadWindow).
 */
export declare function leadNames(names: string[], units: Record<string, string>, gains: Gain[], objects: Record<string, ObjectRecord>): string[];
/**
 * The first failing drawing step of each stepped value that stepLeads judges (leadNames on `read.names`), inside the
 * input window. `raw` are the frames with every stepped value as its drawings
 * (GatePage `rawFrames`), on the 1/60 s grid from frame 0. A step is the change into a drawing, judged where the new
 * drawing starts; steps into or out of a gone drawing are not judged.
 *
 * - **Quantum.** The value's drawing step is the median |Δvalue| of its judged steps from the input's first sample to
 *   the raw window's end (quantum). With none, off and ahead are not judged.
 * - **Gain.** From `gains` by name (fittedGains or restGains; Gain `at` for the step's frame). A value with none
 *   is not judged at all (leadNames).
 * - **Anchor.** pred = v_anchor + gain × (input − input_anchor). The anchor is the value in the frame before the first
 *   sample, at the input before it moves (inputBefore). Each press in `presses` whose point lies inside the object's
 *   box in the first frame at or after it moves the anchor there: that frame's value and the press point. The step
 *   into that frame is not judged (a thumb that jumps to the press).
 * - **Off the input** (to the raw window's end). The residual across the boundary frame, |Δvalue − gain × Δinput|,
 *   may not pass OFF_STEPS × the largest of the quantum, |gain × the input's travel over the drawing before|, and the
 *   previous step's |Δvalue| when that step was judged and the drawing between the two (from one step to the next) is
 *   shown under HOLD_MS. So a value that eases after the input (a spring, a lerp) may grow its step up to OFF_STEPS
 *   times from one brief drawing to the next, while a jump out of a drawing held HOLD_MS or more is held to the
 *   quantum and the travel, unless the rounding allowance below excuses it.
 * - **Rounding while the input holds still.** A step taken while the input holds still across it (from the last frame
 *   of the drawing before to the new drawing, every sample there the same) is not off when its |Δvalue| is at most one
 *   quantum more than a same-way neighbour: the step before (when the drawing before is brief and that step was
 *   judged) or the step after (when the new drawing is brief and that step is judged). A value that moves by its own
 *   speed between 1 and 2 quanta a frame (a stiff spring, a fast chase) rounds to steps of k and k+1 quanta, and the
 *   neighbour after shows the speed it keeps. The cost: a one-quantum fault there (a skip that stays, steps that grow
 *   by one quantum a drawing) passes, and so does a step that a same-way step after it excuses (one cell, then five a
 *   drawing), a step out of a drawing held HOLD_MS or more among them.
 * - **Ahead** (first sample to last). Only while the input moves one way over the drawing before the step (it changes,
 *   and its samples there never turn back), in direction s = sign(gain × that change): s × (v − pred) may not pass
 *   LEAD_STEPS quanta plus |gain × the input's travel over the drawing before|. A drawing taken while the input holds
 *   still is not judged here: a spring that overshoots a still hand belongs to the overshoot rule.
 * - **Excursions** (to the raw window's end): rule 3 of the stepped pop rule on the raw drawings, with the value's
 *   fitted slopes (fitSlopes on `raw`).
 *
 * At one step off goes first, then ahead, then an excursion; each value gives its earliest failing step only.
 */
export declare function stepLeads(raw: Frame[], input: InputSamples, gains: Gain[], objects: Record<string, ObjectRecord>, presses: Press[], read: LeadRead): Lead[];
/**
 * The failure line of each value's failing step (stepLeads), under the rule `rule` (`follows` or `scroll`): a lead in
 * its drawing steps, a jump off the input in its drawing steps, and an excursion in object lengths, in the envelope
 * rule's excursion words. A step reported here is not reported again under `envelope:` (leadWindow).
 */
export declare function leads(raw: Frame[], input: InputSamples, gains: Gain[], objects: Record<string, ObjectRecord>, presses: Press[], read: LeadRead, rule: string): string[];
/** `leads` for a page's stepped values (ctx.stepped), each with its own gain from `gainsOf` (fittedGains or restGains). */
export declare function steppedLeads(page: GatePage, ctx: RuleContext, input: InputSamples, rule: string, gainsOf: typeof fittedGains): Promise<string[]>;
/** The stepped values the input rules judge, and the window (ms) the envelope rule leaves out for them. */
export type LeadWindow = {
    names: string[];
    window: [number, number];
};
/**
 * The stepped values the input rules judge on a live or scroll page (leadNames, for `input` and `gainsOf`, as
 * steppedLeads reads them), and the window the envelope rule leaves out for them: from the first sample of the page's
 * whole input (ctx.input) to the end of its raw window (rawWindowEnd), where the values rest after the input. Every
 * other stepped value is judged by the envelope rule's stepped pop checks there too.
 */
export declare function leadWindow(page: GatePage, ctx: RuleContext, input: InputSamples, gainsOf: typeof fittedGains): Promise<LeadWindow>;
