import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Pages that draw random values when a cause starts them (a burst, a shuffle, random gaps, a random tilt, a random delay
 * before a pop), on one engine and five scenes in fixtures/gate-pages/draws/. The page seeds its draws the way `?seek` does:
 * one seeded stream, the same in live play and under `?seek`, reseeded where each sequence starts (the scene calls `reseed()`).
 * `stream` plants the other pages: "other-seed" (the live run draws from another seed) and "unseeded" (the live run draws
 * from Math.random, the known limit).
 *
 * - `scatter`: chips fly out to random distances and stay (a live drag's release, a choreo tap, or a scroll starts it).
 * - `deck`: a tap cuts a deck of tiles by a random number of slots; each tile eases to its new slot, one after another.
 * - `gaps`: reply bubbles fade in one after another, each after a random gap; live, a timer starts each fade.
 * - `tilt`: a card springs out and settles at a random tilt; both springs overshoot.
 * - `pop`: a badge pops, on a spring that overshoots, after a random delay.
 */

const DRAWS = path.resolve(import.meta.dirname, "../fixtures/gate-pages/draws");

export type DrawsKind = "live" | "choreo" | "scroll";
export type DrawScene = "scatter" | "deck" | "gaps" | "tilt" | "pop";
export type Stream = "seeded" | "other-seed" | "unseeded";

export type Draws = {
  kind: DrawsKind;
  scene: DrawScene;
  /** The seed of the stream `?seek` draws from, and the live run too unless `stream` says otherwise. */
  seed?: number;
  stream?: Stream;
  /** The seed the live run draws from when `stream` is "other-seed". */
  liveSeed?: number;
  /** Any of the scene's own numbers. */
  motion?: Record<string, number>;
};

const SCENES: Record<DrawScene, { count: number; motion: Record<string, number> }> = {
  scatter: { count: 6, motion: { chips: 6, minPx: 80, maxPx: 240, flyS: 0.9 } },
  deck: { count: 4, motion: { tiles: 4, slotPx: 60, moveS: 0.5, staggerS: 0.08 } },
  gaps: { count: 3, motion: { bubbles: 3, gapMinS: 0.4, gapMaxS: 2.6, fadeS: 0.25 } },
  tilt: { count: 1, motion: { outPx: 200, cardHz: 2, cardZeta: 0.35, tiltDeg: 12, cardRest: 0.01 } },
  pop: { count: 1, motion: { delayMinS: 0.2, delayMaxS: 1.2, popHz: 2.5, popZeta: 0.45 } },
};

/** Writes the page for `d` into a new folder of `dir`, the engine and scene beside it, and gives its file. */
export function drawsPage(dir: string, name: string, d: Draws): string {
  const { count, motion: sceneMotion } = SCENES[d.scene];
  const out = mkdtempSync(path.join(dir, `${name}-`));
  for (const f of ["draws.js", `${d.scene}.js`]) cpSync(path.join(DRAWS, f), path.join(out, f));
  const motion = {
    kind: d.kind,
    seed: d.seed ?? 1,
    stream: d.stream ?? "seeded",
    liveSeed: d.liveSeed ?? 99,
    omega: 22.25,
    zeta: 0.84,
    restPx: 0.01,
    maxStepS: 0.05,
    smoothS: 1 / 6,
    triggerPx: 150,
    ...sceneMotion,
    ...d.motion,
  };
  const chips = Array.from({ length: count }, (_, i) => `<div class="c" style="top:${60 + i * 56}px"></div>`).join("");
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${d.kind}">
<title>${d.kind}: ${name}</title>
<style>html { background: #fff } body { margin: 0; ${d.kind === "scroll" ? "height: 4000px" : "min-height: 100vh"} } .c { position: fixed; left: 200px; width: 24px; height: 24px; border-radius: 50%; background: #c33 } #dot { position: fixed; left: 620px; top: 340px; width: 40px; height: 40px; border-radius: 50%; background: #333 } #bar { position: fixed; left: 40px; top: 20px; width: 80px; height: 20px; background: #246 }</style>
</head>
<body>
${d.kind === "live" ? '<div id="dot"></div>' : ""}${d.kind === "scroll" ? '<div id="bar"></div>' : ""}${chips}
<script>
const MOTION = ${JSON.stringify(motion)};
</script>
<script src="${d.scene}.js"></script>
<script src="draws.js"></script>
</body>
</html>
`,
  );
  return file;
}
