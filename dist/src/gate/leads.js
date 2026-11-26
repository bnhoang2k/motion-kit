import { REST_FRAMES, round, spanOf } from "./kind-gate.js";
import { explainedBy, fitSlopes, goneIn, objectOf } from "./objects.js";
import { drawingsOf, excursions, lineAt, poses, restsOf } from "./poses.js";
import { roundLengths } from "./self-checks.js";
import { HOLD_MS, series, stillTol, valueNames } from "./series.js";
import { inputSpan } from "./synthetic-input.js";
/**
 * Values that follow the input, and stepped drawings that run ahead of it or jump off it. The live rules aim a regrab
 * with `tracks`; the live `follows` rule and the scroll rules judge `leads` inside the input window.
 */
/** A value tracks an input axis when it moves with it this closely during the input (|r|). */
export const TRACK_R = 0.9;
const axesOf = (input) => (input.kind === "pointer" ? [1, 2] : [1]);
/** The input sample in force at `ms`: the latest one at or before it, else the first. */
function inputAt(input, ms) {
    const s = input.samples;
    let at = s[0];
    for (const q of s)
        if (q[0] <= ms + 1e-6)
            at = q;
    return at;
}
/**
 * Where the input starts, before its first sample: a pointer presses at its first sample, and a scroll page opens at
 * the top (scroll position 0), so a scroll's first sample is already a change.
 */
const inputBefore = (input) => (input.kind === "scroll" ? [inputSpan(input).start, 0] : input.samples[0]);
/** The frame before the input's first sample, where the value still rests before the input moves it (or the first frame). */
const anchorFrame = (frames, input) => Math.max(0, frames.findIndex((f) => f.ms >= inputSpan(input).start - 1e-6) - 1);
/**
 * Each value in `names` that moves with an input axis from the input's first sample to its last, on the axis it follows
 * best, with |r| TRACK_R or more.
 */
export function fits(frames, input, names = valueNames(frames)) {
    const { start, end } = inputSpan(input);
    const inSpan = frames.filter((f) => f.ms >= start - 1e-6 && f.ms <= end + 1e-6);
    const out = [];
    for (const name of names) {
        const v = inSpan.map((f) => f.values[name] ?? Number.NaN);
        const all = axesOf(input).map((axis) => ({ axis, fit: linearFit(inSpan.map((f) => inputAt(input, f.ms)[axis]), v) }));
        const top = all.reduce((a, b) => (Math.abs(b.fit?.r ?? 0) > Math.abs(a.fit?.r ?? 0) ? b : a));
        if (!top.fit || Math.abs(top.fit.r) < TRACK_R || top.fit.slope === 0)
            continue;
        out.push({ axis: top.axis, name, slope: top.fit.slope, r: top.fit.r });
    }
    return out;
}
/**
 * For each input axis, the value that moves with it during the input, and how many value units it moves per input
 * unit. Each value goes to the one axis it follows best, so one value never aims both.
 */
export function tracks(frames, input) {
    const best = new Map();
    for (const t of fits(frames, input)) {
        const held = best.get(t.axis);
        if (!held || Math.abs(t.r) > Math.abs(held.r))
            best.set(t.axis, t);
    }
    return [...best.values()].map(({ axis, name, slope }) => ({ axis, name, slope }));
}
export function linearFit(x, y) {
    const n = x.length;
    if (n < 3 || y.some((v) => !Number.isFinite(v)))
        return null;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
    }
    if (sxx === 0 || syy === 0)
        return null;
    return { slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
}
/** A prefix fit judges a step only once it spans at least this many frames (fittedGains). */
export const PREFIX_FRAMES = 12;
/** The input along `axis` at `ms`: the sample in force, or where the input starts before its first sample (inputBefore). */
const inputOn = (input, axis, ms) => (ms < inputSpan(input).start - 1e-6 ? inputBefore(input) : inputAt(input, ms))[axis];
/**
 * The fitted gain of each value in `names` that tracks an input axis (`fits`, |r| TRACK_R or more over the whole
 * input). A step is judged with the prefix gain: the fit on the frames from the input's first sample to the frame
 * before the step, once that spans PREFIX_FRAMES frames and tracks; before then, the whole fit. So a step never moves
 * the gain that judges it, and a jump that stays ahead is not taken for a steeper gain.
 */
export function fittedGains(frames, input, names) {
    const first = frames.findIndex((f) => f.ms >= inputSpan(input).start - 1e-6);
    return fits(frames, input, names).map(({ name, axis, slope }) => ({
        name,
        axis,
        gain: slope,
        at: (frame) => {
            if (first < 0 || frame - first < PREFIX_FRAMES)
                return slope;
            const prefix = frames.slice(first, frame);
            const fit = linearFit(prefix.map((f) => inputOn(input, axis, f.ms)), prefix.map((f) => f.values[name] ?? Number.NaN));
            return fit && Math.abs(fit.r) >= TRACK_R && fit.slope !== 0 ? fit.slope : slope;
        },
    }));
}
/** The harness reads stepped values raw for at most this many frames past the input's last sample (harness.ts LOOKAHEAD_FRAMES). */
const RAW_WINDOW_FRAMES = 240;
/**
 * Where the raw window ends, in ms: the first frame at or after the input's last sample from which the pose line
 * (poses.ts `lineAt`) of every value in `names` holds still for REST_FRAMES frame steps, at most RAW_WINDOW_FRAMES on
 * and never past the last frame. It is the window inside which the harness reads stepped values raw
 * (OpenOptions.steppedInputRaw), read here from `raw`, frames on the 1/60 s grid from frame 0.
 */
export function rawWindowEnd(raw, input, names) {
    const { end } = inputSpan(input);
    const last = raw.length - 1;
    if (last < 0)
        return end;
    const found = raw.findIndex((f) => f.ms >= end - 1e-6);
    const i0 = found < 0 ? last : found;
    const lines = names.map((n) => {
        const v = series(raw, n);
        const eps = stillTol(v);
        const ps = poses(v, eps);
        const rests = restsOf(ps);
        return { eps, at: (k) => (k > last ? Number.NaN : (lineAt(ps, rests, k) ?? v[k])) };
    });
    const still = (i) => lines.every(({ eps, at }) => {
        for (let k = i; k < i + REST_FRAMES; k++)
            if (!(Math.abs(at(k + 1) - at(k)) <= eps))
                return false;
        return true;
    });
    let i = i0;
    while (i < Math.min(last, i0 + RAW_WINDOW_FRAMES) && !still(i))
        i++;
    return raw[i].ms;
}
/** The median of `xs` (not empty): the middle one, or the mean of the two middle ones. */
function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/**
 * The rest gain of each value in `names` on a one-axis input. A rest is the end of a stretch where the input holds one
 * value, from the input's first sample to the end of the raw window (rawWindowEnd), with the value still over the
 * stretch's last REST_FRAMES frame steps. The gain is the median of the gains read between consecutive rests, a pair
 * whose input is equal left out; with none, it is read from the anchor (the value in the frame before the first sample,
 * at the input before it moves: inputBefore) to the rest furthest from it in input, so with one rest from the anchor to
 * that rest. A value that chases the input (a smoothed scroll) lags it, so a least-squares fit of it is biased; at rest
 * it has caught up. A value with no rest, or a gain of 0, has no gain: stepLeads does not judge it (leadNames), and the
 * envelope rule's stepped pop checks judge it inside the input window instead.
 */
export function restGains(frames, input, names) {
    if (frames.length === 0 || input.samples.length === 0)
        return [];
    const [from, to] = [inputSpan(input).start, rawWindowEnd(frames, input, names)];
    const inside = frames.map((f, i) => i).filter((i) => frames[i].ms >= from - 1e-6 && frames[i].ms <= to + 1e-6);
    if (inside.length === 0)
        return [];
    const at = (i) => inputAt(input, frames[i].ms)[1];
    const [i0, in0] = [anchorFrame(frames, input), inputBefore(input)[1]];
    // The last frame of each stretch of one input value: where the input next changes, or the window's end.
    const ends = inside.filter((i, k) => k === inside.length - 1 || at(inside[k + 1]) !== at(i));
    const out = [];
    for (const name of names) {
        const v = series(frames, name);
        const eps = stillTol(v);
        const rests = ends.filter((e) => {
            if (e - REST_FRAMES < inside[0])
                return false;
            for (let k = e - REST_FRAMES; k < e; k++)
                if (!(at(k) === at(e) && Math.abs(v[k + 1] - v[k]) <= eps))
                    return false;
            return true;
        });
        const between = [];
        for (let k = 1; k < rests.length; k++) {
            const [a, b] = [rests[k - 1], rests[k]];
            if (at(b) !== at(a))
                between.push((v[b] - v[a]) / (at(b) - at(a)));
        }
        let gain = between.length > 0 ? median(between) : null;
        if (gain === null) {
            const far = rests.reduce((best, e) => (Math.abs(at(e) - in0) > Math.abs(best === null ? 0 : at(best) - in0) ? e : best), null);
            if (far !== null)
                gain = (v[far] - v[i0]) / (at(far) - in0);
        }
        if (gain !== null && Number.isFinite(gain) && gain !== 0)
            out.push({ name, axis: 1, gain });
    }
    return out;
}
/** A drawing step lands ahead of the input when it lands more than this many of its value's drawing steps (quantum), plus the input's own travel over the drawing before it (× gain), ahead of where the input puts it. */
export const LEAD_STEPS = 1.5;
/**
 * A drawing step jumps off the input when its residual is more than this many times the largest of its quantum, the
 * input's travel over the drawing before it (× gain), and, when that drawing is brief (shown under HOLD_MS) and the
 * step into it was judged, that step's |Δvalue|. A step taken while the input holds still across it may instead be one
 * quantum more than a same-way step next to it whose drawing is brief (stepLeads): grid rounding of a smooth speed.
 */
export const OFF_STEPS = 1.5;
/** A value has a quantum only with at least this many non-zero drawing steps; with fewer, only excursions judge it. */
export const QUANTUM_STEPS = 3;
/** The non-zero |Δvalue| of the steps between drawings `ds` that `keep` (by the index of the step's new drawing) keeps, leaving out steps into or out of a gone drawing. */
function stepSizes(ds, keep) {
    const out = [];
    for (let j = 1; j < ds.length; j++) {
        const [a, b] = [ds[j - 1], ds[j]];
        if (a.gone || b.gone || !keep(j))
            continue;
        const d = Math.abs(b.value - a.value);
        if (d > 0 && Number.isFinite(d))
            out.push(d);
    }
    return out;
}
const quantumOf = (sizes) => (sizes.length < QUANTUM_STEPS ? null : median(sizes));
/**
 * A value's drawing step: the median |Δvalue| of the non-zero steps between drawings `ds` (the drawings of the judged
 * window), steps into or out of a gone drawing left out. Null with fewer than QUANTUM_STEPS such steps.
 */
export const quantum = (ds) => quantumOf(stepSizes(ds, () => true));
/** The presses of `input`: a pointer presses at each sample that is down (no flag, or 1) after one that is not, or at its first sample when that is down. A scroll has none. */
export function pressesOf(input) {
    if (input.kind !== "pointer")
        return [];
    const out = [];
    let down = false;
    for (const s of input.samples) {
        const now = s[3] !== 0;
        if (now && !down)
            out.push({ ms: s[0], at: [s[1], s[2]] });
        down = now;
    }
    return out;
}
const to2 = (n) => Math.round(n * 100) / 100;
/**
 * The stepped values in `names` that stepLeads judges: each that moves an object in `objects` (the page's record), is
 * not an `index` (by `units`), and has a gain in `gains`. A value with no gain does not follow the input (it moves on
 * its own, or the input never lets it rest), so stepLeads does not judge it: the envelope rule's stepped pop checks
 * judge it inside the input window too (leadWindow).
 */
export function leadNames(names, units, gains, objects) {
    const owner = objectOf(objects);
    return names.filter((n) => owner.has(n) && units[n] !== "index" && gains.some((g) => g.name === n));
}
/**
 * The first failing drawing step of each stepped value that stepLeads judges (leadNames on `read.names`), inside the
 * input window. `raw` are the frames with every stepped value as its drawings
 * (GatePage `rawFrames`), on the 1/60 s grid from frame 0. A step is the change into a drawing, judged where the new
 * drawing starts; steps into or out of a gone drawing are not judged.
 *
 * - **Quantum.** The value's drawing step is the median |Δvalue| of its judged steps from the input's first sample to
 *   the raw window's end (quantum). With none, off and ahead are not judged.
 * - **Gain.** From `gains` by name (fittedGains or restGains; Gain `at` for the step's frame). A value with none
 *   is not judged at all (leadNames).
 * - **Anchor.** pred = v_anchor + gain × (input − input_anchor). The anchor is the value in the frame before the first
 *   sample, at the input before it moves (inputBefore). Each press in `presses` whose point lies inside the object's
 *   box in the first frame at or after it moves the anchor there: that frame's value and the press point. The step
 *   into that frame is not judged (a thumb that jumps to the press).
 * - **Off the input** (to the raw window's end). The residual across the boundary frame, |Δvalue − gain × Δinput|,
 *   may not pass OFF_STEPS × the largest of the quantum, |gain × the input's travel over the drawing before|, and the
 *   previous step's |Δvalue| when that step was judged and the drawing between the two (from one step to the next) is
 *   shown under HOLD_MS. So a value that eases after the input (a spring, a lerp) may grow its step up to OFF_STEPS
 *   times from one brief drawing to the next, while a jump out of a drawing held HOLD_MS or more is held to the
 *   quantum and the travel, unless the rounding allowance below excuses it.
 * - **Rounding while the input holds still.** A step taken while the input holds still across it (from the last frame
 *   of the drawing before to the new drawing, every sample there the same) is not off when its |Δvalue| is at most one
 *   quantum more than a same-way neighbour: the step before (when the drawing before is brief and that step was
 *   judged) or the step after (when the new drawing is brief and that step is judged). A value that moves by its own
 *   speed between 1 and 2 quanta a frame (a stiff spring, a fast chase) rounds to steps of k and k+1 quanta, and the
 *   neighbour after shows the speed it keeps. The cost: a one-quantum fault there (a skip that stays, steps that grow
 *   by one quantum a drawing) passes, and so does a step that a same-way step after it excuses (one cell, then five a
 *   drawing), a step out of a drawing held HOLD_MS or more among them.
 * - **Ahead** (first sample to last). Only while the input moves one way over the drawing before the step (it changes,
 *   and its samples there never turn back), in direction s = sign(gain × that change): s × (v − pred) may not pass
 *   LEAD_STEPS quanta plus |gain × the input's travel over the drawing before|. A drawing taken while the input holds
 *   still is not judged here: a spring that overshoots a still hand belongs to the overshoot rule.
 * - **Excursions** (to the raw window's end): rule 3 of the stepped pop rule on the raw drawings, with the value's
 *   fitted slopes (fitSlopes on `raw`).
 *
 * At one step off goes first, then ahead, then an excursion; each value gives its earliest failing step only.
 */
export function stepLeads(raw, input, gains, objects, presses, read) {
    if (raw.length === 0 || input.samples.length === 0)
        return [];
    const { start, end } = inputSpan(input);
    const owner = objectOf(objects);
    const msOf = (i) => raw[i].ms;
    const inWindow = (ms, to) => ms >= start - 1e-6 && ms <= to + 1e-6;
    const samples = input.samples;
    const out = [];
    for (const name of leadNames(read.names, read.units, gains, objects)) {
        const object = owner.get(name);
        const g = gains.find((x) => x.name === name);
        const inn = (i) => inputOn(input, g.axis, msOf(i));
        // The anchors in time order: before the input, then each press that lands inside the object's box.
        const i0 = anchorFrame(raw, input);
        const anchors = [{ frame: i0, v: raw[i0].values[name] ?? Number.NaN, input: inputBefore(input)[g.axis] }];
        const exempt = new Set();
        for (const p of presses) {
            const f = raw.findIndex((fr) => fr.ms >= p.ms - 1e-6);
            const box = f < 0 ? undefined : raw[f].boxes?.[object];
            if (!box || goneIn(box, read.view.width, read.view.height))
                continue;
            if (p.at[0] < box[0] || p.at[0] > box[0] + box[2] || p.at[1] < box[1] || p.at[1] > box[1] + box[3])
                continue;
            anchors.push({ frame: f, v: raw[f].values[name] ?? Number.NaN, input: p.at[g.axis - 1] });
            exempt.add(f);
        }
        anchors.sort((a, b) => a.frame - b.frame);
        const ds = drawingsOf(raw, name, object, stillTol(series(raw, name)), read.view, read.scrolled);
        const judged = (j) => !ds[j - 1].gone && !ds[j].gone && !exempt.has(ds[j].start) && inWindow(msOf(ds[j].start), read.windowEnd);
        const q = quantumOf(stepSizes(ds, judged));
        const fit = fitSlopes(raw, object, objects[object].moves, read.scrolled);
        const pops = new Map(excursions(ds, read.units[name], fit.slopes.get(name) ?? null, (f) => exempt.has(f), fit.shifted, explainedBy(raw, fit, name))
            .filter((p) => inWindow(msOf(p.atFrame), read.windowEnd))
            .map((p) => [p.atFrame, p]));
        /** The sign of the input's change on the gain's axis from frame `from` to frame `to`, when its samples there move one way; else 0. */
        const oneWay = (from, to) => {
            const seq = [inn(from), ...samples.filter((s) => s[0] > msOf(from) + 1e-6 && s[0] <= msOf(to) + 1e-6).map((s) => s[g.axis])];
            let sign = 0;
            for (let k = 1; k < seq.length; k++) {
                const d = Math.sign(seq[k] - seq[k - 1]);
                if (d === 0)
                    continue;
                if (sign !== 0 && d !== sign)
                    return 0;
                sign = d;
            }
            return Math.sign(seq[seq.length - 1] - seq[0]);
        };
        /** Whether the input holds still on the gain's axis from frame `from` to frame `to`: every sample there equals the input at `from`. */
        const stillOver = (from, to) => inn(to) === inn(from) && samples.every((s) => s[0] <= msOf(from) + 1e-6 || s[0] > msOf(to) + 1e-6 || s[g.axis] === inn(from));
        /** Whether drawing `ds[k]` is brief: shown under HOLD_MS before the next drawing starts. */
        const briefAt = (k) => msOf(ds[k + 1].start) - msOf(ds[k].start) < HOLD_MS - 1e-6;
        /**
         * Whether step j, taken while the input holds still across it, is grid rounding: at most one quantum more than a
         * same-way neighbour step (before it, when its drawing before is brief and that step was judged; after it, when
         * its new drawing is brief and that step is judged).
         */
        const rounding = (j, q) => {
            const [a, b] = [ds[j - 1], ds[j]];
            if (!stillOver(a.endFrame, b.start))
                return false;
            const dv = b.value - a.value;
            const near = [j >= 2 && briefAt(j - 1) && judged(j - 1) ? a.value - ds[j - 2].value : 0, j + 1 < ds.length && briefAt(j) && judged(j + 1) ? ds[j + 1].value - b.value : 0]
                .filter((d) => Number.isFinite(d) && Math.sign(d) === Math.sign(dv))
                .map(Math.abs);
            return near.length > 0 && Math.abs(dv) <= (Math.max(...near) + q) * (1 + 1e-9);
        };
        for (let j = 1; j < ds.length; j++) {
            const [a, b] = [ds[j - 1], ds[j]];
            const ms = msOf(b.start);
            const pop = pops.get(b.start);
            if (judged(j) && q !== null && Number.isFinite(b.value - a.value)) {
                const gain = g.at ? g.at(b.start) : g.gain;
                const travel = Math.abs(gain * (inn(b.start) - inn(a.start)));
                const brief = msOf(b.start) - msOf(a.start) < HOLD_MS - 1e-6;
                const before = j >= 2 && brief && judged(j - 1) ? Math.abs(a.value - ds[j - 2].value) : 0;
                const residual = Math.abs(b.value - a.value - gain * (inn(b.start) - inn(a.endFrame)));
                if (residual > OFF_STEPS * Math.max(q, travel, Number.isFinite(before) ? before : 0) * (1 + 1e-9) && !rounding(j, q)) {
                    out.push({ name, ms, steps: to2(residual / q), kind: "off" });
                    break;
                }
                const s = inWindow(ms, end) ? Math.sign(gain) * oneWay(a.start, b.start) : 0;
                if (s !== 0) {
                    const anchor = anchors.filter((x) => x.frame <= b.start).pop();
                    const ahead = s * (b.value - (anchor.v + gain * (inn(b.start) - anchor.input)));
                    if (ahead > (LEAD_STEPS * q + travel) * (1 + 1e-9)) {
                        out.push({ name, ms, steps: to2(ahead / q), kind: "ahead" });
                        break;
                    }
                }
            }
            if (pop) {
                out.push({ name, ms, steps: q === null ? 0 : to2(Math.abs(b.value - a.value) / q), kind: "excursion", lengths: pop.lengths });
                break;
            }
        }
    }
    return out;
}
/**
 * The failure line of each value's failing step (stepLeads), under the rule `rule` (`follows` or `scroll`): a lead in
 * its drawing steps, a jump off the input in its drawing steps, and an excursion in object lengths, in the envelope
 * rule's excursion words. A step reported here is not reported again under `envelope:` (leadWindow).
 */
export function leads(raw, input, gains, objects, presses, read, rule) {
    return stepLeads(raw, input, gains, objects, presses, read).map((l) => {
        const at = `${rule}: ${l.name} at ${round(l.ms)} ms`;
        if (l.kind === "ahead")
            return `${at} runs ${l.steps} of its drawing steps ahead of the input`;
        if (l.kind === "off")
            return `${at} jumps ${l.steps} of its drawing steps off the input in one drawing`;
        return `${at} jumps ${roundLengths(l.lengths)} object lengths and back in one drawing; that is a teleport`;
    });
}
/** The reads stepLeads judges a page's stepped values (ctx.stepped) on, for `input`, each with its gain from `gainsOf` (fittedGains or restGains). */
async function pageLeads(page, ctx, input, gainsOf) {
    const raw = await page.rawFrames(0, spanOf(ctx));
    const reported = new Set(valueNames(raw));
    const names = (ctx.stepped ?? []).filter((n) => reported.has(n));
    const { objects, units } = await page.state();
    const read = { names, units, view: await page.viewport(), scrolled: ctx.kind === "scroll", windowEnd: rawWindowEnd(raw, input, names) };
    return { raw, gains: gainsOf(raw, input, names), objects, units, presses: pressesOf(input), read };
}
/** `leads` for a page's stepped values (ctx.stepped), each with its own gain from `gainsOf` (fittedGains or restGains). */
export async function steppedLeads(page, ctx, input, rule, gainsOf) {
    const { raw, gains, objects, presses, read } = await pageLeads(page, ctx, input, gainsOf);
    return leads(raw, input, gains, objects, presses, read, rule);
}
/**
 * The stepped values the input rules judge on a live or scroll page (leadNames, for `input` and `gainsOf`, as
 * steppedLeads reads them), and the window the envelope rule leaves out for them: from the first sample of the page's
 * whole input (ctx.input) to the end of its raw window (rawWindowEnd), where the values rest after the input. Every
 * other stepped value is judged by the envelope rule's stepped pop checks there too.
 */
export async function leadWindow(page, ctx, input, gainsOf) {
    const { raw, gains, objects, units, read } = await pageLeads(page, ctx, input, gainsOf);
    const all = ctx.input ?? input;
    return { names: leadNames(read.names, units, gains, objects), window: [inputSpan(all).start, rawWindowEnd(raw, all, read.names)] };
}
