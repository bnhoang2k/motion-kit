// A choreo or sim page whose tap starts a slide and a designed loop. The page defines MOTION, UNITS and valuesAt(d)
// (d: seconds since the tap, or null before it; T: the page clock in seconds, for a value that starts on load) before this script. State is a function of the page clock; ?seek replays
// the tap from window.__input. The live loop pauses while the page is hidden. Under reduced motion a tap shows
// valuesAt(MOTION.reducedD) if it is set.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = {};
for (const n of Object.keys(UNITS)) {
  const d = document.createElement("div"), k = Object.keys(els).length;
  d.className = "b";
  d.style.left = `${200 + 120 * (k % 4)}px`;
  d.style.top = `${200 + 120 * Math.floor(k / 4)}px`;
  document.body.appendChild(d);
  els[n] = d;
}
let T = 0, tapAt = null;
function downAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
const at = () => {
  if (tapAt === null) return valuesAt(null, T);
  if (reduced) return MOTION.reducedD === undefined ? valuesAt(null, T) : valuesAt(MOTION.reducedD, T);
  return valuesAt(T - tapAt, T);
};
function draw() {
  const v = at();
  for (const n of Object.keys(UNITS)) {
    const u = UNITS[n];
    if (u === "opacity") els[n].style.opacity = String(v[n]);
    else els[n].style.transform = u === "px" ? `translateY(${v[n]}px)` : u === "deg" ? `rotate(${v[n]}deg)` : `scale(${v[n]})`;
  }
}
window.__seek = (ms) => {
  tapAt = null; T = 0;
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 1; i <= n; i++) { T = i / 60; if (tapAt === null && downAt(T * 1000)) tapAt = T; }
  if (ms / 1000 - T > 1e-9) { T = ms / 1000; if (tapAt === null && downAt(ms)) tapAt = T; }
  draw();
};
window.__state = () => ({ values: at(), events: {}, units: UNITS });
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    T += h;
    draw();
    raf = (tapAt !== null && !reduced) ? requestAnimationFrame(frame) : 0;
    if (!raf) last = null;
  };
  const start = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
  addEventListener("pointerdown", () => { if (tapAt === null) { tapAt = T; draw(); } start(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (tapAt !== null) start();
  });
}
