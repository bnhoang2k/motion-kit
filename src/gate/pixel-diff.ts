/**
 * The pixel diff shared by the frame sheet's crop (sheet.ts) and the drawn check (drawn.ts). It lives in a module of
 * its own, so neither imports the other.
 */

/**
 * Runs in a page: for each pair of PNG data URLs in `pairs`, calls `each(k, x, y, strong)` for every pixel (x, y) where
 * `differ(a, b, o)` holds between the two shots' RGBA data at byte offset `o` (`strong` true), with `k` the pair's
 * index. Both shots of a pair have one size; with `size` ([w, h] in px) each shot is drawn at that size first.
 *
 * With `soft` (`{ differ, rects }`), a pixel that `differ` passes over is still reported, with `strong` false, when
 * `soft.differ` holds for it and its centre lies inside one of `rects[k]` (`[x0, y0, x1, y1]` in px, edges included):
 * a second, finer tolerance inside given rects.
 *
 * With `shifts` (whole px per pair, or 0), pair k is a scroll pair: its second shot sits `shifts[k]` px further down
 * the document than its first. A pixel (x, y) of the second shot then differs only when it differs both from (x, y)
 * and from (x, y + shift) of the first: in viewport coordinates and in the document's. A pixel whose shifted source
 * lies outside the first shot is not reported, nor is one within the shift, in its column, of a still pixel: one the
 * same in viewport coordinates that the document did not carry, since it differs from where the scroll would take it
 * from (x, y + shift of the first shot) or to (x, y - shift of the second). A fixed or sticky header is still, and the
 * page next to it is not judged, since its shifted source can lie under the header. The soft test holds the same way.
 *
 * With `regions` (per scroll pair, or null), what the page reports about it: `a` and `b`, rects (as `rects` above) of
 * the objects that move in both frames of reference, where each lies in the first and the second shot; `free`, rects
 * in the second shot's coordinates where those objects' own change lies; `held`, rects of objects that hold still in
 * the viewport and do not change. A pixel is not still when it, or the pixel it is compared with across the scroll,
 * lies in a mover's rect of its own shot: there the difference is the object's, not fixed content's. Inside `free` a
 * pixel differs when it differs from its shifted source alone, and no still pixel near it hides it: an object that
 * moves with neither frame of reference (a parallax card), or across a flat background, changes the two frames in
 * different places. One whose shifted source lies outside the first shot is compared in viewport coordinates. A pixel
 * whose shifted source lies inside `held` is not reported: the page there was hidden under an object that held still.
 *
 * The last few decoded shots are kept, so a shot in several pairs is decoded once.
 */
export const DIFF_PIXELS = String.raw`async (pairs, differ, each, size, soft, shifts, regions) => {
  const kept = new Map();
  const pixels = async (src) => {
    const hit = kept.get(src);
    if (hit) { kept.delete(src); kept.set(src, hit); return hit; }
    const i = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    const [w, h] = size || [i.naturalWidth, i.naturalHeight];
    const g = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    g.drawImage(i, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    const p = { w, h, data, words: new Uint32Array(data.buffer) };
    kept.set(src, p);
    if (kept.size > 3) kept.delete(kept.keys().next().value);
    return p;
  };
  // The pixels whose centre lies inside one of the rects: x from ceil(x0 - 0.5) to floor(x1 - 0.5), y the same.
  const maskOf = (rects, w, h) => {
    if (!rects || rects.length === 0) return null;
    const m = new Uint8Array(w * h);
    for (const r of rects) {
      const [x0, x1] = [Math.max(0, Math.ceil(r[0] - 0.5)), Math.min(w - 1, Math.floor(r[2] - 0.5))];
      const [y0, y1] = [Math.max(0, Math.ceil(r[1] - 0.5)), Math.min(h - 1, Math.floor(r[3] - 0.5))];
      for (let y = y0; y <= y1; y++) m.fill(1, y * w + x0, y * w + x1 + 1);
    }
    return m;
  };
  // Compares pixel j of the first shot with pixel i of the second, through one pixel's bytes each.
  const [ja, ib] = [new Uint8ClampedArray(4), new Uint8ClampedArray(4)];
  const across = (f, a, b, j, i) => {
    ja.set(a.data.subarray(j * 4, j * 4 + 4));
    ib.set(b.data.subarray(i * 4, i * 4 + 4));
    return f(ja, ib, 0);
  };
  for (let k = 0; k < pairs.length; k++) {
    const a = await pixels(pairs[k][0]), b = await pixels(pairs[k][1]);
    const fine = soft ? maskOf(soft.rects[k], a.w, a.h) : null;
    const s = shifts ? Math.round(shifts[k] || 0) : 0;
    if (s === 0) {
      // A pixel whose four bytes match is skipped without a call.
      for (let y = 0, i = 0; y < a.h; y++) for (let x = 0; x < a.w; x++, i++) {
        if (a.words[i] === b.words[i]) continue;
        if (differ(a.data, b.data, i * 4)) each(k, x, y, true);
        else if (fine && fine[i] && soft.differ(a.data, b.data, i * 4)) each(k, x, y, false);
      }
      continue;
    }
    const { w, h } = a, reach = Math.abs(s);
    const y0 = Math.max(0, -s), y1 = Math.min(h, h - s);
    const reg = regions ? regions[k] : null;
    const [inA, inB, free, held] = reg ? [maskOf(reg.a, w, h), maskOf(reg.b, w, h), maskOf(reg.free, w, h), maskOf(reg.held, w, h)] : [null, null, null, null];
    const on = (m, i) => m !== null && m[i] === 1;
    // still[(y + 1) * w + x] counts the still pixels of column x in rows 0 to y.
    const still = new Int32Array(w * (h + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const from = y >= y0 && y < y1 && !on(inB, i) && !on(inA, i + s * w) && across(differ, a, b, i + s * w, i);
      const to = y - s >= 0 && y - s < h && !on(inA, i) && !on(inB, i - s * w) && across(differ, a, b, i, i - s * w);
      still[i + w] = still[i] + (!differ(a.data, b.data, i * 4) && (from || to) ? 1 : 0);
    }
    const near = (x, y) => still[Math.min(h, y + reach + 1) * w + x] - still[Math.max(0, y - reach) * w + x] > 0;
    // Reports pixel i when test(differ) holds, or, inside the soft rects, test(soft.differ).
    const report = (x, y, i, test) => {
      if (test(differ)) { each(k, x, y, true); return true; }
      if (fine && fine[i] && test(soft.differ)) { each(k, x, y, false); return true; }
      return false;
    };
    for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) {
      const moved = a.words[i] !== b.words[i];
      if (y < y0 || y >= y1) {
        // A mover's pixel whose shifted source lies outside the first shot is compared in viewport coordinates.
        if (moved && on(free, i)) report(x, y, i, (d) => d(a.data, b.data, i * 4));
        continue;
      }
      const j = i + s * w;
      if (a.words[j] === b.words[i] || on(held, j)) continue;
      // Inside a mover's sides a change in the document's frame is enough: a mover that moves with neither frame
      // (parallax), or over a flat background, changes the two frames in different places.
      if (on(free, i)) {
        report(x, y, i, (d) => across(d, a, b, j, i));
        continue;
      }
      if (!moved || near(x, y)) continue;
      report(x, y, i, (d) => across(d, a, b, j, i) && d(a.data, b.data, i * 4));
    }
  }
}`;
