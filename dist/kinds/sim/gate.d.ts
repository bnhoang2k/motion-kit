import { type KindRule } from "../../src/gate/kind-gate.ts";
/**
 * The sim rules (kinds/sim/rules.md). A sim page moves bodies by physics after a cause: a tap, a
 * release, a scroll or the page load. From the moment each cause stops, a body (a value in px or
 * deg that is no loop) gains speed only under a steady pull, leaves each turn no faster than it
 * arrived, and does not start again once it rests. Every value but a loop
 * rests within 4 s. A loop on the page gets the idle rules: it pauses off screen.
 */
/** Every value that is not a loop holds still this long after its cause stops, at the latest. */
export declare const REST_WITHIN_MS = 4000;
/** A flight's first frames are its launch, and the steady-pull check skips them. */
export declare const LAUNCH_FRAMES = 2;
/** In a flight, one frame's rise in speed may be at most this many times the flight's median change in speed, plus the unit floor. */
export declare const PULL_MULTIPLE = 4;
export declare const rules: KindRule[];
