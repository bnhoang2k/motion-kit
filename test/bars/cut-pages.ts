import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Idle pages for the drawn check's small cuts: one designed change in one frame, at 1000 ms, that is not a scene
 * change. The page's pixels come from its viewport, so the same page runs at any size.
 *
 * - `snap`: a part that jumps into a slot (its value x steps), so the change is the part's old place and the slot.
 * - `light`: a lamp that flips from red to green (an object with moves: []).
 * - `panel`: a panel that appears (its box goes from gone to drawn, its value p steps from 0 to 1).
 *
 * A bar of flat colour (an object, value m) slides to and fro and changes about half as much of the view as the cut
 * does in every frame (a fifth of the view high at most, above the things the cuts change), so the cut is not 3 times the largest change elsewhere and is judged as a small cut. It holds
 * still from 900 to 1100 ms, so the frame of the cut changes nothing else.
 *
 * `share` is how much of the view the change covers. `fault` plants a lie: "glitch" shows a 16 px square no object
 * reports beside the honest change; "unowned" leaves the changing thing out of the record, which reports only a
 * still plate; "none" declares the cut on a frame where nothing changes; "noobjects" reports no objects at all.
 *
 * `quiet` leaves the sliding bar out, so nothing else on the page changes in any frame: the cut is the only change
 * the page has, and the ratio test against "the most any other pair changes" has nothing to compare it to.
 */
export type CutShape = "snap" | "light" | "panel";
export type CutFault = "honest" | "glitch" | "unowned" | "none" | "noobjects";
export const CUT_MS = 1000;

export function cutPage(shape: CutShape, share: number, fault: CutFault, quiet = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>cut ${shape}</title>
<style>html, body { margin: 0; background: #fff; height: 100%; overflow: hidden } div { position: fixed } #glitch, #panel { display: none }</style>
</head><body>
<div id="slot"></div><div id="part"></div><div id="lamp"></div><div id="panel"></div><div id="plate"></div><div id="bar"></div><div id="glitch"></div>
<script>
const SHAPE = ${JSON.stringify(shape)}, SHARE = ${share}, FAULT = ${JSON.stringify(fault)}, QUIET = ${quiet}, CUT = ${CUT_MS};
const W = innerWidth, H = innerHeight, A = SHARE * W * H;
const $ = (id) => document.getElementById(id);
const place = (el, r, bg) => { el.style.left = r[0] + "px"; el.style.top = r[1] + "px"; el.style.width = r[2] + "px"; el.style.height = r[3] + "px"; if (bg) el.style.background = bg; };
const snapSide = Math.round(Math.sqrt(A / 2));
const lampSide = Math.round(Math.sqrt(A));
const panelW = Math.round(Math.sqrt((A * 4) / 3)), panelH = Math.round((panelW * 3) / 4);
const slot = [Math.round(W / 2 - snapSide / 2), Math.round(H / 2 - snapSide / 2), snapSide, snapSide];
const lamp = [Math.round(W / 2 - lampSide / 2), Math.round(H / 2 - lampSide / 2), lampSide, lampSide];
const panel = [Math.round(W / 2 - panelW / 2), Math.round(H / 2 - panelH / 2), panelW, panelH];
const away = Math.round(1.6 * snapSide);
const plate = [20, H - 60, 100, 40];
place($("slot"), SHAPE === "snap" ? slot : [0, 0, 0, 0], "#dde");
place($("plate"), plate, "#bbb");
place($("glitch"), [W - 40, 20, 16, 16], "#c33");
// The bar moves STEP px a frame, back and forth over RANGE px, and is at most a fifth of the view high, so it changes
// 2 * STEP * barH px a frame (its width is STEP at least, so the two slivers it changes do not meet).
const barH = Math.min(Math.round(0.2 * H), Math.round((0.25 * A) / 40)), STEP = Math.max(40, Math.round((0.25 * A) / barH)), RANGE = Math.round(W / 2), barTop = 40, barW = Math.max(120, STEP);
place($("bar"), [0, barTop, barW, barH], "#888");
const barX = (ms) => { const k = Math.round(((ms <= 900 ? ms : ms < 1100 ? 900 : ms - 200) * 60) / 1000) * STEP; const u = k % (2 * RANGE); return 100 + (u < RANGE ? u : 2 * RANGE - u); };
let T = 0;
const after = () => FAULT !== "none" && T > CUT + 0.001;
function draw() {
  const on = after();
  $("bar").style.left = barX(T) + "px";
  $("bar").style.display = QUIET ? "none" : "block";
  if (SHAPE === "snap") place($("part"), [slot[0] - (on ? 0 : away), slot[1], snapSide, snapSide], "#e94");
  if (SHAPE === "light") place($("lamp"), lamp, on ? "#3c3" : "#c33");
  if (SHAPE === "panel") { place($("panel"), panel, "#36c"); $("panel").style.display = on ? "block" : "none"; }
  $("glitch").style.display = FAULT === "glitch" && on ? "block" : "none";
}
window.__seek = (ms) => { T = ms; draw(); };
window.__state = () => {
  const on = after();
  const values = { v: 0, m: barX(T), ...(SHAPE === "snap" ? { x: on ? 0 : -away } : {}), ...(SHAPE === "panel" ? { p: on ? 1 : 0 } : {}) };
  const units = { v: "px", m: "px", ...(SHAPE === "snap" ? { x: "px" } : {}), ...(SHAPE === "panel" ? { p: "ratio" } : {}) };
  const objects = { plate: { box: plate, moves: ["v"] } };
  if (!QUIET) objects.bar = { box: [barX(T), barTop, barW, barH], moves: ["m"] };
  if (FAULT !== "unowned") {
    if (SHAPE === "snap") objects.part = { box: [slot[0] - (on ? 0 : away), slot[1], snapSide, snapSide], moves: ["x"] };
    if (SHAPE === "light") objects.lamp = { box: lamp, moves: [] };
    if (SHAPE === "panel") objects.panel = { box: on ? panel : [panel[0], panel[1], 1, 1], moves: ["p"] };
  }
  return { values, events: {}, units, objects: FAULT === "noobjects" ? {} : objects };
};
draw();
</script></body></html>
`;
}

/** Writes a cut page into `dir` and returns its path. */
export function writeCutPage(dir: string, name: string, html: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.html`);
  writeFileSync(file, html);
  return file;
}
