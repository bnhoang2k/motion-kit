import type { KindName } from "../core/types.ts";
import { type Frame, type GatePage, type InputSamples, type OpenOptions } from "./harness.ts";
import { type Verdict } from "./verdict.ts";
import { rangeOf, REST_FRAMES, series, stillEps, valueNames } from "./series.ts";
import { type Cause } from "./causes.ts";
import { type Periodic } from "./periodic.ts";
export { rangeOf, REST_FRAMES, series, stillEps, valueNames };
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
    /** What starts the motion on a choreo or sim page (causesOf the input). The other kinds do not read it. */
    causes?: Cause[];
    /** Values a copied bar's trace.json marks as held in drawings on purpose. The page reads them as their pose lines. */
    stepped?: string[];
    /**
     * Where rules put notes: information lines that never change the verdict. kindGate makes one per run and copies it
     * into KindVerdict `notes`.
     */
    notes?: string[];
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
/** An idle page's rules read this many periods of its longest designed loop, after its lead-in. */
export declare const IDLE_PERIODS_READ = 2;
/** How far the rules' `?seek` frames reach for this context. */
export declare const spanOf: (ctx: RuleContext) => number;
/** After a recorded input's last sample, the rules read this long more, so the page can settle. */
export declare const SETTLE_MS = 1000;
/** The span of a recorded input: SPAN_MS, the last trace row, or the last input sample plus SETTLE_MS, the latest. */
export declare function recordedSpan(input: InputSamples, rowTimes: number[]): number;
/** Fails when the input runs past the span: the rules would judge only part of it. */
export declare function inputPastSpan(input: InputSamples | null, spanMs: number): string[];
/** A value's tolerance floor: its unit's floor (TOLERANCE_FLOORS), or 1% of its range for a unit with none. */
export declare const unitFloor: (unit: string | undefined, range: number) => number;
/** Kinds whose motion starts from causes: their shared rules read the caused windows and leave loops out. */
export declare const CAUSED_KINDS: readonly KindName[];
/** On a choreo or sim page the rules read at least this long after the last cause stops: sim's 4 s rest bound, then a second more. */
export declare const CAUSE_SETTLE_MS = 5000;
/** How far past the last cause's stop the gate looks for the end of a choreo or sim sequence. The rules read SETTLE_MS past that end. */
export declare const SEQUENCE_SCAN_MS = 15000;
/** How long the gate watches a page with no input for its load motion to end. */
export declare const LOAD_SCAN_MS = 15000;
export declare const round: (n: number) => number;
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
 * after `timeoutMs`. Values named in `ignore` (loops) are not read.
 */
export declare function waitForRest(live: GatePage, timeoutMs?: number, ignore?: Set<string>): Promise<number | null>;
/** A pulse's attack, from its start to its peak, is 40 to 120 ms. */
export declare const ATTACK_MS: readonly [40, 120];
/**
 * The values in `frames` that loop: a value that starts the same way (an onset in the same
 * direction) at a fixed period, as the envelope's loop test reads it, or a value that never holds
 * still and peaks at the same height (within 2% of its range) at a fixed period, still moving at the
 * end. A damped spring's peaks shrink, so it is no loop.
 */
export declare function loopNames(frames: Frame[], windows: [number, number][], cuts: number[]): Set<string>;
/** What the choreo and sim rules do with a value: a loop may run forever, a position (px or deg) is a body, the rest are other. */
export type Role = "loop" | "position" | "other";
/**
 * Each value's role, read once per page from its frames over LOOP_SCAN_MS with the gate's input:
 * loopNames finds the loops, and a value in px or deg that is no loop is a position.
 */
export declare function rolesOf(page: GatePage, ctx: RuleContext): Promise<Map<string, Role>>;
/** The loops among `roles`. */
export declare const loopsIn: (roles: Map<string, Role>) => Set<string>;
/** `rule`, run only on a page with a loop: a choreo or sim page's loops get the idle rules. */
export declare function forLoops(rule: KindRule): KindRule;
/**
 * The windows of motion a person caused, which the envelope and overshoot rules leave out. On a
 * live, idle or scroll page: the input window. On a choreo or sim page: each cause's caused window,
 * from the cause to the end of the sequence it starts, pauses and loops not counted.
 */
export declare function exemptWindows(page: GatePage, frames: Frame[], ctx: RuleContext): Promise<[number, number][]>;
/**
 * Where a stepped value's chains end (`overshootIn`'s `holdAt`): the frame each held drawing (poses.ts `heldPoses`)
 * gives way to the next, where its pose line reaches it, from its raw frames `raw`. A slow drawing among slow ones
 * (threes into ones) holds nothing.
 */
export declare function heldDrawings(raw: number[]): Set<number>;
/** Inside a designed loop, a settle may pass its rest by at most this share of its move. */
export declare const LOOP_OVERSHOOT = 0.5;
/** Whether value `name` on `page` is a designed loop (periodic.ts), read once per page and value. */
export declare function periodicFor(page: GatePage, name: string, unit: string | undefined): Promise<Periodic | null>;
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
/** Under reduced motion a choreo or sim page shows a state held at least this long, away from its start, in a sequence that comes back. */
export declare const HOLD_SHOWN_MS = 500;
/** The reduced-motion check on a choreo or sim page plays the last cause once more this long after its sequence ends. */
export declare const REDUCED_REPEAT_MS = 500;
/**
 * Reduced motion: input still answers, the target is reached in 1 frame, and the still frame is not
 * the blank start state. A choreo or sim page has its own check (causedReduced). The blank start state is a start the page leaves and never comes back to
 * without reduced motion (an entrance). A scroll page instead moves between stepped states (steppedStates).
 */
export declare const reducedMotion: KindRule;
/**
 * Stepped values (a bar's trace.json `stepped`): each must be a value the page reports, it must change over the
 * span, and it must move an object in `__state().objects`, whose length its drawings are judged in. A frozen value
 * marked stepped would hide nothing, but it marks nothing either.
 */
export declare const stepped: KindRule;
/**
 * Objects: the record a page reports in `__state().objects` is whole in every frame the rules read, each `px` value
 * moves its box, and each box spike has a cause (objects.ts `checkObjects`). A page that reports none passes.
 */
export declare const objects: KindRule;
/**
 * Drawn: the boxes in a page's object record hold what changes on screen, judged on screenshot pairs (drawn.ts). A
 * page that reports no objects passes. Its notes go to the run's notes.
 */
export declare const drawn: KindRule;
/**
 * Values: each value the page reports is a finite number in every frame, from the first frame that holds it on. A
 * value that turns NaN or Infinity, or goes missing, for a frame hides what it does there from every other rule, while
 * the renderer drops the bad frame and the value jumps.
 */
export declare const values: KindRule;
export declare const ALL_RULES: KindRule[];
/** The page's kind from its marker, and whether it is a copied bar; or the failure line. */
export declare function pageKind(html: string, file: string): {
    kind: string;
    bar: boolean;
} | {
    failure: string;
};
/** The values a trace marks as stepped (held in drawings on purpose), or none. */
export declare const steppedOf: (trace: {
    stepped?: unknown;
} | undefined) => string[];
/** A choreo or sim page still moving SEQUENCE_SCAN_MS past the last cause's stop: the rules do not read its end. */
export declare const sequenceCutLine: (input: InputSamples | null) => string;
/**
 * The input the kind gate would play on `file` and how far its seek frames reach. A page with no marker, an unknown
 * kind or a kind with no gate plays no input over SPAN_MS. The frame sheet draws the page with this, so it shows what
 * the gate judges.
 */
export declare function pageInput(file: string): Promise<{
    input: InputSamples | null;
    spanMs: number;
}>;
/**
 * Runs Gate B on one page: reads its marker, runs the static audit, then the gate checks on
 * nothing (a missing clock hook, zero frames, an input past the span) and every rule of the page's
 * kind. A page with no marker, an unknown kind, or a kind with no rules in this version fails; it
 * never passes. The audit skips its literal check only for a copy of one of the kit's own bars
 * (literalExemption): the bar's slug, with a MOTION block the same as the kit's, byte for byte.
 */
export declare function kindGate(file: string): Promise<KindVerdict>;
