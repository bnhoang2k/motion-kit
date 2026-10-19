import { motionRange } from "../core/bar.js";
import { knobDistance } from "../core/knob.js";
export const CLOCK_MARKERS = ["motion-kit:clock", "motion-kit:not-motion"];
/** The slug a `motion-kit-bar` marker names, or null with no marker. */
function barSlug(html) {
    for (const m of maskHtmlComments(html).matchAll(/<meta\s[^>]*>/gi)) {
        if (!/\bname\s*=\s*["']motion-kit-bar["']/i.test(m[0]))
            continue;
        const c = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(m[0]);
        return c ? c[1].trim() : "";
    }
    return null;
}
/** A bar slug: lowercase words and digits joined by dashes, so it names one folder of bars/. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * Whether the audit skips its literal check for this page. Only a copy of one of the kit's own bars does: the page's
 * `motion-kit-bar` marker names a slug, `readKitBar(slug)` returns that bar's index.html from the kit, and the page's
 * MOTION block is the same as the bar's, byte for byte. A page that names a bar and is not such a copy gets the check,
 * with a note that says why. A page with no marker gets the check and no note.
 */
export function literalExemption(html, readKitBar) {
    const slug = barSlug(html);
    if (slug === null)
        return { exempt: false };
    const runs = "note: the literal check runs:";
    const kit = SLUG.test(slug) ? readKitBar(slug) : undefined;
    if (kit === undefined)
        return { exempt: false, note: `${runs} the page names bar ${slug || "(empty)"}, and motion-kit has no bars/${slug}/` };
    const motion = (text) => {
        const r = motionRange(text);
        return r && text.slice(r.start, r.end);
    };
    const mine = motion(html);
    if (mine === undefined || mine !== motion(kit))
        return { exempt: false, note: `${runs} the page's MOTION block differs from bars/${slug}/index.html, so the page is adapted, not a copy` };
    return { exempt: true };
}
/** `literals: false` skips the literal check (a copy of a kit bar, see literalExemption). */
export function audit(html, scripts = [], { literals: literalCheck = true } = {}) {
    const failures = [];
    const distances = [];
    const page = maskHtmlComments(html);
    const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;
    const regions = [];
    for (const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (/\bsrc\s*=/i.test(m[1]))
            continue;
        const start = m.index + m[0].indexOf(">") + 1;
        regions.push({ kind: "js", start, text: maskJsComments(m[2]), raw: m[2], where: (o) => `line ${lineOf(html, start + o)}` });
    }
    for (const m of page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
        const start = m.index + m[0].indexOf(">") + 1;
        regions.push({ kind: "css", start, text: maskCssComments(m[1]), raw: m[1], where: (o) => `line ${lineOf(html, start + o)}` });
    }
    const markup = page.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (s) => s.replace(/[^\n]/g, " "));
    for (const m of markup.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
        const start = m.index + m[0].indexOf(m[1]) + 1;
        regions.push({ kind: "css", start, text: m[2], raw: m[2], where: (o) => `line ${lineOf(html, start + o)}` });
    }
    regions.push({ kind: "markup", start: 0, text: markup, raw: html, where: (o) => `line ${lineOf(html, o)}` });
    for (const s of scripts)
        regions.push({ kind: "js", start: 0, text: maskJsComments(s.text), raw: s.text, where: (o) => `${s.src} line ${lineOf(s.text, o)}` });
    const js = regions.filter((r) => r.kind === "js");
    for (const r of js) {
        for (const block of declaredBlocks(r.text, "KNOBS")) {
            const read = knobLines(block.body);
            failures.push(...read.failures.map((f) => `audit: ${r.where(block.start)}: ${f}`));
            distances.push(...read.distances);
        }
    }
    if (literalCheck)
        for (const r of regions)
            for (const f of literals(r))
                failures.push(`audit: ${r.where(f.at)}: ${f.text}`);
    for (const r of js)
        for (const f of wallClock(r))
            failures.push(`audit: ${r.where(f.at)}: ${f.text}`);
    return { failures, distances };
}
// ---- literals -------------------------------------------------------------------------------
const TIME_WORDS = new Set(["duration", "delay", "stagger", "period", "tau", "ms", "sec", "secs", "seconds"]);
const SPRING_WORDS = new Set(["spring", "stiffness", "damping", "mass", "bounce", "omega", "zeta", "lambda", "tension", "friction"]);
const EASE_WORDS = new Set(["ease", "easing", "bezier"]);
/** camelCase, snake_case and SCREAMING_CASE names split into lowercase words. */
function words(name) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean);
}
/** What a name holds, when it holds a motion number: "a duration", "an easing", "a spring value", "a loop period". */
function motionName(name) {
    const w = words(name);
    if (w.some((x) => EASE_WORDS.has(x)))
        return "an easing";
    if (w.some((x) => SPRING_WORDS.has(x)))
        return "a spring value";
    if (w.includes("period"))
        return "a loop period";
    const joined = w.join("");
    if (w.some((x) => TIME_WORDS.has(x)) || joined.includes("maxstep") || joined.includes("halflife"))
        return "a duration";
    if (w.length > 1 && w[w.length - 1] === "s")
        return "a duration";
    return null;
}
function literals(r) {
    const out = [];
    let text = r.text;
    if (r.kind === "js")
        for (const name of ["MOTION", "KNOBS"])
            for (const b of declaredBlocks(text, name))
                text = blank(text, b.declStart, b.end);
    if (r.kind === "markup") {
        for (const m of text.matchAll(/\s(dur|begin)\s*=\s*["']\s*\d/gi))
            out.push({ at: m.index, text: `the SVG ${m[1]} attribute is a duration typed as a literal outside MOTION and KNOBS` });
        return out;
    }
    for (const m of text.matchAll(/(?<![\w$.#-])(?:\d+\.?\d*|\.\d+)(?:ms|s)(?![\w$-])/g))
        out.push({ at: m.index, text: `${m[0]} is a duration typed as a literal outside MOTION and KNOBS` });
    for (const m of text.matchAll(/\bcubic-bezier\s*\(|\bsteps\s*\(\s*\d|\bease-(?:in-out|in|out)\b/g))
        out.push({ at: m.index, text: `${m[0].replace(/\s*\($/, "(")} is an easing typed as a literal outside MOTION and KNOBS` });
    if (r.kind !== "js")
        return out;
    const named = /(?<![\w$])["']?([A-Za-z_$][\w$]*)["']?\s*(?:=(?![=>])|:)\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|\[\s*-?(?:\d|\.\d)|["'`])/g;
    for (const m of text.matchAll(named)) {
        const what = motionName(m[1]);
        if (!what)
            continue;
        const value = m[2];
        const numeric = /^-?[\d.]/.test(value);
        if (what !== "an easing" && !numeric)
            continue;
        if (numeric && Number(value) === 0)
            continue;
        // A number that combines with a MOTION or KNOBS value (`1 - MOTION.bounce`) is arithmetic on a
        // kept number, not a new one. Any other expression (`300 * k`) still holds a literal.
        const after = text.slice(m.index + m[0].length);
        const rest = after.slice(0, after.search(/[,;\n)}\]]|$/));
        if (numeric && /\b(?:MOTION|KNOBS)\b/.test(rest))
            continue;
        const shown = numeric ? value : `${value}...`;
        out.push({ at: m.index, text: `${m[1]} = ${shown} is ${what} typed as a literal outside MOTION and KNOBS` });
    }
    return out;
}
// ---- the wall clock ------------------------------------------------------------------------
const WALL_CLOCK = /\b(setTimeout|setInterval)\s*\(|\b(performance\.now|Date\.now)\s*\(/g;
/** Every wall-clock timer or time read whose line carries no clock marker. */
function wallClock(r) {
    const out = [];
    for (const m of r.text.matchAll(WALL_CLOCK)) {
        const from = r.raw.lastIndexOf("\n", m.index) + 1;
        const to = r.raw.indexOf("\n", m.index);
        const line = r.raw.slice(from, to < 0 ? r.raw.length : to);
        if (CLOCK_MARKERS.some((k) => line.includes(k)))
            continue;
        const name = m[1] ?? `${m[2]}()`;
        out.push({
            at: m.index,
            text: `${name} runs on the wall clock, which the fixed clock cannot see; time motion on the page clock, or mark the line with a motion-kit:clock comment (the page clock's own time read) or motion-kit:not-motion (it times no motion)`,
        });
    }
    return out;
}
// ---- KNOBS ----------------------------------------------------------------------------------
function knobLines(body) {
    let data;
    try {
        data = JSON.parse(body);
    }
    catch {
        const relaxed = body
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
            .replace(/,(\s*[}\]])/g, "$1");
        try {
            data = JSON.parse(relaxed);
        }
        catch {
            return { failures: ["the KNOBS block is not plain data; paste it as `motion-kit knobs` prints it"], distances: [] };
        }
    }
    const failures = [];
    const distances = [];
    if (typeof data !== "object" || data === null || Array.isArray(data))
        return { failures: ["the KNOBS block is not an object of kinds"], distances };
    for (const [kind, fields] of Object.entries(data)) {
        if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
            failures.push(`KNOBS.${kind} is not an object of knobs`);
            continue;
        }
        for (const [field, value] of Object.entries(fields)) {
            try {
                distances.push(...knobDistance(`${kind}.${field}`, value));
            }
            catch (e) {
                failures.push(`KNOBS.${kind}.${field}: ${e.message}`);
            }
        }
    }
    return { failures, distances };
}
// ---- text helpers ---------------------------------------------------------------------------
/** Each `const|let|var <name> = {...}` (or `= Object.freeze({...})`): where the declaration starts, the object text, and where it ends. */
function declaredBlocks(text, name) {
    const out = [];
    for (const m of text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:Object\\.freeze\\s*\\(\\s*)?\\{`, "g"))) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(text, open);
        if (close < 0)
            continue;
        out.push({ declStart: m.index, start: open, body: text.slice(open, close + 1), end: close + 1 });
    }
    return out;
}
/** The index of the bracket that closes the one at `open`, skipping strings, or -1. Comments must be masked first. */
function matchClose(text, open) {
    const pairs = { "(": ")", "[": "]", "{": "}" };
    const stack = [];
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") {
            i = stringEnd(text, i);
            continue;
        }
        if (pairs[c])
            stack.push(pairs[c]);
        else if (c === stack[stack.length - 1]) {
            stack.pop();
            if (stack.length === 0)
                return i;
        }
    }
    return -1;
}
function stringEnd(text, i) {
    const q = text[i];
    for (let j = i + 1; j < text.length; j++) {
        if (text[j] === "\\")
            j++;
        else if (text[j] === q)
            return j;
    }
    return text.length;
}
const blank = (text, from, to) => text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, " ") + text.slice(to);
function maskHtmlComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, " "));
}
function maskCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
}
/** Replaces `//` and `/* *\/` comments with spaces, keeping strings and line breaks. Regex literals are not parsed. */
function maskJsComments(js) {
    let out = "";
    for (let i = 0; i < js.length; i++) {
        const c = js[i];
        if (c === '"' || c === "'" || c === "`") {
            const end = stringEnd(js, i);
            out += js.slice(i, end + 1);
            i = end;
        }
        else if (c === "/" && js[i + 1] === "/") {
            const end = js.indexOf("\n", i);
            const stop = end < 0 ? js.length : end;
            out += " ".repeat(stop - i);
            i = stop - 1;
        }
        else if (c === "/" && js[i + 1] === "*") {
            const end = js.indexOf("*/", i + 2);
            const stop = end < 0 ? js.length : end + 2;
            out += js.slice(i, stop).replace(/[^\n]/g, " ");
            i = stop - 1;
        }
        else
            out += c;
    }
    return out;
}
