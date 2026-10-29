// A choreo or sim page whose tap starts window.F(s) (s seconds since the tap), which returns { name: value }.
// window.UNITS gives each value's unit. Under reduced motion the page shows window.STILL(s) instead (default: F(0)). A
// second tap is ignored. The live loop runs while F keeps moving (window.FOREVER) and pauses while the page is hidden.
const F = window.F, UNITS = window.UNITS, STILL = window.STILL || (() => F(0));

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const names = Object.keys(UNITS);
const els = Object.fromEntries(names.map((n, i) => { const d = document.createElement("div"); d.className = "box"; d.style.top = `${120 + i * 120}px`; document.body.appendChild(d); return [n, d]; }));
const hand = { presses: 0 };
let S;
function reset() { S = { t: 0, down: false, presses: 0, start: window.AUTO ? 0 : null, last: window.AUTO ? 0 : null }; }
function downAt(ms) { const s = window.__input || []; let p = null; for (const q of s) if (q[0] <= ms + 1e-6) p = q; return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6; }
function trigger(t) { if (S.start === null) S.start = t; S.last = t; }
function step(h) {
  const end = S.t + h;
  if (seekMode) { const down = downAt(end * 1000); if (down && !S.down) trigger(end); S.down = down; }
  else if (hand.presses > S.presses) { S.presses = hand.presses; trigger(end); }
  S.t = end;
}
const values = () => (S.start === null ? F(0, 0) : reduced ? STILL(S.t - S.start, S.t - S.last) : F(S.t - S.start, S.t - S.last));
const draw = () => { const v = values(); for (const n of names) { const u = UNITS[n], el = els[n], x = v[n]; if (u === "scale") el.style.transform = `scale(${x})`; else if (u === "opacity") el.style.opacity = String(x); else if (u === "deg") el.style.transform = `rotate(${x}deg)`; else el.style.transform = `translateY(${x}px)`; } };
window.__seek = (ms) => { reset(); const n = Math.floor((ms * 60) / 1000 + 1e-6); for (let i = 0; i < n; i++) step(1 / 60); const rest = ms / 1000 - n / 60; if (rest > 1e-9) step(rest); draw(); };
window.__state = () => ({ values: values(), events: {}, units: UNITS });
reset(); draw();
if (!seekMode) {
  let last = null, raf = 0;
  const moving = () => S.start === null ? false : reduced ? (S.t - S.start) < (window.STILL_MS || 0) / 1000 : (window.FOREVER || (S.t - S.start) < (window.RUN_MS || 20000) / 1000);
  const frame = (now) => { const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS); last = now; step(h); draw(); if (moving() || hand.presses > S.presses) raf = requestAnimationFrame(frame); else { raf = 0; last = null; } };
  const wake = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", () => { hand.presses++; wake(); }); if (window.AUTO) wake();
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = null; } else if (S.start !== null) wake(); });
}
