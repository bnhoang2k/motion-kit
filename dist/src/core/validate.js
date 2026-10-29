import { DEFAULTS } from "./defaults.js";
import { KINDS, KNOB_FIELDS, knobProblems } from "./kinds.js";
import { MOVES } from "./types.js";
export const LIMITS = {
    bounce: [0, 0.4],
    visualDuration: [0.05, 1.5],
    stagger: [0, 0.2],
    amount: [0.5, 1.5],
    reducedFade: [0.05, 0.5],
};
const NAME = /^[a-z][a-z0-9-]*$/;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function inRange(errs, path, v, [lo, hi]) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
        errs.push(`${path}: must be a number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
    }
}
const NAME_RULE = "name must be lowercase letters, digits and dashes";
const MOVE_KEYS = ["visualDuration", "bounce", "amount", "reduced"];
const FEEL_KEYS = ["extends", "describe", "stagger", "moves"];
const TOP_KEYS = ["version", "reducedFade", "feels", "use", "kinds"];
const isMove = (m) => MOVES.includes(m);
const unknownMove = (path) => `${path}: unknown move (allowed: ${MOVES.join(", ")})`;
/** A surface name must be a plain name, and must not be the name of a feel: tx() would read it as the surface. */
function checkSurface(errs, surface, feelNames) {
    if (!NAME.test(surface))
        errs.push(`use.${surface}: ${NAME_RULE}`);
    else if (feelNames.has(surface))
        errs.push(`use.${surface}: a surface cannot have the name of a feel`);
}
function unknownKeys(errs, path, o, allowed) {
    for (const k of Object.keys(o))
        if (!allowed.includes(k))
            errs.push(`${path ? `${path}.` : ""}${k}: unknown key`);
}
function typeOf(errs, path, v, type) {
    if (typeof v !== type)
        errs.push(`${path}: must be a ${type}, got ${JSON.stringify(v)}`);
}
const allowedKnobs = (kind) => Object.keys(KNOB_FIELDS).filter((f) => f.startsWith(`${kind}.`)).map((f) => f.slice(kind.length + 1));
/**
 * Walks a kinds block and reports unknown kinds and knobs, and any problem `check` finds in a known knob value.
 * `check` gets the full path and the "kind.field" key.
 */
function walkKinds(errs, kinds, check) {
    if (!isObj(kinds)) {
        errs.push("kinds: must be an object");
        return;
    }
    for (const [kind, block] of Object.entries(kinds)) {
        const kp = `kinds.${kind}`;
        if (!KINDS.includes(kind)) {
            errs.push(`${kp}: unknown kind`);
            continue;
        }
        if (!isObj(block)) {
            errs.push(`${kp}: must be an object`);
            continue;
        }
        for (const [knob, value] of Object.entries(block)) {
            const field = `${kind}.${knob}`;
            if (!Object.hasOwn(KNOB_FIELDS, field))
                errs.push(`${kp}.${knob}: unknown knob (allowed: ${allowedKnobs(kind).join(", ") || "none"})`);
            else
                errs.push(...check(`${kp}.${knob}`, field, value));
        }
    }
}
/** The shape and types of one knob value, without its ranges. */
function knobShape(path, field, value) {
    const errs = [];
    if (KNOB_FIELDS[field].shape === "number")
        typeOf(errs, path, value, "number");
    else if (!isObj(value))
        errs.push(`${path}: must be an object, got ${JSON.stringify(value)}`);
    else {
        unknownKeys(errs, path, value, ["visualDuration", "bounce"]);
        for (const k of ["visualDuration", "bounce"])
            if (value[k] !== undefined)
                typeOf(errs, `${path}.${k}`, value[k], "number");
    }
    return errs;
}
/**
 * Returns every problem in a project's overrides (the contents of motion.json). An empty list means the shape is right.
 * It checks keys, object shapes and value types. It does not check ranges or whether a name exists: validate() does that on the merged result.
 */
export function validateOverrides(o) {
    const errs = [];
    if (!isObj(o))
        return ["config: must be an object"];
    unknownKeys(errs, "", o, TOP_KEYS);
    if (o.version !== undefined && o.version !== 1 && o.version !== 2)
        errs.push(`version: expected 1 or 2, got ${JSON.stringify(o.version)}`);
    if (o.kinds !== undefined) {
        if (o.version !== 2)
            errs.push("kinds: needs version 2");
        walkKinds(errs, o.kinds, knobShape);
    }
    if (o.reducedFade !== undefined)
        typeOf(errs, "reducedFade", o.reducedFade, "number");
    const feelNames = new Set(Object.keys(DEFAULTS.feels));
    if (o.feels !== undefined) {
        if (!isObj(o.feels))
            errs.push("feels: must be an object");
        else {
            for (const [name, feel] of Object.entries(o.feels)) {
                feelNames.add(name);
                const p = `feels.${name}`;
                if (!NAME.test(name))
                    errs.push(`${p}: ${NAME_RULE}`);
                if (!isObj(feel)) {
                    errs.push(`${p}: must be an object`);
                    continue;
                }
                unknownKeys(errs, p, feel, FEEL_KEYS);
                if (feel.extends !== undefined)
                    typeOf(errs, `${p}.extends`, feel.extends, "string");
                if (feel.describe !== undefined)
                    typeOf(errs, `${p}.describe`, feel.describe, "string");
                if (feel.stagger !== undefined)
                    typeOf(errs, `${p}.stagger`, feel.stagger, "number");
                if (feel.moves === undefined)
                    continue;
                if (!isObj(feel.moves)) {
                    errs.push(`${p}.moves: must be an object`);
                    continue;
                }
                for (const [m, mv] of Object.entries(feel.moves)) {
                    const mp = `${p}.moves.${m}`;
                    if (!isMove(m)) {
                        errs.push(unknownMove(mp));
                        continue;
                    }
                    if (!isObj(mv)) {
                        errs.push(`${mp}: must be an object`);
                        continue;
                    }
                    unknownKeys(errs, mp, mv, MOVE_KEYS);
                    for (const k of ["visualDuration", "bounce", "amount"])
                        if (mv[k] !== undefined)
                            typeOf(errs, `${mp}.${k}`, mv[k], "number");
                    if (mv.reduced !== undefined && mv.reduced !== "instant" && mv.reduced !== "fade")
                        errs.push(`${mp}.reduced: must be "instant" or "fade"`);
                }
            }
        }
    }
    if (o.use !== undefined) {
        if (!isObj(o.use))
            errs.push("use: must be an object");
        else {
            for (const [surface, feel] of Object.entries(o.use)) {
                checkSurface(errs, surface, feelNames);
                typeOf(errs, `use.${surface}`, feel, "string");
            }
        }
    }
    return errs;
}
/** Returns every problem in a resolved config. An empty list means it is valid. */
export function validate(cfg) {
    const errs = [];
    if (!isObj(cfg))
        return ["config: must be an object"];
    if (cfg.version !== 1 && cfg.version !== 2)
        errs.push(`version: expected 1 or 2, got ${JSON.stringify(cfg.version)}`);
    if (cfg.kinds !== undefined) {
        if (cfg.version !== 2)
            errs.push("kinds: needs version 2");
        walkKinds(errs, cfg.kinds, knobProblems);
    }
    inRange(errs, "reducedFade", cfg.reducedFade, LIMITS.reducedFade);
    const feels = cfg.feels;
    if (!isObj(feels))
        return [...errs, "feels: missing"];
    for (const [name, feel] of Object.entries(feels)) {
        const p = `feels.${name}`;
        if (!NAME.test(name))
            errs.push(`${p}: ${NAME_RULE}`);
        if (!isObj(feel)) {
            errs.push(`${p}: must be an object`);
            continue;
        }
        if (typeof feel.describe !== "string")
            errs.push(`${p}.describe: missing`);
        if (feel.stagger === undefined)
            errs.push(`${p}.stagger: missing`);
        else
            inRange(errs, `${p}.stagger`, feel.stagger, LIMITS.stagger);
        const moves = isObj(feel.moves) ? feel.moves : {};
        for (const m of Object.keys(moves))
            if (!isMove(m))
                errs.push(unknownMove(`${p}.moves.${m}`));
        for (const m of MOVES) {
            const mp = `${p}.moves.${m}`;
            const mv = moves[m];
            if (!isObj(mv)) {
                errs.push(`${mp}: missing`);
                continue;
            }
            unknownKeys(errs, mp, mv, MOVE_KEYS);
            for (const k of ["visualDuration", "bounce"]) {
                if (mv[k] === undefined)
                    errs.push(`${mp}.${k}: missing`);
                else
                    inRange(errs, `${mp}.${k}`, mv[k], LIMITS[k]);
            }
            if (mv.amount !== undefined)
                inRange(errs, `${mp}.amount`, mv.amount, LIMITS.amount);
            if (mv.reduced !== "instant" && mv.reduced !== "fade")
                errs.push(`${mp}.reduced: must be "instant" or "fade"`);
        }
    }
    if (cfg.use !== undefined) {
        if (!isObj(cfg.use))
            errs.push("use: must be an object");
        else {
            const feelNames = new Set(Object.keys(feels));
            for (const [surface, feel] of Object.entries(cfg.use)) {
                checkSurface(errs, surface, feelNames);
                if (typeof feel !== "string" || !Object.hasOwn(feels, feel))
                    errs.push(`use.${surface}: unknown feel ${JSON.stringify(feel)}`);
            }
        }
    }
    return errs;
}
