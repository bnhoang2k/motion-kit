// An idle page for the loop sweep: the page defines MOTION, UNITS and valuesAt(T) before this script. Each value
// gets one dot. Under reduced motion the page shows the still moment MOTION.stillAtS (until MOTION.reducedRunsAtS,
// when set: a fault). State is a pure function of the page clock T, so ?seek only sets T. The live loop pauses while
// the page is hidden; under reduced motion it runs only when the page moves there.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = {};
// Dots sit in rows of 4, 72 px apart, so every dot starts on a 320 px screen.
for (const n of Object.keys(UNITS)) {
  const d = document.createElement("div"), k = Object.keys(els).length;
  d.className = "b";
  d.style.left = `${24 + 72 * (k % 4)}px`;
  d.style.marginTop = `${120 * Math.floor(k / 4)}px`;
  document.body.appendChild(d);
  els[n] = d;
}
const at = (T) => valuesAt(reduced && !(T >= MOTION.reducedRunsAtS) ? MOTION.stillAtS : T);
let T = 0;
function draw() {
  const v = at(T);
  for (const n of Object.keys(UNITS)) {
    const u = UNITS[n];
    if (u === "opacity") els[n].style.opacity = String(v[n]);
    else els[n].style.transform = u === "px" ? `translateY(${v[n]}px)` : u === "deg" ? `rotate(${v[n]}deg)` : `scale(${v[n]})`;
  }
}
window.__seek = (ms) => { T = ms / 1000; draw(); };
window.__state = () => ({ values: at(T), events: {}, units: UNITS });
draw();
if (!seekMode && (!reduced || MOTION.reducedRunsAtS !== undefined)) {
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
