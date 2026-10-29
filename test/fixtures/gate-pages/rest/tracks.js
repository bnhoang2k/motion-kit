// A page of timed tracks and a loop. The page defines MOTION before this script:
//   kind: "live" | "choreo" | "sim" | "scroll"
//   tracks: [[name, unit, [[startS, durS, from, to, ease], ...]], ...]  timed from the cause
//           (live: the release; choreo/sim: the first press; scroll: the first scroll change)
//   loop: null or { name, unit, base, amp, periodS, from: "load" | "cause", startS }
//   pause: "all" (the whole clock stops off screen) | "loop" (only the loop's clock stops)
//   gaps: "tick" (rAF runs through gaps in the timeline) | "timer" (rAF sleeps in gaps; a timer wakes it) | "stall"
//         (rAF sleeps in gaps and nothing wakes it: the live page never plays the track after a gap)
//   mount: { name: s } a track's value is reported only from s after the cause (it is mounted then)
//   omega, zeta, restPx: the live release spring; smoothS: the scroll smoothing; maxStepS
const M = MOTION;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const CX = 640, CY = 360;
const ease = {
  out: (p) => 1 - (1 - p) ** 3,
  inout: (p) => (1 - Math.cos(Math.PI * p)) / 2,
  lin: (p) => p,
  outq: (p) => 1 - (1 - p) ** 2,
};
const clamp = (p) => Math.min(1, Math.max(0, p));
function segAt(segs, d) {
  let v = segs[0][2];
  for (const [s, dur, from, to, e] of segs) {
    if (d < s) break;
    if (e === "spring") {
      // a hand-written damped spring from `from` to `to`, M.segOmega rad/s, M.segZeta; snaps when within M.segRest
      const w = M.segOmega, z = M.segZeta, wd = w * Math.sqrt(1 - z * z), u = d - s;
      const k = Math.exp(-z * w * u) * (Math.cos(wd * u) + ((z * w) / wd) * Math.sin(wd * u));
      v = Math.abs((from - to) * k) < M.segRest && Math.exp(-z * w * u) * Math.abs(from - to) < M.segRest ? to : to + (from - to) * k;
    } else v = from + (to - from) * ease[e](dur > 0 ? clamp((d - s) / dur) : 1);
  }
  return v;
}
const trackEnd = () => Math.max(0, ...M.tracks.flatMap(([, , segs]) => segs.map(([s, dur, , , e]) => s + (e === "spring" ? M.springSettleS : dur))));
function pointerAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  if (!p) return { down: false, x: 0, y: 0, n: 0 };
  return { down: p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6, x: p[1], y: p[2] };
}
function scrollAt(ms) {
  let y = 0;
  for (const [t, v] of window.__input || []) if (t <= ms + 1e-6) y = v;
  return y;
}
const hand = { down: false, x: 0, y: 0 };
let S;
function reset() {
  S = { t: 0, down: false, x: 0, y: 0, vx: 0, vy: 0, spring: false, cT: null, loopT: 0, visible: true, p: 0, lastScroll: 0 };
}
function loopOn() {
  const L = M.loop;
  if (!L || reduced) return false;
  if (L.from === "load") return S.t >= (L.startS || 0);
  return S.cT !== null && S.t >= S.cT + (L.startS || 0);
}
function step(h) {
  S.t += h;
  const ms = S.t * 1000;
  if (M.kind === "live") {
    const p = seekMode ? pointerAt(ms) : hand;
    if (p.down) {
      const nx = p.x - CX, ny = p.y - CY;
      if (S.down && h > 0) { S.vx = (nx - S.x) / h; S.vy = (ny - S.y) / h; }
      S.x = nx; S.y = ny; S.spring = false;
    } else if (S.down) {
      S.cT = S.t; S.spring = true;
      if (reduced) { S.x = 0; S.y = 0; S.spring = false; }
    }
    S.down = p.down;
    if (S.spring && h > 0) {
      const w = M.omega, z = M.zeta, k = Math.ceil(h * M.substepsPerS), dt = h / k;
      for (let i = 0; i < k; i++) {
        S.vx += (-w * w * S.x - 2 * z * w * S.vx) * dt; S.x += S.vx * dt;
        S.vy += (-w * w * S.y - 2 * z * w * S.vy) * dt; S.y += S.vy * dt;
      }
      if (Math.hypot(S.x, S.y) < M.restPx && Math.hypot(S.vx, S.vy) < M.restPx * w) { S.x = 0; S.y = 0; S.vx = 0; S.vy = 0; S.spring = false; }
    }
  } else if (M.kind === "scroll") {
    const y = seekMode ? scrollAt(ms) : window.scrollY;
    if (S.cT === null && y !== 0) S.cT = S.t;
    if (reduced) S.p = y;
    else if (h > 0) { S.p += (y - S.p) * (1 - Math.exp(-h / M.smoothS)); if (Math.abs(y - S.p) < 0.01) S.p = y; }
  } else {
    const p = seekMode ? pointerAt(ms) : { down: hand.presses > 0 };
    if (p.down && S.cT === null) S.cT = S.t;
  }
  if (loopOn() && (S.visible || M.pause === "all")) S.loopT += h;
}
function values() {
  const out = {};
  if (M.kind === "live") { out.x = S.x; out.y = S.y; }
  if (M.kind === "scroll") out.p = S.p;
  for (const [n, , segs] of M.tracks) {
    const d = S.cT === null ? -1 : S.t - S.cT;
    if (M.mount && M.mount[n] !== undefined && (S.cT === null || (!reduced && d < M.mount[n]))) continue;
    out[n] = reduced ? (S.cT === null ? segs[0][2] : segs[segs.length - 1][3]) : segAt(segs, d);
  }
  if (M.loop) {
    const L = M.loop;
    const w = (2 * Math.PI * S.loopT) / L.periodS;
    const shape = L.shape === "drift" ? (Math.sin(w) + Math.sin(w / M.drift)) / 2 : Math.sin(w);
    out[L.name] = L.base + (loopOn() ? L.amp * shape : 0);
  }
  return out;
}
const units = () => {
  const u = {};
  if (M.kind === "live") { u.x = "px"; u.y = "px"; }
  if (M.kind === "scroll") u.p = "px";
  for (const [n, unit] of M.tracks) u[n] = unit;
  if (M.loop) u[M.loop.name] = M.loop.unit;
  return u;
};
const els = {};
for (const n of Object.keys(units())) {
  const d = document.createElement("div");
  d.className = "b";
  d.style.cssText = `position:fixed;left:${120 + 90 * Object.keys(els).length}px;top:200px;width:60px;height:60px;background:#333;border-radius:12px`;
  document.body.appendChild(d);
  els[n] = d;
}
function draw() {
  const v = values(), u = units();
  for (const n of Object.keys(u)) {
    if (v[n] === undefined) continue;
    if (u[n] === "opacity") els[n].style.opacity = String(v[n]);
    else if (u[n] === "scale") els[n].style.transform = `scale(${v[n]})`;
    else if (u[n] === "deg") els[n].style.transform = `rotate(${v[n]}deg)`;
    else if (n === "x") els[n].style.transform = `translate(${v.x}px, ${v.y}px)`;
    else els[n].style.transform = `translateY(${v[n]}px)`;
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
window.__state = () => ({ values: values(), events: {}, units: units() });
reset();
draw();
if (!seekMode) {
  hand.presses = 0;
  let last = null, raf = 0, timer = 0;
  const end = trackEnd();
  const inSeg = (d) => M.tracks.some(([, , segs]) => segs.some(([s, dur, , , e]) => d >= s - 1e-9 && d < s + (e === "spring" ? M.springSettleS : dur)));
  const nextStart = (d) => Math.min(Infinity, ...M.tracks.flatMap(([, , segs]) => segs.map(([s]) => s).filter((s) => s > d + 1e-9)));
  const timeline = () => S.cT !== null && !reduced && S.t - S.cT < end;
  const loopRuns = () => loopOn() && S.visible;
  const scrolling = () => M.kind === "scroll" && Math.abs(window.scrollY - S.p) > 0;
  const waitingLoop = () => M.loop && !reduced && M.loop.from === "cause" && S.cT !== null && S.t < S.cT + (M.loop.startS || 0) && M.gaps === "tick";
  const busy = () => S.down || S.spring || scrolling() || loopRuns() || waitingLoop() || (timeline() && (M.gaps === "tick" || inSeg(S.t - S.cT)));
  const frame = (now) => {
    raf = 0;
    if (M.pause === "all" && !S.visible) return;
    const h = last === null ? 0 : Math.min((now - last) / 1000, M.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else {
      last = null;
      // in a gap of the timeline, sleep until the next segment starts, then jump the clock there
      if (timeline() && M.gaps === "timer") {
        const d = S.t - S.cT, n = nextStart(d);
        if (Number.isFinite(n)) timer = setTimeout(() => { timer = 0; S.t = S.cT + n; wake(); }, (n - d) * 1000); // motion-kit:clock
      }
      // a loop the cause starts after a delay: a timer starts it
      if (M.loop && !reduced && M.loop.from === "cause" && S.cT !== null && S.t < S.cT + (M.loop.startS || 0)) {
        const wait = S.cT + M.loop.startS - S.t;
        setTimeout(() => { S.t = S.cT + M.loop.startS; wake(); }, wait * 1000); // motion-kit:clock
      }
    }
  };
  const wake = () => { if (!raf && (S.visible || M.pause !== "all")) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", (e) => { hand.down = true; hand.presses++; hand.x = e.clientX; hand.y = e.clientY; wake(); });
  addEventListener("pointermove", (e) => { hand.x = e.clientX; hand.y = e.clientY; if (hand.down) wake(); });
  addEventListener("pointerup", () => { hand.down = false; wake(); });
  addEventListener("scroll", () => wake());
  const setVisible = (v) => {
    if (S.visible === v) return;
    S.visible = v;
    if (v) { last = null; wake(); }
    else if (M.pause === "all") { cancelAnimationFrame(raf); raf = 0; last = null; }
  };
  if (M.watch === "io") new IntersectionObserver((es) => setVisible(es[es.length - 1].isIntersecting)).observe(Object.values(els)[0]);
  else document.addEventListener("visibilitychange", () => setVisible(!document.hidden));
  wake();
}
