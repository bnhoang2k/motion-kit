// An idle page for the drawn check with objects inside objects: a head with an eye in it, each reported as an object.
// It loops on its own clock; its state is a pure function of the page clock T, so ?seek only sets T. The live loop
// pauses while the page is hidden. window.VARIANT picks what moves:
// - "blink": the head and the eye hold still, and a lid, an object of its own, closes over the eye and opens again.
//   Every pixel the lid changes is inside the head's box and the eye's box too.
// - "nod": the head lifts and settles back, and the eye moves with it, inside the head's box. y moves the head; the eye
//   is an object no value names.
const VARIANT = window.VARIANT || "";
const MOTION = {
  periodS: 1.6,     // the loop
  closeAtS: 0.6,    // VARIANT "blink": the lid starts to close
  closeS: 0.15,
  openAtS: 1.0,     // and opens again
  openS: 0.15,
  liftAtS: 0.6,     // VARIANT "nod": the lift starts
  liftS: 0.3,
  liftPx: 60,
  backAtS: 1.1,
  backS: 0.3,
  maxStepS: 0.05,   // the live loop caps one time step
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const head = document.getElementById("head");
const eye = document.getElementById("eye");
const lid = document.getElementById("lid");
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
const rectOf = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
const eyeRest = rectOf(eye);
// The lid's height, from 0 (open) to the eye's height (shut), or the head's lift.
function valuesAt(T) {
  const ph = T % MOTION.periodS;
  if (VARIANT === "blink") return { lid: reduced ? 0 : eyeRest[3] * (eis((ph - MOTION.closeAtS) / MOTION.closeS) - eis((ph - MOTION.openAtS) / MOTION.openS)) };
  return { y: reduced ? 0 : -MOTION.liftPx * (eis((ph - MOTION.liftAtS) / MOTION.liftS) - eis((ph - MOTION.backAtS) / MOTION.backS)) };
}
let T = 0;
function draw() {
  const v = valuesAt(T);
  if (VARIANT === "blink") lid.style.height = `${v.lid}px`;
  else head.style.transform = eye.style.transform = `translateY(${v.y}px)`;
}
window.__seek = (ms) => { T = ms / 1000; draw(); };
// Boxes are read from the DOM after draw(). A lid open to under 1 px is not drawn, and reports a box of 1 by 1.
window.__state = () => {
  const v = valuesAt(T);
  const objects = { head: { box: rectOf(head), moves: VARIANT === "nod" ? ["y"] : [] }, eye: { box: rectOf(eye), moves: [] } };
  if (VARIANT === "blink") objects.lid = { box: v.lid < 1 ? [eyeRest[0], eyeRest[1], 1, 1] : rectOf(lid), moves: ["lid"] };
  return { values: v, events: {}, units: VARIANT === "blink" ? { lid: "px" } : { y: "px" }, objects };
};
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
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else start();
  });
  start();
}
