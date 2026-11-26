import { evaluateMotion, motionRange, skipStringOrComment, valueAtPath } from "../core/bar.js";
export const STANDARD_FAULTS = ["dial25", "linear", "reducedIgnored"];
const isSpace = (c) => c !== undefined && /\s/.test(c);
/** The index of the first character at or after `i` that is not space or a comment. */
function skipSpace(text, i) {
    while (i < text.length) {
        if (isSpace(text[i]))
            i++;
        else if (text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))
            i = skipStringOrComment(text, i) + 1;
        else
            break;
    }
    return i;
}
/**
 * Scans one value expression from `i`, through nested brackets, strings and comments, up to the
 * `,` or closing bracket that ends it. Returns where it ends (`stop`) and where its last code
 * character ends (`end`), so a comment before the comma is not part of the value.
 */
function scanValue(text, i) {
    let depth = 0;
    let end = i;
    for (; i < text.length; i++) {
        const c = text[i];
        const skipped = skipStringOrComment(text, i);
        if (skipped !== i) {
            if (c !== "/")
                end = skipped + 1;
            i = skipped;
            continue;
        }
        if ("([{".includes(c))
            depth++;
        else if (")]}".includes(c)) {
            if (depth === 0)
                return { end, stop: i };
            depth--;
        }
        else if (c === "," && depth === 0)
            return { end, stop: i };
        if (!isSpace(c))
            end = i + 1;
    }
    return { end, stop: i };
}
/** Every `key: value` entry of the object literal that opens at `text[open]`, nested objects included, in source order. */
function entries(text, open, prefix = "", out = []) {
    let i = open + 1;
    for (;;) {
        i = skipSpace(text, i);
        const c = text[i];
        if (c === undefined)
            return { out, end: i };
        if (c === "}")
            return { out, end: i + 1 };
        if (c === ",") {
            i++;
            continue;
        }
        let key;
        if (c === '"' || c === "'") {
            const close = skipStringOrComment(text, i);
            key = text.slice(i + 1, close);
            i = close + 1;
        }
        else {
            const m = /^[\w$]+/.exec(text.slice(i));
            if (!m) {
                // A spread or a computed key: skip it as one expression.
                i = scanValue(text, i).stop;
                continue;
            }
            key = m[0];
            i += key.length;
        }
        i = skipSpace(text, i);
        if (text[i] !== ":") {
            // A shorthand property or a method: skip it.
            i = scanValue(text, i).stop;
            continue;
        }
        i = skipSpace(text, i + 1);
        const path = prefix + key;
        if (text[i] === "{") {
            i = entries(text, i, `${path}.`, out).end;
            continue;
        }
        const { end, stop } = scanValue(text, i);
        out.push({ path, start: i, end });
        i = stop;
    }
}
/** The MOTION block's range and its entries, with offsets into `html`. Throws for a page with none. */
function motionEntries(html, fault) {
    const range = motionRange(html);
    if (!range)
        throw new Error(`${fault}: the page has no \`const MOTION = {\` block`);
    return { ...range, entries: entries(html, range.start).out };
}
const splice = (html, e, text) => html.slice(0, e.start) + text + html.slice(e.end);
/** Evaluates the page's MOTION block, or throws a line naming the fault. */
function motionOf(html, fault) {
    const r = motionRange(html);
    try {
        return evaluateMotion(html.slice(r.start, r.end));
    }
    catch (e) {
        throw new Error(`${fault}: the MOTION block does not evaluate: ${e.message}`);
    }
}
function dial25(html, bar) {
    const dial = bar.dials[0];
    if (!dial)
        throw new Error("dial25: bar.json has no dials");
    const { entries: list } = motionEntries(html, "dial25");
    const entry = list.find((e) => e.path === dial.path);
    if (!entry)
        throw new Error(`dial25: ${dial.path} is not a value in the MOTION block`);
    const out = splice(html, entry, `(${html.slice(entry.start, entry.end)})*1.25`);
    const was = valueAtPath(motionOf(html, "dial25"), dial.path);
    const now = valueAtPath(motionOf(out, "dial25"), dial.path);
    if (typeof was !== "number" || typeof now !== "number" || !(Math.abs(now - was * 1.25) <= 1e-9 * Math.abs(was * 1.25))) {
        throw new Error(`dial25: ${dial.path} holds ${String(was)}, which cannot be moved by 25%`);
    }
    return out;
}
const CSS_EASING = /^(ease|ease-in|ease-out|ease-in-out|step-start|step-end)$|^(cubic-bezier|steps|linear)\(/;
const MOTION_EASING = /^(ease(In|Out|InOut)|circ(In|Out|InOut)|back(In|Out|InOut)|anticipate)$/;
const ONE_ARG_FN = /^(\(\s*[A-Za-z_$][\w$]*\s*\)|[A-Za-z_$][\w$]*)\s*=>|^function\b[\s\w$]*\(\s*[A-Za-z_$][\w$]*\s*\)/;
/** What an entry's value becomes under the `linear` fault, or null when it is not a curve (or is linear already). */
function linearFor(source) {
    if (ONE_ARG_FN.test(source))
        return /^\(\s*t\s*\)\s*=>\s*t$/.test(source) ? null : "(t) => t";
    if (!/^["'`[]/.test(source))
        return null;
    let value;
    try {
        value = evaluateMotion(source);
    }
    catch {
        return null;
    }
    if (typeof value === "string")
        return CSS_EASING.test(value.trim()) || MOTION_EASING.test(value.trim()) ? '"linear"' : null;
    const bezier = Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n));
    if (!bezier)
        return null;
    const [x1, y1, x2, y2] = value;
    if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1))
        return null;
    return x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1 ? null : "[0, 0, 1, 1]";
}
/** The name of the `bar.json` `faults` entry that `linear` falls back to. */
export const LINEAR_FAULT = "linear";
function linear(html, bar) {
    // The author named the main curve, so a "linear" entry wins over a curve inferred from MOTION.
    if (bar.faults.some((f) => f.name === LINEAR_FAULT))
        return own(html, LINEAR_FAULT, bar);
    for (const e of motionEntries(html, "linear").entries) {
        const swap = linearFor(html.slice(e.start, e.end));
        if (swap !== null)
            return splice(html, e, swap);
    }
    throw new Error(`linear: the MOTION block holds no curve to swap (a cubic-bezier array, an easing name, or a one-argument easing function), and bar.json has no fault named "${LINEAR_FAULT}"; add one of the two`);
}
const REDUCED_QUERY = /\(\s*prefers-reduced-motion\s*(?::\s*(reduce|no-preference)\s*)?\)/g;
function reducedIgnored(html) {
    let n = 0;
    const out = html.replace(REDUCED_QUERY, (_q, value) => {
        n++;
        return value === "no-preference" ? "(min-width: 0px)" : "not all";
    });
    if (n === 0)
        throw new Error("reducedIgnored: the page has no prefers-reduced-motion query");
    return out;
}
function own(html, name, bar) {
    const f = bar.faults.find((x) => x.name === name);
    if (!f)
        throw new Error(`own: bar.json has no fault named "${name}"`);
    const n = html.split(f.find).length - 1;
    if (n !== 1)
        throw new Error(`own: "${name}" finds "${f.find}" ${n} times in the page, needs exactly once`);
    return html.replace(f.find, () => f.replace);
}
/** Returns `html` with `fault` planted. Throws one clear line when the fault cannot be planted on this page. */
export function plantFault(html, fault, bar) {
    if (fault === "dial25")
        return dial25(html, bar);
    if (fault === "linear")
        return linear(html, bar);
    if (fault === "reducedIgnored")
        return reducedIgnored(html);
    return own(html, fault.own, bar);
}
