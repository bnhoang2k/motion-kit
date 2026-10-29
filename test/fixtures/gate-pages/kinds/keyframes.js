// A choreo page for the kind gate, driven by keyframes or springs: a tap starts every track, each after its own delay.
// window.CFG = { tracks: [ { name, unit, prop, delayMs, model } ] }
// model kf: { type: "kf", ms, offsets: [0..1], values: [...], eases: name | [names per segment], repeat: n }. Two
// equal offsets in a row are a step: the value jumps from the first one's value to the second one's at that offset.
// model spring: { type: "spring", k, c, m, v0, x0 }   (x(t) analytic, damped oscillator about 0; v0 in units/s)
const CFG = window.CFG;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
function bezier(x1, y1, x2, y2) {
  const at = (a, b, s) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < p) lo = mid; else hi = mid; }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const CURVES = {
  ease: bezier(0.25, 0.1, 0.25, 1), easeIn: bezier(0.42, 0, 1, 1), easeOut: bezier(0, 0, 0.58, 1), easeInOut: bezier(0.42, 0, 0.58, 1),
  linear: (p) => p, sine: (p) => (1 - Math.cos(Math.PI * p)) / 2,
  animOut: bezier(0.215, 0.61, 0.355, 1), animIn: bezier(0.755, 0.05, 0.855, 0.06),
  motionEaseOut: bezier(0, 0, 0.58, 1), motionEaseInOut: bezier(0.42, 0, 0.58, 1),
  shakeCurve: bezier(0.36, 0.07, 0.19, 0.97), backOut: bezier(0.34, 1.56, 0.64, 1),
  power2InOut: (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) ** 2), power3Out: (p) => 1 - (1 - p) ** 3,
  power2In: (p) => p * p, power1InOut: (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) ** 2),
  // The circle curves (Motion, GSAP, Penner): a square-root cusp where the speed is infinite, at the middle of circInOut and at an end of circIn and circOut.
  circIn: (p) => 1 - Math.sqrt(1 - p * p), circOut: (p) => Math.sqrt(1 - (1 - p) ** 2),
  circInOut: (p) => (p < 0.5 ? (1 - Math.sqrt(1 - 4 * p * p)) / 2 : (Math.sqrt(1 - (-2 * p + 2) ** 2) + 1) / 2),
  // Steeper than the circle: a cube-root cusp at the middle of cubic-bezier(1,0,0,1), a plain CSS ease; the same shape a little gentler; and an exponential in-out (no cusp).
  bez1001: bezier(1, 0, 0, 1), bez9001: bezier(0.9, 0, 0.1, 1),
  expoInOut: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
  // Just under the cusp: a bounded speed, with a straight middle far narrower than a frame.
  bez96: bezier(0.96, 0, 0.04, 1), bez98: bezier(0.98, 0, 0.02, 1), bez995: bezier(0.995, 0, 0.005, 1),
};
function kfAt(m, d) {
  const dur = m.ms / 1000, reps = m.repeat || 1;
  if (d <= 0) return m.values[0];
  if (d >= dur * reps) return m.values[m.values.length - 1];
  let u = (d % dur) / dur;
  if (m.global) u = CURVES[m.global](u);
  const o = m.offsets;
  let k = 0;
  while (k < o.length - 2 && u >= o[k + 1]) k++;
  const span = o[k + 1] - o[k];
  const p = span > 0 ? (u - o[k]) / span : 1;
  const e = CURVES[Array.isArray(m.eases) ? m.eases[k] : m.eases];
  return m.values[k] + (m.values[k + 1] - m.values[k]) * e(p);
}
function springAt(m, d) {
  if (d <= 0) return m.x0 || 0;
  const w0 = Math.sqrt(m.k / m.m), z = m.c / (2 * Math.sqrt(m.k * m.m));
  const x0 = m.x0 || 0, v0 = m.v0 || 0;
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return Math.exp(-z * w0 * d) * (x0 * Math.cos(wd * d) + ((v0 + z * w0 * x0) / wd) * Math.sin(wd * d));
  }
  return Math.exp(-w0 * d) * (x0 + (v0 + w0 * x0) * d);
}
// a spring rests when |x| and |v| both tiny: snap to 0 then (as Motion does with restDelta)
function springRest(m, d) {
  const x = springAt(m, d), v = (springAt(m, d + 1e-4) - x) / 1e-4;
  return Math.abs(x) < (m.restDelta ?? 0.01) && Math.abs(v) < (m.restSpeed ?? 2);
}
const trackDur = (tr) => {
  const m = tr.model;
  if (m.type === "kf") return (tr.delayMs || 0) / 1000 + (m.ms / 1000) * (m.repeat || 1);
  for (let d = 0.05; d < 10; d += 1 / 240) if (springRest(m, d)) return (tr.delayMs || 0) / 1000 + d;
  return 10;
};
const durAll = Math.max(...CFG.tracks.map(trackDur));
function trackAt(tr, d) {
  const m = tr.model, dd = d - (tr.delayMs || 0) / 1000;
  if (m.type === "kf") return kfAt(m, dd);
  if (dd <= 0) return m.x0 || 0;
  const restAt = trackDur(tr) - (tr.delayMs || 0) / 1000;
  if (dd >= restAt) return m.nosnap ? springAt(m, restAt) : 0;
  return springAt(m, dd);
}
const els = CFG.tracks.map((tr) => document.getElementById(tr.name));
const hand = { presses: 0 };
let S;
function reset() { S = { t: 0, down: false, presses: 0, start: null }; }
function downAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
const playing = (t) => S.start !== null && t < S.start + durAll - 1e-9;
function trigger(t) { if (playing(t) || reduced) return; S.start = t; }
function step(h) {
  const end = S.t + h;
  if (seekMode) {
    const down = downAt(end * 1000);
    if (down && !S.down) trigger(end);
    S.down = down;
  } else if (hand.presses > S.presses) { S.presses = hand.presses; trigger(end); }
  S.t = end;
}
const value = (i) => { const tr = CFG.tracks[i]; return S.start === null ? tr.model.type === "kf" ? tr.model.values[0] : 0 : trackAt(tr, S.t - S.start); };
const values = () => Object.fromEntries(CFG.tracks.map((tr, i) => [tr.name, value(i)]));
const draw = () => els.forEach((el, i) => {
  const tr = CFG.tracks[i], x = value(i), p = tr.prop || "translateX";
  el.style.transform = p === "scale" ? `scale(${x})` : p === "rotate" ? `rotate(${x}deg)` : p === "skewX" ? `skewX(${x}deg)` : `${p}(${x}px)`;
});
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => ({ values: values(), events: {}, units: Object.fromEntries(CFG.tracks.map((tr) => [tr.name, tr.unit || "px"])) });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now;
    step(h);
    draw();
    if (playing(S.t)) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", () => { hand.presses++; wake(); });
  wake();
}
