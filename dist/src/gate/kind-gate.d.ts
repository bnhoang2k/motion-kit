import type { KindName } from "../core/types.ts";
import { type Frame, type GatePage, type InputSamples, type OpenOptions } from "./harness.ts";
import { type Verdict } from "./verdict.ts";
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
     */
    spanMs?: number;
};
export type KindRule = {
    name: string;
    check(page: GatePage, ctx: RuleContext): Promise<string[]>;
};
/** `distances` and `notes` are information lines: they never change the verdict. */
export type KindVerdict = Verdict & {
    kind: KindName | null;
    distances: string[];
    notes: string[];
};
/** How far the `?seek` frames reach, in ms, when the input starts INPUT_START_MS in. */
export declare const SPAN_MS = 3000;
/** How far the rules' `?seek` frames reach for this context. */
export declare const spanOf: (ctx: RuleContext) => number;
/** After a recorded input's last sample, the rules read this long more, so the page can settle. */
export declare const SETTLE_MS = 1000;
/** The span of a recorded input: SPAN_MS, the last trace row, or the last input sample plus SETTLE_MS, the latest. */
export declare function recordedSpan(input: InputSamples, rowTimes: number[]): number;
/** Fails when the input runs past the span: the rules would judge only part of it. */
export declare function inputPastSpan(input: InputSamples | null, spanMs: number): string[];
/** How long the gate watches a page with no input for its load motion to end. */
export declare const LOAD_SCAN_MS = 15000;
/** A value that holds still for this many frame steps is at rest. */
export declare const REST_FRAMES = 3;
export declare const round: (n: number) => number;
/** The names of every value any frame holds. */
export declare function valueNames(frames: Frame[]): string[];
/** A value's series over the frames; NaN where a frame lacks it. */
export declare function series(frames: Frame[], name: string): number[];
export declare function rangeOf(vs: number[]): number;
/** A change smaller than this does not count as motion for a value with this range. */
export declare const stillEps: (range: number) => number;
/** The time of the first frame at or after `fromMs` from which every value holds still for REST_FRAMES steps, or the last frame's time. */
export declare function restAfter(frames: Frame[], fromMs: number): number;
/** The span the input drives: from its first sample until the page rests after its last one. Null with no input. */
export declare function inputWindow(frames: Frame[], input: InputSamples | null): [number, number] | null;
/**
 * When the synthetic input starts, from the page's frames with no input (its load motion): INPUT_START_MS in, or
 * INPUT_START_MS after the last frame step in which a value moves, when that comes later. So the input meets a page
 * at rest, as it does on a page with no load motion. A page still moving in its last REST_FRAMES frame steps (a
 * loop) never settles, and keeps INPUT_START_MS. The time sits on the 1/60 s frame grid.
 */
export declare function inputStartAfter(frames: Frame[]): number;
/** Opens the same file as `page` with the same input, changing only `options`. */
export declare function reopen(page: GatePage, options: OpenOptions): Promise<GatePage>;
/** Plays the input on a live page, when there is one. */
export declare function drive(live: GatePage, ctx: RuleContext): Promise<void>;
/**
 * Polls a live page's values every 50 ms until no value has moved for 150 ms, and returns the
 * page's clock (`performance.now()`) at that point. Returns null when the page is still moving
 * after `timeoutMs`.
 */
export declare function waitForRest(live: GatePage, timeoutMs?: number): Promise<number | null>;
/** A pulse's attack, from its start to its peak, is 40 to 120 ms. */
export declare const ATTACK_MS: readonly [40, 120];
/** Under reduced motion, a value on a scroll page takes at most this many still states over the sweep. */
export declare const STILL_STATES_MAX = 6;
/** Under reduced motion, an opacity value on a scroll page may reach its new state by a fade this long, at most. */
export declare const REDUCED_FADE_MS = 300;
type ScrollInput = Extract<InputSamples, {
    kind: "scroll";
}>;
/**
 * The scroll input of the reduced-motion sweep, one sample a frame from `startMs` (on the 1/60 s grid): down in
 * SWEEP_STEP_PX steps to `maxY` (at most SWEEP_MAX_PX), a hold, back up to the top in the same steps, and a hold.
 */
export declare function sweepInput(startMs: number, maxY: number): ScrollInput;
/**
 * Reduced motion: input still answers, the target is reached in 1 frame, and the still frame is not
 * the blank start state. The blank start state is a start the page leaves and never comes back to
 * without reduced motion (an entrance). A scroll page instead moves between stepped states (steppedStates).
 */
export declare const reducedMotion: KindRule;
export declare const ALL_RULES: KindRule[];
/** The page's kind from its marker, and whether it is a copied bar; or the failure line. */
export declare function pageKind(html: string, file: string): {
    kind: string;
    bar: boolean;
} | {
    failure: string;
};
/**
 * Runs Gate B on one page: reads its marker, runs the static audit, then the gate checks on
 * nothing (a missing clock hook, zero frames, an input past the span) and every rule of the page's
 * kind. A page with no marker, an unknown kind, or a kind with no rules in this version fails; it
 * never passes. The audit skips its literal check only for a copy of one of the kit's own bars
 * (literalExemption): the bar's slug, with a MOTION block the same as the kit's, byte for byte.
 */
export declare function kindGate(file: string): Promise<KindVerdict>;
export {};
