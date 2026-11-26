import type { KnobBaseInfo } from "./knob-values.ts";
import type { KindName, MotionConfig, SpringKnob } from "./types.ts";
export type { KnobBaseInfo };
/**
 * Turns a bar's raw page values (in the order of the dials.json `path` array) into the knob's own form.
 * `convert` in a dials.json entry names one of these.
 */
export declare const KNOB_CONVERT: Record<string, (raw: number[]) => number | SpringKnob>;
/** The base value and every bar's value for one knob. Throws on an unknown knob. */
export declare function knobBase(kind: KindName, field: string): KnobBaseInfo;
/** The file's override for this knob if it has one, else the base. */
export declare function knob(cfg: MotionConfig, kind: KindName, field: string): number | SpringKnob;
/**
 * How far a value sits from the base, one line per number. A spring gives two lines:
 * `visualDuration` in seconds and `bounce` as a plain ratio.
 * Throws on an unknown knob or a value of the wrong shape.
 */
export declare function knobDistance(field: string, value: number | SpringKnob): string[];
