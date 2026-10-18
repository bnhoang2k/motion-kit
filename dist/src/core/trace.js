/**
 * The trace.json contract: what a bar's recorded trace holds, and the check that says whether the
 * bar gate can play it. Pure: no browser, no file system. validate-bar and the bar gate both use it.
 */
/**
 * The smallest tolerance a trace channel may have, by unit. A channel with one of these units
 * cannot be checked more tightly than this. The bar gate reads the same table.
 */
export const TOLERANCE_FLOORS = { px: 0.5, deg: 0.5, ratio: 0.01, opacity: 0.01, scale: 0.002, s: 0.017 };
/** An event lands within 1 frame of its trace time. */
export const EVENT_MS = 17;
/** A trace holds 2 to 5 channels. */
const CHANNELS = [2, 5];
/** The gate seeks in 1/60 s frames, so the trace holds one sample per 1/60 s. */
export const TRACE_FPS = 60;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const round = (n) => Math.round(n * 1000) / 1000;
const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
/** A sample time sits on the 1/60 s frame grid: k * 1000 / 60 for a whole k, within a relative 1e-9. */
function onFrameGrid(ms) {
    const k = Math.round((ms * TRACE_FPS) / 1000);
    const grid = (k * 1000) / TRACE_FPS;
    return Math.abs(ms - grid) <= 1e-9 * Math.max(1, Math.abs(grid));
}
/** The tolerance a channel must have: 2 times the rebuild's error, and never below its unit's floor. */
export function toleranceFor(unit, rebuildError) {
    return Math.max(2 * rebuildError, TOLERANCE_FLOORS[unit] ?? 0);
}
/**
 * Checks a parsed trace.json. `shape` lists what makes the trace unusable, so the gate cannot
 * play it. `tolerance` lists each channel whose tolerance is not max(2 * rebuildError, floor).
 */
export function checkTrace(value) {
    const shape = [];
    const tolerance = [];
    const p = (msg) => shape.push(`trace.json: ${msg}`);
    if (!isObj(value))
        return { trace: undefined, shape: ["trace.json: must be an object"], tolerance };
    if (value.fps !== TRACE_FPS)
        p(`fps must be ${TRACE_FPS}, got ${JSON.stringify(value.fps)}; the gate seeks in 1/60 s frames and events land within ${EVENT_MS} ms`);
    const input = value.input;
    if (!isObj(input) || !Array.isArray(input.samples))
        p("input must be { kind, samples }");
    else {
        const width = input.kind === "pointer" ? 3 : input.kind === "scroll" ? 2 : input.kind === "none" ? 0 : -1;
        // A pointer sample may carry a 4th number, down: 0 lifts the pointer, so one input can hold two presses.
        const pointerSample = (s) => s.every(isNum) && (s.length === 3 || (s.length === 4 && (s[3] === 0 || s[3] === 1)));
        if (width < 0)
            p(`input kind ${JSON.stringify(input.kind)} is not pointer, scroll or none`);
        else if (width === 0 && input.samples.length > 0)
            p("input of kind none holds no samples");
        else if (input.kind === "pointer") {
            if (!input.samples.every((s) => Array.isArray(s) && pointerSample(s)))
                p("each pointer input sample must be [ms, x, y] or [ms, x, y, down] with down 0 or 1");
        }
        else if (!input.samples.every((s) => Array.isArray(s) && s.length === width && s.every(isNum)))
            p(`each ${String(input.kind)} input sample must be ${width} numbers`);
    }
    const channels = Array.isArray(value.channels) ? value.channels : undefined;
    if (!channels || channels.length < CHANNELS[0] || channels.length > CHANNELS[1])
        p(`channels must hold ${CHANNELS[0]} to ${CHANNELS[1]} channels, got ${channels?.length ?? 0}`);
    const names = new Set();
    (channels ?? []).forEach((c, i) => {
        const where = `channels[${i}]`;
        if (!isObj(c))
            return void p(`${where} must be an object`);
        const before = shape.length;
        if (!isText(c.name))
            p(`${where}.name must be a non-empty string`);
        else if (names.has(c.name))
            p(`${where}.name ${c.name} is used twice`);
        else
            names.add(c.name);
        if (!isText(c.unit) || !Object.hasOwn(TOLERANCE_FLOORS, c.unit))
            p(`${where}.unit must be one of ${Object.keys(TOLERANCE_FLOORS).join(", ")}`);
        if (!isText(c.read))
            p(`${where}.read must name a key of __state().values`);
        if (!Array.isArray(c.selectors) || !c.selectors.every(isText))
            p(`${where}.selectors must be a list of selectors`);
        if (!(isNum(c.tolerance) && c.tolerance > 0))
            p(`${where}.tolerance must be a number above 0`);
        if (!(isNum(c.rebuildError) && c.rebuildError >= 0))
            p(`${where}.rebuildError must be a number, 0 or above`);
        if (shape.length > before)
            return;
        const want = toleranceFor(c.unit, c.rebuildError);
        if (!same(c.tolerance, want)) {
            tolerance.push(`trace.json: ${String(c.name)} tolerance ${String(c.tolerance)}, but max(2 x rebuildError ${String(c.rebuildError)}, ${String(c.unit)} floor ${TOLERANCE_FLOORS[c.unit]}) is ${round(want)}`);
        }
    });
    const samples = Array.isArray(value.samples) ? value.samples : undefined;
    if (!samples || samples.length === 0)
        p("samples must hold 1 or more rows");
    else {
        const width = 1 + (channels?.length ?? 0);
        const bad = samples.findIndex((r) => !Array.isArray(r) || r.length !== width || !isNum(r[0]) || !r.slice(1).every((v) => v === null || isNum(v)));
        if (bad >= 0)
            p(`samples[${bad}] must be [ms, ...one value per channel]: ${width} entries, each value a number or null (not measured)`);
        else if (samples.some((r, i) => i > 0 && !(r[0] > samples[i - 1][0])))
            p("samples must run forward in time");
        else {
            // Each row sits on the 1/60 s grid. A rounded time (16.667) seeks off the frame, and near a cut it reads the other side.
            const off = samples.findIndex((r) => !onFrameGrid(r[0]));
            if (off >= 0)
                p(`samples[${off}] ms ${String(samples[off][0])} is not on the 1/60 s grid (k * 1000 / 60); store the time at full precision, for example 1000 / 60 = 16.666666666666668, not a rounded value`);
            (channels ?? []).forEach((c, ci) => {
                if (samples.every((r) => r[ci + 1] === null))
                    p(`channels[${ci}] ${isObj(c) ? String(c.name) : ""} has no measured sample; every value is null`);
            });
        }
    }
    if (!isObj(value.events) || !Object.values(value.events).every(isNum))
        p("events must map each name to a time in ms");
    if (value.cuts !== undefined && !(Array.isArray(value.cuts) && value.cuts.every(isNum)))
        p("cuts must be a list of times in ms");
    return { trace: shape.length === 0 ? value : undefined, shape, tolerance };
}
