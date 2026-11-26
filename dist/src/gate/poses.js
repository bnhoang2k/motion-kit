import { FOLLOW_PX, goneIn, ownChange, stepParts } from "./objects.js";
import { HOLD_MS, HOLD_RATIO, REST_FRAMES, REST_MS, series } from "./series.js";
/**
 * A run is a rest when it holds at least this many times the typical run beside it... 3, not 2: mixed timing puts
 * threes (7 and 8 frames) next to ones at 24 (2 and 3 frames), and those slow drawings are not stops.
 */
export const REST_RATIO = 3;
/** ...read as the lower median of up to this many runs on each side. */
const NEIGHBOURS = 3;
/** The poses of a series: a frame belongs to the pose before it when it is within `eps` of that pose's value. */
export function poses(v, eps) {
    const out = [];
    for (let i = 0; i < v.length; i++) {
        const cur = out[out.length - 1];
        if (cur && Math.abs(v[i] - cur.value) <= eps)
            cur.frames++;
        else
            out.push({ start: i, frames: 1, value: v[i] });
    }
    return out;
}
/**
 * Pose k is a rest: it holds REST_FRAMES frames or more, and at least REST_RATIO times the lower median length of up
 * to NEIGHBOURS poses on each side. So a rest is long next to the drawings around it, at any drawing rate, and a
 * steady train of equal holds has none.
 */
export function isRest(ps, k) {
    const n = ps[k].frames;
    if (n < REST_FRAMES)
        return false;
    const near = [...ps.slice(Math.max(0, k - NEIGHBOURS), k), ...ps.slice(k + 1, k + 1 + NEIGHBOURS)].map((p) => p.frames).sort((a, b) => a - b);
    return near.length === 0 || n >= REST_RATIO * near[Math.floor((near.length - 1) / 2)];
}
export const restsOf = (ps) => ps.map((_, k) => isRest(ps, k));
/** The pose that holds frame position `fi`. */
function poseAt(ps, fi) {
    let [lo, hi] = [0, ps.length - 1];
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ps[mid].start <= fi + 1e-9)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}
/**
 * The pose line at frame position `fi` (between frames too), or null where it keeps the raw value. The line is
 * causal: it never moves before the raw value. Each drawing's knot sits where the next drawing starts, so over a
 * drawing the line goes from the drawing before it to this one, and reaches each drawing one drawing late. Into a
 * rest it glides over the length of the drawing before (at most the rest's own length, less a frame), then holds. A
 * move from a rest straight to the next rest keeps its raw jump (null), and so does a value that is not a number.
 */
export function lineAt(ps, rests, fi) {
    const k = poseAt(ps, fi);
    if (k === 0)
        return Number.isFinite(ps[0].value) ? ps[0].value : null;
    const [a, p] = [ps[k - 1], ps[k]];
    if (!Number.isFinite(a.value) || !Number.isFinite(p.value) || (rests[k] && rests[k - 1]))
        return null;
    const glide = rests[k] ? Math.max(1, Math.min(a.frames, p.frames - 1)) : p.frames;
    return a.value + (p.value - a.value) * Math.min(1, (fi - p.start) / glide);
}
/** The pose line of a series, one value per frame. */
export function poseLine(v, eps) {
    const ps = poses(v, eps);
    const rests = restsOf(ps);
    return v.map((x, i) => lineAt(ps, rests, i) ?? x);
}
/** The 1/60 s grid the frames sit on, in ms. */
const GRID_MS = 1000 / 60;
/** The lower median length of poses `side`, or 0 for none. */
const typical = (side) => {
    const f = side.map((p) => p.frames).sort((a, b) => a - b);
    return f.length === 0 ? 0 : f[Math.floor((f.length - 1) / 2)];
};
/**
 * Which poses are held: shown HOLD_MS or more, and at least HOLD_RATIO times the lower median length of up to
 * NEIGHBOURS poses on each side, each side apart. A slow drawing among slow ones (threes into ones) holds nothing. A
 * side with no poses gives no veto. With `cutSides` (the pop checks), neither does a side that the start or end of
 * `ps` cuts short of NEIGHBOURS poses: a loop's read starts at a drawing whose drawings before it are not read, so its
 * first drawings would otherwise be judged against a part of their neighbours. The overshoot rule's holds keep the
 * default.
 */
export function heldPoses(ps, cutSides = false) {
    const veto = (p, side) => (cutSides ? side.length >= NEIGHBOURS : true) && p.frames < HOLD_RATIO * typical(side);
    return ps.map((p, k) => p.frames * GRID_MS >= HOLD_MS - 1e-6 && !veto(p, ps.slice(Math.max(0, k - NEIGHBOURS), k)) && !veto(p, ps.slice(k + 1, k + 1 + NEIGHBOURS)));
}
/** A run of drawing steps is a spike when each moves more than this many times as fast as the steps just outside it... */
export const SPIKE_RATIO = 3;
/** ...and the run is at least this many object lengths in all. */
export const SPIKE_MIN = 0.25;
/** A step of more than this many object lengths is a teleport between two rests, and so is an excursion this long. */
export const TELEPORT_LENGTHS = 1;
/** A step goes out and back when the next step takes it at least this share of the way back. */
export const OUT_AND_BACK = 0.5;
/**
 * A look value (opacity, an angle, a ratio) leaves its object's box as it is, so its steps are measured in its own
 * unit: a change of this much counts as one object length. A value in `index` (a sprite frame, a count) never pops.
 */
export const LOOK_LINE = { opacity: 0.25, deg: 15, ratio: 0.25 };
/**
 * The drawings of value `name` (poses within `eps`), with the boxes of `object` in a viewport of `view` CSS px, and the
 * scroll when `scrolled` (else 0).
 *
 * - Each pose is split wherever its box turns from drawn to gone or back (goneIn: a box of 1 by 1, or one wholly
 *   outside the viewport), so each drawing is wholly drawn or wholly gone.
 * - A gone gap shorter than HOLD_MS is bridged: its frames join the drawing before it, and drawings of equal value
 *   (within `eps`) on each side then merge, so the step is judged from the last drawn drawing to the next. A gap is
 *   not bridged when the box leaves through the viewport's edge (the last drawn box before it, or the first after it,
 *   reaches past the viewport: a wrap off screen is honest), nor at the start or end of the frames.
 * - A longer gone gap stays, one gone drawing for each pose in it.
 */
export function drawingsOf(frames, name, object, eps, view, scrolled) {
    const boxAt = (i) => (object !== null && frames[i]?.boxes?.[object]) || null;
    const goneAt = (i) => {
        const b = boxAt(i);
        return b !== null && goneIn(b, view.width, view.height);
    };
    const pastEdge = (i) => {
        const b = boxAt(i);
        return b !== null && (b[0] < 0 || b[1] < 0 || b[0] + b[2] > view.width || b[1] + b[3] > view.height);
    };
    const runs = [];
    for (const p of poses(series(frames, name), eps)) {
        for (let i = p.start; i < p.start + p.frames; i++) {
            const [g, cur] = [goneAt(i), runs[runs.length - 1]];
            if (cur && i > p.start && cur.gone === g)
                cur.frames++;
            else
                runs.push({ start: i, frames: 1, value: p.value, gone: g });
        }
    }
    const out = [];
    for (let k = 0; k < runs.length;) {
        const before = out[out.length - 1];
        if (!runs[k].gone) {
            if (before && !before.gone && Math.abs(runs[k].value - before.value) <= eps)
                before.frames += runs[k].frames;
            else
                out.push({ ...runs[k] });
            k++;
            continue;
        }
        let end = k;
        while (end < runs.length && runs[end].gone)
            end++;
        const n = runs.slice(k, end).reduce((t, r) => t + r.frames, 0);
        const after = runs[end];
        const bridged = before !== undefined && !before.gone && after !== undefined && n * GRID_MS < HOLD_MS - 1e-6 && !pastEdge(runs[k].start - 1) && !pastEdge(after.start);
        if (bridged)
            before.frames += n;
        else
            out.push(...runs.slice(k, end).map((r) => ({ ...r })));
        k = end;
    }
    const scrollAt = (i) => (scrolled ? (frames[i]?.scroll ?? 0) : 0);
    return out.map((r) => {
        let last = r.start + r.frames - 1;
        if (!r.gone)
            while (last > r.start && goneAt(last))
                last--;
        return { ...r, box: boxAt(r.start), endBox: boxAt(last), scroll: scrollAt(r.start), endScroll: scrollAt(last), endFrame: last };
    });
}
/**
 * Whether drawing `i` of `ds` is a rest: shown REST_MS or more, shown from the start of the read (frame 0: the page
 * opens on it), or held to the end of the read, which is frame `lastFrame` (the caller's span plus its read-ahead, as
 * a frame index).
 */
export function isRestDrawing(ds, i, lastFrame) {
    const d = ds[i];
    return d.frames * GRID_MS >= REST_MS - 1e-6 || d.start === 0 || d.start + d.frames - 1 >= lastFrame;
}
/**
 * A box change in centre x, centre y, width and height (ownChange) that leaves each of the box's four numbers (x, y, w,
 * h) within FOLLOW_PX.
 */
const stillBox = (c) => [c[0] - c[2] / 2, c[1] - c[3] / 2, c[2], c[3]].every((x) => Math.abs(x) <= FOLLOW_PX);
/**
 * Whether a `ratio` value with drawings `ds` is a look value, decided once for the run: its own effect on its box stays
 * within FOLLOW_PX on every step where it changes between two drawn drawings. With `slopes` (fitSlopes), that effect
 * is each of |cx·Δv|, |cy·Δv|, |w·Δv| and |h·Δv|, so another value moving the same box does not count; with none, its
 * own change of the box across the boundary frame (ownChange: the scroll change added to y when `shifted`, less what
 * `explained` says the object's fitted values did). A value with no such step is a look value.
 */
export function ratioIsLook(ds, slopes, shifted, explained) {
    for (let j = 1; j < ds.length; j++) {
        const [a, b] = [ds[j - 1], ds[j]];
        const dv = b.value - a.value;
        if (a.gone || b.gone || !a.endBox || !b.box || !Number.isFinite(dv) || dv === 0)
            continue;
        const still = slopes ? [slopes.cx, slopes.cy, slopes.w, slopes.h].every((k) => Math.abs(k * dv) <= FOLLOW_PX) : stillBox(ownChange(a.endBox, b.box, shifted ? b.scroll - a.endScroll : 0, explained(a.endFrame, b.start)));
        if (!still)
            return false;
    }
    return true;
}
const NO_STEP = { position: 0, size: 0, look: 0, speedPos: 0, speedLook: 0 };
/** Whether a value in `unit` is a look value (stepMeasure): opacity, deg, and a ratio when `ratioLook` (ratioIsLook). */
const isLook = (unit, ratioLook) => unit === "opacity" || unit === "deg" || (unit === "ratio" && ratioLook);
/**
 * The step from drawing `a` to drawing `b` of a value in `unit`, measured across the boundary frame (a's `endBox` to
 * b's `box`) with the value's `slopes` (fitSlopes; null where none fit).
 *
 * - **Look values:** `opacity`, `deg` (always: a rotating box's width and height do not change linearly with the angle;
 *   wrapped to the shortest turn), and `ratio` when `how.ratioLook` (ratioIsLook, decided once for the run, so every
 *   step of one value is measured in one unit). Their `look` is |Δvalue| over LOOK_LINE[unit]; position and size are 0.
 * - **Box parts:** every other unit, by stepParts (a `ratio` that moves its box, too): with slopes,
 *   the value's own part, so another value moving the same box never adds to it; with none, the box's change across
 *   the boundary frame, plus the scroll change when the object is fitted scroll-shifted, less what the object's
 *   fitted values explain there (`how.explained`).
 * - An `index` measures 0, and so does a step into or out of a gone drawing, or one with a value that is not a number.
 *
 * Speed is a part over the time the step takes: how long `a` was shown, or `b` when `a` is a hold.
 */
export function stepMeasure(a, b, unit, slopes, how) {
    let dv = b.value - a.value;
    if (unit === "index" || a.gone || b.gone || !Number.isFinite(dv))
        return NO_STEP;
    if (unit === "deg")
        dv = (((dv % 360) + 540) % 360) - 180;
    const ms = (how.heldBefore ? b.frames : a.frames) * GRID_MS;
    const dScroll = how.shifted ? b.scroll - a.endScroll : 0;
    const boxes = a.endBox && b.box ? [a.endBox, b.box] : null;
    const fin = (x) => (Number.isFinite(x) ? x : 0);
    if (isLook(unit, how.ratioLook))
        return { ...NO_STEP, look: fin(Math.abs(dv) / LOOK_LINE[unit]), speedLook: fin(Math.abs(dv) / ms) };
    if (boxes === null)
        return NO_STEP;
    const p = stepParts(boxes[0], boxes[1], slopes, dv, dScroll, how.explained);
    return { ...NO_STEP, position: fin(p.position), size: fin(p.size), speedPos: fin(p.positionPx / ms) };
}
/** A step's ratio must beat SPIKE_RATIO by this share, and lengths reach a line within it: float noise never decides. */
const EPS = 1e-9;
function stepsOf(ds, unit, slopes, skip, shifted, explained) {
    const held = heldPoses(ds, true);
    const ratioLook = ratioIsLook(ds, slopes, shifted, explained);
    const how = (a, b) => ({ shifted, heldBefore: held[a], ratioLook, explained: explained(ds[a].endFrame, ds[b].start) });
    const m = ds.map((b, j) => (j === 0 ? NO_STEP : stepMeasure(ds[j - 1], b, unit, slopes, how(j - 1, j))));
    const judged = (j) => j >= 1 && j < ds.length && !ds[j - 1].gone && !ds[j].gone && !skip(ds[j].start);
    return {
        ds,
        m,
        held,
        unit,
        how,
        len: (j) => m[j].position + m[j].look,
        speed: (j) => m[j].speedPos + m[j].speedLook,
        judged,
        moving: (j) => judged(j) && !held[j - 1] && !held[j],
        slopes,
        shifted,
        look: isLook(unit, ratioLook),
    };
}
/** The faster of the moving steps among `outside`, or null when none of them is one. */
function fastestOf(s, outside) {
    const near = outside.filter(s.moving);
    return near.length === 0 ? null : Math.max(...near.map(s.speed));
}
/** Steps `run`'s speeds over `fastest`: Infinity over a still outside step. */
const ratiosOf = (s, run, fastest) => run.map((k) => (fastest > 0 ? s.speed(k) / fastest : Infinity));
/**
 * Rule 2, from step j: drawing j-1 is a stop (a rest, or a strict hold: heldPoses with every side that has drawings
 * giving its veto, so an even train cut short by the read's edge holds nothing), and drawing j, j+1 or j+2 is the next
 * stop with only brief in-betweens (each shown under HOLD_MS) before it. From the read's first drawing, when it is a
 * rest only by opening the read, the next stop must be a rest. The move's position part is its largest
 * step's; its size part is its net size change from stop to stop (stepMeasure from drawing j-1 to the next stop), so a
 * smear drawn between two holds is no snap. The move is a teleport when the longer of the two is longer than
 * TELEPORT_LENGTHS; a move with a step that is not judged is not. With no in-between both are the one step's.
 */
function teleportAt(s, rest, strict, j) {
    // The read's first drawing, a rest because the page opens on it, ends a move at a rest only: a loop read from
    // mid-motion opens on a drawing whose motion runs on into the cycle's own holds.
    const opens = j - 1 === 0 && s.ds[0].start === 0 && s.ds[0].frames * GRID_MS < REST_MS - 1e-6;
    const stop = (k) => rest[k] || (!opens && strict[k]);
    if (!stop(j - 1))
        return null;
    for (let b = j; b < s.ds.length && b <= j + 2; b++) {
        if (!stop(b)) {
            if (s.ds[b].frames * GRID_MS >= HOLD_MS - 1e-6)
                return null;
            continue;
        }
        let top = j;
        for (let k = j; k <= b; k++) {
            if (!s.judged(k))
                return null;
            if (s.m[k].position > s.m[top].position)
                top = k;
        }
        const size = b === j ? s.m[j].size : stepMeasure(s.ds[j - 1], s.ds[b], s.unit, s.slopes, s.how(j - 1, b)).size;
        const [L, at] = s.m[top].position >= size ? [s.m[top].position, top] : [size, j];
        return L > TELEPORT_LENGTHS * (1 + EPS) ? { pop: { atFrame: s.ds[at].start, kind: "teleport", lengths: L, ratio: 0, drawings: 1 }, next: b + 1 } : null;
    }
    return null;
}
/** A box's centre, with the scroll added to y when `shifted`. */
const centreOf = (b, scroll, shifted) => [b[0] + b[2] / 2, b[1] + b[3] / 2 + (shifted ? scroll : 0)];
/**
 * How far drawings `to` lie from drawing `from`: in value units when the value has slopes, else by box centres, from
 * `from`'s last drawn box to each drawing's first (with the scroll when `shifted`). Null when a box is missing.
 */
function offsetsFrom(s, from, to) {
    const a = s.ds[from];
    if (s.slopes !== null)
        return to.map((k) => Math.abs(s.ds[k].value - a.value));
    if (!a.endBox || to.some((k) => !s.ds[k].box))
        return null;
    const p = centreOf(a.endBox, a.endScroll, s.shifted);
    return to.map((k) => {
        const q = centreOf(s.ds[k].box, s.ds[k].scroll, s.shifted);
        return Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
}
/**
 * Rule 3 at step j: step j goes out and step j+1 comes back at least OUT_AND_BACK of the way (in value units when the
 * value has slopes, else by box centres), the drawing between them is brief (shown under HOLD_MS), and the path
 * resumes: steps j-1 and j+2, each counted only when it is a moving step, run the same way, or neither moves. Its
 * length is the step out's position part. Longer than TELEPORT_LENGTHS, it is a teleport out and back; shorter, a
 * spike of 2 drawings when it reaches SPIKE_MIN and both its steps beat SPIKE_RATIO times the faster outside step.
 */
function excursionAt(s, j) {
    const { ds, m } = s;
    if (!s.judged(j) || !s.judged(j + 1) || ds[j].frames * GRID_MS >= HOLD_MS - 1e-6)
        return null;
    const L = m[j].position;
    if (!(L >= SPIKE_MIN * (1 - EPS)))
        return null;
    const off = offsetsFrom(s, j - 1, [j, j + 1]);
    if (off === null)
        return null;
    const [out, left] = off;
    if (left > (1 - OUT_AND_BACK) * out + EPS)
        return null;
    const way = (k) => (s.moving(k) ? Math.sign(ds[k].value - ds[k - 1].value) : 0);
    if (way(j - 1) !== way(j + 2))
        return null;
    const fastest = fastestOf(s, [j - 1, j + 2]);
    const ratio = fastest === null ? 0 : Math.min(...ratiosOf(s, [j, j + 1], fastest));
    const at = { atFrame: ds[j].start, lengths: L, ratio, drawings: 2 };
    if (L > TELEPORT_LENGTHS * (1 + EPS))
        return { pop: { ...at, kind: "outAndBack" }, next: j + 2 };
    return fastest !== null && ratio > SPIKE_RATIO * (1 + EPS) ? { pop: { ...at, kind: "spike" }, next: j + 2 } : null;
}
/**
 * Whether a position run of 2 or 3 steps goes out and comes back: its last step runs against its first (by the
 * value's sign), and it ends within OUT_AND_BACK of its largest offset from where it started (offsetsFrom: value units
 * with slopes, else box centres). A look value's run never does: it always needs moving steps on both sides.
 */
function backRun(s, run) {
    const [a, z] = [run[0], run[run.length - 1]];
    const d = (k) => s.ds[k].value - s.ds[k - 1].value;
    if (s.look || run.length < 2 || !(Math.sign(d(a)) * Math.sign(d(z)) < 0))
        return false;
    const off = offsetsFrom(s, a - 1, run);
    if (off === null)
        return false;
    return off[off.length - 1] <= (1 - OUT_AND_BACK) * Math.max(...off) + EPS;
}
/**
 * Rule 1 at step j: the first of runs j, j..j+1 and j..j+2 that pops. A run is judged steps; a run of 2 or 3 is moving
 * steps. It pops when each of its steps is faster than SPIKE_RATIO times the faster of the moving steps just outside it
 * (j-1 and the one after the run) and its total length reaches SPIKE_MIN. A single step needs one moving step outside
 * it. A run of 2 or 3 needs moving steps on both sides, unless it is a position run that goes out and comes back
 * (backRun): then a judged step beside a hold may stand on one side, and the run is compared only with the moving
 * step on its other side.
 */
function spikeAt(s, j) {
    for (let k = 1; k <= 3; k++) {
        const run = Array.from({ length: k }, (_, i) => j + i);
        if (!run.every(k === 1 ? s.judged : s.moving))
            return null;
        const outside = [j - 1, j + k];
        if (k > 1 && !outside.every((o) => s.moving(o) || (s.judged(o) && backRun(s, run))))
            continue;
        const fastest = fastestOf(s, outside);
        if (fastest === null)
            continue;
        const ratios = ratiosOf(s, run, fastest);
        const L = run.reduce((t, i) => t + s.len(i), 0);
        if (L >= SPIKE_MIN * (1 - EPS) && ratios.every((r) => r > SPIKE_RATIO * (1 + EPS)))
            return { pop: { atFrame: s.ds[j].start, kind: "spike", lengths: L, ratio: Math.min(...ratios), drawings: k }, next: j + k };
    }
    return null;
}
/**
 * Rule 1 for a single step j between two strict holds (teleportAt), not both rests: it has no moving step beside it, so it is
 * compared with the judged steps just past the holds that are not rests (j-1, into the first, and j+1, out of the
 * second). Below REST_MS motion still reads as one move, so a snap between two short holds is judged against the
 * motion around them. Its speed is timed by the shorter of the two holds, so a snap from a short hold into a rest is
 * judged too. It pops when it is faster than SPIKE_RATIO times the faster of those and reaches SPIKE_MIN.
 */
function heldSpikeAt(s, rest, strict, j) {
    if (!s.judged(j) || !strict[j - 1] || !strict[j] || (rest[j - 1] && rest[j]))
        return null;
    const past = [...(rest[j - 1] ? [] : [j - 1]), ...(rest[j] ? [] : [j + 1])].filter((k) => s.judged(k) && s.speed(k) > 0);
    if (past.length === 0)
        return null;
    const fastest = Math.max(...past.map(s.speed));
    // Timed by the shorter of its holds, so a long rest after it never makes it look slow.
    const ratio = (s.speed(j) * s.ds[j].frames) / Math.min(s.ds[j - 1].frames, s.ds[j].frames) / fastest;
    return s.len(j) >= SPIKE_MIN * (1 - EPS) && ratio > SPIKE_RATIO * (1 + EPS) ? { pop: { atFrame: s.ds[j].start, kind: "spike", lengths: s.len(j), ratio, drawings: 1 }, next: j + 1 } : null;
}
/**
 * The excursions among drawings `ds` (rule 3 alone; stepPops' excursionAt), in time order, each scan going on after the
 * step back. `unit`, `slopes`, `skip`, `shifted` and `explained` are as in stepPops.
 */
export function excursions(ds, unit, slopes, skip, shifted, explained) {
    const s = stepsOf(ds, unit, slopes, skip, shifted, explained);
    const out = [];
    for (let j = 1; j < ds.length;) {
        const f = excursionAt(s, j);
        if (f)
            out.push(f.pop);
        j = f ? f.next : j + 1;
    }
    return out;
}
/**
 * The pops between drawings `ds` of a value in `unit`, with its `slopes` (fitSlopes; null where none fit), its
 * object's `shifted` (ObjectFit) and what its object's fitted values explain of the box's change (`explained`,
 * explainedBy; NOTHING_EXPLAINED for a value that moves no object), read to frame `lastFrame` (isRestDrawing). Each
 * step is measured by stepMeasure. A step
 * whose new drawing starts at a frame `skip` names, or that goes into or out of a gone drawing, is not judged and
 * stands beside no other.
 *
 * The scan takes the steps in time order. At each step it tries a teleport between stops (rule 2, on position and size
 * parts), then an excursion (rule 3, position parts), then a spike run (rule 1, position parts and look values), then
 * a single step between two holds (heldSpikeAt); it
 * reports the first that pops and goes on after it. A look value's position and size parts are 0, and a size part has
 * no spike or excursion, so position parts get rules 1 to 3, size parts rule 2 (by their net change through brief
 * in-betweens) and look values rule 1.
 */
export function stepPops(ds, unit, slopes, skip, lastFrame, shifted, explained) {
    const s = stepsOf(ds, unit, slopes, skip, shifted, explained);
    const rest = ds.map((_, i) => isRestDrawing(ds, i, lastFrame));
    const strict = heldPoses(ds);
    const out = [];
    for (let j = 1; j < ds.length;) {
        const f = s.judged(j) ? (teleportAt(s, rest, strict, j) ?? excursionAt(s, j) ?? spikeAt(s, j) ?? heldSpikeAt(s, rest, strict, j)) : null;
        if (f)
            out.push(f.pop);
        j = f ? f.next : j + 1;
    }
    return out;
}
