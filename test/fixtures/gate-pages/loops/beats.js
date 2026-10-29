// A choreo page whose tap slides two bars and starts a designed motion. The page defines MOTION (endS: when the motion
// stops, Infinity for a loop that runs on; reducedAtS: the still moment shown under reduced motion), UNITS and
// valuesAfter(d), d = seconds since the tap (null before it). State is a pure function of the tap time and the page clock.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = {};
for (const n of Object.keys(window.NOSEQ ? UNITS : { ...UNITS, x0: 1, x1: 1 })) {
  const d = document.createElement("div"), k = Object.keys(els).length;
  d.className = "b";
  d.style.left = `${40 + 90 * (k % 4)}px`;
  d.style.top = `${200 + 120 * Math.floor(k / 4)}px`;
  document.body.appendChild(d);
  els[n] = d;
}
let S;
const reset = () => { S = { t: 0, down: false, presses: 0, tap: null, vtap: null }; };
const hand = { presses: 0 };
function downAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
function step(h) {
  const end = S.t + h;
  if (seekMode) {
    const down = downAt(end * 1000);
    if (down && !S.down) { if (S.tap === null) S.tap = end; if (S.vtap === null || window.RESTART) S.vtap = end; }
    S.down = down;
  } else if (hand.presses > S.presses) {
    S.presses = hand.presses;
    if (S.tap === null) S.tap = end;
    if (S.vtap === null || window.RESTART) S.vtap = end;
  }
  S.t = end;
}
const SEQ = { travelPx: MOTION.travelPx ?? 200, slideS: MOTION.slideS, staggerS: MOTION.staggerS };
const UNITS_ALL = { ...UNITS, x0: "px", x1: "px" };
const seqAt = (d) => {
  const o = {};
  for (const [i, n] of ["x0", "x1"].entries()) {
    const p = d === null ? 0 : reduced ? 1 : Math.min(1, Math.max(0, (d - i * SEQ.staggerS) / SEQ.slideS));
    o[n] = SEQ.travelPx * (1 - (1 - p) ** 3);
  }
  return o;
};
const values = () => ({ ...valuesAfter(S.vtap === null ? null : reduced ? MOTION.reducedAtS : S.t - S.vtap), ...(window.NOSEQ ? {} : seqAt(S.tap === null ? null : S.t - S.tap)) });
function draw() {
  const v = values();
  for (const n of Object.keys(els)) {
    const u = UNITS_ALL[n];
    if (u === "opacity") els[n].style.opacity = String(v[n]);
    else if (u === "px") els[n].style.transform = `translateY(${v[n]}px)`;
    else if (u === "deg") els[n].style.transform = `rotate(${v[n]}deg)`;
    else els[n].style.transform = `scale(${v[n]})`;
  }
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => ({ values: values(), events: {}, units: window.NOSEQ ? UNITS : UNITS_ALL });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const busy = () => S.tap === null || (!reduced && S.t - S.vtap < Math.max(MOTION.endS, SEQ.slideS + SEQ.staggerS));
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now;
    step(h);
    draw();
    raf = busy() && !document.hidden ? requestAnimationFrame(frame) : 0;
    if (!raf) last = null;
  };
  const wake = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", () => { hand.presses++; wake(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = null; } else wake();
  });
  wake();
}
