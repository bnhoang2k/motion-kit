import { TOLERANCE_FLOORS } from "../../src/core/bar.js";
import { causedWindows, causesOf, repeatCause } from "../../src/gate/causes.js";
import { FRAME_MS } from "../../src/gate/harness.js";
import { forLoops, loopsIn, rangeOf, reopen, REST_FRAMES, rolesOf, round, series, SETTLE_MS, spanOf, stillEps, valueNames } from "../../src/gate/kind-gate.js";
import { rules as idleRules } from "../idle/gate.js";
/**
 * The choreo rules (kinds/choreo/rules.md). A choreo page plays a staggered sequence after a cause:
 * a tap, a scroll, or the page load. `interrupt` plays the cause's own trigger once more just before
 * and just after each piece starts, and every value must stay continuous and come to rest where the
 * page also rests without it. A stepped value's jump test reads its drawings, raw against raw. A loop on the page gets the idle rules: it pauses off screen.
 */
/** The second trigger lands this long before, and again this long after, each piece starts. */
export const INTERRUPT_MS = 8;
/** At most this many piece starts are tried, picked evenly across the sequences: 16 runs. */
export const MAX_BOUNDARIES = 8;
/** A value jumps when one frame moves it more than this many times its largest frame step in the clean run... */
export const JUMP_STEPS = 2.5;
/** ...plus this share of its range. */
export const JUMP_RANGE = 0.01;
/** A rest matches one of the page's own rests within this share of the value's range, or its unit's floor. */
const SAME_REST = 0.02;
/** The toggle run plays the second trigger this long after the clean sequence ends. */
const TOGGLE_AFTER_MS = 500;
/** Where every value starts to move after a cause and before the next, merged when two fall within one frame. */
function boundariesOf(frames, names, causes, k) {
    const c = causes[k];
    const limit = causes[k + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    const starts = [];
    for (const n of names) {
        const v = series(frames, n);
        const eps = stillEps(rangeOf(v));
        for (let i = 0; i + 1 < frames.length; i++) {
            const ms = frames[i].ms;
            if (ms < c.startMs - FRAME_MS - 1e-6 || frames[i + 1].ms > limit + 1e-6)
                continue;
            const moves = (j) => j >= 0 && Math.abs(v[j + 1] - v[j]) > eps;
            let heldBefore = true;
            for (let j = 1; j <= REST_FRAMES && heldBefore; j++)
                heldBefore = !moves(i - j) || frames[i - j].ms < c.startMs - FRAME_MS - 1e-6;
            if (moves(i) && heldBefore)
                starts.push(ms);
        }
    }
    starts.sort((a, b) => a - b);
    return starts.filter((ms, j) => j === 0 || ms - starts[j - 1] > FRAME_MS + 1e-6);
}
/** At most `max` items, picked evenly from first to last. */
const evenPick = (xs, max) => (xs.length <= max ? xs : Array.from({ length: max }, (_, j) => xs[Math.round((j * (xs.length - 1)) / (max - 1))]));
const interrupt = {
    name: "interrupt",
    async check(page, ctx) {
        const span = spanOf(ctx);
        const frames = await page.frames(0, span);
        const { units } = await page.state();
        const loops = loopsIn(await rolesOf(page, ctx));
        const names = valueNames(frames).filter((n) => !loops.has(n));
        const causes = ctx.causes ?? causesOf(ctx.input);
        const windows = causedWindows(frames, causes, loops);
        const seqEnd = (k) => {
            // A load has no caused window; its sequence ends where every value rests.
            const c = causes[k];
            if (c.kind !== "load")
                return windows[causes.slice(0, k).filter((x) => x.kind !== "load").length][1];
            return causedWindows(frames, [{ ...c, kind: "press" }], loops)[0][1];
        };
        const per = causes.map((c, k) => ({ c, k, b: boundariesOf(frames, names, causes, k) }));
        if (!per.some((p) => p.b.length >= 2)) {
            const first = per.find((p) => p.b.length === 1);
            return [first ? `interrupt: every value starts at ${round(first.b[0])} ms; one onset is not a sequence` : "interrupt: no value moves after the cause, so there is no sequence to interrupt"];
        }
        // The second trigger lands after the cause stops: a repeat inside the press would be the press itself.
        const tries = per.filter((p) => p.b.length >= 2).flatMap((p) => p.b.filter((ms) => ms - INTERRUPT_MS > p.c.stopMs + 1e-6).map((ms) => ({ cause: p.c, k: p.k, ms })));
        const ranges = new Map(names.map((n) => [n, rangeOf(series(frames, n))]));
        const floorOf = (n) => (units[n] !== undefined && Object.hasOwn(TOLERANCE_FLOORS, units[n]) ? TOLERANCE_FLOORS[units[n]] : 0);
        const valueAt = (fs, ms, n) => fs.reduce((best, f) => (Math.abs(f.ms - ms) < Math.abs(best.ms - ms) ? f : best), fs[0]).values[n] ?? Number.NaN;
        // A run's frames, and its raw frames: a stepped value's jump test compares its drawings, raw against raw.
        const run = async (input, from, to) => {
            const p = await reopen(page, { input: input.samples });
            try {
                return { fs: await p.frames(from, to), raw: await p.rawFrames(from, to) };
            }
            finally {
                await p.close();
            }
        };
        const rawClean = await page.rawFrames(0, span);
        const out = [];
        const toggles = new Map();
        for (const t of evenPick(tries, MAX_BOUNDARIES)) {
            const end = seqEnd(t.k);
            const limit = causes[t.k + 1]?.startMs ?? Number.POSITIVE_INFINITY;
            const length = end - t.cause.startMs;
            if (!toggles.has(t.k)) {
                const at = end + TOGGLE_AFTER_MS;
                const { fs } = await run(repeatCause(ctx.input, t.cause, at), at, Math.min(limit, at + length + SETTLE_MS));
                toggles.set(t.k, fs[fs.length - 1].values);
            }
            const inClean = (f) => f.ms >= t.cause.startMs - 1e-6 && f.ms <= end + FRAME_MS + 1e-6;
            const clean = rawClean.filter(inClean);
            for (const at of [t.ms - INTERRUPT_MS, t.ms + INTERRUPT_MS]) {
                const to = Math.min(limit, Math.max(end, at) + length + SETTLE_MS);
                const { fs, raw } = await run(repeatCause(ctx.input, t.cause, at), at - FRAME_MS, to);
                for (const n of names) {
                    const range = ranges.get(n);
                    const cleanV = series(clean, n);
                    const maxStep = Math.max(0, ...cleanV.slice(1).map((x, i) => Math.abs(x - cleanV[i])).filter(Number.isFinite));
                    const rv = series(raw, n);
                    const bound = JUMP_STEPS * maxStep + JUMP_RANGE * range;
                    const cut = (ms) => ctx.cuts.some((c) => c >= ms - FRAME_MS && c <= ms + 2 * FRAME_MS);
                    const j = rv.findIndex((x, i) => i > 0 && !cut(raw[i - 1].ms) && Math.abs(x - rv[i - 1]) > bound + 1e-9);
                    if (j > 0) {
                        out.push(`interrupt: ${n} jumps ${round(Math.abs(rv[j] - rv[j - 1]))} in one frame after the second trigger at ${round(at)} ms; its largest frame step without it is ${round(maxStep)}`);
                        continue;
                    }
                    const v = series(fs, n);
                    const eps = stillEps(Math.max(range, rangeOf(v)));
                    const tail = v.slice(-REST_FRAMES - 1);
                    if (tail.some((x, i) => i > 0 && Math.abs(x - tail[i - 1]) > eps)) {
                        out.push(`interrupt: ${n} has not come to rest by ${round(to)} ms after the second trigger at ${round(at)} ms; nothing may be stuck moving`);
                        continue;
                    }
                    const rest = v[v.length - 1];
                    const own = [valueAt(frames, t.cause.startMs, n), valueAt(frames, end, n), toggles.get(t.k)[n] ?? Number.NaN];
                    const tol = Math.max(floorOf(n), SAME_REST * range, 1e-6);
                    if (!own.some((x) => Math.abs(x - rest) <= tol)) {
                        out.push(`interrupt: ${n} rests at ${round(rest)} after the second trigger at ${round(at)} ms, a state the page never rests at without it; a piece is stuck halfway`);
                    }
                }
            }
        }
        return [...new Set(out)];
    },
};
export const rules = [interrupt, ...idleRules.map(forLoops)];
