// An idle page for the kind gate whose loop is two long moves: the dot lifts, holds, and comes
// back. window.CURVE picks each move's curve: "ease600", a 600 ms ease-in-out tween; "spring1s", a
// spring with a visualDuration of 1 s; "back600", a 600 ms easeInBack that dips before it goes.
// "bump-loop" is a different loop: every 1.2 s the dot rests, then bumps up and back over 480 ms.
// None of them is bound by the attack limit.
const CURVE = window.CURVE || "ease600";
const MOTION = {
  periodS: 3.6,              // one loop
  liftAtS: 0.3,              // the lift starts
  backAtS: 1.8,              // the way back starts
  liftPx: 40,
  easeS: 0.6,                // the tween
  backOvershoot: 1.70158,    // easeInBack's dip
  bumpPeriodS: 1.2,          // the bump loop
  bumpS: 0.48,
  spring: { visualDuration: 1, bounce: 0.2 },
  maxStepS: 0.05,            // the live loop caps one time step
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot");
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
// Motion's spring for (visualDuration, bounce), mass 1, from rest: the share of the move done after u s.
const w0 = (2 * Math.PI) / (1.2 * MOTION.spring.visualDuration), zeta = 1 - MOTION.spring.bounce, wd = w0 * Math.sqrt(1 - zeta * zeta);
function springDone(u) {
  if (u <= 0) return 0;
  return 1 - Math.exp(-zeta * w0 * u) * (Math.cos(wd * u) + (zeta * w0 / wd) * Math.sin(wd * u));
}
function backDone(u) {
  const p = Math.min(1, Math.max(0, u / MOTION.easeS)), c = MOTION.backOvershoot;
  return (c + 1) * p ** 3 - c * p ** 2;
}
const done = (u) => (CURVE === "spring1s" ? springDone(u) : CURVE === "back600" ? backDone(u) : eis(u / MOTION.easeS));
function valuesAt(T) {
  if (reduced) return { y: 0 };
  if (CURVE === "bump-loop") {
    const u = ((T % MOTION.bumpPeriodS) - MOTION.liftAtS) / MOTION.bumpS;
    return { y: u > 0 && u < 1 ? -MOTION.liftPx * Math.sin(Math.PI * u) ** 2 : 0 };
  }
  const ph = T % MOTION.periodS;
  return { y: -MOTION.liftPx * (done(ph - MOTION.liftAtS) - done(ph - MOTION.backAtS)) };
}
let T = 0;
function draw() { dot.style.transform = `translateY(${valuesAt(T).y}px)`; }
window.__seek = (ms) => { T = ms / 1000; draw(); };
window.__state = () => ({ values: valuesAt(T), events: {}, units: { y: "px" } });
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
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start();
  });
  start();
}
