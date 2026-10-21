// An idle page for the kind gate: a dot loops on its own clock. A ring flashes once at load. Each
// cycle the dot rests, lifts, dims, and settles back. It fades in at load. Its state is a pure function of
// the page clock T, so ?seek only sets T. The live loop pauses while the page is hidden.
// window.FAULT plants one fault ("set": a 60 px lift, 1.5 lengths of the dot, in one 10 ms rise); window.VARIANT
// picks another good shape. window.STEP_HZ, when set, holds the lift y in poses: it reads the clock at that many
// poses a second, as hand-drawn motion on twos does. Then the page also reports the dot as an object that y and o
// move, and the ring as an object that f moves. The ring draws only its shadow, so its box is the ring's own box grown
// by the shadow's spread.
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
const STEP_HZ = window.STEP_HZ || 0;
/* motion-kit:knobs */
const KNOBS = {
  "idle": {
    "period": 1.6
  }
};
const MOTION = {
  enterS: 0.2,                                    // the fade in at load
  riseAtS: 0.6,                                   // each cycle: the lift starts
  riseS: FAULT === "pop" || FAULT === "set" ? 0.01 : FAULT === "value-nan" || FAULT === "value-missing" ? 0.02 : VARIANT === "rise-50ms" ? 0.05 : 0.2,
  liftPx: FAULT === "set" ? 60 : 20,
  dimAtS: 1.0,                                    // the dim starts
  dimS: 0.2,
  dim: 0.6,                                       // the opacity it dims to
  backAtS: 1.4,                                   // the lift and the dim both settle back
  backS: 0.2,
  maxStepS: 0.05,                                 // the live loop caps one time step
  flashAtS: 0.05,                                 // the ring flashes once, at load
  flashS: FAULT === "pulse-short" ? 0.02 : FAULT === "pulse-slow" ? 0.2 : 0.08,
  decayS: 0.4,
  ringPx: 6,                                      // the ring's shadow spreads this far past its box (the page's CSS)
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot");
const ring = document.getElementById("ring");
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
// How far into the dim the cycle is: 0 at full opacity, 1 at the dim level. The fade-rises fault dims once, past its
// level and back up to it, and stays dim: a fade, not a loop.
function dimShare(ph, T) {
  const p = ((FAULT === "fade-rises" ? T : ph) - MOTION.dimAtS) / MOTION.dimS;
  if (FAULT !== "fade-rises") return eis(p);
  return p < 0.5 ? 1.5 * eis(2 * p) : 1.5 - 0.5 * eis(2 * p - 1);
}
// The flash: an eased attack to full, then a decay back to 0. It happens once, so it is a pulse, not a loop.
function flash(T) {
  const p = (T - MOTION.flashAtS) / MOTION.flashS;
  if (p < 1) return eis(p);
  const q = Math.min(1, (p - 1) * MOTION.flashS / MOTION.decayS);
  return (1 - q) ** 3;
}
function valuesAt(T) {
  if (reduced) return { y: 0, o: 1, f: 0 };
  const ph = T % KNOBS.idle.period;
  const back = FAULT === "fade-rises" ? 0 : eis((ph - MOTION.backAtS) / MOTION.backS);
  const py = (STEP_HZ ? Math.floor(T * STEP_HZ + 1e-9) / STEP_HZ : T) % KNOBS.idle.period;
  const y = -MOTION.liftPx * (eis((py - MOTION.riseAtS) / MOTION.riseS) - eis((py - MOTION.backAtS) / MOTION.backS));
  const o = eis(T / MOTION.enterS) * (1 - (1 - MOTION.dim) * (dimShare(ph, T) - back));
  // A lift set in two frames whose middle frame is NaN (a 0/0 tween) or left out: the dot pops, and y hides it.
  const hidden = (FAULT === "value-nan" || FAULT === "value-missing") && py - MOTION.riseAtS > 1e-9 && py - MOTION.riseAtS < MOTION.riseS - 1e-9;
  if (hidden) return FAULT === "value-nan" ? { y: NaN, o, f: flash(T) } : { o, f: flash(T) };
  return { y, o, f: flash(T) };
}
let T = 0;
function draw() {
  const v = valuesAt(T);
  dot.style.transform = `translateY(${v.y}px)`;
  dot.style.opacity = String(v.o);
  ring.style.opacity = String(v.f);
}
window.__seek = (ms) => { T = ms / 1000; draw(); };
// With STEP_HZ the boxes are read from the DOM after draw(). A dot or ring faded out is not drawn, and reports a box of
// 1 by 1.
const boxOf = (el, grow = 0) => {
  const r = el.getBoundingClientRect();
  return Number(el.style.opacity) <= 0 ? [r.x, r.y, 1, 1] : [r.x - grow, r.y - grow, r.width + 2 * grow, r.height + 2 * grow];
};
window.__state = () => ({
  values: valuesAt(T),
  events: {},
  units: { y: "px", o: "opacity", f: "opacity" },
  ...(STEP_HZ ? { objects: { dot: { box: boxOf(dot), moves: ["y", "o"] }, ring: { box: boxOf(ring, MOTION.ringPx), moves: ["f"] } } } : {}),
});
draw();
if (!seekMode && !reduced) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    T += h;
    draw();
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (FAULT !== "no-pause") { cancelAnimationFrame(raf); raf = 0; } }
    else if (FAULT !== "no-resume") start();
  });
  start();
}
