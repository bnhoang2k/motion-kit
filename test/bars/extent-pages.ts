import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/** The shape of trace.json's `extents`: each value names its edge and its parts. */
export type ExtentsJson = Record<string, { edge: string; parts: string[] }>;

/**
 * A ring of 24 upright cards on one canvas, as a copied bar. It turns by `spinDeg` on an ease-in-out of `spinMs` (the spin eases in, so the first frame is no pop of a box a few px tall), and each card tips
 * out from upright by up to `tipDeg` (the end cards of the ring most, as a kick that tips out and holds). The
 * page reports each card as an object that moves no value, a caption that rises beside it, and the box of all the cards as two values:
 * `top` (the top edge of the union of the cards' boxes) and `height`. Both are edges of many moving parts: they turn
 * when another card becomes the extreme one, not because a body passes its rest.
 */
export type Ring = {
  spinMs?: number;
  tipDeg?: number;
  spinDeg?: number;
  /** How the page reports its two values: `exact` (the union's edges), `inflated` (top 3 px high), or `fewer` (the union of 22 cards: the two at the ring's top when it starts are left out of the sum). */
  report?: "exact" | "inflated" | "fewer";
  /** What trace.json declares: both values as extents of all the cards (default), none, or what is given. */
  extents?: "both" | "none" | ExtentsJson;
  /** Beside the ring: a 600 px slide that springs 3% past its rest (value `slide`), or a 4 px badge pulse with a 200 ms attack (value `badge`). */
  extra?: "" | "slide" | "badge";
  /** A card that jumps 100 px up in one frame 100 ms after the spin ends, when it is at the top of the ring (a pop in the top, which no extent excuses). */
  pop?: boolean;
  /**
   * The cards fade in one after another from 100 ms, 40 ms apart (in an order that scatters them round the ring: card i is the (7 i mod 24)th), each over 300 ms, and a card too faint to show (opacity
   * 0.03 or less) is gone: it reports a box of 1 by 1 and the extents leave it out. The box around the drawn cards
   * jumps as each one appears, as it does when a part goes gone or comes back.
   */
  fade?: boolean;
  /**
   * With `fade`: the card at the top of the ring at 1000 ms jumps 100 px up in the very frame step in which card 10
   * comes back (is first drawn). The edge jumps in a membership step, but a card that was drawn in both frames made the jump.
   */
  popAtArrival?: boolean;
  /** With `fade`: what `top` is while no card is drawn, which the extents do not judge: the ring's rest top (default) or the bottom of the viewport (720), so the first card to come back swings `top` across the viewport. */
  idle?: "rest" | "bottom";
};

const CARDS = Array.from({ length: 24 }, (_, i) => `c${i}`);
/** Both values as extents of every card. */
export const BOTH: ExtentsJson = { top: { edge: "top", parts: CARDS }, height: { edge: "height", parts: CARDS } };

const PAGE = (slug: string, m: Required<Omit<Ring, "extents">>) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="motion-kit-bar" content="${slug}">
<title>ring</title>
<style>html,body{margin:0;background:#101418;height:100%;overflow:hidden}
.o{position:absolute;background:#f0c040;border-radius:3px}
.k{position:absolute;background:#60c0f0}
</style>
</head><body>
<div id="cards"></div>
<div class="o" id="slide" style="display:none"></div>
<div class="k" id="badge" style="display:none"></div>
<div class="k" id="caption"></div>
<script src="../mk.js"></script>
<script>
const MOTION = ${JSON.stringify(m)};
const N = 24, W = 46, H = 60, R = 250, CX = 640, CY = 380;
const cardsEl = document.getElementById("cards");
const els = Array.from({ length: N }, (_, i) => {
  const e = document.createElement("div");
  e.className = "o";
  cardsEl.appendChild(e);
  return e;
});
const D2R = Math.PI / 180;
const pow1out = (p) => 1 - (1 - p) * (1 - p);
const clamp = (x) => Math.min(1, Math.max(0, x));
// With popAtArrival: the card at the top of the ring at 1000 ms (card 10 comes back at 989 ms, at the bottom of it).
const jumpCard = (() => {
  let best = 0, top = Infinity;
  for (let i = 0; i < N; i++) {
    if (clamp((1000 - 100 - ((i * 7) % 24) * 40) / 300) <= 0.03) continue;
    const spin = -MOTION.spinDeg * (0.5 - 0.5 * Math.cos(Math.PI * clamp(1000 / MOTION.spinMs)));
    const y = CY - R * Math.cos(((i - 11.5) * 15 + spin) * D2R);
    if (y < top) [best, top] = [i, y];
  }
  return best;
})();
if (MOTION.extra === "slide") document.getElementById("slide").style.display = "block";
if (MOTION.extra === "badge") document.getElementById("badge").style.display = "block";
const $ = (id) => document.getElementById(id);
MK.pure({ kind: "choreo", cap: 50,
  busy: (s) => (MOTION.extra === "badge" && s.t < MOTION.spinMs + 1000) || (MOTION.pop && s.t < MOTION.spinMs + 600),
  draw(t) {
  const p = MK.REDUCED ? 1 : clamp(t / MOTION.spinMs);
  const spin = -MOTION.spinDeg * (0.5 - 0.5 * Math.cos(Math.PI * p));
  const tipE = MK.REDUCED ? 1 : clamp(t / (MOTION.spinMs / 2));
  const objects = {}, boxes = [];
  els.forEach((e, i) => {
    const phi = (i - 11.5) * 15 + spin;
    const side = i < 12 ? 1 : -1, wEnd = Math.pow(Math.abs(i - 11.5) / 11.5, 2);
    const rot = side * MOTION.tipDeg * wEnd * pow1out(tipE);
    const arrived = MOTION.popAtArrival && !MK.REDUCED && clamp((t - 100 - ((10 * 7) % 24) * 40) / 300) > 0.03;
    const up = (MOTION.pop && i === 19 && t >= MOTION.spinMs + 100) || (arrived && i === jumpCard) ? 100 : 0;
    const x = CX + R * Math.sin(phi * D2R), y = CY - R * Math.cos(phi * D2R) - up;
    MK.place(e, x - W / 2, y - H / 2, W, H);
    e.style.transform = "rotate(" + rot + "deg)";
    const alpha = MOTION.fade && !MK.REDUCED ? clamp((t - 100 - ((i * 7) % 24) * 40) / 300) : 1;
    e.style.opacity = alpha;
    const b = alpha > 0.03 ? MK.boxOf(e) : [0, 0, 1, 1];
    if (alpha > 0.03) boxes.push(b);
    objects["c" + i] = { box: b, moves: [] };
  });
  const of = MOTION.report === "fewer" ? boxes.filter((_, i) => i !== 11 && i !== 12) : boxes;
  // With no card drawn (the extents do not judge such a frame), top is where the ring's own top is at rest (or the viewport's bottom), and height 0.
  const rest = MOTION.idle === "bottom" ? 720 : CY - R - H / 2;
  const top = of.length > 0 ? Math.min(...of.map((b) => b[1])) : rest, bottom = of.length > 0 ? Math.max(...of.map((b) => b[1] + b[3])) : rest;
  const topV = MOTION.report === "inflated" ? top - 3 : top;
  const values = { top: topV, height: bottom - topV };
  const units = { top: "px", height: "px" };
  if (MOTION.extra === "slide") {
    // A slide of 600 px that springs 3% past its rest and settles: x = 600 (1 - e^(-a u) (cos(w u) + (a / w) sin(w u))).
    const a = 6, w = a / 1.116, u = MK.REDUCED ? 99 : Math.max(0, (t - 300) / 1000);
    const x = 600 * (1 - Math.exp(-a * u) * (Math.cos(w * u) + (a / w) * Math.sin(w * u)));
    MK.place($("slide"), 20 + x, 20, 30, 30);
    values.slide = x;
    units.slide = "px";
    objects.slide = { box: MK.boxOf($("slide")), moves: ["slide"] };
  }
  if (MOTION.extra === "badge") {
    // A badge that rises 4 px in 200 ms and falls back in 400 ms once the ring is still: a pulse with a slow attack.
    const u = MK.REDUCED ? 0 : t - MOTION.spinMs - 400;
    const b = u <= 0 ? 0 : u < 200 ? 4 * Math.sin((Math.PI / 2) * (u / 200)) : u < 600 ? 4 * Math.cos((Math.PI / 2) * ((u - 200) / 400)) : 0;
    MK.place($("badge"), 20, 300 - b, 30, 30);
    values.badge = b;
    units.badge = "px";
    objects.badge = { box: MK.boxOf($("badge")), moves: ["badge"] };
  }
  // A caption that rises 40 px beside the ring, 600 ms in: a second onset, so the sequence has more than one start.
  const c = MK.REDUCED ? 1 : pow1out(clamp((t - 600) / 400));
  MK.place($("caption"), 20, 660 - 40 * c, 120, 20);
  values.caption = 40 * c;
  units.caption = "px";
  objects.caption = { box: MK.boxOf($("caption")), moves: ["caption"] };
  return { values, units, objects };
} });
</script>
</body></html>
`;

/**
 * A copy of the ring page as a copied bar, in its own folder under `dir` (`dir` holds one shared mk.js). Returns its
 * index.html.
 */
export function ringPage(dir: string, ring: Ring = {}): string {
  const out = mkdtempSync(path.join(dir, "ring-"));
  const m = { spinMs: 2500, tipDeg: 15, spinDeg: 108, report: "exact", extra: "", pop: false, fade: false, popAtArrival: false, idle: "rest", ...Object.fromEntries(Object.entries(ring).filter(([k]) => k !== "extents")) } as Required<Omit<Ring, "extents">>;
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(PAGES, "object2-review/mk.js"), path.join(dir, "mk.js"));
  writeFileSync(path.join(out, "index.html"), PAGE(path.basename(out), m));
  writeFileSync(path.join(out, "bar.json"), JSON.stringify({ slug: path.basename(out), kinds: ["choreo"] }));
  const extents = ring.extents ?? "both";
  writeFileSync(path.join(out, "trace.json"), JSON.stringify(extents === "none" ? {} : { extents: extents === "both" ? BOTH : extents }));
  return path.join(out, "index.html");
}

/**
 * How the single body of `bodyPage` moves, and what sits beside it.
 * - `move`: `spring` (default) slides `travel` px right and springs `over` (a share, 0.1) past its rest; `pulse` rises 4 px in
 *   `attackMs` and falls back in twice that, from `startMs` (default 300).
 * - `decoy`: `static` is a second part, drawn all through, that never holds the left edge (it sits far to the right);
 *   `crosses` is a second part that holds the left edge at first, then runs past the body, so the edge changes hands once and
 *   then belongs to the body, which moves on alone; `brief` is the same, and then goes gone (a box of 1 by 1) from 400 ms on, so
 *   it is drawn with the body in only a small share of the frames. Default none: only a part that is never drawn (`ghost`) is beside it.
 * - `drift`: the body also goes down `drift` px a frame for its first 40 frames, across the edge it is named for, so the whole of its
 *   box never turns back though its left edge does (a diagonal path). Default 0.
 */
export type Body = { move?: "spring" | "pulse"; travel?: number; over?: number; attackMs?: number; startMs?: number; decoy?: "" | "static" | "crosses" | "brief"; drift?: number };

/**
 * One dot that slides and springs past its rest (or pulses), beside a `ghost` that is never drawn (a box of 1 by 1) and,
 * as `body.decoy` says, a decoy that is drawn, as a copied bar. The page reports the left edge of the dot as `x` (of the dot
 * and the decoy, when there is one: the left edge of the two); `extents` is what trace.json declares for it. A single body
 * named as an extent, with or without a decoy.
 */
export function bodyPage(dir: string, extents: ExtentsJson, body: Body = {}): string {
  const out = mkdtempSync(path.join(dir, "body-"));
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(PAGES, "object2-review/mk.js"), path.join(dir, "mk.js"));
  const slug = path.basename(out);
  const m = { move: "spring", travel: 300, over: 0.1, attackMs: 200, startMs: 300, decoy: "", drift: 0, ...body };
  writeFileSync(
    path.join(out, "index.html"),
    `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="motion-kit-bar" content="${slug}">
<title>body</title>
<style>html,body{margin:0;background:#101418;height:100%;overflow:hidden}
.o{position:absolute;background:#f0c040;border-radius:3px}
.k{position:absolute;background:#60c0f0}
</style>
</head><body>
<div class="o" id="dot"></div>
<div class="k" id="decoy" style="display:none"></div>
<div class="k" id="cap"></div>
<script src="../mk.js"></script>
<script>
const BODY = ${JSON.stringify(m)};
const $ = (id) => document.getElementById(id);
const pow1out = (p) => 1 - (1 - p) * (1 - p);
const clamp = (x) => Math.min(1, Math.max(0, x));
MK.pure({ kind: "choreo", cap: 50,
  draw(t) {
  let x;
  if (BODY.move === "pulse") {
    // Rises 4 px in attackMs and falls back in twice that.
    const u = MK.REDUCED ? 0 : t - BODY.startMs;
    x = u <= 0 ? 0 : u < BODY.attackMs ? 4 * Math.sin((Math.PI / 2) * (u / BODY.attackMs)) : u < 3 * BODY.attackMs ? 4 * Math.cos((Math.PI / 2) * ((u - BODY.attackMs) / (2 * BODY.attackMs))) : 0;
  } else {
    // x = T (1 - e^(-a u) (cos(w u) + (a / w) sin(w u))): past its rest by e^(-pi a / w), the share \`over\`.
    const a = 8, w = (a * Math.PI) / -Math.log(BODY.over), u = MK.REDUCED ? 99 : t / 1000;
    x = BODY.travel * (1 - Math.exp(-a * u) * (Math.cos(w * u) + (a / w) * Math.sin(w * u)));
  }
  MK.place($("dot"), 100 + x, 300 + BODY.drift * Math.min(40, MK.REDUCED ? 40 : t / (1000 / 60)), 60, 60);
  // The decoy: far to the right and still, or at 40 px at first and then out to 1000 px, past the dot, in 300 ms (a brief one then goes gone).
  const crossing = BODY.decoy === "crosses" || BODY.decoy === "brief";
  const dx = crossing ? (BODY.decoy === "brief" ? 100 : 40) + (BODY.decoy === "brief" ? 900 : 960) * (MK.REDUCED ? 1 : pow1out(clamp(t / 300))) : 1000;
  const gone = BODY.decoy === "brief" && (MK.REDUCED || t >= 400);
  $("decoy").style.display = BODY.decoy && !gone ? "block" : "none";
  if (BODY.decoy && !gone) MK.place($("decoy"), dx, 500, 60, 60);
  const c = MK.REDUCED ? 1 : pow1out(clamp((t - 700) / 400));
  MK.place($("cap"), 20, 660 - 40 * c, 120, 20);
  const objects = { dot: { box: MK.boxOf($("dot")), moves: ["x"] }, ghost: { box: [0, 0, 1, 1], moves: [] }, caption: { box: MK.boxOf($("cap")), moves: ["caption"] } };
  if (BODY.decoy) objects.decoy = { box: gone ? [0, 0, 1, 1] : MK.boxOf($("decoy")), moves: [] };
  return {
    values: { x: BODY.decoy && !gone ? Math.min(100 + x, dx) : 100 + x, caption: 40 * c },
    units: { x: "px", caption: "px" },
    objects,
  };
} });
</script>
</body></html>
`,
  );
  writeFileSync(path.join(out, "bar.json"), JSON.stringify({ slug, kinds: ["choreo"] }));
  writeFileSync(path.join(out, "trace.json"), JSON.stringify({ extents }));
  return path.join(out, "index.html");
}
