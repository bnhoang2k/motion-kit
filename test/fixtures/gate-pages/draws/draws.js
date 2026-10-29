// An engine for pages that draw random values when a cause starts them: the release of a drag (live), a tap (choreo) or the
// scroll passing MOTION.triggerPx (scroll). The page defines MOTION and window.SCENE = { init(S), begin(S, t), step(S, h, end),
// busy(S), values(S), units, draw(S) }; begin runs once, when the cause starts the sequence.
//
// The random stream: rand() draws from a seeded stream, MOTION.seed, the same under ?seek and live, and a scene calls
// reseed() where its sequence starts. MOTION.stream plants the other pages: "seeded" (the default), "other-seed" (live
// draws from MOTION.liveSeed instead), "unseeded" (live draws from Math.random).
const seekMode = new URLSearchParams(location.search).has("seek");
const KIND = MOTION.kind;
const SC = window.SCENE;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
window.reduced = reduced;
window.live = !seekMode;
// A tween's progress after u s, over dur s; under reduced motion it is done at once.
window.prog = (u, dur) => (reduced ? (u >= 0 ? 1 : 0) : Math.min(1, Math.max(0, u / dur)));
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let stream = seeded(MOTION.seed);
window.reseed = () => {
  const how = seekMode ? "seeded" : MOTION.stream || "seeded";
  stream = how === "unseeded" ? null : seeded(how === "other-seed" ? MOTION.liveSeed : MOTION.seed);
};
window.rand = () => (stream ? stream() : Math.random());

const hand = { down: false, x: 0, y: 0, presses: 0 };
const dot = document.getElementById("dot");
const bar = document.getElementById("bar");
let S;
function reset() {
  reseed();
  S = { t: 0, x: 0, y: 0, vx: 0, vy: 0, p: 0, target: 0, down: false, grab: null, rel: null, began: false, presses: 0 };
  SC.init(S);
}
function inputAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return { sample: p, last: s.length ? s[s.length - 1][0] : 0 };
}
function springAt(u, x0, v0) {
  const w = MOTION.omega, z = MOTION.zeta, wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * u) * (x0 * Math.cos(wd * u) + ((v0 + z * w * x0) / wd) * Math.sin(wd * u));
}
function swingLeft(u, x0, v0) {
  const w = MOTION.omega, z = MOTION.zeta, wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * u) * Math.hypot(x0, (v0 + z * w * x0) / wd);
}
function begin(t) { if (!S.began) { S.began = true; SC.begin(S, t); } }
function stepLive(h, end) {
  const { sample, last } = inputAt(end * 1000);
  const p = seekMode ? (sample ? { down: sample[3] !== 0 && end * 1000 <= last + 1e-6, x: sample[1], y: sample[2] } : { down: false, x: 0, y: 0 }) : hand;
  if (p.down && !S.down) { S.grab = { px: p.x, py: p.y, x: S.x, y: S.y }; S.rel = null; S.vx = S.vy = 0; }
  if (p.down) {
    const nx = S.grab.x + (p.x - S.grab.px), ny = S.grab.y + (p.y - S.grab.py);
    if (h > 0) { S.vx = (nx - S.x) / h; S.vy = (ny - S.y) / h; }
    S.x = nx; S.y = ny;
  } else if (S.down) {
    S.rel = { t: S.t, x: S.x, y: S.y, vx: S.vx, vy: S.vy };
    begin(S.t);
  }
  S.down = p.down;
  if (!p.down && S.rel) {
    const u = end - S.rel.t, r = S.rel;
    if (reduced || Math.max(swingLeft(u, r.x, r.vx), swingLeft(u, r.y, r.vy)) < MOTION.restPx) { S.x = 0; S.y = 0; S.rel = null; }
    else { S.x = springAt(u, r.x, r.vx); S.y = springAt(u, r.y, r.vy); }
  }
}
function stepChoreo(h, end) {
  if (seekMode) {
    const { sample, last } = inputAt(end * 1000);
    const d = !!sample && sample[3] !== 0 && end * 1000 <= last + 1e-6;
    if (d && !S.down) begin(end);
    S.down = d;
  } else if (hand.presses > S.presses) { S.presses = hand.presses; begin(end); }
}
function stepScroll(h, end) {
  if (seekMode) { S.target = 0; for (const [t, v] of window.__input || []) if (t <= end * 1000 + 1e-6) S.target = v; }
  else S.target = window.scrollY;
  S.p = reduced ? S.target : S.p + (S.target - S.p) * (1 - Math.exp(-h / MOTION.smoothS));
  if (Math.abs(S.target - S.p) < MOTION.restPx) S.p = S.target;
  if (S.p >= MOTION.triggerPx) begin(end);
}
function step(h) {
  const end = S.t + h;
  (KIND === "live" ? stepLive : KIND === "choreo" ? stepChoreo : stepScroll)(h, end);
  SC.step(S, h, end);
  S.t = end;
}
function draw() {
  if (dot) dot.style.transform = `translate(${S.x}px, ${S.y}px)`;
  if (bar) bar.style.transform = `translateX(${S.p}px)`;
  SC.draw(S);
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => ({
  values: { ...(KIND === "live" ? { x: S.x, y: S.y } : KIND === "scroll" ? { p: S.p } : {}), ...SC.values(S) },
  events: {},
  units: { ...(KIND === "live" ? { x: "px", y: "px" } : KIND === "scroll" ? { p: "px" } : {}), ...SC.units },
});
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const busy = () => S.down || S.rel !== null || S.p !== S.target || SC.busy(S);
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  window.__wake = wake;
  if (KIND === "live") {
    addEventListener("pointerdown", (e) => { hand.down = true; hand.x = e.clientX; hand.y = e.clientY; wake(); });
    addEventListener("pointermove", (e) => { hand.x = e.clientX; hand.y = e.clientY; if (hand.down) wake(); });
    addEventListener("pointerup", () => { hand.down = false; wake(); });
  } else if (KIND === "choreo") addEventListener("pointerdown", () => { hand.presses++; wake(); });
  else addEventListener("scroll", wake);
}
