import { fromPhysics } from "./convert.js";
import { KNOB_FIELDS } from "./kinds.js";
import { KNOB_VALUES } from "./knob-values.js";
/**
 * Turns a bar's raw page values (in the order of the dials.json `path` array) into the knob's own form.
 * `convert` in a dials.json entry names one of these.
 */
export const KNOB_CONVERT = {
    /** [omega, zeta] of a spring with mass 1. */
    fromPhysics: ([omega = NaN, zeta = NaN]) => fromPhysics(omega ** 2, 2 * zeta * omega),
    /** [lambda]: a rate per second becomes a time constant in seconds. */
    inverse: ([lambda = NaN]) => 1 / lambda,
    /** [ms]: milliseconds become seconds. */
    msToS: ([ms = NaN]) => ms / 1000,
};
const keyOf = (kind, field) => `${kind}.${field}`;
/** The base value and every bar's value for one knob. Throws on an unknown knob. */
export function knobBase(kind, field) {
    const key = keyOf(kind, field);
    const info = Object.hasOwn(KNOB_VALUES, key) ? KNOB_VALUES[key] : undefined;
    if (!info)
        throw new RangeError(`unknown knob: ${key}`);
    return info;
}
/** The file's override for this knob if it has one, else the base. */
export function knob(cfg, kind, field) {
    const base = knobBase(kind, field).base.value;
    const override = cfg.kinds?.[kind]?.[field];
    return override === undefined ? base : override;
}
/** One decimal at 1 or above, else 3 significant digits with no trailing zeros. A value that rounds up to 1 (0.9996) prints 1.0. */
function fmt(v) {
    const short = Number(v.toPrecision(3));
    return Math.abs(v) >= 1 || Math.abs(short) >= 1 ? v.toFixed(1) : String(short);
}
function line(label, v, base, unit, bar) {
    const ref = `(${bar}: ${fmt(base)}${unit})`;
    const here = `${label} ${fmt(v)}${unit}`;
    if (Math.abs(v - base) <= 1e-9 * Math.max(Math.abs(v), Math.abs(base)))
        return `${here}, at base ${ref}`;
    const dir = v > base ? "above" : "below";
    if (base === 0)
        return `${here}, ${dir} base ${ref}`;
    const pct = Math.round((Math.abs(v - base) / Math.abs(base)) * 100);
    return `${here}, ${pct === 0 ? "under 1" : pct}% ${dir} base ${ref}`;
}
/**
 * How far a value sits from the base, one line per number. A spring gives two lines:
 * `visualDuration` in seconds and `bounce` as a plain ratio.
 * Throws on an unknown knob or a value of the wrong shape.
 */
export function knobDistance(field, value) {
    const info = Object.hasOwn(KNOB_VALUES, field) ? KNOB_VALUES[field] : undefined;
    if (!info)
        throw new RangeError(`unknown knob: ${field}`);
    const { value: base, bar } = info.base;
    if (typeof base === "number") {
        if (typeof value !== "number")
            throw new TypeError(`${field}: expected a number`);
        return [line(field, value, base, " s", bar)];
    }
    if (typeof value === "number")
        throw new TypeError(`${field}: expected a spring`);
    return [
        line(`${field}.visualDuration`, value.visualDuration, base.visualDuration, " s", bar),
        line(`${field}.bounce`, value.bounce, base.bounce, "", bar),
    ];
}
