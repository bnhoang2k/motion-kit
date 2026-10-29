// A tap (choreo/sim), drag (live) or scroll page whose cause starts a timed sequence of pieces, with
// optional loops, a creep, and live-loop behaviours (when the rAF stops, how it pauses and resumes off screen).
// All numbers live in MOTION (declared in the page). MOTION.pieces: [{ n, unit, from, to, at, dur }] in s after the
// cause (the release on a live page). MOTION.loops: [{ n, unit, amp, period, at, from: "load"|"cause" }].
// MOTION.creep: { n, unit, rate, at, accel } (a value that moves at rate/s, plus accel/s per s, forever from `at` s after the cause).
// MOTION.stop: "rest" | "never" | "late" | "first" (stop when pieces[0] is done) | "flight" (stop when no piece is mid-move).
// MOTION.late: s past the end for "late". MOTION.pause: true pauses off screen. MOTION.resume: "ok" | "once" | "none".
// MOTION.pauseOn: "both" | "vis" | "io". MOTION.liveFurther: the share each live move goes past (or, negative, short of) its ?seek end.
const seekMode = new URLSearchParams(location.search).has("seek");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const KIND = document.querySelector('meta[name="motion-kit-kind"]').content;
const pieces = MOTION.pieces || [];
const loops = MOTION.loops || [];
const easeOut = (p) => 1 - (1 - p) ** 3;
const hand = { presses: 0, down: false, x: 0, y: 0 };
let S;
function reset() { S = { sp: 0, sy: 0, frozenU: null, t: 0, cause: null, down: false, presses: 0, x0: 0, dx: 0, rel: null, dvx: 0, lastDx: 0 }; }
const seqEnd = () => Math.max(0, ...pieces.map((p) => p.at + p.dur));
function pieceAt(p, u) {
  if (u === null) return p.from;
  if (reduced) return p.to;
  if (u <= p.at) return p.from;
  if (p.dur <= 0) return p.to;
  const q = Math.min(1, (u - p.at) / p.dur);
  // MOTION.liveFurther: the live page draws each move this share further (or, negative, shorter) than ?seek does, as a page does
  // that draws its live values at random and a fixed stream under ?seek.
  const to = p.to + (!seekMode && MOTION.liveFurther ? (p.to - p.from) * MOTION.liveFurther : 0);
  return p.from + (to - p.from) * easeOut(q);
}
function loopAt(l) {
  const base = l.from === "load" ? S.t : S.cause === null ? null : S.t - S.cause;
  if (reduced || base === null || base < l.at) return 0;
  return (l.amp * (1 - Math.cos((2 * Math.PI * (base - l.at)) / l.period))) / 2;
}
const u = () => (S.cause === null ? null : S.frozenU !== null ? S.frozenU : S.t - S.cause);
function sampleAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return p;
}
function handAt(ms) {
  if (!seekMode) return hand;
  const s = window.__input || [];
  const p = sampleAt(ms);
  if (!p) return { down: false, x: 0, y: 0 };
  return { down: p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6, x: p[1], y: p[2] };
}
function scrollAt(ms) {
  if (!seekMode) return window.scrollY;
  let y = 0;
  for (const [t, v] of window.__input || []) if (t <= ms + 1e-6) y = v;
  return y;
}
function step(h) {
  const end = S.t + h;
  if (KIND === "scroll") {
    const y = scrollAt(end * 1000);
    S.sp = reduced ? y : S.sp + (y - S.sp) * (1 - Math.exp(-h / MOTION.smooth));
    if (Math.abs(y - S.sp) < MOTION.restPx) S.sp = y;
    if (y > 0 && S.cause === null) S.cause = end;
    S.sy = y;
    S.t = end;
    return;
  }
  const p = handAt(end * 1000);
  if (KIND === "live") {
    if (p.down && !S.down) { S.x0 = p.x - S.dx; S.rel = null; }
    if (p.down) { const nd = p.x - S.x0; S.dvx = h > 0 ? (nd - S.dx) / h : 0; S.dx = nd; }
    if (!p.down && S.down) { S.rel = { t: end, x: S.dx, v: S.dvx }; if (S.cause === null) S.cause = end; }
    if (!p.down && S.rel) {
      const w = MOTION.omega, r = (end - S.rel.t);
      S.dx = reduced ? 0 : Math.exp(-w * r) * (S.rel.x + (S.rel.v + w * S.rel.x) * r);
      if (Math.abs(S.dx) < MOTION.restPx) S.dx = 0;
    }
  } else {
    const down = seekMode ? p.down : hand.presses > S.presses;
    if (down && !S.down && S.cause === null) S.cause = end;
    if (!seekMode) S.presses = hand.presses;
  }
  S.down = p.down;
  S.t = end;
}
const values = () => {
  const out = {};
  if (KIND === "live") out.x = S.dx;
  if (KIND === "scroll") out.p = S.sp;
  for (const p of pieces) out[p.n] = pieceAt(p, u());
  for (const l of loops) out[l.n] = loopAt(l);
  if (MOTION.creep) { const c = MOTION.creep, d = u() === null || reduced ? 0 : Math.max(0, u() - c.at); out[c.n] = (c.base || 0) + d * c.rate + 0.5 * (c.accel || 0) * d * d; }
  return out;
};
const units = { x: "px", p: "px", ...Object.fromEntries([...pieces, ...loops, ...(MOTION.creep ? [MOTION.creep] : [])].map((p) => [p.n, p.unit])) };
function draw() {
  const v = values();
  for (const [n, val] of Object.entries(v)) {
    const el = document.getElementById(n);
    if (!el) continue;
    const un = units[n];
    if (un === "opacity") el.style.opacity = String(val);
    else if (un === "scale") el.style.scale = String(val);
    else if (un === "deg") el.style.rotate = `${val}deg`;
    else el.style.translate = `${val}px 0`;
  }
}
window.__seek = (ms) => {
  reset();
  const f = 1 / 60, total = ms / 1000;
  let n = Math.floor(total / f + 1e-9);
  for (let i = 0; i < n; i++) step(f);
  const rest = total - n * f;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => ({ values: values(), events: {}, units });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0, hidden = false, resumed = 0;
  const playing = () => S.cause !== null && u() < seqEnd() + 1e-9;
  const loopBusy = () => loops.some((l) => l.from === "load" || S.cause !== null);
  const liveBusy = () => (KIND === "live" && (S.down || (S.rel && S.dx !== 0))) || (KIND === "scroll" && S.sp !== window.scrollY);
  const inFlight = () => S.cause !== null && pieces.some((p) => u() >= p.at - 1e-9 && u() < p.at + p.dur);
  const loopStarted = () => loops.some((l) => { const b = l.from === "load" ? S.t : S.cause === null ? null : S.t - S.cause; return b !== null && b >= l.at; });
  const lateIgnore = () => MOTION.lateLoopIgnoresHidden && loopStarted();
  const busy = () => {
    if (hidden) return lateIgnore();
    if (MOTION.stop === "never") return true;
    if (liveBusy() || loopBusy() || (MOTION.creep && S.cause !== null)) return true;
    if (MOTION.stop === "late") return S.cause !== null && u() < seqEnd() + MOTION.late;
    if (MOTION.stop === "first") return S.cause !== null && u() < pieces[0].at + pieces[0].dur;
    if (MOTION.stop === "flight") return inFlight();
    return playing();
  };
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf && !hidden) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", (e) => { hand.presses++; hand.down = true; hand.x = e.clientX; hand.y = e.clientY; wake(); });
  addEventListener("pointermove", (e) => { hand.x = e.clientX; hand.y = e.clientY; wake(); });
  addEventListener("scroll", wake);
  addEventListener("pointerup", (e) => { hand.down = false; hand.x = e.clientX; hand.y = e.clientY; wake(); });
  const setHidden = (hd) => {
    if (!MOTION.pause) return;
    if (hd === hidden) return;
    hidden = hd;
    if (hd) { if (lateIgnore()) return; if (raf) cancelAnimationFrame(raf); raf = 0; last = null; return; }
    if (MOTION.resume === "ok") wake();
    else if (MOTION.resume === "once") { let k = MOTION.resumeFrames || 1; const f = () => { if (--k > 0) requestAnimationFrame(f); }; requestAnimationFrame(f); }
    else if (MOTION.resume === "loop-only") { if (S.cause !== null && S.frozenU === null) S.frozenU = S.t - S.cause; wake(); }
  };
  const pauseOn = MOTION.pauseOn || "both";
  if (pauseOn !== "io") document.addEventListener("visibilitychange", () => setHidden(document.hidden));
  if (pauseOn !== "vis") new IntersectionObserver((es) => setHidden(!es[es.length - 1].isIntersecting)).observe(document.getElementById("stage"));
  wake();
}
