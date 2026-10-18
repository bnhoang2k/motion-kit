// An idle page for the kind gate: a dot loops on its own clock. A ring flashes once at load. Each
// cycle the dot rests, lifts, dims, and settles back. It fades in at load. Its state is a pure function of
// the page clock T, so ?seek only sets T. The live loop pauses while the page is hidden.
// window.FAULT plants one fault; window.VARIANT picks another good shape.
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
/* motion-kit:knobs */
const KNOBS = {
  "idle": {
    "period": 1.6
  }
};
const MOTION = {
  enterS: 0.2,                                    // the fade in at load
  riseAtS: 0.6,                                   // each cycle: the lift starts
  riseS: FAULT === "pop" ? 0.01 : VARIANT === "rise-50ms" ? 0.05 : 0.2,
  liftPx: 20,
  dimAtS: 1.0,                                    // the dim starts
  dimS: 0.2,
  dim: 0.6,                                       // the opacity it dims to
  backAtS: 1.4,                                   // the lift and the dim both settle back
  backS: 0.2,
  maxStepS: 0.05,                                 // the live loop caps one time step
  flashAtS: 0.05,                                 // the ring flashes once, at load
  flashS: FAULT === "pulse-short" ? 0.02 : FAULT === "pulse-slow" ? 0.2 : 0.08,
  decayS: 0.4,
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot");
const ring = document.getElementById("ring");
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
// How far into the dim the cycle is: 0 at full opacity, 1 at the dim level.
function dimShare(ph) {
  const p = (ph - MOTION.dimAtS) / MOTION.dimS;
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
  const back = eis((ph - MOTION.backAtS) / MOTION.backS);
  const y = -MOTION.liftPx * (eis((ph - MOTION.riseAtS) / MOTION.riseS) - back);
  const o = eis(T / MOTION.enterS) * (1 - (1 - MOTION.dim) * (dimShare(ph) - back));
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
window.__state = () => ({ values: valuesAt(T), events: {}, units: { y: "px", o: "opacity", f: "opacity" } });
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
