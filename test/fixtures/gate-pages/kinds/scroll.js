// A scroll page for the kind gate: a bar follows the scroll position, smoothed with the
// scroll.smooth time constant and a scroll.maxStep cap on one time step. Under ?seek the scroll
// position comes from window.__input samples [ms, scrollY]. window.FAULT plants one fault. With
// window.VARIANT "intro", a second value e also eases in over 1.5 s at load, on the page clock.
// VARIANT "snap05" rests the bar at 0.05 px, not 0.01: a last snap that small is below the px floor.
// VARIANT "pop06" adds a value q that jumps 0.6 px in one frame at 100 ms (none under reduced motion).
// VARIANT "stepped" adds z, a scale that grows with the bar, and o, an opacity that rises with it. Under reduced
// motion both step between still states, one every 600 px of scroll: z in one frame, o by a 200 ms fade.
// FAULT "reduced-zoom" keeps z a continuous zoom under reduced motion. FAULT "reduced-ignored" holds p, z and o
// still under reduced motion.
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
/* motion-kit:knobs */
const KNOBS = {
  "scroll": {
    "smooth": 0.166666666667,
    "maxStep": 0.05
  }
};
const MOTION = {
  restPx: VARIANT === "snap05" ? 0.05 : 0.01,   // the bar is at rest inside this distance
  popPx: 0.6,     // VARIANT "pop06": q's one-frame jump
  popAtS: 0.1,    // VARIANT "pop06": when q jumps
  introS: 1.5,    // VARIANT "intro": e eases in over this long at load
  stepPx: 600,    // VARIANT "stepped": under reduced motion, one still state per 600 px of scroll
  zoomPerPx: 0.001, // z grows by this per px of bar
  dimPx: 1800,    // o goes from 0.5 to 1 over this many px
  fadeS: 0.2,     // under reduced motion, o fades to its new state over this long
};
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
if (FAULT === "console") console.error("a console error at load");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const bar = document.getElementById("bar");
let S;
function reset() { S = { t: 0, p: 0, target: 0, e: reduced ? 1 : 0, q: reduced ? MOTION.popPx : 0, z: 1, o: 0.5, fade: null }; }
const dimAt = (px) => 0.5 + 0.5 * Math.min(1, px / MOTION.dimPx);
function scrollAt(ms) {
  if (!seekMode) return window.scrollY;
  let y = 0;
  for (const [t, v] of window.__input || []) if (t <= ms + 1e-6) y = v;
  return y;
}
function step(h) {
  const end = S.t + h;
  const y = scrollAt(end * 1000);
  S.target = FAULT === "one-way" ? Math.max(S.target, y) : y;
  const ignored = reduced && FAULT === "reduced-ignored";
  if (reduced) S.p = ignored ? S.p : S.target;
  else S.p += (S.target - S.p) * (1 - Math.exp(-h / KNOBS.scroll.smooth));
  if (Math.abs(S.target - S.p) < MOTION.restPx && !ignored) S.p = S.target;
  if (VARIANT === "stepped" && !reduced) { S.z = 1 + MOTION.zoomPerPx * S.p; S.o = dimAt(S.p); }
  else if (VARIANT === "stepped" && !ignored) {
    const view = MOTION.stepPx * Math.floor(S.target / MOTION.stepPx);
    S.z = 1 + MOTION.zoomPerPx * (FAULT === "reduced-zoom" ? S.target : view);
    const goal = dimAt(view);
    if (!S.fade || S.fade.to !== goal) S.fade = { from: S.o, to: goal, t0: S.t };
    S.o = S.fade.from + (S.fade.to - S.fade.from) * Math.min(1, (end - S.fade.t0) / MOTION.fadeS);
  }
  if (!reduced) S.e = eis(end / MOTION.introS);
  if (end >= MOTION.popAtS - 1e-9) S.q = MOTION.popPx;
  S.t = end;
}
const intro = () => (VARIANT === "intro" && S.e < 1) || (S.fade !== null && S.o !== S.fade.to);
function draw() {
  bar.style.transform = VARIANT === "stepped" ? `translateX(${S.p}px) scale(${S.z})` : `translateX(${S.p}px)`;
  if (VARIANT === "intro") bar.style.opacity = String(0.5 + 0.5 * S.e);
  if (VARIANT === "stepped") bar.style.opacity = String(S.o);
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor(ms * 60 / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => VARIANT === "intro"
  ? { values: { p: S.p, e: S.e }, events: {}, units: { p: "px", e: "opacity" } }
  : VARIANT === "stepped"
    ? { values: { p: S.p, z: S.z, o: S.o }, events: {}, units: { p: "px", z: "scale", o: "opacity" } }
  : VARIANT === "pop06"
    ? { values: { p: S.p, q: S.q }, events: {}, units: { p: "px", q: "px" } }
    : { values: { p: S.p }, events: {}, units: { p: "px" } };
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    let h = last === null ? 0 : (now - last) / 1000;
    if (FAULT !== "no-cap") h = Math.min(h, KNOBS.scroll.maxStep);
    last = now;
    step(h);
    draw();
    if (S.p !== S.target || intro()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(frame); });
  if (intro()) raf = requestAnimationFrame(frame);
}
