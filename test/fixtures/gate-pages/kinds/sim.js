// A sim page for the kind gate. A tap pushes ball A off a 200 px shelf: it falls under gravity,
// bounces on the floor with half its speed each time, and rests there. The same tap rolls ball B
// right at a steady speed until it passes the viewport edge, where the page stops moving it. A ring
// pulses forever (a loop) and pauses while the page is hidden. Every motion step goes through
// step(h), so ?seek and the live loop run the same code. window.VARIANT "load" starts on load,
// ignores taps, and lands ball A with no bounce: motion a page starts by itself may not overshoot.
// window.FAULT plants one fault: "bounce-rises" (each bounce leaves faster than it landed), "mid-kick" (one frame of extra push halfway down the first fall), "restart" (ball A
// hops again 500 ms after it rests), "slow-damping" (bounces lose too little to rest within 4 s),
// "no-body" (only a fade moves), "loop-no-pause" (the ring keeps running while hidden) or
// "glow-pop" (the fade value drops from 1 to 0 in one frame, 1 s after the tap) or "no-cap" (the live loop takes
// the whole time step, so a long frame gap throws the motion). window.VARIANT "tap-loop" runs no live loop until the
// tap lifts, and then only while something moves: the first live frame comes after the input has ended. It has no
// ring, since a page with no loop of its own has no idle rules to meet.
// A page with a tile (#t) reports a value t: a control that acts out the tap with a keyframe tween beside the bodies,
// 0, -a, +a, 0 px over tweenMs (or a shake, tweenFirst +1), its turns at a quarter and three quarters of the time
// (tweenLegs "quarters") or at a third and two thirds (evenly spaced keyframes, "thirds"), each leg on the curve
// tweenEase: "ease", "ease-in-out" or "linear", as CSS keyframes ease each segment. Under reduced motion it does
// nothing. FAULT "tween-pop" plants one frame that carries two thirds of its swing, "tween-snap" holds its far turn and snaps home at the end (half its swing), "tween-away" ends it a away from
// where it started, "tween-grows" swings its second turn twice as far as its first, and "tween-throw" throws it: it ends 200 px away, as a body that lands elsewhere.
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
const MOTION = {
  gravity: 2000,    // px/s², pulling ball A down
  shelfPx: 200,     // ball A's height above the floor before the tap
  bounce: FAULT === "bounce-rises" ? 1.3 : FAULT === "slow-damping" ? 0.825 : VARIANT === "load" ? 0 : 0.5, // speed kept at each bounce
  restSpeed: 60,    // px/s: a bounce slower than this rests
  ceilingPx: 400,   // ball A leaves the screen above this, and stops moving there
  rollSpeed: 800,   // px/s, ball B
  rollFrom: 900,    // ball B's start, page px
  edgePx: 1300,     // ball B stops moving past the viewport edge
  kickSpeed: 900,   // px/s: the mid-kick fault's extra push
  hopSpeed: 300,    // px/s: the restart fault's hop
  hopAfterS: 0.5,
  fadeS: 0.6,       // the no-body fault's fade
  glowAtS: 1,       // the glow-pop fault's drop
  ringPeriodS: 1.2, // the ring's pulse
  loadAtS: 0.1,     // the "load" variant starts this long after load
  maxStepS: FAULT === "no-cap" ? Infinity : 0.05, // the live loop caps one time step
  tweenPx: 3,       // a: how far the tile's first leg goes
  tweenMs: 350,     // the whole tween
  tweenEase: "ease", // each leg's curve
  tweenFirst: -1,   // -1: the first leg goes up the screen, +1: down
  tweenLegs: "quarters", // where the turns sit
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const [elA, elB, elRing, elFade, elT] = ["a", "b", "ring", "fade", "t"].map((id) => document.getElementById(id));
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
// The CSS names, as keys: "ease-in-out" is read as easeInOut (the audit keeps an easing's name out of the page's code).
const CURVES = { ease: bezier(0.25, 0.1, 0.25, 1), easeInOut: bezier(0.42, 0, 0.58, 1), linear: (p) => p };
const tweenEase = CURVES[MOTION.tweenEase.replace(/-(\w)/g, (_, c) => c.toUpperCase())];
// The tile's value d seconds after the tap lands, with the planted fault (or none).
function tweenAt(d) {
  const dur = MOTION.tweenMs / 1000;
  const a = MOTION.tweenPx * MOTION.tweenFirst;
  const home = FAULT === "tween-throw" ? 200 : FAULT === "tween-away" ? -a : 0;
  const lo = FAULT === "tween-grows" ? -2 * a : -a;
  if (d <= 0) return 0;
  if (d >= dur) return home;
  const [t1, t2] = MOTION.tweenLegs === "thirds" ? [1 / 3, 2 / 3] : [0.25, 0.75];
  const u = d / dur;
  if (u < t1) return a * tweenEase(u / t1);
  if (FAULT === "tween-snap" && u >= t2) return lo;
  if (u >= t2) return home === 0 ? lo * (1 - tweenEase((u - t2) / (1 - t2))) : -a + (a + home) * tweenEase((u - t2) / (1 - t2));
  const p = (u - t1) / (t2 - t1);
  const q = FAULT === "tween-pop" ? (p < 0.5 ? 0.15 * tweenEase(2 * p) : 0.82 + 0.18 * tweenEase(2 * p - 1)) : tweenEase(p);
  return a + (lo - a) * q;
}
const tile = () => (!elT || reduced || !S.launched ? 0 : tweenAt(S.t - S.startedAt));
// The live run counts presses, so a tap pressed and lifted inside one frame still lands.
const hand = { presses: 0 };
let S;
function reset() {
  S = { t: 0, down: false, presses: 0, started: false, startedAt: 0, launched: false, a: { h: MOTION.shelfPx, v: 0, flying: false, kicked: false, restAt: null, hopped: false }, bx: MOTION.rollFrom, rolling: false, fade: 1, fadeAt: null };
  // Under reduced motion motion a page starts by itself shows its end from the first frame.
  if (reduced && VARIANT === "load") Object.assign(S, { started: true, launched: true, bx: MOTION.edgePx, a: { ...S.a, h: 0 } });
}
function downAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
function start(t) {
  if (S.started) return;
  S.started = true;
  S.startedAt = t;
}
// The tap takes effect from the step after the frame it lands in, so that frame still shows the start.
function launch() {
  S.launched = true;
  if (FAULT === "no-body") { S.fadeAt = reduced ? -1 : S.t; if (reduced) S.fade = 0; return; }
  // Under reduced motion the tap shows the end state: ball A on the floor (above the screen when its bounces rise).
  if (reduced) { S.a.h = FAULT === "bounce-rises" ? MOTION.ceilingPx : 0; S.bx = MOTION.edgePx; if (FAULT === "glow-pop") S.fade = 0; return; }
  S.a.flying = true;
  S.rolling = true;
}
function stepA(t, h) {
  const a = S.a, g = MOTION.gravity;
  if (FAULT === "restart" && a.restAt !== null && !a.hopped && t + h >= a.restAt + MOTION.hopAfterS) { a.hopped = true; a.flying = true; a.v = MOTION.hopSpeed; }
  if (!a.flying) return;
  if (FAULT === "mid-kick" && !a.kicked && a.v < 0 && a.h < MOTION.shelfPx / 2) { a.kicked = true; a.v -= MOTION.kickSpeed; }
  let nh = a.h + a.v * h - (g * h * h) / 2, nv = a.v - g * h;
  if (nh > MOTION.ceilingPx) { a.h = MOTION.ceilingPx; a.flying = false; return; }
  if (nh <= 0 && nv < 0) {
    // The ball meets the floor in this step: it sits on the floor this frame and leaves at the next.
    const impact = Math.sqrt(a.v * a.v + 2 * g * a.h);
    nh = 0;
    nv = MOTION.bounce * impact;
    if (nv < MOTION.restSpeed) { a.flying = false; a.restAt = t + h; nv = 0; }
  }
  a.h = nh;
  a.v = nv;
}
function step(h) {
  const end = S.t + h;
  if (VARIANT === "load") {
    if (end >= MOTION.loadAtS - 1e-9) start(end);
  } else if (seekMode) {
    const down = downAt(end * 1000);
    if (down && !S.down) start(end);
    S.down = down;
  } else if (hand.presses > S.presses) {
    S.presses = hand.presses;
    start(end);
  }
  if (S.started && !S.launched && S.t >= S.startedAt - 1e-9 && h > 0) launch();
  if (S.launched && h > 0) {
    stepA(S.t, h);
    if (S.rolling) { S.bx += MOTION.rollSpeed * h; if (S.bx >= MOTION.edgePx) { S.bx = MOTION.edgePx; S.rolling = false; } }
    if (S.fadeAt !== null && S.fadeAt >= 0) S.fade = Math.max(0, 1 - (end - S.fadeAt) / MOTION.fadeS);
    if (FAULT === "glow-pop" && end >= S.startedAt + MOTION.glowAtS - 1e-9) S.fade = 0;
  }
  S.t = end;
}
const ring = (t) => (reduced || VARIANT === "tap-loop" ? 1 : 1 + 0.1 * Math.sin((2 * Math.PI * t) / MOTION.ringPeriodS));
const values = () => ({ a: S.a.h, b: S.bx, ring: ring(S.t), fade: S.fade, ...(elT ? { t: tile() } : {}) });
const busy = () => S.a.flying || S.rolling || (FAULT === "glow-pop" && S.fade > 0) || (S.fadeAt !== null && S.fade > 0) || (FAULT === "restart" && S.a.restAt !== null && !S.a.hopped);
function draw() {
  const v = values();
  elA.style.transform = `translateY(${-v.a}px)`;
  elB.style.transform = `translateX(${v.b - MOTION.rollFrom}px)`;
  // Past the edge the page culls ball B: it stops drawing it, and its value holds.
  elB.style.display = v.b >= MOTION.edgePx ? "none" : "";
  elRing.style.transform = `scale(${v.ring})`;
  elFade.style.opacity = String(v.fade);
  if (elT) elT.style.transform = `translateY(${v.t}px)`;
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
const units = { ...(FAULT === "no-body" ? { ring: "scale", fade: "opacity" } : { a: "px", b: "px", ring: "scale", fade: "opacity" }), ...(elT ? { t: "px" } : {}) };
window.__state = () => {
  const v = values();
  if (FAULT === "no-body") { delete v.a; delete v.b; }
  return { values: v, events: {}, units };
};
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    raf = (VARIANT === "tap-loop" ? busy() || !S.launched : !reduced || busy() || !S.launched) ? requestAnimationFrame(frame) : 0;
    if (!raf) last = null;
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  // "tap-loop" counts the press and starts its loop at the lift; its page has no loop before that.
  const tapLoop = VARIANT === "tap-loop";
  addEventListener(tapLoop ? "pointerup" : "pointerdown", () => { hand.presses++; wake(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (FAULT !== "loop-no-pause") { cancelAnimationFrame(raf); raf = 0; last = null; } }
    else if (!tapLoop || S.started) wake();
  });
  if (!tapLoop) wake();
}
