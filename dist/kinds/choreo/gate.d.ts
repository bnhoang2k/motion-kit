import { type KindRule } from "../../src/gate/kind-gate.ts";
/**
 * The choreo rules (kinds/choreo/rules.md). A choreo page plays a staggered sequence after a cause:
 * a tap, a scroll, or the page load. `interrupt` plays the cause's own trigger once more just before
 * and just after each piece starts, and every value must stay continuous and come to rest where the
 * page also rests without it. A stepped value's jump test reads its drawings, raw against raw. A loop on the page gets the idle rules: it pauses off screen. A loop has no rest to keep, but it may not jump after the second trigger (a restart of its lead-in or its phase).
 * A repeat that lands on a control the sequence brought under the cause's spot is a press on that control: the page
 * answers it as it should, and its rest is also one the page reaches when the control is pressed at rest.
 */
/** The second trigger lands this long before, and again this long after, each piece starts. */
export declare const INTERRUPT_MS = 8;
/** At most this many piece starts are tried, picked evenly across the sequences: 16 runs. */
export declare const MAX_BOUNDARIES = 8;
/** A value jumps when one frame moves it more than this many times its largest frame step in the clean run... */
export declare const JUMP_STEPS = 2.5;
/** ...plus this share of its range. */
export declare const JUMP_RANGE = 0.01;
export declare const rules: KindRule[];
