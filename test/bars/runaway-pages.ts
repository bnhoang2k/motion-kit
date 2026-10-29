import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A choreo or sim page whose tap starts a value that never comes to rest, which the loop sort must not take for a loop:
 *
 * - choreo: a tween with no clamp. The tap moves `x` (px) on at `speed` px/s for ever.
 * - sim: a body thrown with too little friction. The tap throws `x` (px) at `speed` px/s and its speed decays with a time
 *   constant of `tauS` (none: no friction at all).
 *
 * Read for 15 s past the tap, its last 500 ms are at one steady speed, as a marquee's are, but the tap started it and it
 * was at rest before. `clampS`, when set, stops it that long after the tap: the honest page, a tween that ends and a body
 * that comes to rest. `introS` is a fade (`intro`, opacity) from load that the gate's tap waits for.
 */
export type Runaway = { kind: "choreo" | "sim"; speed: number; tauS?: number; clampS?: number; introS?: number };

export function runawayPage(dir: string, r: Runaway): string {
  const out = mkdtempSync(path.join(dir, `${r.kind}-runaway-`));
  const m = { introS: 0.25, tauS: 0, clampS: 0, ...r };
  mkdirSync(out, { recursive: true });
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${m.kind}">
<title>${m.kind}: a tap starts a value that never stops</title>
<style>html { background: #fff } body { margin: 0 } #item { position: fixed; left: 10vw; top: 300px; width: 30vw; height: 60px; background: #333 }</style>
</head>
<body>
<div id="item"></div>
<script>
const MOTION = {
  speed: ${m.speed},       // px/s
  tauS: ${m.tauS},         // the friction's time constant (sim); 0: none
  clampS: ${m.clampS},     // 0: none; else the value stops this long after the tap
  introS: ${m.introS},     // a fade from load that the gate's tap waits for
  maxStepS: 0.05,
};
const seekMode = new URLSearchParams(location.search).has("seek");
const item = document.getElementById("item");
const smooth = (p) => { p = Math.min(1, Math.max(0, p)); return p * p * (3 - 2 * p); };
const hand = { presses: 0 };
let S;
function reset() { S = { t: 0, down: false, presses: 0, tapAt: null }; }
function downAt(ms) {
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
}
function step(h) {
  const end = S.t + h;
  if (seekMode) {
    const down = downAt(end * 1000);
    if (down && !S.down && S.tapAt === null) S.tapAt = end;
    S.down = down;
  } else if (hand.presses > S.presses) {
    S.presses = hand.presses;
    if (S.tapAt === null) S.tapAt = end;
  }
  S.t = end;
}
function xAt(d) {
  if (MOTION.clampS > 0) d = Math.min(d, MOTION.clampS);
  return MOTION.tauS > 0 ? MOTION.speed * MOTION.tauS * (1 - Math.exp(-d / MOTION.tauS)) : MOTION.speed * d;
}
function values() {
  const v = { x: S.tapAt === null ? 0 : xAt(S.t - S.tapAt) };
  if (MOTION.introS > 0) v.intro = smooth(S.t / MOTION.introS);
  return v;
}
function draw() {
  const v = values();
  item.style.transform = "translateX(" + (v.x % 600) + "px)";
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
window.__state = () => ({ values: values(), events: {}, units: { x: "px", ...(MOTION.introS > 0 ? { intro: "opacity" } : {}) } });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    step(h);
    draw();
    // The clock runs while something moves: the intro, then the value from the tap (for ever, unless it is clamped).
    const busy = S.t < MOTION.introS + 0.1 || (S.tapAt !== null && (MOTION.clampS === 0 || S.t < S.tapAt + MOTION.clampS + 0.1));
    if (!document.hidden && busy) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!document.hidden && !raf) { last = null; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", wake);
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
