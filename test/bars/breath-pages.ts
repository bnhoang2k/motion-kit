import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A choreo page whose tap starts a loop: a breath, `1 + amp * sin(2 pi t / periodS)` on the picked item, faded in over
 * `fadeS`. The tap also slides the item (`x`, px) and fades its label in (`label`, opacity) a moment later, so the
 * sequence has two pieces to interrupt beside the loop. `introS` is a fade (`intro`, opacity) that plays from load:
 * the gate's tap waits for it, so it sets the tap's time (INPUT_START_MS, 250 ms, after the intro ends). A second tap
 * is ignored once the item is picked. Under reduced motion the item and label show their end at the tap, and the
 * breath holds still at 1. `lead` is a scale-up the tap starts (`leadS` long) that the breath rides on top of: the item
 * grows from 1 to 1 + lead, and breathes around its new size. With `idleUntilTap` the page runs no rAF until the tap, so the
 * loop is running only after the tap (needs `introS` 0): the gate's off-screen and resume rules must play the input first.
 *
 * Faults (`fault`): "damped" (the breath dies away and the page keeps its loop running), "drift" (its period grows each
 * cycle: no fixed period), "pops" (its loop is a sawtooth: one frame drops it back each cycle), "burst" (it breathes
 * three cycles and holds), and "burst-freeze" (the same, and a second tap while the item slides stops it where it is), and
 * "no-pause" (the loop keeps running while the page is off screen).
 */
export type Breath = { periodS?: number; amp?: number; introS?: number; fadeS?: number; lead?: number; idleUntilTap?: boolean };

export function breathPage(dir: string, b: Breath = {}, fault = ""): string {
  const out = mkdtempSync(path.join(dir, "choreo-breath-"));
  const motion = { periodS: 3.14, amp: 0.02, fadeS: 0.5, introS: 0, lead: 0, idleUntilTap: false, ...b };
  mkdirSync(out, { recursive: true });
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="choreo">
<title>choreo: a tap starts a breath</title>
<style>html { background: #fff } body { margin: 0 } #item { position: fixed; left: 10vw; top: 300px; width: 30vw; height: 60px; background: #333 } #label { position: fixed; left: 10vw; top: 380px; width: 30vw; height: 20px; background: #888 }</style>
</head>
<body>
<div id="item"></div><div id="label"></div>
<script>
const FAULT = ${JSON.stringify(fault)};
const IDLE_UNTIL_TAP = ${motion.idleUntilTap === true};
const MOTION = {
  periodS: ${motion.periodS}, // the breath's period
  amp: ${motion.amp},       // its swing, a share of the item's size
  fadeS: ${motion.fadeS},   // it fades in over this long from the tap
  introS: ${motion.introS}, // a fade from load that the gate's tap waits for
  lead: ${motion.lead},       // a scale-up from the tap that the breath rides on, a share of the item's size
  leadS: 0.4,
  slidePx: 120,             // the pick slides the item this far, on an ease-out
  slideS: 0.4,
  labelDelayS: 0.15,        // the label fades in this long after the tap
  labelS: 0.3,
  cycles: 3,                // the burst faults breathe this many cycles
  tauS: 1.5,                // the damped fault's decay
  growth: 0.2,              // the drift fault's period grows by this share each cycle
  maxStepS: 0.05,           // the live loop caps one time step
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const item = document.getElementById("item"), label = document.getElementById("label");
const clamp01 = (p) => Math.min(1, Math.max(0, p));
const smooth = (p) => { p = clamp01(p); return p * p * (3 - 2 * p); };
const easeOut = (p) => 1 - (1 - clamp01(p)) ** 3;
const hand = { presses: 0 };
let S;
function reset() { S = { t: 0, down: false, presses: 0, tapAt: null, frozenAt: null }; }
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
const sliding = (t) => S.tapAt !== null && t < S.tapAt + MOTION.labelDelayS + MOTION.labelS;
function trigger(t) {
  if (S.tapAt === null) { S.tapAt = t; return; }
  if (FAULT === "burst-freeze" && sliding(t) && S.frozenAt === null) S.frozenAt = t;
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
// The scale at d seconds from the tap: the lead-in scale-up, with the breath on top of it.
function breathAt(d) { return ride(d) + MOTION.lead * (reduced ? 1 : smooth(d / MOTION.leadS)); }
// The breath at d seconds from the tap, around 1.
function ride(d) {
  if (reduced) return 1;
  const w = (2 * Math.PI) / MOTION.periodS, fade = smooth(d / MOTION.fadeS);
  if (FAULT === "damped") return 1 + MOTION.amp * Math.sin(w * d) * fade * Math.exp(-d / MOTION.tauS);
  if (FAULT === "drift") {
    let start = 0, P = MOTION.periodS;
    while (start + P <= d) { start += P; P *= 1 + MOTION.growth; }
    return 1 + MOTION.amp * Math.sin((2 * Math.PI * (d - start)) / P) * fade;
  }
  if (FAULT === "pops") return 1 + MOTION.amp * (2 * ((d / MOTION.periodS) % 1) - 1) * fade;
  if (FAULT === "burst" || FAULT === "burst-freeze") return d > MOTION.cycles * MOTION.periodS ? 1 : 1 + MOTION.amp * Math.sin(w * d) * fade;
  return 1 + MOTION.amp * Math.sin(w * d) * fade;
}
function values() {
  const v = {};
  if (MOTION.introS > 0) v.intro = reduced ? 1 : smooth(S.t / MOTION.introS);
  if (S.tapAt === null) return { ...v, x: 0, label: 0, breath: 1 };
  const d = (S.frozenAt ?? S.t) - S.tapAt;
  return { ...v, x: reduced ? MOTION.slidePx : MOTION.slidePx * easeOut(d / MOTION.slideS), label: reduced ? 1 : smooth((d - MOTION.labelDelayS) / MOTION.labelS), breath: breathAt(d) };
}
function draw() {
  const v = values();
  item.style.transform = "translateX(" + v.x + "px) scale(" + v.breath + ")";
  label.style.opacity = String(v.label);
  if (v.intro !== undefined) document.body.style.opacity = String(0.5 + 0.5 * v.intro);
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
const units = { x: "px", label: "opacity", breath: "scale", ...(MOTION.introS > 0 ? { intro: "opacity" } : {}) };
window.__state = () => ({ values: values(), events: {}, units });
reset();
draw();
if (!seekMode) {
  // The live loop runs from load (a page keeps its clock going) and pauses while the page is hidden. The burst faults
  // stop it when their breath ends, as a page with no loop does.
  let last = null, raf = 0;
  const burst = FAULT === "burst" || FAULT === "burst-freeze";
  const busy = () => (IDLE_UNTIL_TAP && S.tapAt === null ? false : !burst || S.tapAt === null || S.t < S.tapAt + MOTION.cycles * MOTION.periodS + 0.5);
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if ((FAULT === "no-pause" || !document.hidden) && !raf) { last = null; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && FAULT !== "no-pause") { cancelAnimationFrame(raf); raf = 0; last = null; }
    else wake();
  });
  addEventListener("pointerdown", () => { hand.presses++; wake(); });
  wake();
}
</script>
</body>
</html>
`,
  );
  return file;
}
