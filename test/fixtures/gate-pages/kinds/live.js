// A live page for the kind gate: a dot follows a drag one to one, and on release it springs back
// to its rest spot from the hand's speed. It fades in at load. Every motion step goes through
// step(h), so ?seek and the live loop run the same code. window.FAULT plants one fault; with
// window.VARIANT "hit-test", a press grabs only on the dot; with "slider-x", the dot is a
// horizontal slider knob that follows only x, and a press grabs only on it.
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
const MOTION = {
  enterS: 0.2,      // the fade in at load
  omega: 22.25,     // the release spring, rad/s
  zeta: 0.84,
  restPx: 0.01,     // the spring is at rest when less than this is left of its swing
  maxStepS: 0.05,   // the live loop caps one time step
  restAt: [640, 360], // the dot's center at rest, page px
  reachPx: 25,      // the hit test: a press this close to the dot's center grabs it
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot");
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
const hand = { down: false, x: 0, y: 0 };
let S;
function reset() {
  const stillO = FAULT === "reduced-blank" ? 0 : 1;
  S = { t: 0, x: 0, y: 0, vx: 0, vy: 0, o: reduced ? stillO : 0, down: false, grab: null, rel: null };
}
// Under ?seek the pointer comes from window.__input samples [ms, x, y] or [ms, x, y, down]: it sits
// at the latest sample, down unless that sample's down is 0, and up after the last sample.
function pointerAt(ms) {
  if (!seekMode) return hand;
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  if (!p) return { down: false, x: 0, y: 0 };
  return { down: p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6, x: p[1], y: p[2] };
}
function springAt(u, x0, v0) {
  const w = MOTION.omega, z = MOTION.zeta, wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * u) * (x0 * Math.cos(wd * u) + ((v0 + z * w * x0) / wd) * Math.sin(wd * u));
}
function swingLeft(u, x0, v0) {
  const w = MOTION.omega, z = MOTION.zeta, wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * u) * Math.hypot(x0, (v0 + z * w * x0) / wd);
}
// Whether a new press grabs: the hit test, and the fault that ignores a press while the dot settles.
function grabs(p) {
  if (FAULT === "regrab-ignored" && S.rel) return false;
  if (VARIANT !== "hit-test" && VARIANT !== "slider-x") return true;
  return Math.hypot(p.x - MOTION.restAt[0] - S.x, p.y - MOTION.restAt[1] - S.y) <= MOTION.reachPx;
}
function step(h) {
  const end = S.t + h;
  const raw = pointerAt(end * 1000);
  const p = raw.down && !S.down && !grabs(raw) ? { ...raw, down: false } : raw;
  if (p.down && !S.down) {
    // The regrab fault picks up from where the hand let go, not from where the dot is now.
    const from = FAULT === "regrab-jump" && S.rel ? S.rel : S;
    S.grab = { px: p.x, py: p.y, x: from.x, y: from.y };
    S.rel = null;
    S.vx = S.vy = 0;
  }
  if (p.down) {
    const k = FAULT === "no-follow" ? 0 : 1;
    const ky = VARIANT === "slider-x" ? 0 : k;
    const nx = S.grab.x + k * (p.x - S.grab.px), ny = S.grab.y + ky * (p.y - S.grab.py);
    if (h > 0) { S.vx = (nx - S.x) / h; S.vy = (ny - S.y) / h; }
    S.x = nx;
    S.y = ny;
  } else if (S.down) {
    const k = FAULT === "zero-release" ? 0 : 1;
    S.rel = { t: S.t, x: S.x, y: S.y, vx: k * S.vx, vy: k * S.vy };
  }
  S.down = p.down;
  if (!p.down && S.rel) {
    const u = end - S.rel.t, r = S.rel;
    const snap = reduced && FAULT !== "reduced-slow";
    if (snap || Math.max(swingLeft(u, r.x, r.vx), swingLeft(u, r.y, r.vy)) < MOTION.restPx) { S.x = S.y = 0; S.rel = null; }
    else { S.x = springAt(u, r.x, r.vx); S.y = springAt(u, r.y, r.vy); }
  }
  if (!reduced) S.o = eis(end / MOTION.enterS);
  S.t = end;
}
function draw() {
  dot.style.transform = `translate(${S.x}px, ${S.y}px)`;
  dot.style.opacity = String(S.o);
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor(ms * 60 / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => ({ values: { x: S.x, y: S.y, o: S.o }, events: {}, units: { x: "px", y: "px", o: "opacity" } });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const busy = () => FAULT === "loop-forever" || S.down || S.rel !== null || S.o < 1;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", (e) => { hand.down = true; hand.x = e.clientX; hand.y = e.clientY; wake(); });
  addEventListener("pointermove", (e) => { hand.x = e.clientX; hand.y = e.clientY; if (hand.down) wake(); });
  addEventListener("pointerup", () => { hand.down = false; wake(); });
  wake();
}
