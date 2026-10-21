import { FRAME_MS } from "./harness.js";
import { AMBIENT_SHARE, areaIn, goneIn, haloOf, isGone, objectOf } from "./objects.js";
import { DIFF_PIXELS } from "./pixel-diff.js";
import { drawingsOf } from "./poses.js";
import { HOLD_MS, series, stillTol } from "./series.js";
/**
 * The drawn check: the boxes a page reports in `__state().objects` hold what really changes on screen. It screenshots
 * pairs of frames, finds the pixels that change between the two, and checks them against each object's box grown by
 * its halo. A page that reports no objects is not read.
 */
/** Frame pairs compared... */
export const DRAWN_SAMPLES = 24;
/** ...at least this many of them spread evenly over the frames the rules read; the rest at events. */
export const DRAWN_EVEN = 8;
/** At most this many of the event pairs are stepped drawing boundaries. */
export const DRAWN_BOUNDARIES = 16;
/** A pixel changes when one of its channels moves by more than this, of 255. */
export const DRAWN_TOL = 8;
/**
 * Inside a changing solid object's own box (unpadded, in either frame), a pixel changes for the ghost test when one of
 * its channels moves by more than this, of 255: a faint or fading object still shows its change.
 */
export const DRAWN_SOFT_TOL = 2;
/**
 * A pair fails when more than this share of its changed pixels, or more than DRAWN_STRAY_PX of them, are covered by no
 * object.
 */
export const DRAWN_STRAY = 0.01;
export const DRAWN_STRAY_PX = 64;
/** A box moves when its centre, width or height changes by more than this, in CSS px. */
export const DRAWN_MOVE_PX = 2;
/**
 * A box that moves DRAWN_MOVE_PX or less per frame is compared with the first later frame, up to this many on, where
 * it has moved more.
 */
export const DRAWN_SLOW_FRAMES = 30;
/** A box number that changes by more than this, in CSS px, changes its object. */
const CHANGE_PX = 0.01;
/**
 * Changed pixels inside an ambient box that no solid box holds are grouped into clusters: the viewport is cut into
 * cells of this many by this many px, a cell is on when one of its pixels changed, and on cells join when the cells
 * around them (one cell out, diagonals too) touch.
 */
export const CLUSTER_CELL = 4;
/**
 * A cluster is compact when its on cells fill at least this share of their bounding box and that box covers less than
 * CLUSTER_SHARE of the viewport: a spot, not the background's own change.
 */
export const CLUSTER_FILL = 0.25;
export const CLUSTER_SHARE = 0.25;
/** A pair with this many clusters or more changes its background in many patches: none of them is stray. */
export const CLUSTER_MANY = 3;
/**
 * Tightness: the changed pixels an object alone holds reach an edge of its box, clipped to the viewport, when they come
 * within this share of what they span inside that box along the edge's axis (across for left and right, down for top
 * and bottom), plus TIGHT_PX, of it. Ink past an edge (a halo's) reaches it.
 */
export const TIGHT_SIDE = 0.25;
/** ...plus this many px, for the rounding of a box's edges to pixels. */
export const TIGHT_PX = 1;
/** A listed cut must change more than this share of the viewport... */
export const CUT_SHARE = 0.5;
/** ...or more than this many times the most pixels any other pair changes. */
export const CUT_TIMES = 3;
/**
 * Pages that shoot at once. A screenshot waits for the page's next frame, so shots taken one after another on one page
 * cost a frame or two each; on several pages of one browser they overlap.
 */
const DRAWN_PAGES = 4;
/** How far a box moves between two frames, in CSS px: its centre, or its width or height if that changes more. */
const movePx = (a, b) => Math.max(Math.hypot(a[0] + a[2] / 2 - (b[0] + b[2] / 2), a[1] + a[3] / 2 - (b[1] + b[3] / 2)), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
const rectOf = (b, grow = 0) => [b[0] - grow, b[1] - grow, b[0] + b[2] + grow, b[1] + b[3] + grow];
/** The pixels of `r` inside a viewport of `vw` by `vh`, by pixel centres, as inclusive integer ranges; null if none. */
function pixelsOf(r, vw, vh) {
    const x0 = Math.max(0, Math.ceil(r[0] - 0.5)), x1 = Math.min(vw - 1, Math.floor(r[2] - 0.5));
    const y0 = Math.max(0, Math.ceil(r[1] - 0.5)), y1 = Math.min(vh - 1, Math.floor(r[3] - 0.5));
    return x0 > x1 || y0 > y1 ? null : [x0, y0, x1, y1];
}
/**
 * Whether every pixel of `r` in a viewport of `vw` by `vh` lies in one of `others`, by pixel centres. True when `r`
 * holds no pixel.
 */
export function coveredBy(r, others, vw, vh) {
    const p = pixelsOf(r, vw, vh);
    if (p === null)
        return true;
    const os = others.map((o) => pixelsOf(o, vw, vh)).filter((o) => o !== null);
    if (os.length === 0)
        return false;
    // Coverage is the same over each cell between the others' edges, so one pixel per cell decides it.
    const cuts = (lo, hi, at) => [...new Set([lo, ...at.filter((v) => v > lo && v <= hi)])];
    const xs = cuts(p[0], p[2], os.flatMap((o) => [o[0], o[2] + 1]));
    const ys = cuts(p[1], p[3], os.flatMap((o) => [o[1], o[3] + 1]));
    return xs.every((x) => ys.every((y) => os.some((o) => x >= o[0] && x <= o[2] && y >= o[1] && y <= o[3])));
}
/** A box moved down the viewport by `dy` px. */
const shiftBox = (b, dy) => [b[0], b[1] + dy, b[2], b[3]];
/**
 * How a box moves between frames a and b of a pair whose second frame is scrolled `ds` px past the first, in CSS px:
 * the lesser of its move in viewport coordinates and in the document's, so a fixed header and an in-flow card both
 * hold still across a scroll. On a pair with no scroll, the move.
 */
const moveAcross = (a, b, ds) => (ds === 0 ? movePx(a, b) : Math.min(movePx(a, b), movePx(shiftBox(a, -ds), b)));
/**
 * Whether an object goes gone or comes back between two frames: a box reported gone (1 by 1) on one side only, or a
 * box that leaves or enters the viewport. On a scroll pair a box that leaves or enters the viewport goes gone only when
 * it also moves more than DRAWN_MOVE_PX in both frames of reference: the document scrolling an in-flow card out of
 * view does not make it gone.
 */
function flips(a, b, ds, vw, vh) {
    if (isGone(a) !== isGone(b))
        return true;
    if (goneIn(a, vw, vh) === goneIn(b, vw, vh))
        return false;
    return ds === 0 || moveAcross(a, b, ds) > DRAWN_MOVE_PX;
}
function pairBoxes(a, b, objs, vw, vh) {
    const ds = (b.scroll ?? 0) - (a.scroll ?? 0);
    const out = { solid: [], ambient: [], soft: [], probes: [], tight: [], shift: Math.round(ds), regions: null };
    const seen = objs.map((o) => {
        const [ba, bb] = [a.boxes[o.name], b.boxes[o.name]];
        const [ga, gb] = [goneIn(ba, vw, vh), goneIn(bb, vw, vh)];
        const halo = (box) => haloOf({ ...o.record, box });
        // A side of frame a on a scroll pair is also where the document carried it, so a change where an in-flow object
        // was is found as well as one where a fixed object was.
        const aBoxes = ds === 0 ? [ba] : [ba, shiftBox(ba, -ds)];
        // On a scroll pair, frame a's side is not judged for ghosts when the document carried its box wholly off screen:
        // where it was then shows no change on a flat background, and where the scroll took it cannot be seen.
        const unseen = ds !== 0 && goneIn(shiftBox(ba, -ds), vw, vh);
        const sides = [...(ga ? [] : [{ boxes: aBoxes, judged: !unseen }]), ...(gb ? [] : [{ boxes: [bb], judged: true }])].map(({ boxes, judged }) => ({ boxes, judged, grown: boxes.map((box) => rectOf(box, halo(box))) }));
        const ambient = sides.some(({ grown }) => grown.some((g) => areaIn([g[0], g[1], g[2] - g[0], g[3] - g[1]], vw, vh) > AMBIENT_SHARE * vw * vh));
        const valueChanged = ([v, tol]) => a.values[v] !== b.values[v] && !(Math.abs((b.values[v] ?? Number.NaN) - (a.values[v] ?? Number.NaN)) <= tol);
        const numbers = (x, y) => x.some((n, i) => Math.abs(y[i] - n) > CHANGE_PX);
        const boxChanged = numbers(ba, bb) && (ds === 0 || numbers(shiftBox(ba, -ds), bb));
        const flip = flips(ba, bb, ds, vw, vh);
        const truly = flip || boxChanged || o.tols.some(valueChanged);
        const d = moveAcross(ba, bb, ds);
        // On a scroll pair: whether its box moves in both frames of reference (or goes gone or comes back), and whether
        // it is drawn in both frames, holds still in the viewport and changes no value in its moves.
        const travels = ds !== 0 && (boxChanged || flip);
        const still = ds !== 0 && !ga && !gb && !numbers(ba, bb) && !o.tols.some(valueChanged);
        const grownA = ga ? null : rectOf(ba, halo(ba));
        const grownB = gb ? null : rectOf(bb, halo(bb));
        return { o, sides, ambient, changed: o.record.moves.length === 0 || truly, truly, moved: flip || (!ga && !gb && d > DRAWN_MOVE_PX), d, travels, still, grownA, grownB };
    });
    if (ds !== 0) {
        const movers = seen.filter((s) => s.travels && !s.ambient);
        const rects = (xs) => xs.filter((r) => r !== null);
        out.regions = { a: rects(movers.map((s) => s.grownA)), b: rects(movers.map((s) => s.grownB)), free: movers.flatMap((s) => s.sides.flatMap((x) => x.grown)), held: rects(seen.filter((s) => s.still && !s.ambient).map((s) => s.grownB)) };
    }
    const rectsOf = (s) => s.sides.flatMap((x) => x.grown);
    for (const s of seen) {
        if (!s.changed || s.sides.length === 0)
            continue;
        const g = rectsOf(s);
        if (s.ambient)
            out.ambient.push([Math.min(...g.map((r) => r[0])), Math.min(...g.map((r) => r[1])), Math.max(...g.map((r) => r[2])), Math.max(...g.map((r) => r[3]))]);
        else {
            out.solid.push(...g);
            out.soft.push(...s.sides.flatMap((x) => x.boxes.map((box) => rectOf(box))));
        }
    }
    const movers = [];
    const changers = [];
    for (const s of seen) {
        if (!s.moved && !(s.truly && !s.ambient))
            continue;
        const others = seen.filter((t) => t !== s && t.changed && !t.ambient).flatMap(rectsOf);
        // An object whose own box lies inside the other changing objects' grown boxes moves with them: not judged.
        const inside = s.sides.every((x) => x.boxes.every((box) => coveredBy(rectOf(box), others, vw, vh)));
        if (s.moved) {
            const m = { name: s.o.name, d: s.d, probes: [], solid: !s.ambient };
            movers.push(m);
            // Where it was and where it went, each less the other changers' boxes; a side they hide wholly is skipped. A
            // gone side has no box, so only the drawn side is judged.
            if (!inside)
                for (const side of s.sides) {
                    if (!side.judged || side.grown.every((g) => coveredBy(g, others, vw, vh)))
                        continue;
                    m.probes.push(out.probes.length);
                    out.probes.push({ rects: side.grown, minus: others });
                }
        }
        if (!s.truly || s.ambient || s.sides.length === 0)
            continue;
        const c = { name: s.o.name, rects: rectsOf(s), moved: s.moved, tight: null };
        changers.push(c);
        if (inside || c.rects.every((g) => coveredBy(g, others, vw, vh)))
            continue;
        // Measured against frame b's box, or frame a's when b is gone.
        const box = goneIn(b.boxes[s.o.name], vw, vh) ? a.boxes[s.o.name] : b.boxes[s.o.name];
        c.tight = { probe: out.tight.length, box };
        out.tight.push({ rects: c.rects, minus: others });
    }
    return { boxes: out, movers, changers };
}
/**
 * Runs in a page: counts each pair's changed pixels against its boxes (on a scroll pair, as DIFF_PIXELS compares
 * across a scroll). A changed pixel (DRAWN_TOL) that a solid box holds is covered; one that no box holds is stray.
 * One that only an ambient box holds goes into that pair's clusters (CLUSTER_CELL): with CLUSTER_MANY clusters or more
 * all are the background's own change; with fewer, a compact cluster (CLUSTER_FILL, CLUSTER_SHARE) is stray and any
 * other is the background's. `hits[q]` counts the changed pixels in probe q, and `reach[t]` the bounds `[x0, y0, x1,
 * y1]` and count of those in tightness probe t: at DRAWN_SOFT_TOL inside a soft box, at DRAWN_TOL elsewhere. Returns
 * each pair's changed and stray counts, its number of clusters, and the bounding boxes, in px, of its clusters that
 * are not compact.
 */
const COUNT = String.raw `async (shots, pairs, boxes, tol, softTol, size, cluster) => {
  const over = (t) => (a, b, o) => Math.abs(a[o] - b[o]) > t || Math.abs(a[o + 1] - b[o + 1]) > t || Math.abs(a[o + 2] - b[o + 2]) > t;
  const inside = (r, x, y) => x + 0.5 >= r[0] && x + 0.5 <= r[2] && y + 0.5 >= r[1] && y + 0.5 <= r[3];
  const any = (rs, x, y) => { for (let i = 0; i < rs.length; i++) if (inside(rs[i], x, y)) return true; return false; };
  const [W, H] = size, [cell, fill, share, many] = cluster;
  const cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
  const out = boxes.map((p) => ({ changed: 0, stray: 0, hits: p.probes.map(() => 0), reach: p.tight.map(() => [Infinity, Infinity, -Infinity, -Infinity, 0]), cells: null }));
  await (${DIFF_PIXELS})(pairs.map(([i, j]) => [shots[i], shots[j]]), over(tol), (k, x, y, strong) => {
    const p = boxes[k], o = out[k];
    for (let q = 0; q < p.probes.length; q++) if (any(p.probes[q].rects, x, y) && !any(p.probes[q].minus, x, y)) o.hits[q]++;
    for (let t = 0; t < p.tight.length; t++) if (any(p.tight[t].rects, x, y) && !any(p.tight[t].minus, x, y)) {
      const r = o.reach[t];
      r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y); r[4]++;
    }
    if (!strong) return;
    o.changed++;
    if (any(p.solid, x, y)) return;
    if (!any(p.ambient, x, y)) { o.stray++; return; }
    if (!o.cells) o.cells = new Uint32Array(cw * ch);
    o.cells[Math.floor(y / cell) * cw + Math.floor(x / cell)]++;
  }, size, { differ: over(softTol), rects: boxes.map((p) => p.soft) }, boxes.map((p) => p.shift), boxes.map((p) => p.regions));
  // The clusters of a pair's ambient cells: the on cells grown by one cell, joined where they touch (diagonals too).
  // Fill and bounds are measured on the on cells, before growing.
  const clustersOf = (cells) => {
    const grown = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      if (!cells[cy * cw + cx]) continue;
      for (let y = Math.max(0, cy - 1); y <= Math.min(ch - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(cw - 1, cx + 1); x++) grown[y * cw + x] = 1;
    }
    const label = new Int32Array(cw * ch).fill(-1);
    const found = [];
    for (let start = 0; start < cw * ch; start++) {
      if (!grown[start] || label[start] >= 0) continue;
      const c = { on: 0, px: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const stack = [start];
      label[start] = found.length;
      while (stack.length > 0) {
        const i = stack.pop(), cx = i % cw, cy = (i - cx) / cw;
        if (cells[i]) {
          c.on++; c.px += cells[i];
          c.x0 = Math.min(c.x0, cx); c.y0 = Math.min(c.y0, cy); c.x1 = Math.max(c.x1, cx); c.y1 = Math.max(c.y1, cy);
        }
        for (let y = Math.max(0, cy - 1); y <= Math.min(ch - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(cw - 1, cx + 1); x++) {
          const j = y * cw + x;
          if (grown[j] && label[j] < 0) { label[j] = found.length; stack.push(j); }
        }
      }
      const box = [c.x0 * cell, c.y0 * cell, Math.min(W, (c.x1 + 1) * cell), Math.min(H, (c.y1 + 1) * cell)];
      const compact = c.on >= fill * (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) && (box[2] - box[0]) * (box[3] - box[1]) < share * W * H;
      found.push({ px: c.px, box, compact });
    }
    return found;
  };
  return out.map((o) => {
    const clusters = o.cells ? clustersOf(o.cells) : [];
    let stray = o.stray;
    if (clusters.length < many) for (const c of clusters) if (c.compact) stray += c.px;
    return { changed: o.changed, stray, hits: o.hits, reach: o.reach.map((r) => (r[4] > 0 ? r : null)), clusters: clusters.length, loose: clusters.filter((c) => !c.compact).map((c) => c.box) };
  });
}`;
const round = (n) => Math.round(n * 1000) / 1000;
/** The `drawn:` lines for `page` (drawnRead). */
export async function drawn(page, ctx) {
    return (await drawnRead(page, ctx)).lines;
}
/**
 * Which pairs drawnRead compares, from the raw frames the rules read: `objs` are the page's objects, `cuts` the trace's
 * cuts in ms, `stepped` the stepped values, each with the object it moves (or null), `whole(i, j)` whether frames i
 * and j can be compared (every box in both is numbers), and `level(i, j)` whether they can be and sit at one scroll
 * position. DRAWN_SAMPLES pairs at most, DRAWN_EVEN or more of them spread evenly over the frame steps; the rest at
 * events, in this order, each class ranked on its own:
 *
 * 1. Every cut: the frame at or before it, and the next frame. drawnRead also compares the step into that frame.
 * 2. An object going gone or coming back (flips), the bigger drawn box first. When its gone gap lasts HOLD_MS or more,
 *    or runs to the edge of the frames read, the pair also names its fade reference (fadeRef).
 * 3. One stretched pair per slow object, whose box moves but never more than DRAWN_MOVE_PX in one frame step: frame k
 *    and the first later frame at the same scroll position, up to DRAWN_SLOW_FRAMES on, where it has moved more than
 *    DRAWN_MOVE_PX; the k with the shortest stretch.
 * 4. Box jumps, scrolls and stepped drawing boundaries (the largest DRAWN_BOUNDARIES of those), by the largest box
 *    move or scroll, in px. A box moves across a scroll only as far as it moves in both frames of reference
 *    (moveAcross).
 *
 * On a tie, the earliest first. Every pair but a slow one is two frames in a row, and may span a scroll.
 */
function pickPairs(frames, objs, cuts, stepped, view, scrolled, whole, level) {
    const { width: vw, height: vh } = view;
    const steps = frames.slice(0, -1).flatMap((_, k) => (whole(k, k + 1) ? [k] : []));
    if (steps.length === 0)
        return [];
    const box = (k, n) => frames[k].boxes[n];
    /** How far frame k + 1 is scrolled past frame k, in CSS px. */
    const ds = (k) => (frames[k + 1].scroll ?? 0) - (frames[k].scroll ?? 0);
    const drawnAt = (k, n) => !goneIn(box(k, n), vw, vh);
    const jumpAt = (k, n) => (drawnAt(k, n) && drawnAt(k + 1, n) ? moveAcross(box(k, n), box(k + 1, n), ds(k)) : 0);
    const picks = [];
    const taken = new Set();
    const slots = DRAWN_SAMPLES - Math.min(DRAWN_EVEN, steps.length);
    const add = (p) => {
        const key = `${p.k}:${p.m}`;
        if (taken.has(key) || picks.length >= slots)
            return;
        taken.add(key);
        picks.push(p);
    };
    const byRank = (xs) => xs.sort((a, b) => b.size - a.size || a.k - b.k);
    const stepSet = new Set(steps);
    for (const c of [...cuts].sort((a, b) => a - b)) {
        let k = -1;
        while (k + 1 < frames.length && frames[k + 1].ms <= c + 1e-6)
            k++;
        if (stepSet.has(k))
            add({ k, m: 1, event: "cut", cut: c });
    }
    const goneBack = objs.flatMap((o) => steps.flatMap((k) => {
        if (!flips(box(k, o.name), box(k + 1, o.name), ds(k), vw, vh))
            return [];
        const da = drawnAt(k, o.name);
        const shown = da ? box(k, o.name) : box(k + 1, o.name);
        return [{ k, o, da, size: Math.max(shown[2], shown[3]), event: `${da ? "gone" : "back"} ${o.name}` }];
    }));
    // Whether an object's gone gap, from frame `from` on in direction `dir`, is long: gone in HOLD_MS or more of frames,
    // or gone up to the edge of the frames read. A frame that cannot be read (a box not finite numbers, which the objects
    // rule reports) is passed over: it neither ends the gap nor counts toward it, so only the frames read gone count.
    // poses.ts differs here: it reads a box of NaN as drawn, which ends its gap.
    const longGone = (name, from, dir) => {
        let gone = 0, k = from;
        for (; k >= 0 && k < frames.length; k += dir) {
            if (!whole(k, k))
                continue;
            if (drawnAt(k, name))
                break;
            gone++;
        }
        return k < 0 || k >= frames.length || gone * FRAME_MS >= HOLD_MS - 1e-6;
    };
    for (const g of byRank(goneBack)) {
        const [o, drawnSide, goneSide] = [g.o, g.da ? g.k : g.k + 1, g.da ? g.k + 1 : g.k];
        const ref = longGone(o.name, goneSide, g.da ? 1 : -1) ? fadeRef(frames, o, drawnSide, g.da ? -1 : 1, goneSide, view, level) : null;
        add({ k: g.k, m: 1, event: g.event, ...(ref === null ? {} : { ref: { name: o.name, frame: ref } }) });
    }
    for (const o of objs) {
        const most = Math.max(0, ...steps.map((k) => jumpAt(k, o.name)));
        if (most > DRAWN_MOVE_PX || most <= CHANGE_PX)
            continue;
        let best = null;
        for (let k = 0; k < frames.length && (best === null || best.m > 2); k++) {
            if (!whole(k, k) || !drawnAt(k, o.name))
                continue;
            for (let m = 2; m <= DRAWN_SLOW_FRAMES && k + m < frames.length && (best === null || m < best.m); m++) {
                if (!level(k, k + m) || !drawnAt(k + m, o.name) || movePx(box(k, o.name), box(k + m, o.name)) <= DRAWN_MOVE_PX)
                    continue;
                best = { k, m, event: `slow ${o.name}` };
                break;
            }
        }
        if (best)
            add(best);
    }
    const pool = new Map();
    const offer = (k, size, event) => {
        if (size > (pool.get(k)?.size ?? 0))
            pool.set(k, { k, size, event });
    };
    for (const k of steps) {
        for (const o of objs)
            offer(k, jumpAt(k, o.name), `jump ${o.name}`);
        offer(k, Math.abs(ds(k)), "scroll");
    }
    const boundaries = stepped.flatMap(([name, object]) => {
        const dr = drawingsOf(frames, name, object, stillTol(series(frames, name)), view, scrolled);
        return dr.slice(1).flatMap((d, j) => {
            const prev = dr[j];
            const k = d.start - 1;
            if (!stepSet.has(k))
                return [];
            const size = !prev.gone && !d.gone && prev.endBox && d.box ? movePx(prev.endBox, d.box) : 0;
            return [{ k, size, event: `drawing ${name}` }];
        });
    });
    for (const b of byRank(boundaries).slice(0, DRAWN_BOUNDARIES))
        pool.set(b.k, { k: b.k, size: Math.max(b.size, pool.get(b.k)?.size ?? 0), event: b.event });
    for (const p of byRank([...pool.values()]))
        add({ k: p.k, m: 1, event: p.event });
    // The rest spread evenly over the frame steps no event took, so every sample is a different pair.
    const rest = steps.filter((k) => !taken.has(`${k}:1`));
    const want = Math.min(DRAWN_SAMPLES - picks.length, rest.length);
    const even = Array.from({ length: want }, (_, i) => rest[want === 1 ? 0 : Math.round((i * (rest.length - 1)) / (want - 1))]);
    return [...picks, ...even.map((k) => ({ k, m: 1, event: null }))].sort((a, b) => a.k - b.k || a.m - b.m);
}
/**
 * The frame to compare with an object's gone frame `gone` when the pair where it goes gone or comes back shows no
 * change where it is drawn: an object that fades out (or in) may be all but invisible in the frame next to its gone
 * one, so its last step changes nothing on screen, as a slow box moves less than DRAWN_MOVE_PX in one. Walking from
 * `from` (its drawn frame in that pair) in direction `dir`, up to DRAWN_SLOW_FRAMES frames, while it stays drawn and
 * the frame can be compared with `gone`: the frame that differs most from `from` in what the record says, each value
 * in its moves by its share of its range over the run and its box by its move in lengths of the object. The earliest
 * such frame on a tie. Null when nothing it reports differs. pickPairs asks for it only when the object stays gone
 * HOLD_MS or more, or to the edge of the frames read: an object reported gone for a shorter gap is judged on its pair
 * alone, wherever the gap sits.
 */
function fadeRef(frames, o, from, dir, gone, view, level) {
    const ranges = o.record.moves.map((v) => {
        const xs = series(frames, v).filter(Number.isFinite);
        return [v, xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0];
    });
    const at = (k) => frames[k].boxes[o.name];
    const score = (k) => {
        const [a, b] = [at(from), at(k)];
        const box = movePx(a, b) / Math.max(1, a[2], a[3], b[2], b[3]);
        const values = ranges.map(([v, r]) => (r > 0 ? Math.abs((frames[k].values[v] ?? Number.NaN) - (frames[from].values[v] ?? Number.NaN)) / r : 0));
        return Math.max(box, ...values.map((x) => (Number.isFinite(x) ? x : 0)));
    };
    let best = null;
    for (let j = 1; j <= DRAWN_SLOW_FRAMES; j++) {
        const k = from + dir * j;
        if (k < 0 || k >= frames.length || !level(k, gone) || goneIn(at(k), view.width, view.height))
            break;
        const s = score(k);
        if (s > 0 && (best === null || s > best.s))
            best = { k, s };
    }
    return best?.k ?? null;
}
/**
 * The `drawn:` lines for `page`, read over 0 to the context's span; the pairs compared; and notes, information lines
 * that never fail the page. The shots are taken on fresh pages of the page's own browser context (same input, pixel
 * ratio and reduced motion), each sought right before its shot, so nothing another read left on screen is shot: a
 * stepped page's reads look ahead and leave it drawn at a later frame. The boxes are the raw ones read for those
 * frames. A pair (pickPairs) may span a scroll: its pixels and boxes are then compared in both frames of reference
 * (DIFF_PIXELS, moveAcross), and each side of frame a counts both where it was in the viewport and where the document
 * carried it.
 *
 * - **Covered.** Each object's box is grown by its halo (haloOf). A changed pixel (DRAWN_TOL) is covered when the
 *   grown box of an object that changed in the pair holds it: its box moved, resized, went gone or came back, a value
 *   in its `moves` changed by more than its still tolerance, or its `moves` is empty. A grown box that covers more
 *   than AMBIENT_SHARE of the viewport is ambient: the changed pixels only it holds form clusters (COUNT), and only
 *   compact ones, one or two in a pair, are stray. A pair fails when more than DRAWN_STRAY of its changed pixels, or
 *   more than DRAWN_STRAY_PX, are stray.
 * - **Unjudged.** In a pair with CLUSTER_MANY clusters or more, or where a solid object's grown box overlaps a cluster
 *   that is not compact, the object is not judged for ghosts or tightness: the background changes around it. An object
 *   unjudged in every pair where it truly changed gets a note, not a line.
 * - **Ghosts.** An object whose box moves more than DRAWN_MOVE_PX, goes gone or comes back fails when no pixel changes
 *   where its box was, or where it went: its grown box in that frame, less the grown boxes of the other solid objects
 *   that changed. Inside a changing solid object's own box a change of DRAWN_SOFT_TOL counts. A side the others hide
 *   wholly is skipped, a gone side has no box, and an object whose own box lies inside the others' grown boxes moves
 *   with them and is not judged. A step to or from a gone gap of HOLD_MS or more (or one that runs to the
 *   edge of the frames read) that shows no change is also compared from its fade reference (fadeRef) to its gone
 *   frame, and fails only when that shows none either. A shorter gone gap is judged on its pair alone.
 * - **Tightness.** The changed pixels a solid object alone holds (inside its grown boxes, outside the other changers')
 *   must come within TIGHT_SIDE of what they span along each edge's axis, plus TIGHT_PX, of both of its long edges
 *   and one of its short edges, in frame b's box (frame a's when b is gone) clipped to the viewport (reachOf: an
 *   edge the viewport cuts off is not judged, nor, when less than half the box shows, the two across it). Each event pair where it moved and is judged must pass; an
 *   object in none passes when, over the pairs where it truly changed and is judged, each of those edges is reached
 *   in some pair. A pair where it holds no changed pixel tells nothing.
 * - **Cuts.** A listed cut is read over two frame steps: its pair, and the step into the pair's first frame, since a
 *   page may switch its scene at the cut or after it. The larger change of the two must be more than CUT_SHARE of the
 *   viewport, or more than CUT_TIMES the most pixels any other pair changes. Neither step is judged for anything else,
 *   whichever pair it is sampled as, and neither sets that most.
 *
 * Each cause prints its first pair: one line for pixels outside the objects, one per object that moves with nothing
 * drawn, one per object whose box is bigger than what it draws, and one per cut that changes little.
 */
export async function drawnRead(page, ctx) {
    const none = { lines: [], pairs: [], notes: [] };
    const records = (await page.state()).objects;
    const names = Object.keys(records);
    if (names.length === 0)
        return none;
    // Imported when called: kind-gate.ts imports this file.
    const spanMs = ctx.spanMs ?? (await import("./kind-gate.js")).SPAN_MS;
    const frames = await page.rawFrames(0, spanMs);
    const view = await page.viewport();
    const { width: vw, height: vh } = view;
    const objs = names.map((name) => {
        const r = records[name];
        const moves = Array.isArray(r?.moves) ? r.moves.filter((v) => typeof v === "string") : [];
        return { name, record: { box: r.box, moves, ...(r.halo !== undefined ? { halo: r.halo } : {}) }, tols: moves.map((v) => [v, stillTol(series(frames, v))]) };
    });
    // A frame with a box missing or not numbers is the objects rule's to report.
    const read = (f) => names.every((n) => f.boxes?.[n]?.every(Number.isFinite) === true);
    const whole = (i, j) => read(frames[i]) && read(frames[j]);
    const level = (i, j) => whole(i, j) && (frames[i].scroll ?? 0) === (frames[j].scroll ?? 0);
    const owner = objectOf(records);
    const stepped = (ctx.stepped ?? []).map((n) => [n, owner.get(n) ?? null]);
    const picks = pickPairs(frames, objs, ctx.cuts ?? [], stepped, view, ctx.kind === "scroll", whole, level);
    if (picks.length === 0)
        return none;
    // A pick with a fade reference is also compared from that frame to its gone frame, for that object's ghost alone.
    const refs = picks.flatMap((p, i) => {
        if (!p.ref)
            return [];
        const gone = goneIn(frames[p.k].boxes[p.ref.name], vw, vh) ? p.k : p.k + 1;
        const [x, y] = [Math.min(gone, p.ref.frame), Math.max(gone, p.ref.frame)];
        return [{ i, name: p.ref.name, pick: { k: x, m: y - x, event: null } }];
    });
    // A cut is also compared over the step into its frame: a page that switches its scene at the cut, not after it,
    // already shows the new scene in the frame at or before the cut.
    const before = picks.flatMap((p, i) => (p.event === "cut" && p.k >= 1 && whole(p.k - 1, p.k) ? [{ i, pick: { k: p.k - 1, m: 1, event: null } }] : []));
    const compared = [...picks, ...refs.map((r) => r.pick), ...before.map((b) => b.pick)];
    const shots = await shoot(page, frames, compared);
    const judged = compared.map((p) => pairBoxes(frames[p.k], frames[p.k + p.m], objs, vw, vh));
    // The count runs in a blank page of its own, so nothing the page under test sets up (a policy on images, a patched
    // global) reaches it. Each shot goes over once; the pairs name theirs by index.
    const counter = await page.page.context().newPage();
    let counted;
    try {
        const at = (k) => shots.index.get(k);
        const cluster = [CLUSTER_CELL, CLUSTER_FILL, CLUSTER_SHARE, CLUSTER_MANY];
        const args = [shots.srcs, compared.map((p) => [at(p.k), at(p.k + p.m)]), judged.map((j) => j.boxes), DRAWN_TOL, DRAWN_SOFT_TOL, [vw, vh], cluster];
        counted = (await counter.evaluate(`(${COUNT})(...${JSON.stringify(args)})`));
    }
    finally {
        await counter.close();
    }
    const overlaps = (r, q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3];
    /** Whether a solid object with grown boxes `rects` is left unjudged in compared pair i by its background's change. */
    const unjudged = (i, rects) => counted[i].clusters >= CLUSTER_MANY || counted[i].loose.some((l) => rects.some((r) => overlaps(r, l)));
    /** Whether mover m of compared pair i shows a change on every side it is judged on. */
    const shows = (i, m) => m.probes.every((q) => counted[i].hits[q] > 0);
    const lines = [];
    const ghosts = new Set();
    let strayed = false;
    /** Per object: the pairs where it truly changed, those where it was unjudged, and its tightness reads. */
    const seen = new Map();
    const time = (i) => [round(frames[picks[i].k].ms), round(frames[picks[i].k + picks[i].m].ms)];
    /** The frame steps around each cut, the one into its frame and the one out of it: judged by the cut check alone. */
    const cutSteps = new Set(picks.flatMap((p) => (p.event === "cut" ? [p.k - 1, p.k] : [])));
    const atCut = (p) => p.event === "cut" || (p.m === 1 && cutSteps.has(p.k));
    picks.forEach((p, i) => {
        if (atCut(p))
            return;
        const [a, b] = time(i);
        const c = counted[i];
        if (!strayed && (c.stray > DRAWN_STRAY * c.changed || c.stray > DRAWN_STRAY_PX)) {
            strayed = true;
            lines.push(`drawn: pixels change outside every object between ${a} and ${b} ms (${c.stray} px); the objects do not cover what the page draws`);
        }
        const left = new Set(judged[i].changers.filter((ch) => unjudged(i, ch.rects)).map((ch) => ch.name));
        for (const ch of judged[i].changers) {
            const s = seen.get(ch.name) ?? { changed: 0, unjudged: 0, event: [], run: [] };
            seen.set(ch.name, s);
            s.changed++;
            if (left.has(ch.name)) {
                s.unjudged++;
                continue;
            }
            const r = ch.tight === null ? null : c.reach[ch.tight.probe];
            if (!ch.tight || !r)
                continue;
            const reach = reachOf(r, ch.tight.box, vw, vh);
            if (p.event !== null && ch.moved)
                s.event.push({ i, ok: reach.long[0] && reach.long[1] && reach.short });
            s.run.push({ i, reach });
        }
        for (const m of judged[i].movers) {
            if (ghosts.has(m.name) || shows(i, m) || (m.solid && left.has(m.name)))
                continue;
            const ref = refs.findIndex((r) => r.i === i && r.name === m.name);
            const refMover = ref < 0 ? undefined : judged[picks.length + ref].movers.find((x) => x.name === m.name);
            if (refMover && refMover.probes.length > 0 && shows(picks.length + ref, refMover))
                continue;
            ghosts.add(m.name);
            lines.push(`drawn: ${m.name} moves ${round(m.d)} px between ${a} and ${b} ms but nothing changes on screen there`);
        }
    });
    const notes = [];
    for (const [name, s] of seen) {
        if (s.changed > 0 && s.unjudged === s.changed)
            notes.push(`drawn: ${name} could not be judged: the background changes around it in every sampled pair`);
        const bad = s.event.length > 0 ? s.event.find((e) => !e.ok)?.i : s.run.length > 0 && !(s.run.some((x) => x.reach.long[0]) && s.run.some((x) => x.reach.long[1]) && s.run.some((x) => x.reach.short)) ? s.run[0].i : undefined;
        if (bad === undefined)
            continue;
        const [a, b] = time(bad);
        lines.push(`drawn: ${name}'s box is bigger than what it draws between ${a} and ${b} ms`);
    }
    const most = Math.max(0, ...picks.flatMap((p, i) => (atCut(p) ? [] : [counted[i].changed])));
    picks.forEach((p, i) => {
        if (p.event !== "cut")
            return;
        const into = before.findIndex((b) => b.i === i);
        const n = Math.max(counted[i].changed, into < 0 ? 0 : counted[picks.length + refs.length + into].changed);
        if (n > CUT_SHARE * vw * vh || n > CUT_TIMES * most)
            return;
        lines.push(`drawn: the cut at ${round(p.cut)} ms changes ${Math.round((1000 * n) / (vw * vh)) / 10}% of the view; a cut is a scene change`);
    });
    const pairs = picks.map((p, i) => ({ a: frames[p.k].ms, b: frames[p.k + p.m].ms, moved: judged[i].movers.map((m) => m.name), event: p.event }));
    return { lines, pairs, notes };
}
function reachOf(r, box, vw, vh) {
    const [x0, y0, x1, y1] = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(vw, box[0] + box[2]), Math.min(vh, box[1] + box[3])];
    const [w, h] = [Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
    const span = (lo, hi, a, b) => Math.max(0, Math.min(hi + 1, b) - Math.max(lo, a));
    const [nx, ny] = [TIGHT_SIDE * span(r[0], r[2], x0, x1) + TIGHT_PX, TIGHT_SIDE * span(r[1], r[3], y0, y1) + TIGHT_PX];
    // Across a cut, only when less than half the box shows: a round object shows its widest part once half of it does.
    const [cutX, cutY] = [w < box[2] / 2, h < box[3] / 2];
    const left = cutY || box[0] < 0 || r[0] + 0.5 <= x0 + nx;
    const right = cutY || box[0] + box[2] > vw || r[2] + 0.5 >= x1 - nx;
    const top = cutX || box[1] < 0 || r[1] + 0.5 <= y0 + ny;
    const bottom = cutX || box[1] + box[3] > vh || r[3] + 0.5 >= y1 - ny;
    return w >= h ? { long: [top, bottom], short: left || right } : { long: [left, right], short: top || bottom };
}
/**
 * Screenshots every frame the pairs need, each sought right before its shot and shot after the page's next frame.
 * Pairs that share a frame form a group, shot on one page, so both shots of a pair come from one page; the groups are
 * spread over DRAWN_PAGES fresh pages of the page's browser context, each loaded with its fonts ready. Every page
 * opened is closed, also when one fails to load. A shot page scrolled elsewhere than its frame was read throws: the
 * scroll pairs would be compared across the wrong shift. Returns the shots as data URLs, once each, and each frame's
 * index among them.
 */
async function shoot(page, frames, picks) {
    const groups = [];
    let end = -1;
    for (const p of [...picks].sort((a, b) => a.k - b.k)) {
        if (groups.length === 0 || p.k > end)
            groups.push([]);
        groups[groups.length - 1].push(p.k, p.k + p.m);
        end = Math.max(end, p.k + p.m);
    }
    const frameSets = groups.map((g) => [...new Set(g)].sort((a, b) => a - b));
    const shooters = Array.from({ length: Math.min(DRAWN_PAGES, frameSets.length) }, () => []);
    const load = (s) => s.reduce((t, g) => t + g.length, 0);
    for (const g of [...frameSets].sort((a, b) => b.length - a.length))
        shooters.reduce((a, b) => (load(b) < load(a) ? b : a)).push(g);
    const context = page.page.context();
    const opened = await Promise.allSettled(shooters.map(async () => {
        const p = await context.newPage();
        try {
            await p.goto(page.page.url(), { waitUntil: "load" });
            await p.evaluate(() => document.fonts.ready.then(() => undefined));
        }
        catch (e) {
            await p.close();
            throw e;
        }
        return p;
    }));
    const pages = opened.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
    try {
        const failed = opened.find((o) => o.status === "rejected");
        if (failed)
            throw failed.reason;
        // Sought, then shot after the page's next frame: the first frame after a scale change can be drawn from the old
        // raster, so a shot taken at once may differ from the same frame shot a frame later, with nothing changed.
        // Returns the page's scroll position there, which must be the one read for that frame: a scroll pair is compared
        // across the scroll the frames say.
        const seek = (p, ms) => p.evaluate((t) => {
            window.__gate.seek(t);
            return new Promise((done) => requestAnimationFrame(() => done(window.scrollY)));
        }, ms);
        const shot = new Map();
        await Promise.all(shooters.map(async (mine, i) => {
            const p = pages[i];
            const cdp = await context.newCDPSession(p);
            try {
                for (const k of mine.flat()) {
                    // Sought right before the shot (seek). The shot is the viewport with no clip: a clip from this session
                    // would clear the page's pixel ratio. The count draws it at 1 pixel per CSS px.
                    const y = await seek(p, frames[k].ms);
                    const want = frames[k].scroll ?? 0;
                    if (Math.abs(y - want) > 0.5)
                        throw new Error(`the shot at ${round(frames[k].ms)} ms is scrolled to ${y} px, but its frame was read at ${want} px`);
                    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
                    shot.set(k, `data:image/png;base64,${data}`);
                }
            }
            finally {
                await cdp.detach();
            }
        }));
        const order = [...shot.keys()].sort((a, b) => a - b);
        return { srcs: order.map((k) => shot.get(k)), index: new Map(order.map((k, i) => [k, i])) };
    }
    finally {
        await Promise.all(pages.map((p) => p.close()));
    }
}
