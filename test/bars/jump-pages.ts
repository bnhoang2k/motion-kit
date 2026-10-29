import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KindName } from "../../src/core/types.ts";

/**
 * Pages whose reported values are pure functions of the clock, for the checks that read motion between frames
 * (`suddenJumps`). A page is a `values(ms)` body that returns `{ name: number }`, written straight from the time it is
 * asked for, so a planted snap sits at an exact millisecond and a seek between two frames reads it there.
 *
 * The page defines these for the body to use: `F` (one frame, ms), `pointerX(ms)` and `pointerY(ms)` (the recorded
 * pointer's place, held from its latest sample), `scrollAt(ms)` (the recorded scroll position, held the same way),
 * the curves `lin`, `outCubic` and `inOut` (0 to 1 over 0 to 1), `tween(ms, start, dur, by, curve)`, and `spring(ms,
 * start, to, w, z)` (a damped spring to `to`, natural frequency w in rad/s, damping ratio z).
 */
export type JumpPage = {
  /** The body of `function values(ms)`. */
  body: string;
  kind?: KindName;
  /** The `units` the page reports. */
  units?: Record<string, string>;
  /** The page integrates whole frames only: a seek between two frames reads the frame before it, as a page that steps its own clock does. */
  wholeFrames?: boolean;
};

const PRELUDE = `
const F = 1000 / 60;
const clamp01 = (u) => Math.min(Math.max(u, 0), 1);
const lin = clamp01;
const outCubic = (u) => 1 - Math.pow(1 - clamp01(u), 3);
const inOut = (u) => { u = clamp01(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const tween = (ms, start, dur, by, curve) => by * curve((ms - start) / dur);
function spring(ms, start, to, w, z) {
  const s = Math.max(ms - start, 0) / 1000, a = z * w, d = w * Math.sqrt(1 - z * z);
  return to * (1 - Math.exp(-a * s) * (Math.cos(d * s) + (a / d) * Math.sin(d * s)));
}
const S = window.__input || [];
function sampleAt(ms) { let p = S.length ? S[0] : [0, 0, 0]; for (const s of S) if (s[0] <= ms + 1e-6) p = s; return p; }
const pointerX = (ms) => sampleAt(ms)[1];
const pointerY = (ms) => sampleAt(ms)[2];
const scrollAt = (ms) => sampleAt(ms)[1];
`;

/** The page's HTML for `spec`, titled `name`. */
export function jumpHtml(name: string, spec: JumpPage): string {
  const seekAt = spec.wholeFrames ? "Math.floor(ms / F + 1e-6) * F" : "ms";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${spec.kind ?? "idle"}">
<title>${name}</title>
<style>body { margin: 0 } #dot { width: 40px; height: 40px; border-radius: 50%; background: #333 }</style>
</head>
<body>
<div id="dot"></div>
<script>
${PRELUDE}
${spec.body}
let vals = {};
const dot = document.getElementById("dot");
window.__seek = (ms) => { vals = values(${seekAt}); dot.style.transform = "translateX(" + (Object.values(vals)[0] ?? 0) + "px)"; };
window.__state = () => ({ values: vals, events: {}, units: ${JSON.stringify(spec.units ?? {})} });
window.__seek(0);
</script>
</body>
</html>
`;
}

/** Writes the page under `dir` and returns its path. */
export function writeJumpPage(dir: string, name: string, spec: JumpPage): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.html`);
  writeFileSync(file, jumpHtml(name, spec));
  return file;
}

/** A pointer drag along x: from frame `startFrame`, `frames` frames of `pxPerFrame`, one sample a frame, as `[ms, x, y, down]`. */
export function dragSamples(startFrame: number, frames: number, pxPerFrame: number, x0 = 400): [number, number, number, 1][] {
  return Array.from({ length: frames + 1 }, (_, i): [number, number, number, 1] => [((startFrame + i) * 1000) / 60, x0 + i * pxPerFrame, 300, 1]);
}
