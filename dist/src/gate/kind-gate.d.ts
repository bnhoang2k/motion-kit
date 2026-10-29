import type { KindName } from "../core/types.ts";
import { type Frame, type GatePage, type InputSamples, type OpenOptions } from "./harness.ts";
import { type Extents } from "./extents.ts";
import { type Verdict } from "./verdict.ts";
import { rangeOf, REST_FRAMES, series, stillEps, unitFloor, valueNames } from "./series.ts";
import { type Cause } from "./causes.ts";
import { type Periodic } from "./periodic.ts";
export { rangeOf, REST_FRAMES, series, stillEps, unitFloor, valueNames };
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
     * A live or scroll page is also read to SETTLE_MS past the end of the sequence the input starts (liveSpan), however
     * long that is, up to SEQUENCE_SCAN_MS past the input.
     */
    spanMs?: number;
    /** What starts the motion on a choreo or sim page (causesOf the input). The other kinds do not read it. */
    causes?: Cause[];
    /** Values a copied bar's trace.json marks as held in drawings on purpose. The page reads them as their pose lines. */
    stepped?: string[];
    /** Values a copied bar's trace.json marks as a control's keyframe tween beside the bodies. A sim page's `energyFalls` leaves them out. */
    tweens?: string[];
    /**
     * Values a copied bar's trace.json declares as an edge of many moving parts, by value name, with the edge and the parts
     * (extents.ts). The `extents` rule guards each one; the envelope's pulse attack and the `overshoot` rule leave out
     * those whose guard passes.
     */
    extents?: Extents;
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
/** The least the `?seek` frames reach, in ms, when the input starts INPUT_START_MS in. A sequence that runs on is read to its end (liveSpan, causedSpan). */
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
/** The page is at rest when each value but its loops changes by no more than its floor over this long. */
export declare const REST_WINDOW_MS = 1000;
/**
 * Polls a live page's values every 50 ms until it is at rest, and returns the page's clock (`performance.now()`) when it
 * came to rest, or null when it is still moving after `timeoutMs`. Values named in `ignore` (loops) are not read.
 *
 * It came to rest when no value moved more than LIVE_STILL between two reads 50 ms apart for 150 ms (the clock at the third
 * quiet read is what the rAF count starts from), and the page is at rest only when, over the last REST_WINDOW_MS, each
 * value's total change is within `floors[name]` (LIVE_STILL for a value with no floor): a creep too slow for the first
 * test to see (0.001 in 50 ms is 0.02 a second) is still moving. A value a read lacks is moving.
 */
export declare function waitForRest(live: GatePage, timeoutMs?: number, ignore?: Set<string>, floors?: Record<string, number>): Promise<number | null>;
/** A pulse's attack, from its start to its peak, is 40 to 120 ms. */
export declare const ATTACK_MS: readonly [40, 120];
/**
 * The values in `frames` that loop by their onsets or by one steady speed: the two branches of the loop sort that read
 * the frames alone (loopSet adds the values periodOf finds). A value that starts the same way (an onset in the same
 * direction) 3 or more times at a fixed period of LOOP_PERIOD_MS's lower bound or more, as the envelope's loop test reads
 * it, and keeps its range each period: every period's swing is as large as the first's, and, but for a value in deg
 * (a hand that ticks round), it starts and tops out at the same levels: each period's levels and swing are the first's,
 * within the unit floor (and what a crest known only to a frame can be off). A per-period step in px, scale or opacity (a
 * staircase) or a swing that grows each beat is no loop, however small: the drift of the whole read is held to the floor. The
 * starts repeat to the end: the last start is within one period, plus a frame, of the last frame. A piece that steps
 * or breathes a few times and holds stops before the end, so it is no loop. A value that moves at one steady speed over
 * the last 500 ms (steadyStep: a marquee, a strip that drifts) is a loop too, whatever it did before a hand held it or
 * eased it back to its drift. `causeMs` is when the first cause starts: a tap on a choreo or sim page, the first input
 * sample on a live or scroll page (0 or none for a page with no input, or that starts on load). With a cause the steady
 * value must move the same in `quiet`, the frames read with no input; with none it must hold that speed from the end of
 * its lead-in (steadyLoop). A value that starts at a cause and never stops (a tween with no clamp, a body with no friction, a fling
 * clamped to a minimum speed) looks the same at the end of the read, and is a fault the span and rest rules must still see.
 */
export declare function loopNames(frames: Frame[], windows: [number, number][], cuts: number[], causeMs?: number, units?: Record<string, string>, quiet?: Frame[]): Set<string>;
/**
 * The loops among the values of `frames`: loopNames' (onsets, steady speed) and every value periodicFor finds. This is
 * the one sort every rule reads (rolesOf), and the one that finds where a sequence ends (causedSpan). With a first cause
 * the steady speeds are judged against the page read with no input (quietFrames).
 */
export declare function loopSet(page: GatePage, frames: Frame[], cuts: number[], causeMs?: number): Promise<Set<string>>;
/** What the choreo and sim rules do with a value: a loop may run forever, a position (px or deg) is a body, the rest are other. */
export type Role = "loop" | "position" | "other";
/**
 * Each value's role, read once per page from its frames over LOOP_SCAN_MS (a choreo or sim page: loopScanEnd) with the gate's input:
 * loopSet finds the loops, and a value in px or deg that is no loop is a position.
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
/**
 * Whether value `name` on `page` is a designed loop (periodic.ts), read once per page and value. A value that moves on by
 * a step each period (a staircase), or whose swing grows or shrinks each period, is a loop only when what it adds up to over
 * the read (`drift`) is within its unit's floor, or in deg, a hand that ticks round: in any other unit it is a move that
 * never stops, however small each period's step.
 */
export declare function periodicFor(page: GatePage, name: string, unit: string | undefined): Promise<Periodic | null>;
/** The floor of each value but `loops` that `frames` (and a page with no frames, its units) hold: its unit's floor, at least LIVE_STILL. */
export declare function restFloors(frames: Frame[], units: Record<string, string>, loops: Set<string>): Record<string, number>;
/**
 * How far each value moves in one frame while the input plays (from a frame before its first sample to a frame after its
 * last), the most any frame step takes it. A live page reads the pointer once a frame, and the gate's pointer events
 * come on the wall clock, so the last move of the hand can reach a frame later than in the `?seek` run, or not at all: a value
 * the hand drives lands up to this far from where its `?seek` frames end (restApart's `slack`).
 */
export declare function inputSlack(seek: Frame[], input: InputSamples | null): Record<string, number>;
/**
 * The check of the live page's rest against the `?seek` frames' (loopStopsAtRest, and resumes after a return): the first
 * value but the loops whose live rest `values` is more than its tolerance from its `?seek` rest, the last frame of `seek`,
 * on either side, or that `values` does not report at all. The tolerance is the value's unit floor or its `slack`
 * (inputSlack), the greater. A page stops short of its `?seek` rest when its live loop ends early, and goes past it when it
 * overruns (a panel that flies on past its slot, a badge that grows to 3): both are a live page that does not play the
 * sequence the `?seek` frames show. A page that draws random values (a burst of particles) is expected to seed them as `?seek`
 * does, so that a live run lands where its `?seek` frames end; a page that draws unseeded random values live can fail this
 * compare. A value the `?seek` frames never report at the end is not compared. Null when every value meets its `?seek` rest.
 * A live page may run its frames longer than 1/60 s, but a page that has stopped lands where its `?seek` frames end,
 * whatever its frame times were.
 */
export declare function restApart(values: Record<string, number>, seek: Frame[], loops: Set<string>, units: Record<string, string>, slack?: Record<string, number>): {
    name: string;
    live: number | null;
    seek: number;
} | null;
/**
 * How long the gate lets a live page play before it looks for rest: the end of the sequence the `?seek` frames show (the last
 * move of a value that is no loop), or none when that move reaches the end of the scan, since a sequence that never ends in the
 * frames (span says so) has no end to wait for, and the live page is judged for rest where it stands.
 */
export declare function sequenceWaitMs(seek: Frame[], loops: Set<string>, ctx: RuleContext): number;
/**
 * The browser's own GL performance note, such as `GPU stall due to ReadPixels`. Chromium writes up to 4 of them in the
 * first WebGL context of a fresh browser; a page can neither cause nor stop them, and which page sees them depends on run
 * order. consoleClean leaves out this one warning. A page's own warning and every error still count.
 */
export declare const BROWSER_NOTE: RegExp;
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
 * Tweens (a bar's trace.json `tweens`): a control that acts out its meaning with a keyframe tween beside the bodies, a
 * tile that bobs or shakes as it is tapped. The sim gate's `energyFalls` leaves a named value out: a CSS ease segment
 * ends at zero speed and the next starts at 0.4 of its mean speed, which reads as a bounce that rises, and a kick at a
 * body's apex looks the same, so motion alone cannot tell them apart. So the name is guarded: each must be a value the
 * page reports, it must change, and after every cause it must end where it was just before that cause (within its
 * unit's floor) and hold still there. A thrown body lands elsewhere, so it cannot be named. A window a later cause cuts
 * off while the value still moves is not read at its end, and the next window's start is the home the value left.
 * A returning body would pass all that, a ball that hops 10, 20, then 40 px and lands at 0 each time, so inside each
 * window the peaks (the value's local extremes, as distance from home) must not grow: a bob has equal peaks, a shake
 * falling ones, and a later peak further out than an earlier one by more than the floor is a bounce that rises. A
 * peak within the floor of home is noise and does not count. A small dip before a larger swing (an anticipation) reads
 * as a swing that grows, so it is left out of the class. Only a
 * sim page may name tweens.
 */
export declare const tweens: KindRule;
/**
 * Objects: the record a page reports in `__state().objects` is whole in every frame the rules read, each `px` value
 * moves its box, and each box spike has a cause (objects.ts `checkObjects`). A page that reports none passes.
 */
export declare const objects: KindRule;
/**
 * Extents (a bar's trace.json `extents`): a value that is an edge of many moving parts, such as the box around 24 cards
 * on one canvas. It turns when another part becomes the extreme one, not because a body passes its rest, so a checked
 * extent has no pulse attack bound in the envelope and is left out of `overshoot`; pops, fades, values and every kind
 * rule still read it. The name is guarded (extents.ts `checkExtents`): in every frame the value is that edge of the union
 * of its drawn parts' boxes, within the px floor; the parts are a group; the edge passes from one part to another at least
 * once; and no part turns round and comes to rest while it holds the edge. So a single body cannot be named, with a part beside it or
 * without. A page that declares none passes. The `drawn` rule checks each part's box against the screen.
 */
export declare const extents: KindRule;
/** The steps of a checked extent where who is in its union changes, by the frame's time in whole microseconds: how far the edge moved over the parts drawn in both frames. */
type MembershipSteps = Map<number, number>;
/**
 * The declared extents whose guard passes, by value name: the values the envelope's pulse attack and `overshoot` leave
 * out. Each maps to its membership steps: the frame steps where a part comes back or goes gone, with how far the edge
 * moved in that step over the parts drawn in both frames (membershipSteps). The envelope reads the extent as its parts
 * moved it (`byMotion`).
 */
export declare function checkedExtents(page: GatePage, ctx: RuleContext): Promise<Map<string, MembershipSteps>>;
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
/**
 * Sudden jumps: no value moves in one frame step what it should spread over the step (self-checks.ts suddenJumps). The
 * gate seeks each step that moves a share of the value's range, or far more than the steps beside it, at sub-steps, and
 * judges whether the change lands in one of them. A value that is not a finite number in every frame is for `values`,
 * and a stepped value is read on its drawings by `stepped`, so both are left out. A page that moves a value in whole
 * frames only cannot be read between frames: the run of steps is skipped with a note.
 */
export declare const suddenJumpsRule: KindRule;
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
/** The values a trace marks as a control's keyframe tween (the sim gate's energyFalls leaves them out), or none. */
export declare const tweensOf: (trace: {
    tweens?: unknown;
} | undefined) => string[];
/**
 * How far the gate reads a choreo or sim page to sort its loops from its sequences: LOOP_SCAN_MS, or SEQUENCE_SCAN_MS
 * past the last cause's stop, the later. causedSpan finds where the sequence ends and rolesOf sorts the loops, both over
 * this one read, so they agree on what loops.
 */
export declare const loopScanEnd: (causes: Cause[]) => number;
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
