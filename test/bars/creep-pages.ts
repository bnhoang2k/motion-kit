import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * Pages for the loop sort's two guards: a loop that drifts a little each period is no loop, and a value that creeps at one
 * steady speed is a loop only when it moves the same with no input, or (with no input to name) from the
 * end of its lead-in. Each page keeps its numbers in a MOTION const and runs on a shared harness script in the fixtures.
 */

const HEAD = (kind: string, title: string, extra = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${kind}">
<title>${kind}: ${title}</title>
<style>html { background: #fff } body { margin: 0${extra} } .b { position: fixed; width: 40px; height: 40px; background: #333; border-radius: 50% }</style>
</head>
<body>
<script>
`;

/** A copy of the page in its own folder under `dir`, with the harness script `script` beside it. Returns the page's path. */
function write(dir: string, name: string, html: string, script: string): string {
  const out = path.join(dir, name);
  mkdirSync(out, { recursive: true });
  copyFileSync(path.join(PAGES, script), path.join(out, script));
  writeFileSync(path.join(out, "index.html"), html);
  return path.join(out, "index.html");
}

/**
 * A live page: a dot a drag moves 1:1. At the release it carries the hand's speed on, which decays at `decayPerS`. With
 * `minPxS` the speed never falls below it (a clamp that leaves the dot creeping for ever); with `stopPxS` it is set to 0
 * below it (the dot comes to rest).
 */
export type Fling = { decayPerS?: number; minPxS?: number; stopPxS?: number };

export function flingPage(dir: string, name: string, spec: Fling): string {
  const motion = JSON.stringify({ decayPerS: 4, minPxS: 0, stopPxS: 2, ...spec });
  const html = `${HEAD("live", name)}
const MOTION = ${motion};
const UNITS = { x: "px" };
const init = () => ({ x: 0, v: 0, down: false, gx: 0, px: 0, rel: false });
function step(S, h, p, reduced) {
  if (p.down && !S.down) { S.gx = S.x; S.px = p.x; S.rel = false; }
  if (p.down) { const nx = S.gx + p.x - S.px; if (h > 0) S.v = (nx - S.x) / h; S.x = nx; }
  else if (S.down) S.rel = true;
  if (!p.down && S.rel) {
    if (reduced) { S.v = 0; }
    else {
      S.v = Math.max(S.v * Math.exp(-MOTION.decayPerS * h), MOTION.minPxS);
      if (MOTION.minPxS === 0 && S.v < MOTION.stopPxS) S.v = 0;
      S.x += S.v * h;
    }
  }
  S.down = p.down;
}
const vals = (S) => ({ x: S.x });
const busy = (S) => S.down || (S.rel && S.v > 0 && !reduced);
</script>
<script src="live-state.js"></script>
</body>
</html>
`;
  return write(dir, name, html, "live-state.js");
}

/**
 * A scroll page: a scroll tick kicks a value `q` at `kickPxS`, which decays at `decayPerS` and, with `minPxS`, never falls
 * below that speed (it creeps for ever); with `stopPxS` it stops below it. Beside it the smoothed scroll position `p`.
 */
export type ScrollKick = { kickPxS?: number; decayPerS?: number; minPxS?: number; stopPxS?: number };

export function scrollKickPage(dir: string, name: string, spec: ScrollKick): string {
  const motion = JSON.stringify({ smoothS: 0.15, stepPx: 600, kickPxS: 400, decayPerS: 3, minPxS: 0, stopPxS: 1, ...spec });
  const html = `${HEAD("scroll", name, "; height: 3000px")}
const MOTION = ${motion};
const UNITS = { p: "px", q: "px" };
const init = (reduced) => ({ p: 0, q: 0, v: 0, lastY: 0, y: 0 });
function step(S, h, y, reduced) {
  S.y = y;
  if (reduced) { S.p = MOTION.stepPx * Math.round(y / MOTION.stepPx); return; }
  S.p += (y - S.p) * (1 - Math.exp(-h / MOTION.smoothS));
  if (Math.abs(y - S.p) < 0.01) S.p = y;
  if (y !== S.lastY) S.v = MOTION.kickPxS;
  S.lastY = y;
  if (S.v > 0) {
    S.v = Math.max(S.v * Math.exp(-MOTION.decayPerS * h), MOTION.minPxS);
    if (MOTION.minPxS === 0 && S.v < MOTION.stopPxS) S.v = 0;
    S.q += S.v * h;
  }
}
const vals = (S) => ({ p: S.p, q: S.q });
const busy = (S) => !reduced && (S.v > 0 || Math.abs(S.y - S.p) > 0.01);
</script>
<script src="scroll-state.js"></script>
</body>
</html>
`;
  return write(dir, name, html, "scroll-state.js");
}

/**
 * A choreo page on loop-load.js, which starts by itself: two bars slide in at load, and the page's own value
 * `valuesAfter(d)` (d seconds since the load) is a loop that runs on. With `tapSeq` the two bars wait for a tap, so the page answers input too. `motion` is the page's MOTION block, `units` its UNITS.
 */
export type LoadLoop = { motion: Record<string, number | string>; units: Record<string, string>; valuesAfter: string; tapSeq?: boolean };

export function loadLoopPage(dir: string, name: string, spec: LoadLoop): string {
  const motion = JSON.stringify({ slideS: 0.4, staggerS: 0.1, reducedAtS: 30, ...spec.motion, endS: "Infinity" }).replace('"Infinity"', "Infinity");
  const html = `${HEAD("choreo", name)}
window.LOAD = true;${spec.tapSeq ? " window.TAPSEQ = true;" : ""}
const MOTION = ${motion};
const UNITS = ${JSON.stringify(spec.units)};
${spec.valuesAfter}
</script>
<script src="loop-load.js"></script>
</body>
</html>
`;
  return write(dir, name, html, "loop-load.js");
}
