import type { KnobShape } from "./types.ts";
export declare const KINDS: readonly ["live", "idle", "scroll", "choreo", "sim"];
/** Every knob field v0.2.0 ships, keyed "kind.field". A kind gains fields with its first bar. */
export declare const KNOB_FIELDS: Record<string, {
    shape: KnobShape;
    unit: "s" | "s,ratio";
}>;
/**
 * Returns every problem in one knob value. `path` is the place to name in each message, and `field` is the "kind.field" key.
 * Hard limits only: a time must be finite and above 0, and bounce must be from 0 up to (not including) 1. There is no ceiling.
 */
export declare function knobProblems(path: string, field: string, value: unknown): string[];
