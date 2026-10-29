// A choreo page for the kind gate: a tap slides three bars 200 px right on an ease-out, each
// starting 120 ms after the one before. A tap during the sequence turns every bar back from where
// it is; a tap after it ends sends them back the same staggered way. Every motion step goes
// through step(h), so ?seek and the live loop run the same code. window.VARIANT "load" starts the
// sequence on load and ignores taps; "ignore" ignores a tap while the sequence plays; "cycle"
// steps through three stops (0, 200 and 400 px), and a tap during a sequence sends every bar on
// to the next stop, so a second trigger rests where a later tap would, not at the start or end;
// "pause" starts each bar 2.4 s after the one before, so the sequence holds still between bars
// and runs past 5 s; "shake" sends every bar out and back, ignores a tap while it plays, and
// does nothing under reduced motion, since a shake has no end state to show; "toast" slides every
// bar out, holds it there 1.5 s and slides it back, ignoring a tap while it plays, and under
// reduced motion shows the held state in one frame and leaves it in one frame when it would slide
// back. "rider" adds a close button, #close, that rides bar b0: its centre sits at the viewport's mid height
// and MOTION.rideFromPx plus b0 on x, and it shows once b0 has moved. A press on it, in ?seek judged
// against where it is drawn at the press's own time, is a close, not a tap: the bars go on to a dock at 100 px, from
// where they are, in every state, so the sequence rests there when the button is pressed, and the repeated press of the
// tap lands on the button only while it rides under the tap's spot.
// window.FAULT plants one fault: "snap-back" (a tap during the sequence jumps every bar back to
// the start and plays it again), "freeze" (a tap during the sequence stops every bar where it is),
// "one-onset" (every bar starts in the same frame), "raf-forever" (the live loop never stops),
// "reduced-ignored" (under reduced motion a tap does nothing), "reduced-preset" (under reduced
// motion the bars sit at the tap's end state from load, and a tap does nothing), "reduced-once"
// (under reduced motion only the first tap answers), "reduced-toast-skipped" (on the toast
// variant, under reduced motion a tap does nothing), "set-piece" (the last bar is set in one frame,
// not slid), "fade-rises" (an opacity o falls with the first tap, then rises again before it
// rests), "live-stalls" (the live loop sleeps when no bar is in flight, so on the pause variant it
// never plays the bars after the first), "creep" (the last bar slides for 20 s) or "rider-freeze" (on the rider
// variant, a press on the close button while the bars move stops them where they are; at rest it sends them back to
// the start).
const FAULT = window.FAULT || "";
const VARIANT = window.VARIANT || "";
const MOTION = {
  travelPx: 200,    // how far each bar slides
  slideS: 0.4,      // one bar's slide, on an ease-out
  staggerS: FAULT === "one-onset" ? 0 : VARIANT === "pause" ? 2.4 : 0.12, // between one bar's start and the next
  holdS: 1.5,       // the toast variant holds the bars out this long
  creepS: 20,       // the creep fault's last slide
  riseS: 0.2,       // the fade-rises fault's rise
  riseTo: 0.3,      // and where it rises to
  loadAtS: 0.1,     // the "load" variant starts this long after load
  maxStepS: 0.05,   // the live loop caps one time step
  closePx: 32,      // the rider variant's close button: its side
  rideFromPx: 509,  // and where its centre sits on x while b0 is 0 (it rides b0 from there, at y 360): 640, the tap's spot, at b0 131
  dockPx: 100,      // where a press on the close button sends the bars
};
const BARS = 3;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = [...Array(BARS)].map((_, i) => document.getElementById(`b${i}`));
const easeOut = (p) => 1 - (1 - p) ** 3;
// The live run counts presses, so a tap pressed and lifted inside one frame still lands.
const hand = { presses: 0, closes: 0 };
let S;
function reset() {
  S = { t: 0, down: false, presses: 0, closes: 0, target: 0, loaded: false, triggers: 0, oStart: null, segs: [...Array(BARS)].map(() => ({ from: 0, to: 0, start: 0, dur: 0 })) };
  // Under reduced motion a sequence the page starts by itself shows its end from the first frame.
  if (reduced && (VARIANT === "load" || FAULT === "reduced-preset")) {
    const to = MOTION.travelPx;
    Object.assign(S, { target: 1, loaded: true, segs: S.segs.map(() => ({ from: to, to, start: 0, dur: 0 })) });
  }
}
// A segment slides from `from` to `to`; a "back" segment goes out to `to` and comes back to `from`;
// a "hold" segment slides out to `to`, holds there `hold` s and slides back.
const endOf = (seg) => (seg.back || seg.hold !== undefined ? seg.from : seg.to);
function at(seg, t) {
  if (t <= seg.start) return seg.from;
  if (seg.hold !== undefined) {
    const back = seg.start + seg.dur + seg.hold;
    if (t >= back + seg.dur) return seg.from;
    if (t >= seg.start + seg.dur && t < back) return seg.to;
    const out = t < back;
    const p = Math.min(1, (t - (out ? seg.start : back)) / seg.dur);
    return out ? seg.from + (seg.to - seg.from) * easeOut(p) : seg.to + (seg.from - seg.to) * easeOut(p);
  }
  if (seg.dur <= 0 || t >= seg.start + seg.dur) return endOf(seg);
  const p = Math.min(1, (t - seg.start) / seg.dur);
  return seg.from + (seg.to - seg.from) * (seg.back ? Math.sin(Math.PI * p) ** 2 : easeOut(p));
}
// A back or hold segment starts and ends at the same value, so it plays until its time is up.
const playing = (t) => S.segs.some((g) => at(g, t) !== endOf(g) || (g.back && t < g.start + g.dur - 1e-9) || (g.hold !== undefined && t < g.start + 2 * g.dur + g.hold - 1e-9));
// Under ?seek the pointer comes from window.__input samples [ms, x, y] or [ms, x, y, down].
function sampleAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return p;
}
function downAt(ms) {
  const p = sampleAt(ms), s = window.__input || [];
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
// The rider variant's close button, as drawn when b0 is at `x`: a box, shown once b0 has moved.
const closeEl = VARIANT === "rider" ? document.getElementById("close") : null;
const closeBox = (t) => {
  const c = MOTION.rideFromPx + at(S.segs[0], t), h = MOTION.closePx / 2;
  return { x: c - h, y: 360 - h, on: at(S.segs[0], t) > 0.5 };
};
const hitsClose = (t, px, py) => {
  if (!closeEl) return false;
  const b = closeBox(t);
  return b.on && px >= b.x && px <= b.x + MOTION.closePx && py >= b.y && py <= b.y + MOTION.closePx;
};
// A press on the close button sends the bars on to the dock, from where they are, now or staggered.
function closePress(t) {
  S.triggers++;
  const mid = playing(t);
  const to = FAULT === "rider-freeze" ? 0 : MOTION.dockPx;
  S.target = to / MOTION.travelPx;
  S.segs = S.segs.map((g, i) => {
    const x = at(g, t);
    if (reduced) return { from: x, to, start: t, dur: 0 };
    if (mid && FAULT === "rider-freeze") return { from: x, to: x, start: t, dur: 0 };
    return { from: x, to, start: t + (mid ? 0 : i * MOTION.staggerS), dur: (MOTION.slideS * Math.abs(to - x)) / MOTION.travelPx };
  });
}
function trigger(t) {
  const mid = playing(t);
  if (mid && (VARIANT === "ignore" || VARIANT === "shake" || VARIANT === "toast")) return;
  if (reduced && (VARIANT === "shake" || FAULT === "reduced-ignored" || FAULT === "reduced-preset" || FAULT === "reduced-toast-skipped")) return;
  if (reduced && FAULT === "reduced-once" && S.triggers > 0) return;
  S.triggers++;
  if (FAULT === "fade-rises" && S.oStart === null) S.oStart = t;
  const now = S.segs.map((g) => at(g, t));
  if (VARIANT === "shake") {
    S.segs = now.map((x, i) => ({ from: x, to: x + MOTION.travelPx, start: t + i * MOTION.staggerS, dur: MOTION.slideS, back: true }));
    return;
  }
  if (VARIANT === "toast") {
    // Under reduced motion the held state shows until the bar would start to slide back.
    S.segs = now.map((x, i) => (reduced
      ? { from: x, to: x + MOTION.travelPx, start: t, dur: 0, hold: i * MOTION.staggerS + MOTION.slideS + MOTION.holdS }
      : { from: x, to: x + MOTION.travelPx, start: t + i * MOTION.staggerS, dur: MOTION.slideS, hold: MOTION.holdS }));
    return;
  }
  if (VARIANT === "cycle") {
    S.target = (S.target + 1) % 3;
    const to = S.target * MOTION.travelPx;
    S.segs = now.map((x, i) => (reduced ? { from: x, to, start: t, dur: 0 } : { from: x, to, start: t + (mid ? 0 : i * MOTION.staggerS), dur: (MOTION.slideS * Math.abs(to - x)) / MOTION.travelPx }));
    return;
  }
  S.target = S.target === 1 ? 0 : 1;
  const to = S.target * MOTION.travelPx;
  S.segs = now.map((x, i) => {
    if (reduced) return { from: x, to, start: t, dur: 0 };
    if (mid && FAULT === "freeze") return { from: x, to: x, start: t, dur: 0 };
    if (mid && FAULT === "snap-back") return { from: 0, to: MOTION.travelPx, start: t + i * MOTION.staggerS, dur: MOTION.slideS };
    if (mid) return { from: x, to, start: t, dur: (MOTION.slideS * Math.abs(to - x)) / MOTION.travelPx };
    const last = i === BARS - 1;
    const dur = last && FAULT === "set-piece" ? 0 : last && FAULT === "creep" ? MOTION.creepS : MOTION.slideS;
    return { from: x, to, start: t + i * MOTION.staggerS, dur };
  });
  if (mid && FAULT === "snap-back") S.target = 1;
}
function step(h) {
  const end = S.t + h;
  if (VARIANT === "load") {
    if (!S.loaded && end >= MOTION.loadAtS - 1e-9) { S.loaded = true; trigger(MOTION.loadAtS); }
  } else {
    if (seekMode) {
      const down = downAt(end * 1000);
      if (down && !S.down) {
        const p = sampleAt(end * 1000);
        if (hitsClose(p[0] / 1000, p[1], p[2])) closePress(end);
        else trigger(end);
      }
      S.down = down;
    } else if (hand.closes > S.closes) {
      S.closes = hand.closes;
      closePress(end);
    } else if (hand.presses > S.presses) {
      S.presses = hand.presses;
      trigger(end);
    }
  }
  S.t = end;
}
// The fade-rises fault's opacity: it falls straight over one slide from the first tap, then rises again.
function oAt(t) {
  if (S.oStart === null) return 1;
  if (reduced) return MOTION.riseTo;
  const d = t - S.oStart;
  if (d < MOTION.slideS) return 1 - d / MOTION.slideS;
  return MOTION.riseTo * Math.min(1, (d - MOTION.slideS) / MOTION.riseS);
}
const fading = (t) => FAULT === "fade-rises" && S.oStart !== null && !reduced && t < S.oStart + MOTION.slideS + MOTION.riseS;
const values = () => ({ ...Object.fromEntries(S.segs.map((g, i) => [`b${i}`, at(g, S.t)])), ...(FAULT === "fade-rises" ? { o: oAt(S.t) } : {}) });
function draw() {
  if (closeEl) {
    const b = closeBox(S.t);
    closeEl.style.cssText = `width:${MOTION.closePx}px;height:${MOTION.closePx}px;transform:translate(${b.x}px,${b.y}px);visibility:${b.on ? "visible" : "hidden"}`;
  }
  const v = values();
  els.forEach((el, i) => { el.style.transform = `translateX(${v[`b${i}`]}px)`; });
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
const units = { ...Object.fromEntries(els.map((_, i) => [`b${i}`, "px"])), ...(FAULT === "fade-rises" ? { o: "opacity" } : {}) };
// With window.OBJECTS, each bar is reported as an object that its value moves, its box read from the DOM after draw().
const rectOf = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
const objects = () => (window.OBJECTS ? { objects: Object.fromEntries(els.map((el, i) => [`b${i}`, { box: rectOf(el), moves: [`b${i}`] }])) } : {});
window.__state = () => ({ values: values(), events: {}, units, ...objects() });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const inFlight = (t) => S.segs.some((g) => t >= g.start - 1e-9 && t < g.start + g.dur);
  const busy = () => FAULT === "raf-forever" || (FAULT === "live-stalls" ? inFlight(S.t) : playing(S.t) || fading(S.t)) || (VARIANT === "load" && !S.loaded);
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("pointerdown", (e) => {
    if (hitsClose(S.t, e.clientX, e.clientY)) hand.closes++;
    else hand.presses++;
    wake();
  });
  wake();
}
