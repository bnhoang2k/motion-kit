import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * A keyframe model (keyframes.js): `offsets` and `values` are the keyframes, `eases` one curve for all legs or one for
 * each, `global` a curve for the whole run (a WAAPI or GSAP easing over the keyframes). Two equal offsets in a row are a
 * step. `repeat` runs it that many times.
 */
export type Keyframes = { type: "kf"; ms: number; offsets: number[]; values: number[]; eases: string | string[]; repeat?: number; global?: string };
export type Track = { name: string; unit?: string; prop?: "translateX" | "translateY" | "rotate" | "scale" | "skewX"; delayMs?: number; model: Keyframes };

export const kf = (ms: number, offsets: number[], values: number[], eases: string | string[], extra: { repeat?: number; global?: string } = {}): Keyframes => ({ type: "kf", ms, offsets, values, eases, ...extra });

/** Four tracks of one model, the second to fourth starting 70, 140 and 210 ms after the first: four phases inside a frame. */
export const phases = (model: Keyframes, extra: Partial<Track> = {}, n = 4, stepMs = 70): Track[] => Array.from({ length: n }, (_, k) => ({ name: `p${k}`, unit: "px", delayMs: k * stepMs, model, ...extra }));

/**
 * A choreo page in its own folder under `dir`, driven by keyframes.js: each track is a bar a tap moves, after its own
 * delay. Returns the page's path.
 */
export function keyframePage(dir: string, name: string, tracks: Track[]): string {
  const out = path.join(dir, name);
  mkdirSync(out, { recursive: true });
  copyFileSync(path.join(PAGES, "keyframes.js"), path.join(out, "keyframes.js"));
  const bars = tracks.map((t, i) => `<div class="bar" id="${t.name}" style="top:${160 + 70 * i}px"></div>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="choreo">
<title>choreo: ${name}</title>
<style>html { background: #fff } body { margin: 0 } .bar { position: fixed; left: 30vw; width: 30vw; height: 40px; background: #333 }</style>
</head>
<body>
${bars}
<script>const MOTION = ${JSON.stringify({ tracks })}; window.CFG = MOTION;</script>
<script src="keyframes.js"></script>
</body>
</html>
`;
  writeFileSync(path.join(out, "index.html"), html);
  return path.join(out, "index.html");
}
