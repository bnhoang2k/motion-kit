import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOLERANCE_FLOORS } from "../core/bar.js";
import { KINDS } from "../core/kinds.js";
import { kitRoot, readTextFile } from "../core/kit-root.js";
import { audit, literalExemption } from "./audit.js";
import { FRAME_MS, openPage, sleep } from "./harness.js";
import { drawnRead } from "./drawn.js";
import { checkObjects, objectOf } from "./objects.js";
import { heldPoses, poses } from "./poses.js";
import { drawingJumps, noHook, realClockGap, roundLengths, zeroFrames } from "./self-checks.js";
import { driveInput, INPUT_START_MS, inputChanges, inputSpan, syntheticInput } from "./synthetic-input.js";
import { runChecks } from "./verdict.js";
import { HOLD_MS, lastMoveMs, rangeOf, REST_FRAMES, series, stillEps, stillTol, valueNames } from "./series.js";
import { causedWindows, causesOf, repeatCause } from "./causes.js";
import { periodicOf, PERIODIC_SCAN_MS } from "./periodic.js";
export { rangeOf, REST_FRAMES, series, stillEps, valueNames };
/** A move a cut ends sooner than this after it starts is cut off: its pops are not judged. */
const CUT_OFF_MS = 100;
/** How far the `?seek` frames reach, in ms, when the input starts INPUT_START_MS in. */
export const SPAN_MS = 3000;
/** An idle page's rules read this many periods of its longest designed loop, after its lead-in. */
export const IDLE_PERIODS_READ = 2;
/** How far the rules' `?seek` frames reach for this context. */
export const spanOf = (ctx) => ctx.spanMs ?? SPAN_MS;
/** After a recorded input's last sample, the rules read this long more, so the page can settle. */
export const SETTLE_MS = 1000;
/** The span of a recorded input: SPAN_MS, the last trace row, or the last input sample plus SETTLE_MS, the latest. */
export function recordedSpan(input, rowTimes) {
    return Math.max(SPAN_MS, ...rowTimes, inputSpan(input).end + SETTLE_MS);
}
/** Fails when the input runs past the span: the rules would judge only part of it. */
export function inputPastSpan(input, spanMs) {
    if (!input || input.samples.length === 0)
        return [];
    const { end } = inputSpan(input);
    return end > spanMs + 1e-6 ? [`span: the input runs to ${round(end)} ms, past the ${round(spanMs)} ms the rules read`] : [];
}
/** A value's tolerance floor: its unit's floor (TOLERANCE_FLOORS), or 1% of its range for a unit with none. */
export const unitFloor = (unit, range) => unit !== undefined && Object.hasOwn(TOLERANCE_FLOORS, unit) ? TOLERANCE_FLOORS[unit] : 0.01 * range;
/** Kinds whose motion starts from causes: their shared rules read the caused windows and leave loops out. */
export const CAUSED_KINDS = ["choreo", "sim"];
const isCaused = (ctx) => CAUSED_KINDS.includes(ctx.kind);
/** On a choreo or sim page the rules read at least this long after the last cause stops: sim's 4 s rest bound, then a second more. */
export const CAUSE_SETTLE_MS = 5000;
/** How far past the last cause's stop the gate looks for the end of a choreo or sim sequence. The rules read SETTLE_MS past that end. */
export const SEQUENCE_SCAN_MS = 15000;
/** How long after its synthetic tap the gate looks for an answer, to tell a tap-started page from a load-started one. */
const TAP_PROBE_MS = 1500;
/** How long the gate watches a page with no input for its load motion to end. */
export const LOAD_SCAN_MS = 15000;
/** A live page is at rest when no value moves more than this between two reads 50 ms apart. */
const LIVE_STILL = 1e-3;
/** Kinds a page may name that have no knobs and no kind gate yet: one-shot moves use `feels` and `moves`. */
const GATELESS_KINDS = ["oneshot"];
const KIND_RULES = {
    live: () => import("../../kinds/live/gate.js"),
    idle: () => import("../../kinds/idle/gate.js"),
    scroll: () => import("../../kinds/scroll/gate.js"),
    choreo: () => import("../../kinds/choreo/gate.js"),
    sim: () => import("../../kinds/sim/gate.js"),
};
// ---- shared helpers for the rules -----------------------------------------------------------
export const round = (n) => Math.round(n * 1000) / 1000;
/** The time of the first frame at or after `fromMs` from which every value holds still for REST_FRAMES steps, or the last frame's time. */
export function restAfter(frames, fromMs) {
    const names = valueNames(frames);
    const eps = new Map(names.map((n) => [n, stillEps(rangeOf(series(frames, n)))]));
    const still = (i) => names.every((n) => !(Math.abs((frames[i + 1].values[n] ?? 0) - (frames[i].values[n] ?? 0)) > eps.get(n)));
    for (let i = 0; i + REST_FRAMES < frames.length; i++) {
        if (frames[i].ms < fromMs - 1e-6)
            continue;
        let ok = true;
        for (let k = 0; k < REST_FRAMES && ok; k++)
            ok = still(i + k);
        if (ok)
            return frames[i].ms;
    }
    return frames[frames.length - 1]?.ms ?? fromMs;
}
/** The span the input drives: from its first sample until the page rests after its last one. Null with no input. */
export function inputWindow(frames, input) {
    if (!input || input.samples.length === 0)
        return null;
    const { start, end } = inputSpan(input);
    return [start, restAfter(frames, end)];
}
/**
 * When the synthetic input starts, from the page's frames with no input (its load motion): INPUT_START_MS in, or
 * INPUT_START_MS after the last frame step in which a value moves, when that comes later. So the input meets a page
 * at rest, as it does on a page with no load motion. A page still moving in its last REST_FRAMES frame steps (a
 * loop) never settles, and keeps INPUT_START_MS. The time sits on the 1/60 s frame grid.
 */
export function inputStartAfter(frames) {
    let lastMove = -1;
    for (const n of valueNames(frames)) {
        const v = series(frames, n);
        const eps = stillEps(rangeOf(v));
        for (let i = v.length - 2; i > lastMove; i--)
            if (Math.abs(v[i + 1] - v[i]) > eps) {
                lastMove = i;
                break;
            }
    }
    if (lastMove < 0 || lastMove >= frames.length - 1 - REST_FRAMES)
        return INPUT_START_MS;
    const ends = frames[lastMove + 1].ms;
    if (ends < INPUT_START_MS)
        return INPUT_START_MS;
    return Math.ceil((ends + INPUT_START_MS) / FRAME_MS - 1e-9) * FRAME_MS;
}
/** Opens the same file as `page` with the same input, changing only `options`. */
export function reopen(page, options) {
    return openPage(page.file, { ...page.options, ...options });
}
/** Plays the input on a live page, when there is one. */
export async function drive(live, ctx) {
    if (ctx.input)
        await driveInput(live, ctx.input);
}
/**
 * Polls a live page's values every 50 ms until no value has moved for 150 ms, and returns the
 * page's clock (`performance.now()`) at that point. Returns null when the page is still moving
 * after `timeoutMs`. Values named in `ignore` (loops) are not read.
 */
export async function waitForRest(live, timeoutMs = 5000, ignore = new Set()) {
    const end = performance.now() + timeoutMs;
    let prev = null;
    let quiet = 0;
    while (performance.now() < end) {
        const values = Object.fromEntries(Object.entries((await live.state()).values).filter(([k]) => !ignore.has(k)));
        const moved = prev === null || Object.keys({ ...values, ...prev }).some((k) => !(Math.abs((values[k] ?? Number.NaN) - (prev[k] ?? Number.NaN)) <= LIVE_STILL));
        quiet = moved ? 0 : quiet + 1;
        prev = values;
        if (quiet >= 3)
            return live.page.evaluate(() => performance.now());
        await sleep(50);
    }
    return null;
}
// ---- the rules for every kind ---------------------------------------------------------------
/** A pulse's attack, from its start to its peak, is 40 to 120 ms. */
export const ATTACK_MS = [40, 120];
/** A pulse comes back toward where it started: it ends within this share of its peak. */
const PULSE_RETURN = 0.5;
/** A pulse peaks within this long of its start. A slower rise and fall is a move or a loop, not a flash. */
const PULSE_PEAK_MS = 500;
/** How far the gate looks for a pulse-shaped value's repeats. 15 s holds 3 starts of a 5 s loop. */
const LOOP_SCAN_MS = 15000;
/** A value is a loop when it starts the same way 3 or more times, evenly spaced (within 1 frame). */
const LOOP_STARTS = 3;
/** One 1/60 s frame that covers more than this share of a smooth start's whole change is a pop. */
const POP_SHARE = 0.5;
/**
 * Every place a value starts to move after holding still for 2 frame steps (the page counts as
 * still before its first frame), outside the windows (motion the input drives) and away from a cut.
 */
function onsets(frames, windows, cuts) {
    const out = [];
    const inWindow = (ms) => windows.some((w) => ms + FRAME_MS >= w[0] - 1e-6 && ms <= w[1] + 1e-6);
    for (const name of valueNames(frames)) {
        const v = series(frames, name);
        const eps = stillTol(v);
        const moving = (i) => i >= 0 && Math.abs(v[i + 1] - v[i]) > eps;
        const starts = new Set();
        for (let i = 0; i + 1 < frames.length; i++) {
            // A start, or, while the value moves, the first frame step past the frames a cut leaves out (below): what
            // follows a cut is new motion.
            const afterCut = i > 0 && cuts.some((c) => frames[i - 1].ms <= c + 2 * FRAME_MS + 1e-6 && frames[i].ms > c + 2 * FRAME_MS + 1e-6);
            if (!moving(i) || (!afterCut && (moving(i - 1) || moving(i - 2))))
                continue;
            const ms = frames[i].ms;
            if (inWindow(ms))
                continue;
            if (!afterCut && cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS))
                continue;
            if (starts.has(i))
                continue;
            starts.add(i);
            out.push({ name, i, ms, rising: v[i + 1] > v[i] });
        }
    }
    return out;
}
/**
 * An onset's frames until the value rests, or until a cut (what follows a cut is new motion, which may jump): its
 * whole change (the farthest it goes, either way, so an anticipation dip before the move does not count as the move)
 * and where it ends.
 */
function segment(frames, o, eps, cuts = []) {
    const v = series(frames, o.name);
    let end = o.i;
    let still = 0;
    const cutIn = (j) => cuts.some((c) => c >= frames[j].ms + FRAME_MS / 2 - 1e-6 && c <= frames[j + 1].ms + FRAME_MS / 2 + 1e-6);
    let cut = false;
    for (let j = o.i; j + 1 < frames.length && still < REST_FRAMES; j++) {
        if (j > o.i && cutIn(j)) {
            cut = true;
            break;
        }
        still = Math.abs(v[j + 1] - v[j]) > eps ? 0 : still + 1;
        end = j + 1;
    }
    let peak = o.i;
    for (let j = o.i; j <= end; j++)
        if (Math.abs(v[j] - v[o.i]) > Math.abs(v[peak] - v[o.i]))
            peak = j;
    const dir = v[peak] >= v[o.i] ? 1 : -1;
    return { v, dir, end, peak, cut, total: dir * (v[peak] - v[o.i]), left: dir * (v[end] - v[o.i]) };
}
/**
 * A pulse's attack, from seeks every eighth of a frame around its start and its peak. A stepped value's is read on its
 * drawings, not its pose line, which reaches each drawing one drawing late: from half a drawing before its first new
 * drawing (the motion starts somewhere in the drawing before it, as a smooth start is read at the middle of its
 * frame) to the start of its peak drawing.
 */
async function pulseAttack(page, o, peakMs, dir, eps, stepped = false) {
    if (stepped)
        return drawingAttack(page, o, peakMs, dir, eps);
    const dt = FRAME_MS / 8;
    const at = (fs) => fs.map((f) => f.values[o.name] ?? Number.NaN);
    const start = at(await page.frames(o.ms, o.ms + FRAME_MS, dt));
    const k0 = start.findIndex((x) => Math.abs(x - start[0]) > eps / 8);
    const startMs = o.ms + (Math.max(k0, 1) - 0.5) * dt;
    const near = await page.frames(Math.max(o.ms, peakMs - FRAME_MS), peakMs + FRAME_MS, dt);
    let best = near[0];
    for (const f of near)
        if (dir * ((f.values[o.name] ?? Number.NaN) - (best.values[o.name] ?? Number.NaN)) > 0)
            best = f;
    return best.ms - startMs;
}
/**
 * A stepped onset's attack on its drawings (pulseAttack), read up to `peakMs`, where its pose line peaks: from half its
 * first new drawing's length before that drawing starts to the start of its peak drawing.
 */
async function drawingAttack(page, o, peakMs, dir, eps) {
    const raw = await page.rawFrames(Math.max(0, o.ms - FRAME_MS), peakMs + FRAME_MS);
    const x = raw.map((f) => f.values[o.name] ?? Number.NaN);
    const k0 = x.findIndex((y) => Math.abs(y - x[0]) > eps);
    if (k0 < 0)
        return 0;
    let best = k0;
    for (let k = k0; k < x.length; k++)
        if (dir * (x[k] - x[best]) > 0)
            best = k;
    const k1 = x.findIndex((y, k) => k > k0 && Math.abs(y - x[k0]) > eps);
    const drawing = k1 < 0 ? 0 : raw[k1].ms - raw[k0].ms;
    return raw[best].ms - raw[k0].ms + drawing / 2;
}
/**
 * What is wrong with one onset: a pop, a pulse attack out of bounds, or a fade that rises. An onset whose whole
 * change is below its unit's tolerance floor (TOLERANCE_FLOORS: 0.5 px, 0.002 scale, 0.01 opacity, ...) is too small
 * to see, so it has no problem: a spring or a smoothed scroll that snaps to rest at the end of a still stretch.
 */
async function onsetProblems(page, frames, o, unit, isLoop, stepped, caused = false, cuts = [], isDesigned = isLoop) {
    const eps = stillTol(series(frames, o.name));
    const seg = segment(frames, o, eps, cuts);
    const at = `${o.name} at ${round(o.ms)} ms`;
    const out = [];
    const floor = unit !== undefined && Object.hasOwn(TOLERANCE_FLOORS, unit) ? TOLERANCE_FLOORS[unit] : 0;
    if (!(seg.total > eps) || seg.total < floor)
        return out;
    // A stepped value's frames here are its pose line; its pops are judged at its drawing rate (envelope). A move a cut
    // ends within CUT_OFF_MS of its start is cut off, as one the frames end: its whole change is not on screen.
    const cutOff = seg.cut && frames[seg.end].ms - o.ms < CUT_OFF_MS - 1e-6;
    for (let j = o.i; j < seg.end && !stepped && !cutOff; j++) {
        const step = Math.abs(seg.v[j + 1] - seg.v[j]);
        if (step > POP_SHARE * seg.total * (1 + 1e-9)) {
            out.push(`${at} covers ${Math.round((step / seg.total) * 100)}% of its whole change in the one frame after ${round(frames[j].ms)} ms; that is a pop`);
            break;
        }
    }
    // Inside a caused sequence anything that comes back halfway is a pulse, however slow: a dip through black is no fade.
    // A stepped value's pose line reaches its peak drawing one drawing late: whether it peaks in time is read on its drawings.
    const peaksIn = stepped ? await drawingAttack(page, o, frames[seg.peak].ms, seg.dir, eps) : frames[seg.peak].ms - o.ms;
    const pulse = seg.left <= PULSE_RETURN * seg.total && (caused || peaksIn <= PULSE_PEAK_MS);
    if (pulse && !caused && !(await isLoop(o))) {
        const ms = await pulseAttack(page, o, frames[seg.peak].ms, seg.dir, eps, stepped);
        if (ms < ATTACK_MS[0] || ms > ATTACK_MS[1])
            out.push(`${at} is a pulse that peaks ${Math.round(ms)} ms after it starts; a pulse's attack is ${ATTACK_MS[0]} to ${ATTACK_MS[1]} ms`);
    }
    else if (!pulse && unit === "opacity" && seg.dir < 0 && !(await isDesigned(o))) {
        for (let j = o.i; j < seg.end; j++) {
            if (seg.v[j + 1] - seg.v[j] > eps) {
                out.push(`${o.name} rises at ${round(frames[j].ms)} ms, during the fade that starts at ${round(o.ms)} ms; fades only fall`);
                break;
            }
        }
    }
    return out;
}
/** A loop is a value whose starts, or whose peaks of equal height, repeat at a fixed period: this many times or more. */
const evenly = (times) => {
    if (times.length < LOOP_STARTS)
        return false;
    const gaps = times.slice(1).map((t, k) => t - times[k]);
    return Math.max(...gaps) - Math.min(...gaps) <= FRAME_MS + 1e-6;
};
/**
 * The values in `frames` that loop: a value that starts the same way (an onset in the same
 * direction) at a fixed period, as the envelope's loop test reads it, or a value that never holds
 * still and peaks at the same height (within 2% of its range) at a fixed period, still moving at the
 * end. A damped spring's peaks shrink, so it is no loop.
 */
export function loopNames(frames, windows, cuts) {
    const out = new Set();
    const os = onsets(frames, windows, cuts);
    for (const name of valueNames(frames)) {
        for (const rising of [true, false])
            if (evenly(os.filter((o) => o.name === name && o.rising === rising).map((o) => o.ms)))
                out.add(name);
        if (out.has(name))
            continue;
        const v = series(frames, name);
        const range = rangeOf(v);
        const eps = stillEps(range);
        const n = v.length;
        if (n < 2 + REST_FRAMES || !(Math.abs(v[n - 1] - v[n - 2]) > eps))
            continue;
        const peaks = [];
        for (let i = 1; i + 1 < n; i++)
            if (v[i] > v[i - 1] + eps && v[i] >= v[i + 1])
                peaks.push(i);
        const tail = peaks.slice(-LOOP_STARTS - 1);
        const heights = tail.map((i) => v[i]);
        if (tail.length >= LOOP_STARTS && evenly(tail.map((i) => frames[i].ms)) && Math.max(...heights) - Math.min(...heights) <= 0.02 * range)
            out.add(name);
    }
    return out;
}
const roleMemo = new WeakMap();
/**
 * Each value's role, read once per page from its frames over LOOP_SCAN_MS with the gate's input:
 * loopNames finds the loops, and a value in px or deg that is no loop is a position.
 */
export function rolesOf(page, ctx) {
    let memo = roleMemo.get(page);
    if (!memo) {
        memo = (async () => {
            const frames = await page.frames(0, Math.max(LOOP_SCAN_MS, spanOf(ctx)));
            const { units } = await page.state();
            const loops = loopNames(frames, [], ctx.cuts);
            return new Map(valueNames(frames).map((n) => [n, loops.has(n) ? "loop" : units[n] === "px" || units[n] === "deg" ? "position" : "other"]));
        })();
        roleMemo.set(page, memo);
    }
    return memo;
}
/** The loops among `roles`. */
export const loopsIn = (roles) => new Set([...roles].filter(([, r]) => r === "loop").map(([n]) => n));
/** `rule`, run only on a page with a loop: a choreo or sim page's loops get the idle rules. */
export function forLoops(rule) {
    return { name: rule.name, check: async (page, ctx) => (loopsIn(await rolesOf(page, ctx)).size > 0 ? rule.check(page, ctx) : []) };
}
/**
 * The windows of motion a person caused, which the envelope and overshoot rules leave out. On a
 * live, idle or scroll page: the input window. On a choreo or sim page: each cause's caused window,
 * from the cause to the end of the sequence it starts, pauses and loops not counted.
 */
export async function exemptWindows(page, frames, ctx) {
    if (!isCaused(ctx)) {
        const w = inputWindow(frames, ctx.input);
        return w ? [w] : [];
    }
    return causedWindows(frames, ctx.causes ?? causesOf(ctx.input), loopsIn(await rolesOf(page, ctx)));
}
/**
 * On a choreo or sim page, the stretches envelope leaves out: each scroll burst, and each press whose pointer moves
 * while it is down (a drag may carry a value), to one frame past its stop. A tap starts a sequence the rule judges:
 * its pieces may not pop and its fades only fall, however late they start. The pulse attack bound is for flashes the
 * page plays by itself, so a caused shake or toss is not held to it, and a caused dip that comes back halfway is a
 * pulse however slow, so a fade through black is no fade that rises again.
 */
function carriedWindows(ctx) {
    const samples = ctx.input?.kind === "pointer" ? ctx.input.samples : [];
    const drags = (c) => samples.some((q) => q[0] >= c.startMs - 1e-6 && q[0] <= c.stopMs + 1e-6 && (q[1] !== c.at?.[0] || q[2] !== c.at?.[1]));
    return (ctx.causes ?? causesOf(ctx.input)).filter((c) => c.kind === "scroll" || (c.kind === "press" && drags(c))).map((c) => [c.startMs, c.stopMs + FRAME_MS]);
}
/** The windows envelope leaves out: the input's on a live, idle or scroll page, carriedWindows on a choreo or sim page. */
const envelopeWindows = async (page, frames, ctx) => (isCaused(ctx) ? carriedWindows(ctx) : exemptWindows(page, frames, ctx));
/**
 * Envelope: no pop, a pulse has a 40 to 120 ms attack, fades only fall, and one capped time step.
 * An onset whose whole change is below its unit's tolerance floor is left out.
 * A pop is one frame that covers more than half of an onset's whole change. A pulse rises from
 * rest to a peak within 500 ms and then comes back toward where it started (a flash, a badge
 * pulse); ordinary moves, tweens, springs and loops have no attack bound. A value whose starts
 * repeat at a fixed period (3 or more, within 1 frame, over 15 s) is a loop. Motion the input drives,
 * and motion that starts at a cut, are left out; on a choreo or sim page only a drag or a scroll burst drives it
 * (carriedWindows). A stepped value's pops are judged on its drawings, in lengths of its object (drawingJumps), and the
 * rest of the rule reads its pose line. On a live or scroll page the stepped values the input rule judges (inputLeads)
 * are left out from the input's first sample to the end of the raw window, where they rest after the input, so a step
 * the input rule reports is not reported again here; every other stepped value is judged there too.
 */
const envelope = {
    name: "envelope",
    async check(page, ctx) {
        // Onsets inside the span are read on to their rest, up to SETTLE_MS past it, so a move the span cuts is whole.
        const frames = await page.frames(0, spanOf(ctx) + SETTLE_MS);
        const { units } = await page.state();
        const out = [];
        const flagged = new Set();
        let long;
        const isDesigned = async (o) => {
            if (isCaused(ctx) && loopsIn(await rolesOf(page, ctx)).has(o.name))
                return true;
            const loop = await periodicFor(page, o.name, units[o.name]);
            return loop !== null && o.ms >= loop.leadMs - 1e-6;
        };
        const isLoop = async (o) => {
            if (await isDesigned(o))
                return true;
            if (!long) {
                const lf = await page.frames(0, LOOP_SCAN_MS);
                long = onsets(lf, await envelopeWindows(page, lf, ctx), ctx.cuts);
            }
            const starts = long.filter((x) => x.name === o.name && x.rising === o.rising).map((x) => x.ms);
            if (starts.length < LOOP_STARTS)
                return false;
            const gaps = starts.slice(1).map((t, k) => t - starts[k]);
            return Math.max(...gaps) - Math.min(...gaps) <= FRAME_MS + 1e-6;
        };
        const windows = await envelopeWindows(page, frames, ctx);
        const caused = isCaused(ctx) ? await exemptWindows(page, frames, ctx) : [];
        const stepped = new Set(ctx.stepped ?? []);
        const reported = new Set(valueNames(frames));
        const objects = stepped.size > 0 ? (await page.state()).objects : {};
        const inputLeads = stepped.size > 0 && !isCaused(ctx) && ctx.input ? await (await KIND_RULES[ctx.kind]?.())?.inputLeads?.(page, ctx) : undefined;
        for (const name of [...stepped].filter((n) => reported.has(n))) {
            // `ms` is the frame before the step: the input rule judges the steps into frames inside its window.
            const left = (ms) => inputLeads
                ? inputLeads.names.includes(name) && ms + FRAME_MS >= inputLeads.window[0] - 1e-6 && ms + FRAME_MS <= inputLeads.window[1] + 1e-6
                : windows.some((w) => ms + FRAME_MS >= w[0] - 1e-6 && ms <= w[1] + 1e-6);
            const skip = (ms) => left(ms) || ctx.cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS);
            const pop = (await drawingJumps(page, name, objects, spanOf(ctx), units[name], ctx.kind === "scroll", skip))[0];
            if (!pop)
                continue;
            flagged.add(name);
            const [at, L] = [round(pop.atMs), roundLengths(pop.lengths)];
            const drawings = `${pop.drawings} drawing${pop.drawings === 1 ? "" : "s"}`;
            out.push(pop.kind === "spike"
                ? `envelope: ${name} at ${at} ms jumps ${L} of its object's length in ${drawings}, ${roundLengths(pop.ratio)} times the drawings around it; that is a pop`
                : pop.kind === "teleport"
                    ? `envelope: ${name} at ${at} ms jumps ${L} object lengths between two rests; that is a teleport`
                    : `envelope: ${name} at ${at} ms jumps ${L} object lengths and back in one drawing; that is a teleport`);
        }
        for (const o of onsets(frames, windows, ctx.cuts)) {
            if (flagged.has(o.name) || o.ms > spanOf(ctx) + 1e-6)
                continue;
            const inCause = caused.some((w) => o.ms + FRAME_MS >= w[0] - 1e-6 && o.ms <= w[1] + 1e-6);
            const problems = await onsetProblems(page, frames, o, units[o.name], isLoop, stepped.has(o.name), inCause, ctx.cuts, isDesigned);
            if (problems.length > 0) {
                flagged.add(o.name);
                out.push(...problems.map((p) => `envelope: ${p}`));
            }
        }
        const gap = await realClockGap(page, { spanMs: spanOf(ctx), ...(ctx.input ? { drive: (live) => driveInput(live, ctx.input) } : {}) });
        out.push(...gap.map((l) => `envelope: time step: ${l.replace(/^realClockGap: /, "")}`));
        return out;
    },
};
/** A leg turns, and a level counts as passed, only past this share of the move's travel. */
const OVERSHOOT_SHARE = 0.02;
/** A turn after which the value swings back more than this many times its last swing starts a new move. */
const GROWS = 3;
/**
 * Where a stepped value's chains end (`overshootIn`'s `holdAt`): the frame each held drawing (poses.ts `heldPoses`)
 * gives way to the next, where its pose line reaches it, from its raw frames `raw`. A slow drawing among slow ones
 * (threes into ones) holds nothing.
 */
export function heldDrawings(raw) {
    const ps = poses(raw, stillTol(raw));
    const held = heldPoses(ps);
    return new Set(ps.slice(1).filter((_, k) => held[k]).map((p) => p.start));
}
function judgeChain(levels, held, floor, allow, returns = true) {
    const n = levels.length;
    const swing = (j) => Math.abs(levels[j].x - levels[j - 1].x);
    const cuts = [0];
    let far = 0;
    let slop = 0;
    // A chain held back where it started is a shake, which may grow (a wobble that winds up): no turn of it goes on.
    const reach = Math.max(...levels.map((l) => Math.abs(l.x - levels[0].x)));
    const home = held && Math.abs(levels[n - 1].x - levels[0].x) <= Math.max(floor, OVERSHOOT_SHARE * reach);
    for (let j = 1; j + 1 < n; j++) {
        const from = levels[cuts[cuts.length - 1]].x;
        const dist = Math.abs(levels[j].x - from);
        // A held turn short of the farthest the move has gone ends it: the value came to rest there.
        const heldShort = levels[j].held === true && dist < far - Math.max(floor, OVERSHOOT_SHARE * far);
        if (dist > far)
            [far, slop] = [dist, levels[j].slop ?? 0];
        // A new move starts at a turn after which the value swings back more than GROWS times its last swing, or, in a
        // chain that does not come home, goes on farther from where this move started than it has been (past the frame
        // step beside its farthest turn, which a sharp turn, as a ball's landing, can miss its extreme by).
        const goesOn = !home && Math.abs(levels[j + 1].x - from) > far + Math.max(floor, OVERSHOOT_SHARE * far, slop);
        if (levels[j].soft || heldShort || swing(j + 1) > GROWS * swing(j) || goesOn) {
            cuts.push(j);
            far = 0;
            slop = 0;
        }
    }
    cuts.push(n - 1);
    for (let g = 0; g + 1 < cuts.length; g++) {
        const [a, b] = [cuts[g], cuts[g + 1]];
        const inner = levels.slice(a + 1, b);
        if (inner.length === 0)
            continue;
        // A move the frames cut off has no stop to judge it against.
        if (b === n - 1 && !held)
            continue;
        const [s, r] = [levels[a], levels[b]];
        const reach = Math.max(...inner.map((l) => Math.abs(l.x - s.x)));
        const first = inner[0];
        const toFirst = Math.abs(first.x - s.x);
        let hit = null;
        if (Math.abs(r.x - s.x) <= Math.max(floor, OVERSHOOT_SHARE * reach)) {
            const d = Math.sign(s.x - first.x);
            const need = Math.max(floor, OVERSHOOT_SHARE * toFirst);
            // Held at its start, a move that peaks within PULSE_PEAK_MS is pulses (an opacity value's never is: it never
            // passes where it rests).
            if (b === n - 1 && returns && first.ms - s.ms <= PULSE_PEAK_MS)
                continue;
            for (const l of inner.slice(1))
                if (d * (l.x - s.x) > need && (!hit || d * (l.x - s.x) > hit.by))
                    hit = { ms: l.ms, by: d * (l.x - s.x), move: toFirst };
        }
        else {
            const total = Math.abs(r.x - s.x);
            const d = Math.sign(r.x - s.x);
            const pulse = toFirst >= reach - 1e-9 && first.ms - s.ms <= PULSE_PEAK_MS && Math.sign(first.x - s.x) * (r.x - s.x) <= PULSE_RETURN * toFirst;
            if (pulse)
                continue;
            const need = Math.max(floor, OVERSHOOT_SHARE * total);
            for (const l of inner)
                if (d * (l.x - r.x) > need && (!hit || d * (l.x - r.x) > hit.by))
                    hit = { ms: l.ms, by: d * (l.x - r.x), move: total };
        }
        if (hit && !allow(hit))
            return hit;
    }
    return null;
}
function overshootIn(frames, v, floor, eps, skip, allow = () => false, holdAt = new Set(), returns = true) {
    let levels = [];
    let cur = null;
    let still = 0;
    const holdSteps = Math.ceil(HOLD_MS / FRAME_MS - 1e-6);
    const leg = (s, d, startMs, extI, ext = s, extMs = startMs) => ({ s, ext, d, startMs, extMs, extI, vmax: 0, dip: null });
    // A turn's frame can miss its true extreme by up to the frame step beside it.
    const slopAt = (k) => Math.max(k > 0 ? Math.abs(v[k] - v[k - 1]) : 0, k + 1 < v.length ? Math.abs(v[k + 1] - v[k]) : 0);
    // A turn the value holds still at for REST_FRAMES frame steps or more is held.
    const heldAt = (k) => {
        let n = 0;
        while (k + n + 1 < v.length && Math.abs(v[k + n + 1] - v[k + n]) <= eps)
            n++;
        return n >= REST_FRAMES;
    };
    const turn = (c) => ({ x: c.ext, ms: c.extMs, soft: false, slop: slopAt(c.extI), held: heldAt(c.extI) });
    /** Judge the chain that ends at level `x` at `ms`, held there or cut off. */
    const close = (x, ms, held) => {
        if (cur && cur.d !== 0 && Math.abs(cur.ext - x) > eps && cur.extMs < ms)
            levels.push(turn(cur));
        return judgeChain([...levels, { x, ms, soft: false }], held, floor, allow, returns);
    };
    for (let i = 0; i < frames.length; i++) {
        const ms = frames[i].ms;
        const x = v[i];
        if (skip(ms)) {
            levels = [];
            cur = null;
            still = 0;
            continue;
        }
        if (cur === null) {
            cur = leg(x, 0, ms, i);
            levels = [{ x, ms, soft: false }];
            continue;
        }
        const step = Math.abs(x - v[i - 1]);
        const wasStill = still;
        still = step > eps ? 0 : still + 1;
        if (still >= holdSteps || holdAt.has(i)) {
            const hit = close(x, ms, true);
            if (hit)
                return hit;
            cur = leg(x, 0, ms, i);
            levels = [{ x, ms, soft: false }];
            continue;
        }
        if (cur.d === 0) {
            if (Math.abs(x - cur.s) > floor)
                Object.assign(cur, { d: Math.sign(x - cur.s), ext: x, extMs: ms, extI: i, vmax: step });
            continue;
        }
        const ahead = Math.sign(x - v[i - 1]) === cur.d;
        // Held still for REST_FRAMES frame steps, then on the same way at any speed: it stopped there.
        if (wasStill >= REST_FRAMES && step > eps && ahead) {
            levels.push({ x: v[i - 1], ms: frames[i - 1].ms, soft: true });
            cur = { ...leg(v[i - 1], cur.d, frames[i - 1].ms, i, x, ms), vmax: step };
            continue;
        }
        if (step > cur.vmax)
            cur.vmax = step;
        if (step < 0.1 * cur.vmax && (cur.dip === null || step < cur.dip.v))
            cur.dip = { x, v: step, ms };
        else if (cur.dip !== null && ahead && step > Math.max(2 * cur.dip.v, 0.2 * cur.vmax)) {
            levels.push({ x: cur.dip.x, ms: cur.dip.ms, soft: true });
            cur = { ...leg(cur.dip.x, cur.d, cur.dip.ms, i, x, ms), vmax: step };
            continue;
        }
        if (cur.d * (x - cur.ext) > 0)
            Object.assign(cur, { ext: x, extMs: ms, extI: i });
        else if (cur.d * (cur.ext - x) > Math.max(floor, OVERSHOOT_SHARE * cur.d * (cur.ext - cur.s))) {
            levels.push(turn(cur));
            cur = { ...leg(cur.ext, -cur.d, cur.extMs, i, x, ms), vmax: step };
        }
    }
    const last = frames.length - 1;
    return last >= 0 && cur ? close(v[last], frames[last].ms, false) : null;
}
/** Inside a designed loop, a settle may pass its rest by at most this share of its move. */
export const LOOP_OVERSHOOT = 0.5;
const periodicMemo = new WeakMap();
/** The loops idleSpan's probe found, by file, for the rule page to take over (the seek frames are the same). */
const probedLoops = new Map();
function periodicMemoOf(page) {
    let memo = periodicMemo.get(page);
    if (!memo) {
        memo = { frames: page.frames(0, PERIODIC_SCAN_MS), byName: new Map() };
        periodicMemo.set(page, memo);
    }
    return memo;
}
/** Whether value `name` on `page` is a designed loop (periodic.ts), read once per page and value. */
export function periodicFor(page, name, unit) {
    const memo = periodicMemoOf(page);
    let found = memo.byName.get(name);
    if (!found) {
        const frames = memo.frames;
        found = frames.then((fs) => periodicOf(page, fs, name, unitFloor(unit, rangeOf(series(fs, name)))));
        memo.byName.set(name, found);
    }
    return found;
}
/**
 * Overshoot: only motion a person caused may pass its rest and come back, and opacity never does.
 * Motion the input drives is left out, from the input's first sample until the page rests after
 * the last one (on a choreo or sim page, each caused window), and so are cuts. An opacity value is left out only until the input's last sample,
 * so the settle after a release is judged too. Below a unit's tolerance floor nothing is judged. A designed loop
 * (periodicFor) may settle past its rest by up to LOOP_OVERSHOOT of its move, when each cycle holds still for
 * REST_FRAMES frame steps; before its lead-in ends it is judged as any other motion.
 */
const overshoot = {
    name: "overshoot",
    async check(page, ctx) {
        const frames = await page.frames(0, spanOf(ctx));
        const { units } = await page.state();
        const wins = await exemptWindows(page, frames, ctx);
        const samples = ctx.input?.samples ?? [];
        const lastSample = samples.length > 0 ? samples[samples.length - 1][0] : null;
        // An opacity value is left out only while the hand acts: to the input's last sample, or on a
        // choreo or sim page to each cause's stop.
        const opacityWins = isCaused(ctx)
            ? (ctx.causes ?? causesOf(ctx.input)).filter((c) => c.kind !== "load").map((c) => [c.startMs, c.stopMs])
            : wins.map((w) => [w[0], lastSample ?? w[1]]);
        const nearCut = (ms) => ctx.cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS);
        const stepped = new Set(ctx.stepped ?? []);
        const raw = stepped.size > 0 ? await page.rawFrames(0, spanOf(ctx)) : [];
        const out = [];
        for (const name of valueNames(frames)) {
            const v = series(frames, name);
            // A stepped value's frames are its pose line, which glides through a held drawing: its chains end there too.
            const holdAt = stepped.has(name) ? heldDrawings(series(raw, name)) : new Set();
            const unit = units[name];
            const opacity = unit === "opacity";
            const floor = unitFloor(unit, rangeOf(v));
            const skip = (ms) => nearCut(ms) || (opacity ? opacityWins : wins).some((w) => ms >= w[0] - FRAME_MS - 1e-6 && ms <= w[1] + 1e-6);
            const hit = overshootIn(frames, v, floor, stillTol(v), skip, undefined, holdAt, !opacity);
            if (!hit)
                continue;
            const passes = `overshoot: ${name} passes its rest by ${round(hit.by)} at ${round(hit.ms)} ms`;
            // A designed loop may settle past its rest by up to LOOP_OVERSHOOT of its move, when each cycle holds still.
            const loop = opacity ? null : await periodicFor(page, name, unit);
            if (loop && !loop.stillEachCycle) {
                out.push(`${passes} and comes back; a loop may settle past its rest only when each cycle holds still for ${REST_FRAMES} frames or more`);
                continue;
            }
            if (loop) {
                const over = overshootIn(frames, v, floor, stillTol(v), skip, (h) => h.ms >= loop.leadMs - 1e-6 && h.by <= LOOP_OVERSHOOT * h.move * (1 + 1e-9), holdAt);
                if (over && over.ms >= loop.leadMs - 1e-6)
                    out.push(`overshoot: ${name} passes its rest by ${round(over.by)} at ${round(over.ms)} ms, ${Math.round((over.by / over.move) * 100)}% of its move; a loop may pass its rest by at most ${LOOP_OVERSHOOT * 100}% of its move`);
                else if (over)
                    out.push(`overshoot: ${name} passes its rest by ${round(over.by)} at ${round(over.ms)} ms and comes back, before its loop starts; only motion a person caused may overshoot`);
                continue;
            }
            const why = opacity ? "opacity never overshoots" : "only motion a person caused may overshoot";
            out.push(`${passes} and comes back; ${why}`);
        }
        return out;
    },
};
/**
 * The loop stops at rest: 0 rAF callbacks in the second after rest. A live or scroll page rests
 * after its input. An idle page loops while it is on screen, so it is checked at its still frame
 * under reduced motion. A choreo or sim page rests when every value but its loops holds still after
 * its sequence ends, as the seek frames show it: a pause inside the sequence is no rest. There every value
 * the seek frames move must have moved (liveEndsShort). A page with a loop keeps its clock running, and its
 * kind's rules check that the loop pauses off screen.
 */
const loopStopsAtRest = {
    name: "loopStopsAtRest",
    async check(page, ctx) {
        const idle = ctx.kind === "idle";
        const loops = isCaused(ctx) ? loopsIn(await rolesOf(page, ctx)) : new Set();
        const seek = isCaused(ctx) ? await page.frames(0, spanOf(ctx)) : [];
        const sequenceEnd = isCaused(ctx) ? (lastMoveMs(seek, loops) ?? 0) : 0;
        const live = await reopen(page, { seek: false, ...(idle ? { reducedMotion: true } : {}) });
        try {
            const t0 = performance.now();
            if (!idle)
                await drive(live, ctx);
            await sleep(Math.max(0, t0 + sequenceEnd - performance.now()));
            const rest = await waitForRest(live, 5000, loops);
            if (rest === null)
                return [`loopStopsAtRest: the page is still moving 5 s after ${idle ? "it loads under reduced motion" : "the input ends"}`];
            if (isCaused(ctx)) {
                const short = await liveEndsShort(live, seek, loops, (await page.state()).units, Math.min(...(ctx.causes ?? causesOf(ctx.input)).map((c) => c.startMs)));
                if (short)
                    return [short];
            }
            // A loop keeps the clock running: on a choreo or sim page with one, the rest of the page resting is enough.
            if (loops.size > 0)
                return [];
            const n = await live.rafCountAfter(rest, 1000);
            return n === 0 ? [] : [`loopStopsAtRest: ${n} rAF callbacks ran in the second after the page came to rest${idle ? " under reduced motion" : ""}`];
        }
        finally {
            await live.close();
        }
    },
};
/**
 * On a choreo or sim page at rest on its live loop: each value but the loops that the `?seek` frames move away from
 * where it was when the first cause started has left that start too (by its unit floor or 2% of its range). A live
 * loop that stops in a pause, and so never plays the rest of the sequence, fails. Where a value lands is not compared:
 * a live frame may run longer than 1/60 s, and chaotic physics may land elsewhere.
 */
async function liveEndsShort(live, seek, loops, units, startMs) {
    const { values } = await live.state();
    const before = [...seek].reverse().find((f) => f.ms < startMs - 1e-6) ?? seek[0];
    const last = seek[seek.length - 1]?.values ?? {};
    for (const n of valueNames(seek).filter((x) => !loops.has(x))) {
        const range = rangeOf(series(seek, n));
        const tol = Math.max(unitFloor(units[n], range), 0.02 * range);
        const [start, lv, sv] = [before?.values[n] ?? Number.NaN, values[n] ?? Number.NaN, last[n] ?? Number.NaN];
        if (Math.abs(sv - start) > tol && Math.abs(lv - start) <= tol)
            return `loopStopsAtRest: the live page comes to rest with ${n} still at its start, ${round(lv)}, where its ?seek frames end at ${round(sv)}; the live loop stopped before its sequence ended`;
    }
    return null;
}
const NOISY = /^(error|warning|assert|pageerror): /;
/** The console stays clean: no error, warning or uncaught error, on the `?seek` run or the live run. */
const consoleClean = {
    name: "consoleClean",
    async check(page, ctx) {
        await page.frames(0, spanOf(ctx));
        const live = await reopen(page, { seek: false });
        try {
            await drive(live, ctx);
            await sleep(300);
            return [
                ...page.console().filter((m) => NOISY.test(m)).map((m) => `consoleClean: ${m} (the ?seek run)`),
                ...live.console().filter((m) => NOISY.test(m)).map((m) => `consoleClean: ${m} (the live run)`),
            ];
        }
        finally {
            await live.close();
        }
    },
};
/**
 * Two states are the same when every value sits within 2% of its range (at least 0.001). A value that comes back on
 * screen each time it moves on by a whole turn or step (`wraps`: 360 for an angle, a ticking loop's step) is compared
 * modulo each, within 2% of its range or of that turn, the less.
 */
function sameState(a, b, ranges, wraps = () => []) {
    return [...ranges].every(([n, r]) => {
        const d = (a[n] ?? Number.NaN) - (b[n] ?? Number.NaN);
        if (Math.abs(d) <= Math.max(1e-3, 0.02 * r))
            return true;
        return wraps(n).some((m) => Math.abs((((d % m) + 1.5 * m) % m) - 0.5 * m) <= Math.max(1e-3, 0.02 * Math.min(r, m)));
    });
}
/** An angle comes back on screen after a whole turn. */
const turns = (units) => (n) => (units[n] === "deg" ? [360] : []);
/** Under reduced motion, a value on a scroll page takes at most this many still states over the sweep. */
export const STILL_STATES_MAX = 6;
/** Under reduced motion, an opacity value on a scroll page may reach its new state by a fade this long, at most. */
export const REDUCED_FADE_MS = 300;
/** The sweep scrolls this far in each step, one step every SWEEP_STEP_FRAMES frames. */
const SWEEP_STEP_PX = 50;
const SWEEP_STEP_FRAMES = 2;
/** The sweep goes down to the page's end, or this far when the page is longer. */
const SWEEP_MAX_PX = 5000;
/** The sweep holds this many frames at the bottom, and again at the top after it comes back. */
const SWEEP_HOLD_FRAMES = 30;
/**
 * The scroll input of the reduced-motion sweep, one sample a frame from `startMs` (on the 1/60 s grid): down in
 * SWEEP_STEP_PX steps to `maxY` (at most SWEEP_MAX_PX), a hold, back up to the top in the same steps, and a hold.
 */
export function sweepInput(startMs, maxY) {
    const first = Math.round(startMs / FRAME_MS);
    const steps = Math.floor(Math.min(maxY, SWEEP_MAX_PX) / SWEEP_STEP_PX);
    const down = Array.from({ length: steps * SWEEP_STEP_FRAMES + 1 }, (_, k) => SWEEP_STEP_PX * Math.floor(k / SWEEP_STEP_FRAMES));
    const top = down[down.length - 1];
    const ys = [...down, ...Array(SWEEP_HOLD_FRAMES).fill(top), ...[...down].reverse(), ...Array(SWEEP_HOLD_FRAMES).fill(0)];
    return { kind: "scroll", samples: ys.map((y, i) => [((first + i) * 1000) / 60, y]) };
}
/**
 * A blank start state: a start the page leaves and never comes back to without reduced motion (an entrance). A value
 * that wraps (sameState) comes back when it has moved on by a whole turn or step.
 */
function blankStill(normal, reduced, ranges, wraps) {
    const same = (a, b) => sameState(a, b, ranges, wraps);
    const start = normal[0]?.values ?? {};
    const left = normal.findIndex((f) => !same(f.values, start));
    const blank = left >= 0 && normal.slice(left).every((f) => !same(f.values, start));
    const still = reduced[reduced.length - 1]?.values;
    return blank && still && same(still, start) ? ["reducedMotion: the still frame under reduced motion is the blank start state; show the end state instead"] : [];
}
/**
 * Reduced motion on a scroll page: stepped states. The gate sweeps the page down to its end and back (sweepInput), once
 * without reduced motion and once with it. Under reduced motion input still answers, but each value moves between a
 * few still states (STILL_STATES_MAX or fewer over the sweep), each reached in one frame, or by a fade of
 * REDUCED_FADE_MS at most for an opacity value. A continuous scroll-linked zoom or parallax fails. A value that, each
 * time it moves, lands on the scroll position (within one frame) is the scroll itself and is not judged.
 */
async function steppedStates(page, ctx) {
    const maxY = await page.page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
    if (maxY < SWEEP_STEP_PX)
        return [`reducedMotion: the page scrolls ${round(maxY)} px; the reduced-motion sweep needs ${SWEEP_STEP_PX} px or more`];
    const sweep = sweepInput(ctx.input ? inputSpan(ctx.input).start : INPUT_START_MS, maxY);
    const { start, end } = inputSpan(sweep);
    const run = async (reducedMotion) => {
        const p = await reopen(page, { input: sweep.samples, reducedMotion });
        try {
            return await p.frames(0, end + SETTLE_MS);
        }
        finally {
            await p.close();
        }
    };
    const normal = await run(false);
    const rf = await run(true);
    const { units } = await page.state();
    const names = valueNames([...normal, ...rf]);
    const ranges = new Map(names.map((n) => [n, Math.max(rangeOf(series(normal, n)), rangeOf(series(rf, n)))]));
    const scrollAt = (ms) => [...sweep.samples].reverse().find((q) => q[0] <= ms + 1e-6)?.[1] ?? 0;
    const changes = inputChanges(sweep);
    const inSweep = (f) => f.ms >= start - 1e-6 && f.ms <= end + SETTLE_MS + 1e-6;
    const out = [];
    for (const n of names) {
        const v = series(rf, n);
        const eps = stillEps(ranges.get(n));
        const moves = v.map((x, i) => i > 0 && Math.abs(x - v[i - 1]) > eps);
        const near = (x, ms) => [scrollAt(ms), scrollAt(ms - FRAME_MS)].some((y) => Math.abs(x - y) <= TOLERANCE_FLOORS.px);
        if (moves.some(Boolean) && moves.every((m, i) => !m || near(v[i], rf[i].ms)))
            continue;
        const fade = units[n] === "opacity";
        // Each move lands within one frame of a scroll change, or within a short fade of one.
        for (let i = 1; i < rf.length; i++) {
            if (!moves[i])
                continue;
            const [a, b] = [rf[i - 1].ms, rf[i].ms];
            const ok = changes.some((c) => c <= b + 1e-6 && (fade ? b - c <= REDUCED_FADE_MS + 1e-6 : c > a - FRAME_MS - 1e-6));
            if (ok)
                continue;
            out.push(fade
                ? `reducedMotion: ${n} still fades at ${round(a)} ms, more than ${REDUCED_FADE_MS} ms after the scroll last changed; under reduced motion a fade is short`
                : `reducedMotion: ${n} still moves at ${round(a)} ms, more than one frame after the input last changed; under reduced motion the target is reached in 1 frame`);
            break;
        }
        // A few still states, not a continuous scroll-linked change.
        const tol = Math.max(1e-3, 0.02 * ranges.get(n));
        const stills = v.filter((x, i) => i > 0 && inSweep(rf[i]) && !moves[i] && Number.isFinite(x)).sort((x, y) => x - y);
        let states = 0;
        let from = Number.NEGATIVE_INFINITY;
        for (const x of stills)
            if (x > from + tol)
                [states, from] = [states + 1, x];
        if (states > STILL_STATES_MAX) {
            out.push(`reducedMotion: ${n} takes ${states} still values as the page scrolls ${round(maxY)} px under reduced motion; a scroll page moves between a few still states (${STILL_STATES_MAX} or fewer), with no continuous scroll-linked change`);
        }
        // Input still answers.
        const answers = (frames) => rangeOf(frames.filter(inSweep).map((f) => f.values[n] ?? Number.NaN)) > eps;
        if (answers(normal) && !answers(rf))
            out.push(`reducedMotion: ${n} answers the input without reduced motion, but not with it; input still answers under reduced motion`);
    }
    out.push(...blankStill(normal, rf, ranges, turns(units)));
    return out;
}
/** Under reduced motion a choreo or sim page shows a state held at least this long, away from its start, in a sequence that comes back. */
export const HOLD_SHOWN_MS = 500;
/** The reduced-motion check on a choreo or sim page plays the last cause once more this long after its sequence ends. */
export const REDUCED_REPEAT_MS = 500;
/** A value's value at the last frame at or before `ms`. */
const valueAt = (frames, ms, n) => [...frames].reverse().find((f) => f.ms <= ms + 1e-6)?.values[n] ?? Number.NaN;
/**
 * Where each value in `names` holds still, without reduced motion, for HOLD_SHOWN_MS or longer, away from where it
 * started, in a caused window that ends where it began (a toast that slides in, holds and slides out). A window in which
 * the value goes back to its first frame from a start elsewhere is a replay: reduced motion may skip it.
 */
function heldStates(normal, windows, names, ranges, tol) {
    const held = [];
    for (const n of names) {
        const eps = stillEps(ranges.get(n));
        for (const [s, e] of windows) {
            const start = valueAt(normal, s - FRAME_MS / 2, n);
            const endLevel = valueAt(normal, e, n);
            if (!(Math.abs(endLevel - start) <= tol(n)))
                continue;
            const first = normal[0]?.values[n] ?? Number.NaN;
            const run = normal.filter((f) => f.ms >= s - 1e-6 && f.ms <= e + 1e-6);
            if (!(Math.abs(start - first) <= tol(n)) && run.some((f) => Math.abs((f.values[n] ?? Number.NaN) - first) <= tol(n)))
                continue;
            let from = 0;
            for (let i = 1; i <= run.length; i++) {
                if (i < run.length && Math.abs((run[i].values[n] ?? 0) - (run[i - 1].values[n] ?? 0)) <= eps)
                    continue;
                const level = run[from].values[n] ?? Number.NaN;
                if (run[i - 1].ms - run[from].ms >= HOLD_SHOWN_MS - 1e-6 && Math.abs(level - start) > tol(n))
                    held.push({ name: n, level, from: run[from].ms, to: run[i - 1].ms, cause: s, end: e, endLevel });
                from = i;
            }
        }
    }
    return held;
}
/**
 * Reduced motion on a choreo or sim page. The gate plays the page's input with its last cause played once more,
 * REDUCED_REPEAT_MS after its sequence ends (the toggle run), with and without reduced motion. Under reduced motion,
 * each value changes only in the frame the input changes or the one after it, or where it leaves a held state (below).
 * Each value but the loops:
 * - ends every caused window where it ends without reduced motion (within its unit floor or 2% of its range): input
 *   still answers, and reduced motion shows the end state. A value already at that end (an entrance shown finished,
 *   a sequence that replays, a shake that comes back) need not move; the repeat shows whether a second cause answers;
 * - in a window that ends where it began and is no replay, shows each state held HOLD_SHOWN_MS or longer away from
 *   that start, for as long as it holds. It may enter the state in one frame from the cause until the hold starts,
 *   and leave it in one frame, onto the sequence's end, from when the hold ends until the sequence ends.
 * The blank-start check reads the run up to the repeat.
 */
async function causedReduced(page, ctx) {
    const loops = loopsIn(await rolesOf(page, ctx));
    const { units } = await page.state();
    const causes = ctx.causes ?? causesOf(ctx.input);
    const last = causes[causes.length - 1];
    const at = (lastMoveMs(await page.frames(0, spanOf(ctx)), loops) ?? last.stopMs) + REDUCED_REPEAT_MS;
    const input = repeatCause(ctx.input, last, at);
    const to = at + spanOf(ctx) - last.startMs;
    const run = async (reducedMotion) => {
        const p = await reopen(page, { input: input.samples, reducedMotion });
        try {
            return await p.frames(0, to);
        }
        finally {
            await p.close();
        }
    };
    const normal = await run(false);
    const rf = await run(true);
    const all = valueNames([...normal, ...rf]);
    const names = all.filter((n) => !loops.has(n));
    const ranges = new Map(all.map((n) => [n, Math.max(rangeOf(series(normal, n)), rangeOf(series(rf, n)))]));
    const tol = (n) => Math.max(unitFloor(units[n], ranges.get(n)), 0.02 * ranges.get(n));
    const windows = causedWindows(normal, causesOf(input), loops);
    const held = heldStates(normal, windows, names, ranges, tol);
    const changes = inputChanges(input);
    const out = [];
    for (const n of all) {
        const v = series(rf, n);
        const eps = stillEps(ranges.get(n));
        for (let i = 1; i + 1 < rf.length; i++) {
            if (!(Math.abs(v[i + 1] - v[i]) > eps))
                continue;
            const [a, b] = [rf[i].ms, rf[i + 1].ms];
            if (changes.some((c) => c > a - FRAME_MS - 1e-6 && c <= b + 1e-6))
                continue;
            // The reduced path may enter a held state in one frame, from its cause until it holds, and leave it in one frame,
            // onto the sequence's end, from when it stops holding until the sequence ends.
            const lands = (h, to) => h.name === n && Math.abs(v[i + 1] - to) <= tol(n);
            if (held.some((h) => lands(h, h.level) && a >= h.cause - FRAME_MS - 1e-6 && a <= h.from + 1e-6))
                continue;
            if (held.some((h) => lands(h, h.endLevel) && a >= h.to - 2 * FRAME_MS - 1e-6 && a <= h.end + 1e-6))
                continue;
            out.push(`reducedMotion: ${n} still moves at ${round(a)} ms, more than one frame after the input last changed; under reduced motion the target is reached in 1 frame`);
            break;
        }
    }
    for (const n of names) {
        for (const [s, e] of windows) {
            const [nv, rv] = [valueAt(normal, e, n), valueAt(rf, e, n)];
            if (Math.abs(nv - rv) <= tol(n))
                continue;
            const again = s >= at - 1e-6 ? `the cause played again at ${round(s)} ms` : `the cause at ${round(s)} ms`;
            out.push(`reducedMotion: ${n} rests at ${round(rv)} after ${again} under reduced motion, and at ${round(nv)} without it; reduced motion shows the sequence's end state`);
            break;
        }
        // The hold's last frame is where the page starts to leave it, so it need not show there.
        const missed = held.find((h) => h.name === n && rf.some((f) => f.ms >= h.from - 1e-6 && f.ms <= h.to - FRAME_MS + 1e-6 && !(Math.abs((f.values[n] ?? Number.NaN) - h.level) <= tol(n))));
        if (missed)
            out.push(`reducedMotion: ${n} holds at ${round(missed.level)} from ${round(missed.from)} to ${round(missed.to)} ms after the cause at ${round(missed.cause)} ms and comes back, but not under reduced motion; reduced motion shows a held state too`);
    }
    const before = (fs) => fs.filter((f) => f.ms < at - 1e-6);
    out.push(...blankStill(before(normal), before(rf), ranges, turns(units)));
    return out;
}
/**
 * Reduced motion: input still answers, the target is reached in 1 frame, and the still frame is not
 * the blank start state. A choreo or sim page has its own check (causedReduced). The blank start state is a start the page leaves and never comes back to
 * without reduced motion (an entrance). A scroll page instead moves between stepped states (steppedStates).
 */
export const reducedMotion = {
    name: "reducedMotion",
    async check(page, ctx) {
        if (ctx.kind === "scroll")
            return steppedStates(page, ctx);
        if (isCaused(ctx))
            return causedReduced(page, ctx);
        const normal = await page.frames(0, spanOf(ctx));
        const reduced = await reopen(page, { reducedMotion: true });
        let rf;
        try {
            // An idle page has no input, so under reduced motion nothing moves after its first frame: read it as long as
            // its loops are looked for, so a motion that starts late is seen.
            rf = await reduced.frames(0, ctx.kind === "idle" ? Math.max(spanOf(ctx), PERIODIC_SCAN_MS) : spanOf(ctx));
        }
        finally {
            await reduced.close();
        }
        const out = [];
        const { units } = await page.state();
        const names = valueNames([...normal, ...rf]);
        const ranges = new Map(names.map((n) => [n, Math.max(rangeOf(series(normal, n)), rangeOf(series(rf, n)))]));
        const changes = inputChanges(ctx.input);
        for (const n of names) {
            const v = series(rf, n);
            const eps = stillEps(ranges.get(n));
            for (let i = 1; i + 1 < rf.length; i++) {
                if (!(Math.abs(v[i + 1] - v[i]) > eps))
                    continue;
                const [a, b] = [rf[i].ms, rf[i + 1].ms];
                if (changes.some((c) => c > a - FRAME_MS - 1e-6 && c <= b + 1e-6))
                    continue;
                out.push(`reducedMotion: ${n} still moves at ${round(a)} ms, more than one frame after the input last changed; under reduced motion the target is reached in 1 frame`);
                break;
            }
        }
        if (ctx.input) {
            const { start, end } = inputSpan(ctx.input);
            const moves = (frames, n) => {
                const inSpan = frames.filter((f) => f.ms >= start - 1e-6 && f.ms <= end + FRAME_MS + 1e-6).map((f) => f.values[n] ?? Number.NaN);
                return rangeOf(inSpan) > stillEps(ranges.get(n));
            };
            for (const n of names)
                if (moves(normal, n) && !moves(rf, n))
                    out.push(`reducedMotion: ${n} answers the input without reduced motion, but not with it; input still answers under reduced motion`);
        }
        // A ticking loop comes back on screen each period, moved on by its step; a value that moves at one steady speed
        // (a marquee) each frame, moved on by its frame step.
        const steps = new Map();
        for (const n of names) {
            const loop = await periodicFor(page, n, units[n]);
            if (loop && Math.abs(loop.step) > unitFloor(units[n], ranges.get(n)))
                steps.set(n, Math.abs(loop.step));
            const d = series(normal, n).slice(1).map((x, i) => x - normal[i].values[n]);
            if (!loop && d.length > 0 && Math.abs(d[0]) > stillEps(ranges.get(n)) && d.every((x) => Math.abs(x - d[0]) <= stillEps(ranges.get(n))))
                steps.set(n, Math.abs(d[0]));
        }
        out.push(...blankStill(normal, rf, ranges, (n) => [...turns(units)(n), ...(steps.has(n) ? [steps.get(n)] : [])]));
        return out;
    },
};
/**
 * Stepped values (a bar's trace.json `stepped`): each must be a value the page reports, it must change over the
 * span, and it must move an object in `__state().objects`, whose length its drawings are judged in. A frozen value
 * marked stepped would hide nothing, but it marks nothing either.
 */
export const stepped = {
    name: "stepped",
    async check(page, ctx) {
        const names = ctx.stepped ?? [];
        if (names.length === 0)
            return [];
        const frames = await page.rawFrames(0, spanOf(ctx));
        const reported = new Set(valueNames(frames));
        const owner = objectOf((await page.state()).objects);
        return names.flatMap((name) => {
            if (!reported.has(name))
                return [`stepped: ${name} is not a value the page reports`];
            const out = rangeOf(series(frames, name)) > 0 ? [] : [`stepped: ${name} never changes`];
            if (!owner.has(name))
                out.push(`stepped: ${name} moves no object; a stepped value names its object in __state().objects`);
            return out;
        });
    },
};
/**
 * Objects: the record a page reports in `__state().objects` is whole in every frame the rules read, each `px` value
 * moves its box, and each box spike has a cause (objects.ts `checkObjects`). A page that reports none passes.
 */
export const objects = {
    name: "objects",
    async check(page, ctx) {
        const frames = await page.rawFrames(0, spanOf(ctx));
        const s = await page.state();
        const { width, height } = await page.viewport();
        return checkObjects(frames, s.objects, valueNames(frames), s.units, width, height, ctx.kind === "scroll", ctx.cuts);
    },
};
/**
 * Drawn: the boxes in a page's object record hold what changes on screen, judged on screenshot pairs (drawn.ts). A
 * page that reports no objects passes. Its notes go to the run's notes.
 */
export const drawn = {
    name: "drawn",
    async check(page, ctx) {
        const read = await drawnRead(page, { ...ctx, spanMs: spanOf(ctx) });
        ctx.notes?.push(...read.notes);
        return read.lines;
    },
};
/**
 * Values: each value the page reports is a finite number in every frame, from the first frame that holds it on. A
 * value that turns NaN or Infinity, or goes missing, for a frame hides what it does there from every other rule, while
 * the renderer drops the bad frame and the value jumps.
 */
export const values = {
    name: "values",
    async check(page, ctx) {
        // An idle page is read as long as its loops are looked for, as under reduced motion: a bad frame may come late.
        const frames = await page.rawFrames(0, ctx.kind === "idle" ? Math.max(spanOf(ctx), PERIODIC_SCAN_MS) : spanOf(ctx));
        const out = [];
        for (const name of valueNames(frames)) {
            const first = frames.findIndex((f) => Object.hasOwn(f.values, name));
            const at = (f) => (Object.hasOwn(f.values, name) ? f.values[name] : undefined);
            const bad = frames.findIndex((f, i) => i >= first && !Number.isFinite(at(f)));
            if (bad < 0)
                continue;
            const x = at(frames[bad]);
            out.push(`values: ${name} is ${x === undefined ? "missing" : String(x)} at ${round(frames[bad].ms)} ms; a value the page reports is a finite number in every frame once it appears`);
        }
        return out;
    },
};
export const ALL_RULES = [envelope, overshoot, loopStopsAtRest, consoleClean, reducedMotion, stepped, objects, drawn, values];
// ---- the gate -------------------------------------------------------------------------------
const metaContent = (html, name) => {
    for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
        if (!new RegExp(`\\bname\\s*=\\s*["']${name}["']`, "i").test(m[0]))
            continue;
        const c = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(m[0]);
        return c ? c[1].trim() : "";
    }
    return null;
};
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
/** The page's kind from its marker, and whether it is a copied bar; or the failure line. */
export function pageKind(html, file) {
    const slug = metaContent(html, "motion-kit-bar");
    if (slug !== null) {
        const barFile = path.join(path.dirname(file), "bar.json");
        let bar;
        try {
            bar = readJson(barFile);
        }
        catch (e) {
            return { failure: `kind: ${barFile} is not valid JSON: ${e.message}` };
        }
        if (bar === undefined)
            return { failure: `kind: the page names bar ${slug || "(empty)"}, but there is no bar.json next to it` };
        const kinds = bar.kinds;
        if (!Array.isArray(kinds) || typeof kinds[0] !== "string")
            return { failure: "kind: bar.json lists no kinds; its main kind comes first" };
        return { kind: kinds[0], bar: true };
    }
    const kind = metaContent(html, "motion-kit-kind");
    if (kind !== null)
        return { kind, bar: false };
    return { failure: 'kind: the page has no marker; add <meta name="motion-kit-kind" content="<kind>"> (or motion-kit-bar on a copied bar)' };
}
/** The local scripts the page loads with `<script src>`, for the audit. */
function localScripts(html, dir) {
    const out = [];
    for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        const src = m[1];
        if (/^[a-z][\w+.-]*:|^\/\//i.test(src))
            continue;
        const file = path.resolve(dir, src.split(/[?#]/)[0]);
        if (existsSync(file))
            out.push({ src, text: readFileSync(file, "utf8") });
    }
    return out;
}
/** The values a trace marks as stepped (held in drawings on purpose), or none. */
export const steppedOf = (trace) => Array.isArray(trace?.stepped) ? trace.stepped.filter((n) => typeof n === "string") : [];
/** The times of a trace's rows, `[ms, ...values]`. */
const rowTimes = (trace) => Array.isArray(trace?.samples) ? trace.samples.map((r) => (Array.isArray(r) ? r[0] : undefined)).filter((t) => typeof t === "number" && Number.isFinite(t)) : [];
/** A copied bar's trace.json, or undefined when the page is not a bar or has none that parses. */
function traceOf(dir, bar) {
    if (!bar)
        return undefined;
    try {
        return readJson(path.join(dir, "trace.json"));
    }
    catch {
        return undefined;
    }
}
/**
 * A bar's own recorded input (trace.json `input`), or null when the page plays the synthetic input: a live bar's
 * drag (2 samples or more), or a choreo or sim bar's pointer or scroll input (1 sample or more).
 */
function recordedInput(kind, trace) {
    const input = trace?.input;
    if (!Array.isArray(input?.samples))
        return null;
    if (kind === "live" && input.kind === "pointer" && input.samples.length >= 2)
        return input;
    if (CAUSED_KINDS.includes(kind) && (input.kind === "pointer" || input.kind === "scroll") && input.samples.length >= 1)
        return input;
    return null;
}
/** When the last cause in `input` stops, or 0 with none. */
const lastStop = (input) => Math.max(0, ...causesOf(input).map((c) => c.stopMs));
/**
 * How far the rules read on a choreo or sim page playing `input` (open on `page`): CAUSE_SETTLE_MS past the last
 * cause's stop, or SETTLE_MS past the end of the sequence it starts, the later. The end is the last move of a value
 * that is no loop, looked for up to SEQUENCE_SCAN_MS past the stop.
 */
async function causedSpan(page, input, cuts) {
    const scan = lastStop(input) + SEQUENCE_SCAN_MS;
    const frames = await page.frames(0, scan);
    const end = lastMoveMs(frames, loopNames(frames, [], cuts)) ?? 0;
    return { spanMs: Math.max(lastStop(input) + CAUSE_SETTLE_MS, end + SETTLE_MS), cut: end > scan - REST_FRAMES * FRAME_MS + 1e-6 };
}
/** A choreo or sim page still moving SEQUENCE_SCAN_MS past the last cause's stop: the rules do not read its end. */
export const sequenceCutLine = (input) => `span: a value still moves ${SEQUENCE_SCAN_MS} ms after the last cause stops at ${round(lastStop(input))} ms; the rules read a sequence for ${SEQUENCE_SCAN_MS / 1000} s at most`;
/**
 * A choreo or sim page's input and span. A bar plays its recorded input. Any other page gets the synthetic tap after
 * its load motion; when no value answers the tap within TAP_PROBE_MS, the page starts by itself, and the gate judges
 * its load motion with no input. The rules read to the end of the sequence the input starts (causedSpan).
 */
async function causedInputAndSpan(file, kind, trace) {
    const recorded = recordedInput(kind, trace);
    const cuts = Array.isArray(trace?.cuts) ? trace.cuts.filter((c) => typeof c === "number") : [];
    const stepped = steppedOf(trace);
    if (recorded) {
        const page = await openPage(file, { input: recorded.samples, stepped });
        try {
            const { spanMs, cut } = await causedSpan(page, recorded, cuts);
            return { input: recorded, spanMs: Math.max(recordedSpan(recorded, rowTimes(trace)), spanMs), cut };
        }
        finally {
            await page.close();
        }
    }
    // A bar whose original had no input starts on load, as its trace does: no tap.
    if (trace?.input?.kind === "none")
        return { input: null, spanMs: Math.max(SPAN_MS, CAUSE_SETTLE_MS, ...rowTimes(trace).map((t) => t + SETTLE_MS)) };
    let quiet;
    let tapped;
    let start = INPUT_START_MS;
    let answers = true;
    let span = { spanMs: 0, cut: false };
    try {
        quiet = await openPage(file, { stepped });
        start = inputStartAfter(await quiet.frames(0, LOAD_SCAN_MS));
        const tap = syntheticInput(kind, start);
        tapped = await openPage(file, { input: tap.samples, stepped });
        const [a, b] = [await quiet.frames(start, start + TAP_PROBE_MS), await tapped.frames(start, start + TAP_PROBE_MS)];
        const names = valueNames([...a, ...b]);
        answers = names.some((n) => {
            const eps = stillEps(Math.max(rangeOf(series(a, n)), rangeOf(series(b, n))));
            return a.some((f, i) => Math.abs((f.values[n] ?? Number.NaN) - (b[i]?.values[n] ?? Number.NaN)) > eps);
        });
        if (answers)
            span = await causedSpan(tapped, tap, cuts);
    }
    catch (e) {
        // As inputAndSpan: a page that cannot open fails the gate's start; one with no clock hook fails noHook.
        if (!quiet)
            throw e;
    }
    finally {
        await quiet?.close();
        await tapped?.close();
    }
    if (!answers)
        return { input: null, spanMs: Math.max(SPAN_MS, start + CAUSE_SETTLE_MS) };
    const input = syntheticInput(kind, start);
    return { input, spanMs: Math.max(SPAN_MS + (start - INPUT_START_MS), lastStop(input) + CAUSE_SETTLE_MS, span.spanMs), cut: span.cut };
}
async function inputAndSpan(file, kind, trace) {
    if (CAUSED_KINDS.includes(kind))
        return causedInputAndSpan(file, kind, trace);
    const recorded = recordedInput(kind, trace);
    if (recorded)
        return { input: recorded, spanMs: recordedSpan(recorded, rowTimes(trace)) };
    if (syntheticInput(kind) === null)
        return { input: null, spanMs: await idleSpan(file, trace) };
    let probe;
    let start = INPUT_START_MS;
    try {
        probe = await openPage(file, { stepped: steppedOf(trace) });
        start = inputStartAfter(await probe.frames(0, LOAD_SCAN_MS));
    }
    catch (e) {
        // A page that cannot open is the gate failing to start: the CLI exits 2. A page with no clock hook opens but
        // cannot be scanned; the noHook check reports that.
        if (!probe)
            throw e;
    }
    finally {
        await probe?.close();
    }
    return { input: syntheticInput(kind, start), spanMs: SPAN_MS + (start - INPUT_START_MS) };
}
/**
 * How far the rules read an idle page: SPAN_MS, through the lead-in and IDLE_PERIODS_READ periods of its longest designed
 * loop (periodic.ts), or SETTLE_MS past the last move of a value that is no designed loop, the latest, and at most
 * PERIODIC_SCAN_MS, the frames the loops are found in, or a copied bar's last trace row. So a pop, a spring or a settle late in a long loop, or a
 * one-time move after 3 s, is read, and a loop that comes back to its start comes back inside the read.
 */
async function idleSpan(file, trace) {
    let probe;
    try {
        probe = await openPage(file, { stepped: steppedOf(trace) });
        const { units } = await probe.state();
        const memo = periodicMemoOf(probe);
        const frames = await memo.frames;
        let span = SPAN_MS;
        const loops = new Set();
        for (const n of valueNames(frames)) {
            const loop = await periodicFor(probe, n, units[n]);
            if (!loop)
                continue;
            loops.add(n);
            span = Math.max(span, loop.leadMs + IDLE_PERIODS_READ * loop.periodMs);
        }
        const last = lastMoveMs(frames, loops);
        if (last !== null)
            span = Math.max(span, last + SETTLE_MS);
        probedLoops.set(file, memo);
        // A copied bar that lists cuts lists them only as far as its trace runs: the rules read it no further.
        const rows = Array.isArray(trace?.cuts) && trace.cuts.length > 0 ? rowTimes(trace) : [];
        return Math.min(span, PERIODIC_SCAN_MS, rows.length > 0 ? Math.max(SPAN_MS, ...rows) : Number.POSITIVE_INFINITY);
    }
    catch (e) {
        // As inputAndSpan: a page that cannot open fails the gate's start; one with no clock hook fails noHook.
        if (!probe)
            throw e;
        return SPAN_MS;
    }
    finally {
        await probe?.close();
    }
}
/**
 * The input the kind gate would play on `file` and how far its seek frames reach. A page with no marker, an unknown
 * kind or a kind with no gate plays no input over SPAN_MS. The frame sheet draws the page with this, so it shows what
 * the gate judges.
 */
export async function pageInput(file) {
    const picked = pageKind(readFileSync(file, "utf8"), file);
    if ("failure" in picked || !KIND_RULES[picked.kind])
        return { input: null, spanMs: SPAN_MS };
    return inputAndSpan(file, picked.kind, traceOf(path.dirname(file), picked.bar));
}
/**
 * Runs Gate B on one page: reads its marker, runs the static audit, then the gate checks on
 * nothing (a missing clock hook, zero frames, an input past the span) and every rule of the page's
 * kind. A page with no marker, an unknown kind, or a kind with no rules in this version fails; it
 * never passes. The audit skips its literal check only for a copy of one of the kit's own bars
 * (literalExemption): the bar's slug, with a MOTION block the same as the kit's, byte for byte.
 */
export async function kindGate(file) {
    const html = readFileSync(file, "utf8");
    const dir = path.dirname(file);
    const root = kitRoot();
    const exemption = literalExemption(html, (slug) => readTextFile(path.join(root, "bars", slug, "index.html")));
    const audited = audit(html, localScripts(html, dir), { literals: !exemption.exempt });
    const notes = exemption.note ? [exemption.note] : [];
    const fail = (line, kind = null) => ({ status: "failed", failures: [line, ...audited.failures], kind, distances: audited.distances, notes });
    const picked = pageKind(html, file);
    if ("failure" in picked)
        return fail(picked.failure);
    const known = KINDS.includes(picked.kind);
    const load = known ? KIND_RULES[picked.kind] : undefined;
    if (!load) {
        if (!known && !GATELESS_KINDS.includes(picked.kind))
            return fail(`kind: ${picked.kind || "(empty)"} is not a kind; the kinds are ${[...KINDS, ...GATELESS_KINDS].join(", ")}`);
        const ready = Object.keys(KIND_RULES).join(", ");
        return fail(`kind: ${picked.kind} has no kind gate in this version of motion-kit (only ${ready} do), so the page cannot pass`, known ? picked.kind : null);
    }
    const kind = picked.kind;
    const { rules } = await load();
    const trace = traceOf(dir, picked.bar);
    const cuts = Array.isArray(trace?.cuts) ? trace.cuts.filter((c) => typeof c === "number") : [];
    const { input, spanMs, cut } = await inputAndSpan(file, kind, trace);
    const stepped = steppedOf(trace);
    const ctx = { kind, input, cuts, spanMs, causes: causesOf(input), stepped, notes: [] };
    // On a live or scroll page the input drives the motion: inside the input window, stepped values read as drawings.
    const steppedInputRaw = kind === "live" || kind === "scroll";
    let opened;
    const page = () => (opened ??= openPage(file, { ...(ctx.input ? { input: ctx.input.samples } : {}), stepped, steppedInputRaw }).then((p) => {
        // An idle page's probe already looked for its loops on the same seek frames.
        const probed = ctx.input ? undefined : probedLoops.get(file);
        if (probed)
            periodicMemo.set(p, probed);
        probedLoops.delete(file);
        return p;
    }));
    const checks = {
        audit: () => audited.failures,
        noHook: async () => noHook(await page()),
        zeroFrames: async () => zeroFrames(await (await page()).frames(0, spanMs)),
        span: () => [...inputPastSpan(input, spanMs), ...(cut ? [sequenceCutLine(input)] : [])],
    };
    for (const r of [...ALL_RULES, ...rules])
        checks[r.name] = async () => r.check(await page(), ctx);
    try {
        return { ...(await runChecks(checks)), kind, distances: audited.distances, notes: [...notes, ...ctx.notes] };
    }
    finally {
        if (opened)
            await opened.then((p) => p.close()).catch(() => undefined);
    }
}
