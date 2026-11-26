export const KINDS = ["live", "idle", "scroll", "choreo", "sim"];
/** Every knob field v0.2.0 ships, keyed "kind.field". A kind gains fields with its first bar. */
export const KNOB_FIELDS = {
    "live.release": { shape: "spring", unit: "s,ratio" },
    "idle.period": { shape: "number", unit: "s" },
    "scroll.smooth": { shape: "number", unit: "s" },
    "scroll.maxStep": { shape: "number", unit: "s" },
};
const show = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));
const isTime = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
/**
 * Returns every problem in one knob value. `path` is the place to name in each message, and `field` is the "kind.field" key.
 * Hard limits only: a time must be finite and above 0, and bounce must be from 0 up to (not including) 1. There is no ceiling.
 */
export function knobProblems(path, field, value) {
    const spec = Object.hasOwn(KNOB_FIELDS, field) ? KNOB_FIELDS[field] : undefined;
    if (!spec)
        return [`${path}: unknown knob`];
    if (spec.shape === "number") {
        return isTime(value) ? [] : [`${path}: must be a number above 0, got ${show(value)}`];
    }
    // The only other shape in v0.2.0 is a spring.
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return [`${path}: must be an object, got ${show(value)}`];
    const errs = [];
    const o = value;
    for (const k of Object.keys(o))
        if (k !== "visualDuration" && k !== "bounce")
            errs.push(`${path}.${k}: unknown key`);
    if (o.visualDuration === undefined)
        errs.push(`${path}.visualDuration: missing`);
    else if (!isTime(o.visualDuration))
        errs.push(`${path}.visualDuration: must be a number above 0, got ${show(o.visualDuration)}`);
    const b = o.bounce;
    if (b === undefined)
        errs.push(`${path}.bounce: missing`);
    else if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b >= 1)
        errs.push(`${path}.bounce: must be a number from 0 up to, not including, 1, got ${show(b)}`);
    return errs;
}
