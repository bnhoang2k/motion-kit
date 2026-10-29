// A choreo or sim page for the kind gate: a tap bobs two bars through their start, 0, -a, +a, 0 px (a quick bob, or a
// shake when `first` is +1), the second bar staggerMs after the first. The turns sit at a quarter and three quarters of
// the bob, as a swing's extremes do, so its middle leg, the whole swing, takes half the time ("quarters"), or at a
// third and two thirds, three evenly spaced keyframes, so each leg takes a third ("thirds"). A tap while it plays is
// ignored, and under reduced motion it does nothing, since a bob has no end state to show. Every motion step goes
// through step(h), so ?seek and the live loop run the same code. The bob is in MOTION: px (a), ms (the whole bob), ease
// (per leg: "ease", the CSS ease curve, "linear" or "sine", a half cosine, which a sim page's body moves by) and first
// (-1: the first leg goes up the screen, +1 down) and legs ("quarters" or "thirds": where the two turns sit).
// window.FAULT plants one fault in the second bar: "jump" (in the middle leg, 15% of the way in its first half, then one
// frame carries 67% of the whole swing, and the leg goes on smoothly), "set" (the value is set to a, in one frame, and
// stays there) or "dip" (a move from 0 to 4a that ends at 4a: a dip of 10% of the move, then one frame that covers 55%
// of it).
const FAULT = window.FAULT || "";
const MOTION = {
  px: 3,            // a: how far the first leg goes
  ms: 350,          // the whole bob
  ease: "ease",     // each leg's curve
  first: -1,        // -1: the first leg goes up the screen, +1: down
  legs: "quarters", // where the turns sit: "quarters" (25% and 75%) or "thirds" (33% and 67%)
  staggerMs: 120,   // between the first bar's start and the second's
  maxStepS: 0.05,   // the live loop caps one time step
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const BARS = 2;
const els = [...Array(BARS)].map((_, i) => document.getElementById(`b${i}`));
const hand = { presses: 0 };
// The CSS cubic-bezier easing for control points (x1, y1) (x2, y2).
function bezier(x1, y1, x2, y2) {
  const at = (a, b, s) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < p) lo = mid; else hi = mid; }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const CURVES = { ease: bezier(0.25, 0.1, 0.25, 1), linear: (p) => p, sine: (p) => (1 - Math.cos(Math.PI * p)) / 2 };
const ease = CURVES[MOTION.ease];
const dur = MOTION.ms / 1000;
// A bar's value d seconds after its start, with the planted fault (or none).
function bobAt(d, fault) {
  if (d <= 0) return 0;
  if (d >= dur) return fault === "set" ? MOTION.px : fault === "dip" ? 4 * MOTION.px : 0;
  const a = MOTION.px * MOTION.first;
  if (fault === "set") return MOTION.px;
  if (fault === "dip") {
    const p = d / dur;
    if (p < 0.25) return -0.1 * 4 * MOTION.px * ease(p / 0.25);
    return 4 * MOTION.px * (0.45 + 0.55 * ease((p - 0.25) / 0.75));
  }
  const u = d / dur;
  const t1 = MOTION.legs === "thirds" ? 1 / 3 : 0.25, t2 = 1 - t1;
  if (u < t1) return a * ease(u / t1);
  if (u >= t2) return -a * (1 - ease((u - t2) / t1));
  const p = (u - t1) / (t2 - t1);
  // The middle leg goes from a to -a.
  const q = fault === "jump" ? (p < 0.5 ? 0.15 * ease(2 * p) : 0.82 + 0.18 * ease(2 * p - 1)) : ease(p);
  return a - 2 * a * q;
}
let S;
function reset() {
  S = { t: 0, down: false, presses: 0, start: null };
}
function downAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
const starts = (i) => MOTION.staggerMs / 1000 * i;
const playing = (t) => S.start !== null && t < S.start + starts(BARS - 1) + dur - 1e-9;
function trigger(t) {
  if (playing(t) || reduced) return;
  S.start = t;
}
function step(h) {
  const end = S.t + h;
  if (seekMode) {
    const down = downAt(end * 1000);
    if (down && !S.down) trigger(end);
    S.down = down;
  } else if (hand.presses > S.presses) {
    S.presses = hand.presses;
    trigger(end);
  }
  S.t = end;
}
const value = (i) => (S.start === null ? 0 : bobAt(S.t - S.start - starts(i), i === BARS - 1 ? FAULT : ""));
const values = () => Object.fromEntries(els.map((_, i) => [`b${i}`, value(i)]));
const draw = () => els.forEach((el, i) => { el.style.transform = `translateY(${value(i)}px)`; });
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
const rectOf = (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
window.__state = () => ({ values: values(), events: {}, units: Object.fromEntries(els.map((_, i) => [`b${i}`, "px"])), ...(window.OBJECTS ? { objects: Object.fromEntries(els.map((el, i) => [`b${i}`, { box: rectOf(el), moves: [`b${i}`] }])) } : {}) });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
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
