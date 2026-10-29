import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openPage } from "../../src/gate/harness.ts";
import { ALL_RULES, type KindRule } from "../../src/gate/kind-gate.ts";
import { beatContext } from "./beat-pages.ts";

/**
 * A live or scroll page whose strip drifts at one steady speed forever while nobody touches it, as a marquee does. It
 * drifts from load (the speed eases in over `introS`, 0.5 s unless set), or from `startS` when that is set. A hand on the page holds it: on a live page a drag moves the
 * strip 1:1 (`d`, px), on a scroll page the scroll does, and the drift stops at once while the hand is down (live) or
 * the page is scrolled below the top (scroll). At the release the drift eases back to `speed` px/s over `easeS` (0.8 s unless set). The page
 * runs its clock for as long as it is on screen and pauses while it is hidden, unless `fault` says otherwise:
 *
 * - "no-pause": the loop ignores that the page is off screen.
 * - "wobbler": a second value `w` (px) swings forever as two waves that never line up, so it has no period, beside the steady drift.
 * - "slows": the drift slows from load with a time constant of `tauS` (3 s unless set), so it is no steady speed.
 * - "wobble-speed": the drift's speed wobbles by 20% (a 1.1 s swing), so it is no steady speed.
 * - "stops": after the release the strip stays still, and the clock runs on.
 */
export type Drift = { kind?: "live" | "scroll"; speed: number; tauS?: number; startS?: number; introS?: number; easeS?: number; fault?: "" | "no-pause" | "wobbler" | "slows" | "wobble-speed" | "stops" };

export function driftPage(dir: string, b: Drift): string {
  const out = mkdtempSync(path.join(dir, "drift-"));
  const m = { kind: "live", fault: "", ...b };
  const scroll = m.kind === "scroll";
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${m.kind}">
<title>${m.kind}: a strip that drifts, a hand that holds it</title>
<style>html { background: #fff } body { margin: 0${scroll ? "; height: 3000px" : ""}; overflow-x: hidden } #strip { position: fixed; left: 300px; top: 300px; width: 400px; height: 60px; background: #333 } #w { position: fixed; left: 300px; top: 420px; width: 40px; height: 40px; background: #888 }</style>
</head>
<body>
<div id="strip"></div><div id="w"></div>
<script>
const FAULT = ${JSON.stringify(m.fault)};
const SCROLL = ${scroll};
const M = {
  speed: ${m.speed},       // the drift, px/s
  startS: ${m.startS ?? 0},          // it starts to drift this long after load
  introS: ${m.introS ?? 0.5},             // it eases in from there over this long
  easeS: ${m.easeS ?? 0.8},              // ...and back after a release, over this long (cubic out)
  tauS: ${m.tauS ?? 3},            // FAULT "slows": the time constant
  wobble: 0.2,             // FAULT "wobble-speed": the speed swings by this share
  wobbleS: 1.1,            // ...every this long
  swingPx: 30,             // FAULT "wobbler": its swing
  maxStepS: 0.05,          // the live loop caps one time step
};
const seekMode = new URLSearchParams(location.search).has("seek");
const strip = document.getElementById("strip"), wob = document.getElementById("w");
const clamp01 = (p) => Math.min(1, Math.max(0, p));
const smooth = (p) => { p = clamp01(p); return p * p * (3 - 2 * p); };
const hand = { down: false, x: 0 };
let S;
function reset() { S = { t: 0, down: false, relAt: null, pos: 0, d: 0 }; }
// The input at ms: a pointer (down, x), or on a scroll page the scroll position (held while it is below the top).
function inputAt(ms) {
  const s = window.__input || [];
  if (SCROLL) {
    let y = 0;
    if (!seekMode) y = window.scrollY;
    else for (const q of s) if (q[0] <= ms + 1e-6) y = q[1];
    return { down: y > 0, pos: y };
  }
  if (!seekMode) return { down: hand.down, pos: hand.x };
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  if (!p) return { down: false, pos: 0 };
  return { down: p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6, pos: p[1] };
}
// The drift's speed at time t: eased in from load, or back after the release.
function speedAt(t) {
  const k = S.relAt === null ? smooth((t - M.startS) / M.introS) : FAULT === "stops" ? 0 : 1 - (1 - clamp01((t - S.relAt) / M.easeS)) ** 3;
  let v = M.speed * k;
  if (FAULT === "slows") v *= Math.exp(-t / M.tauS);
  if (FAULT === "wobble-speed") v *= 1 + M.wobble * Math.sin((2 * Math.PI * t) / M.wobbleS);
  return v;
}
function step(h) {
  const end = S.t + h, p = inputAt(end * 1000);
  if (p.down) { if (S.down) S.d += p.pos - S.pos; S.down = true; S.pos = p.pos; }
  else {
    if (S.down) { S.down = false; S.relAt = S.t; }
    S.d += speedAt(end) * h;
  }
  S.t = end;
}
// Two swings at 0.83 and 1.37 Hz, which do not repeat: the peaks are neither evenly spaced nor at one height.
const wobbler = () => M.swingPx * (0.6 * Math.sin(2 * Math.PI * 0.83 * S.t) + 0.4 * Math.sin(2 * Math.PI * 1.37 * S.t + 1));
function values() { return FAULT === "wobbler" ? { d: S.d, w: wobbler() } : { d: S.d }; }
function draw() {
  strip.style.transform = "translateX(" + (S.d % 1000) + "px)";
  if (FAULT === "wobbler") wob.style.transform = "translateX(" + wobbler() + "px)";
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor(ms * 60 / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
window.__state = () => ({ values: values(), events: {}, units: FAULT === "wobbler" ? { d: "px", w: "px" } : { d: "px" } });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, M.maxStepS);
    last = now;
    step(h);
    draw();
    if (FAULT === "no-pause" || !document.hidden) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf && (FAULT === "no-pause" || !document.hidden)) { last = null; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && FAULT !== "no-pause") { cancelAnimationFrame(raf); raf = 0; last = null; }
    else wake();
  });
  if (!SCROLL) {
    addEventListener("pointerdown", (e) => { hand.down = true; hand.x = e.clientX; });
    addEventListener("pointermove", (e) => { hand.x = e.clientX; });
    addEventListener("pointerup", () => { hand.down = false; });
  }
  wake();
}
</script>
</body>
</html>
`,
  );
  return file;
}

/**
 * The rules named by `names`, run on a drift page: the shared rules (ALL_RULES) and the page's own kind's `rules`, with
 * the kind's synthetic input. Each rule's lines, in the order the names come.
 */
export async function driftRulesOn(dir: string, b: Drift, names: string[]): Promise<string[]> {
  const kind = b.kind ?? "live";
  const { rules } = (await import(`../../kinds/${kind}/gate.ts`)) as { rules: KindRule[] };
  const ctx = beatContext(kind);
  const p = await openPage(driftPage(dir, b), { input: ctx.input!.samples });
  try {
    const out: string[] = [];
    for (const name of names) {
      const rule = [...ALL_RULES, ...rules].find((r) => r.name === name);
      out.push(...(rule ? await rule.check(p, ctx) : [`${name}: the ${kind} gate has no such rule`]));
    }
    return out;
  } finally {
    await p.close();
  }
}
