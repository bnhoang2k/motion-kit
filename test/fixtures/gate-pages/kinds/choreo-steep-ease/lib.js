window.bez = function (x1, y1, x2, y2) {
  const at = (a, b, s) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
  return (p) => {
    if (p <= 0) return 0; if (p >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < p) lo = mid; else hi = mid; }
    return at(y1, y2, (lo + hi) / 2);
  };
};
window.clamp01 = (p) => Math.min(1, Math.max(0, p));
// tween from a to b over ms after delay ms with ease e
window.tw = (a, b, ms, e, delay = 0) => (d) => a + (b - a) * e(clamp01((d * 1000 - delay) / ms));
window.E = {
  expoInOut: (p) => p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
  expoOut: (p) => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p),
  expoIn: (p) => p <= 0 ? 0 : Math.pow(2, 10 * p - 10),
  circInOut: (p) => (p < 0.5 ? (1 - Math.sqrt(1 - 4 * p * p)) / 2 : (Math.sqrt(1 - (-2 * p + 2) ** 2) + 1) / 2),
  linear: (p) => p,
};
// keyframes: offsets, values, per-segment ease
window.kf = (ms, offs, vals, ease, delay = 0, reps = 1) => (d) => {
  let t = d * 1000 - delay;
  if (t <= 0) return vals[0];
  if (t >= ms * reps) return vals[vals.length - 1];
  const u = (t % ms) / ms;
  let k = 0; while (k < offs.length - 2 && u >= offs[k + 1]) k++;
  const span = offs[k + 1] - offs[k];
  const p = span > 0 ? (u - offs[k]) / span : 1;
  const e = Array.isArray(ease) ? ease[k] : ease;
  return vals[k] + (vals[k + 1] - vals[k]) * e(p);
};
// A ball dropped from rest `h` px above the floor, gravity g px/s^2, restitution e, integrated with semi-implicit Euler
// at a fixed step of 1/hz s; only whole steps are taken (no interpolation). Returns y (0 = start, h = floor).
window.ballFixed = (h, g, e, hz, rest = 60) => (d) => {
  const n = Math.floor(d * hz + 1e-6), dt = 1 / hz;
  let y = 0, v = 0, resting = false;
  for (let i = 0; i < n && !resting; i++) {
    v += g * dt; y += v * dt;
    if (y >= h) { y = h; v = -v * e; if (Math.abs(v) < rest) { v = 0; resting = true; } }
  }
  return y;
};
// The same ball, analytic (exact at every time).
window.ballExact = (h, g, e, rest = 60) => (d) => {
  let t = d, y0 = 0, v = 0, first = true;
  // first fall
  const tf = Math.sqrt(2 * h / g);
  if (t <= tf) return 0.5 * g * t * t;
  t -= tf; let vu = Math.sqrt(2 * g * h) * e;
  while (vu >= rest) {
    const air = 2 * vu / g;
    if (t <= air) return h - (vu * t - 0.5 * g * t * t);
    t -= air; vu *= e;
  }
  return h;
};
// A hand-written spring toward `to`, semi-implicit Euler, one fixed 1/60 step per frame, whole frames only.
window.springWhole = (to, k, c, delayMs = 0, rest = 0.05) => (d) => {
  const n = Math.floor((d * 1000 - delayMs) * 60 / 1000 + 1e-6), dt = 1 / 60;
  let x = 0, v = 0;
  for (let i = 0; i < n; i++) { v += (k * (to - x) - c * v) * dt; x += v * dt; if (Math.abs(to - x) < rest && Math.abs(v) < rest * 10) { x = to; break; } }
  return x;
};
// The same spring, stepping the part of a frame too (the contract's shorter step), so it moves inside a frame.
window.springPart = (to, k, c, delayMs = 0, rest = 0.05) => (d) => {
  const ms = d * 1000 - delayMs; if (ms <= 0) return 0;
  const n = Math.floor(ms * 60 / 1000 + 1e-6), dt = 1 / 60, r = ms / 1000 - n / 60;
  let x = 0, v = 0, done = false;
  for (let i = 0; i < n; i++) { v += (k * (to - x) - c * v) * dt; x += v * dt; if (Math.abs(to - x) < rest && Math.abs(v) < rest * 10) { x = to; done = true; break; } }
  if (!done && r > 1e-9) { v += (k * (to - x) - c * v) * r; x += v * r; }
  return x;
};
