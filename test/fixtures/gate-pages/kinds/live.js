// A live page for the kind gate: a dot follows a drag one to one, and on release it springs back
// to its rest spot from the hand's speed. It fades in at load. Every motion step goes through
// step(h), so ?seek and the live loop run the same code. window.FAULT plants one fault; with
// window.VARIANT "hit-test", a press grabs only on the dot; with "slider-x", the dot is a
// horizontal slider knob that follows only x, and a press grabs only on it. The fault
// "opacity-overshoot" dims the dot to 0.5 on release, passing 0.5 and coming back. With window.STEP
// "grid", the dot is drawn on a 20 px grid (window.GRID_PX sets another): x and y jump from cell to cell as the hand
// drags it, and the page reports the dot as an object that x, y and o move. The fault "jump-ahead" moves the dot 100 px
// further right than the hand 300 ms into the first drag (window.AHEAD_AFTER_S sets another time), and keeps it that
// far ahead. With window.OBJECTS, a smooth dot is reported as an object too. With window.STEP "twos", the dot is drawn on twos: x and y show where it was at the start of each 1/30 s.
// VARIANT "thumb": a slider thumb that rests 120 px right of the press; a press anywhere jumps it to the press, and on
// release it springs back to its rest. VARIANT "springy": the dot chases the hand through its own spring (2 Hz,
// damping ratio 0.5) and, on release, settles where the hand let go. VARIANT "badge": a badge (#badge) that the page
// reports as an object b moves hops twice when the dot is first grabbed, drawn on twos: it does not follow the hand.
// Under reduced motion it holds lifted for as long as the hops last instead. The faults "minor-jump" moves the dot
// 100 px further down than the hand, the way the drag's dip goes, 300 ms into the first drag, and keeps it there;
// "settle-glitch" draws the dot 100 px off its place in the 3rd frame after the release, for that one frame;
// "badge-pop" draws the badge 72 px (3 of its lengths) higher in the third drawing from the first grab, for that one
// drawing; "blip" draws the dot one grid cell further right for the one frame 300 ms into the first drag.
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
const STEP = window.STEP || "";
const MOTION = {
  enterS: 0.2,      // the fade in at load
  omega: 22.25,     // the release spring, rad/s
  zeta: 0.84,
  restPx: 0.01,     // the spring is at rest when less than this is left of its swing
  maxStepS: 0.05,   // the live loop caps one time step
  restAt: [640, 360], // the dot's center at rest, page px
  reachPx: 25,      // the hit test: a press this close to the dot's center grabs it
  dim: 0.5,         // the opacity-overshoot fault: the opacity the dot dims to on release
  dimDipS: 0.04,    // it passes the dim by this time
  dimS: 0.07,       // and rests at it by this time
  gridPx: window.GRID_PX || 20, // STEP "grid": the cell size
  aheadPx: 100,     // the jump-ahead fault: how far the dot jumps ahead of the hand
  aheadAfterS: window.AHEAD_AFTER_S || 0.3, // ...this long into a drag
  twosS: 1 / 30,    // STEP "twos": one drawing per 1/30 s
  thumbPx: 120,     // VARIANT "thumb": the thumb rests this far right of the press
  springHz: 2,      // VARIANT "springy": the chase spring's frequency
  springZeta: 0.5,  // ...and its damping ratio
  glitchFrames: 3,  // FAULT "settle-glitch": the frame after the release it draws off
  hopPx: 16,        // VARIANT "badge": how high the badge hops
  hopS: 0.24,       // ...each hop's length
  hops: 2,          // ...and how many
  popPx: 72,        // FAULT "badge-pop": how much higher the badge is drawn
};
// Where the dot rests: its rest spot, or under VARIANT "thumb" 120 px right of the press.
const homeX = VARIANT === "thumb" ? MOTION.thumbPx : 0;
// What the page shows and reports: the dot's place, on the grid under STEP "grid".
const shown = (v) => (STEP === "grid" ? MOTION.gridPx * Math.round(v / MOTION.gridPx) : v);
const drawnStep = STEP === "grid" || STEP === "twos";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot");
const badge = document.getElementById("badge");
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
const hand = { down: false, x: 0, y: 0 };
let S;
function reset() {
  const stillO = FAULT === "reduced-blank" ? 0 : 1;
  S = { t: 0, x: homeX, y: 0, vx: 0, vy: 0, o: reduced ? stillO : 0, down: false, grab: null, rel: null, dimAt: null, tx: homeX, ty: 0, gx: 0, still: true, firstAt: null, b: 0, drawing: -1, dx: homeX, dy: 0, db: 0 };
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
    const thumb = VARIANT === "thumb";
    S.grab = { px: p.x, py: p.y, x: thumb ? p.x - MOTION.restAt[0] : from.x, y: thumb ? p.y - MOTION.restAt[1] : from.y, t: S.t, first: !S.grab };
    if (S.firstAt === null) S.firstAt = end;
    S.rel = null;
    S.vx = S.vy = 0;
  }
  if (p.down) {
    const k = FAULT === "no-follow" ? 0 : 1;
    const ky = VARIANT === "slider-x" ? 0 : k;
    const late = S.grab.first && end - S.grab.t >= MOTION.aheadAfterS - 1e-9;
    const ahead = FAULT === "jump-ahead" && late ? MOTION.aheadPx : 0;
    const down = FAULT === "minor-jump" && late ? MOTION.aheadPx : 0;
    S.gx = FAULT === "blip" && S.grab.first && Math.round((end - S.grab.t) * 60) === Math.round(MOTION.aheadAfterS * 60) ? MOTION.gridPx : 0;
    const nx = S.grab.x + k * (p.x - S.grab.px) + ahead, ny = S.grab.y + ky * (p.y - S.grab.py) + down;
    if (VARIANT === "springy") { S.tx = nx; S.ty = ny; }
    else {
      if (h > 0) { S.vx = (nx - S.x) / h; S.vy = (ny - S.y) / h; }
      S.x = nx;
      S.y = ny;
    }
  } else if (S.down && VARIANT === "springy") {
    // The springy dot settles where the hand let go: its target stays.
  } else if (S.down) {
    const k = FAULT === "zero-release" ? 0 : 1;
    S.rel = { t: S.t, x: S.x, y: S.y, vx: k * S.vx, vy: k * S.vy };
    if (FAULT === "opacity-overshoot" && S.dimAt === null) S.dimAt = S.t;
  }
  S.down = p.down;
  if (!p.down && S.rel) {
    const u = end - S.rel.t, r = S.rel;
    const snap = reduced && FAULT !== "reduced-slow";
    // On the grid, the spring rests once its swing stays inside the rest cell.
    const restPx = STEP === "grid" ? MOTION.gridPx / 2 : MOTION.restPx;
    if (snap || Math.max(swingLeft(u, r.x - homeX, r.vx), swingLeft(u, r.y, r.vy)) < restPx) { S.x = homeX; S.y = 0; S.rel = null; }
    else { S.x = homeX + springAt(u, r.x - homeX, r.vx); S.y = springAt(u, r.y, r.vy); }
    S.gx = FAULT === "settle-glitch" && Math.round(u * 60) === MOTION.glitchFrames ? MOTION.aheadPx : 0;
  } else if (!p.down) S.gx = 0;
  if (VARIANT === "springy" && h > 0) {
    // A spring toward the hand (semi-implicit Euler), at rest once it is within restPx and nearly still.
    const w = 2 * Math.PI * MOTION.springHz, z = MOTION.springZeta;
    if (!reduced) {
      S.vx += (w * w * (S.tx - S.x) - 2 * z * w * S.vx) * h;
      S.vy += (w * w * (S.ty - S.y) - 2 * z * w * S.vy) * h;
      S.x += S.vx * h;
      S.y += S.vy * h;
    }
    S.still = reduced || (Math.hypot(S.tx - S.x, S.ty - S.y) < MOTION.restPx && Math.hypot(S.vx, S.vy) < MOTION.restPx);
    if (S.still) { S.x = S.tx; S.y = S.ty; S.vx = S.vy = 0; }
  }
  // The badge hops from the first grab; under reduced motion it holds lifted while the hops would last.
  const u = S.firstAt === null ? -1 : end - S.firstAt;
  const hop = u >= 0 && u < MOTION.hops * MOTION.hopS;
  S.b = VARIANT === "badge" && hop ? -MOTION.hopPx * (reduced ? 1 : Math.abs(Math.sin((Math.PI * u) / MOTION.hopS))) : 0;
  // STEP "twos" holds each place for one drawing (1/30 s), and the badge is always drawn on twos. The badge-pop fault
  // draws the third drawing from the first grab higher.
  const k = Math.floor(end / MOTION.twosS + 1e-6);
  if (k !== S.drawing) {
    S.drawing = k;
    S.dx = S.x;
    S.dy = S.y;
    const popped = FAULT === "badge-pop" && S.firstAt !== null && k - Math.floor(S.firstAt / MOTION.twosS + 1e-6) === 2;
    S.db = S.b - (popped ? MOTION.popPx : 0);
  }
  if (!reduced) S.o = eis(end / MOTION.enterS);
  if (S.dimAt !== null) {
    // From 1 down past the dim to 84% of the way below it, then back up to rest at the dim.
    const u = end - S.dimAt, m = MOTION, gap = 1 - m.dim;
    const g = reduced || u >= m.dimS ? 0 : u < m.dimDipS ? 1 - 1.16 * eis(u / m.dimDipS) : -0.16 * (1 - eis((u - m.dimDipS) / (m.dimS - m.dimDipS)));
    S.o = m.dim + gap * g;
  }
  S.t = end;
}
// Where the dot is drawn: on twos, or on the grid (the settle-glitch and blip faults draw one frame off).
const drawnX = () => (STEP === "twos" ? S.dx : shown(S.x + S.gx));
const drawnY = () => (STEP === "twos" ? S.dy : shown(S.y));
function draw() {
  dot.style.transform = `translate(${drawnX()}px, ${drawnY()}px)`;
  dot.style.opacity = String(S.o);
  if (badge) badge.style.transform = `translateY(${S.db}px)`;
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor(ms * 60 / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
// Under STEP "grid" or "twos" (or with window.OBJECTS) the dot's box is read from the DOM after draw(), so it is the box
// of the frame just drawn. A dot faded out is not drawn, and reports a box of 1 by 1. The badge's box is read the same way.
const boxOf = () => {
  const r = dot.getBoundingClientRect();
  return S.o <= 0 ? [r.x, r.y, 1, 1] : [r.x, r.y, r.width, r.height];
};
const badgeBox = () => { const r = badge.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
window.__state = () => ({
  values: { x: drawnX(), y: drawnY(), o: S.o, ...(badge ? { b: S.db } : {}) },
  events: {},
  units: { x: "px", y: "px", o: "opacity", ...(badge ? { b: "px" } : {}) },
  ...(drawnStep || window.OBJECTS ? { objects: { dot: { box: boxOf(), moves: ["x", "y", "o"] }, ...(badge ? { badge: { box: badgeBox(), moves: ["b"] } } : {}) } } : {}),
});
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const hopping = () => S.firstAt !== null && S.t - S.firstAt < MOTION.hops * MOTION.hopS + MOTION.twosS;
  const busy = () => FAULT === "loop-forever" || S.down || S.rel !== null || !S.still || (badge && hopping()) || (S.dimAt === null ? S.o < 1 : S.t - S.dimAt < MOTION.dimS);
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
