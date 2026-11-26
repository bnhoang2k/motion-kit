import type { Frame } from "./harness.ts";
import { type Box, type BoxChange, type Explained, type Slopes } from "./objects.ts";
/**
 * Stepped values: motion held in drawings on purpose, as cel on twos or threes, stop-motion and sprites are. A bar's
 * trace.json names them in `stepped`. The rules read such a value two ways:
 *
 * - Its poses and rests (`poses`, `isRest`), and the pops between its drawings (`drawingsOf`, `stepMeasure`,
 *   `stepPops`), on the raw frames, measured in lengths of the object the value moves.
 * - Its pose line (`lineAt`, `poseLine`): a continuous line through its drawings, for the rules that need to see a
 *   move as one move (onsets, rests, loops, overshoot). The harness reports it in place of the raw value.
 *
 * Every function here works on frames of the 1/60 s grid, by index.
 */
/** A run of frames that hold one drawing: the frame it starts at, how many frames it holds, and its value. */
export type Pose = {
    start: number;
    frames: number;
    value: number;
};
/**
 * A run is a rest when it holds at least this many times the typical run beside it... 3, not 2: mixed timing puts
 * threes (7 and 8 frames) next to ones at 24 (2 and 3 frames), and those slow drawings are not stops.
 */
export declare const REST_RATIO = 3;
/** The poses of a series: a frame belongs to the pose before it when it is within `eps` of that pose's value. */
export declare function poses(v: number[], eps: number): Pose[];
/**
 * Pose k is a rest: it holds REST_FRAMES frames or more, and at least REST_RATIO times the lower median length of up
 * to NEIGHBOURS poses on each side. So a rest is long next to the drawings around it, at any drawing rate, and a
 * steady train of equal holds has none.
 */
export declare function isRest(ps: Pose[], k: number): boolean;
export declare const restsOf: (ps: Pose[]) => boolean[];
/**
 * The pose line at frame position `fi` (between frames too), or null where it keeps the raw value. The line is
 * causal: it never moves before the raw value. Each drawing's knot sits where the next drawing starts, so over a
 * drawing the line goes from the drawing before it to this one, and reaches each drawing one drawing late. Into a
 * rest it glides over the length of the drawing before (at most the rest's own length, less a frame), then holds. A
 * move from a rest straight to the next rest keeps its raw jump (null), and so does a value that is not a number.
 */
export declare function lineAt(ps: Pose[], rests: boolean[], fi: number): number | null;
/** The pose line of a series, one value per frame. */
export declare function poseLine(v: number[], eps: number): number[];
/**
 * Which poses are held: shown HOLD_MS or more, and at least HOLD_RATIO times the lower median length of up to
 * NEIGHBOURS poses on each side, each side apart. A slow drawing among slow ones (threes into ones) holds nothing. A
 * side with no poses gives no veto. With `cutSides` (the pop checks), neither does a side that the start or end of
 * `ps` cuts short of NEIGHBOURS poses: a loop's read starts at a drawing whose drawings before it are not read, so its
 * first drawings would otherwise be judged against a part of their neighbours. The overshoot rule's holds keep the
 * default.
 */
export declare function heldPoses(ps: Pose[], cutSides?: boolean): boolean[];
/** A run of drawing steps is a spike when each moves more than this many times as fast as the steps just outside it... */
export declare const SPIKE_RATIO = 3;
/** ...and the run is at least this many object lengths in all. */
export declare const SPIKE_MIN = 0.25;
/** A step of more than this many object lengths is a teleport between two rests, and so is an excursion this long. */
export declare const TELEPORT_LENGTHS = 1;
/** A step goes out and back when the next step takes it at least this share of the way back. */
export declare const OUT_AND_BACK = 0.5;
/**
 * A look value (opacity, an angle, a ratio) leaves its object's box as it is, so its steps are measured in its own
 * unit: a change of this much counts as one object length. A value in `index` (a sprite frame, a count) never pops.
 */
export declare const LOOK_LINE: Record<string, number>;
/**
 * One drawing of a stepped value: a pose, wholly drawn or wholly gone (`gone`, by goneIn), with its object's box and
 * the scroll in its first frame (`start`: `box`, `scroll`) and in its last drawn frame (`endFrame`: `endBox`,
 * `endScroll`; a gone drawing's last frame). The boxes are null when the value moves no object. A step is measured
 * across the boundary frame, from one drawing's `endBox` to the next one's `box` (stepMeasure).
 */
export type Drawing = Pose & {
    box: Box | null;
    endBox: Box | null;
    scroll: number;
    endScroll: number;
    endFrame: number;
    gone: boolean;
};
/**
 * The drawings of value `name` (poses within `eps`), with the boxes of `object` in a viewport of `view` CSS px, and the
 * scroll when `scrolled` (else 0).
 *
 * - Each pose is split wherever its box turns from drawn to gone or back (goneIn: a box of 1 by 1, or one wholly
 *   outside the viewport), so each drawing is wholly drawn or wholly gone.
 * - A gone gap shorter than HOLD_MS is bridged: its frames join the drawing before it, and drawings of equal value
 *   (within `eps`) on each side then merge, so the step is judged from the last drawn drawing to the next. A gap is
 *   not bridged when the box leaves through the viewport's edge (the last drawn box before it, or the first after it,
 *   reaches past the viewport: a wrap off screen is honest), nor at the start or end of the frames.
 * - A longer gone gap stays, one gone drawing for each pose in it.
 */
export declare function drawingsOf(frames: Frame[], name: string, object: string | null, eps: number, view: {
    width: number;
    height: number;
}, scrolled: boolean): Drawing[];
/**
 * Whether drawing `i` of `ds` is a rest: shown REST_MS or more, shown from the start of the read (frame 0: the page
 * opens on it), or held to the end of the read, which is frame `lastFrame` (the caller's span plus its read-ahead, as
 * a frame index).
 */
export declare function isRestDrawing(ds: Drawing[], i: number, lastFrame: number): boolean;
/**
 * One drawing step's parts, in object lengths (stepParts): `position` its centre move, over the bigger box's length;
 * `size` its size change, over the smaller box's length; `look` a look value's change over its LOOK_LINE. Its speeds:
 * `speedPos` the centre move in px, and `speedLook` the look change in its own unit, each per ms of the time the step
 * takes.
 */
export type StepMeasure = {
    position: number;
    size: number;
    look: number;
    speedPos: number;
    speedLook: number;
};
/**
 * What stepMeasure needs from outside the two drawings: `shifted`, the object's fit was scroll-shifted (ObjectFit
 * `shifted`), so a step with no slopes adds the scroll change to its centre y; `heldBefore`, the drawing before the step
 * is a hold (heldPoses), so the step's time is how long the drawing after it was shown; `ratioLook`, a `ratio` value is
 * a look value for the whole run (ratioIsLook); `explained`, what the object's fitted values explain of its box change
 * from a's `endFrame` to b's `start` (explainedBy), which a step with no slopes takes off. Other units ignore
 * `ratioLook`.
 */
export type StepContext = {
    shifted: boolean;
    heldBefore: boolean;
    ratioLook: boolean;
    explained: BoxChange;
};
/**
 * Whether a `ratio` value with drawings `ds` is a look value, decided once for the run: its own effect on its box stays
 * within FOLLOW_PX on every step where it changes between two drawn drawings. With `slopes` (fitSlopes), that effect
 * is each of |cx·Δv|, |cy·Δv|, |w·Δv| and |h·Δv|, so another value moving the same box does not count; with none, its
 * own change of the box across the boundary frame (ownChange: the scroll change added to y when `shifted`, less what
 * `explained` says the object's fitted values did). A value with no such step is a look value.
 */
export declare function ratioIsLook(ds: Drawing[], slopes: Slopes | null, shifted: boolean, explained: Explained): boolean;
/**
 * The step from drawing `a` to drawing `b` of a value in `unit`, measured across the boundary frame (a's `endBox` to
 * b's `box`) with the value's `slopes` (fitSlopes; null where none fit).
 *
 * - **Look values:** `opacity`, `deg` (always: a rotating box's width and height do not change linearly with the angle;
 *   wrapped to the shortest turn), and `ratio` when `how.ratioLook` (ratioIsLook, decided once for the run, so every
 *   step of one value is measured in one unit). Their `look` is |Δvalue| over LOOK_LINE[unit]; position and size are 0.
 * - **Box parts:** every other unit, by stepParts (a `ratio` that moves its box, too): with slopes,
 *   the value's own part, so another value moving the same box never adds to it; with none, the box's change across
 *   the boundary frame, plus the scroll change when the object is fitted scroll-shifted, less what the object's
 *   fitted values explain there (`how.explained`).
 * - An `index` measures 0, and so does a step into or out of a gone drawing, or one with a value that is not a number.
 *
 * Speed is a part over the time the step takes: how long `a` was shown, or `b` when `a` is a hold.
 */
export declare function stepMeasure(a: Drawing, b: Drawing, unit: string | undefined, slopes: Slopes | null, how: StepContext): StepMeasure;
/**
 * A pop between drawings, reported at `atFrame`, where the drawing after its first step starts:
 *
 * - `spike`: a run of `drawings` steps (1 to 3), each faster than SPIKE_RATIO times the moving steps just outside it
 *   (on one side only when a position run that goes out and comes back sits next to a hold), `lengths` long in all, and
 *   `ratio` the smallest of its steps' speeds over the faster outside step's. A short excursion is a spike too:
 *   `drawings` 2, `lengths` its step out.
 * - `teleport`: a step `lengths` long between two rests; or a move from rest to rest through one or two brief
 *   in-betweens, `lengths` its largest step's position part or its net size change from rest to rest, whichever is
 *   longer (reported at that step, or at the move's first step for the size change); `drawings` 1.
 * - `outAndBack`: an excursion longer than the object, `lengths` its step out; `drawings` 2.
 *
 * `ratio` is 0 when there was no outside step to compare with (a teleport is never compared).
 */
export type StepPop = {
    atFrame: number;
    kind: "spike" | "teleport" | "outAndBack";
    lengths: number;
    ratio: number;
    drawings: number;
};
/**
 * The excursions among drawings `ds` (rule 3 alone; stepPops' excursionAt), in time order, each scan going on after the
 * step back. `unit`, `slopes`, `skip`, `shifted` and `explained` are as in stepPops.
 */
export declare function excursions(ds: Drawing[], unit: string | undefined, slopes: Slopes | null, skip: (frame: number) => boolean, shifted: boolean, explained: Explained): StepPop[];
/**
 * The pops between drawings `ds` of a value in `unit`, with its `slopes` (fitSlopes; null where none fit), its
 * object's `shifted` (ObjectFit) and what its object's fitted values explain of the box's change (`explained`,
 * explainedBy; NOTHING_EXPLAINED for a value that moves no object), read to frame `lastFrame` (isRestDrawing). Each
 * step is measured by stepMeasure. A step
 * whose new drawing starts at a frame `skip` names, or that goes into or out of a gone drawing, is not judged and
 * stands beside no other.
 *
 * The scan takes the steps in time order. At each step it tries a teleport between stops (rule 2, on position and size
 * parts), then an excursion (rule 3, position parts), then a spike run (rule 1, position parts and look values), then
 * a single step between two holds (heldSpikeAt); it
 * reports the first that pops and goes on after it. A look value's position and size parts are 0, and a size part has
 * no spike or excursion, so position parts get rules 1 to 3, size parts rule 2 (by their net change through brief
 * in-betweens) and look values rule 1.
 */
export declare function stepPops(ds: Drawing[], unit: string | undefined, slopes: Slopes | null, skip: (frame: number) => boolean, lastFrame: number, shifted: boolean, explained: Explained): StepPop[];
