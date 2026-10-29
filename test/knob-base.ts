import { KNOB_VALUES } from "../src/core/knob-values.ts";

/**
 * How a distance line shows a knob's base, for a test's expected text: `(<bar>: 4.0 s)` while bars/ holds the bar
 * that set the base, and `4.0 s` when it does not. Tests read the bar from the knob values, so no test names a bar
 * folder that may be absent.
 */
export function base(knob: string, shown: string): string {
  const bar = KNOB_VALUES[knob]?.base.bar;
  if (bar === undefined) throw new RangeError(`unknown knob: ${knob}`);
  return bar === null ? shown : `(${bar}: ${shown})`;
}

/** The bar that set a knob's base, or null when this copy of the kit does not hold it. */
export function baseBar(knob: string): string | null {
  const bar = KNOB_VALUES[knob]?.base.bar;
  if (bar === undefined) throw new RangeError(`unknown knob: ${knob}`);
  return bar;
}
