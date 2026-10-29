import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * A choreo page on loop-tap.js: a tap slides two bars in, and starts a loop of the page's own that `valuesAfter(d)`
 * returns (d seconds since the tap, null before it). `motion` is the page's MOTION block, `units` its UNITS. With
 * `restart`, a second tap restarts the loop from the second tap, as a page that restarts its animation on every tap
 * does.
 */
export type TapLoop = { restart: boolean; motion: Record<string, number | string>; units: Record<string, string>; valuesAfter: string };

/** The loop's MOTION fields the driver reads: it never stops (endS) and shows `reducedAtS` under reduced motion. */
export const LOOP_MOTION = { travelPx: 200, slideS: 0.4, staggerS: 0.12 };

/** A copy of the page in its own folder under `dir`. Returns its path. */
export function tapLoopPage(dir: string, name: string, spec: TapLoop): string {
  const out = path.join(dir, name);
  mkdirSync(out, { recursive: true });
  copyFileSync(path.join(PAGES, "loop-tap.js"), path.join(out, "loop-tap.js"));
  const motion = JSON.stringify({ ...LOOP_MOTION, ...spec.motion, endS: "Infinity" }).replace('"Infinity"', "Infinity");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="choreo">
<title>choreo: ${name}</title>
<style>html { background: #fff } body { margin: 0 } .b { position: fixed; width: 40px; height: 40px; border-radius: 8px; background: #333 }</style>
</head>
<body>
<script>window.RESTART = ${spec.restart}; window.NOSEQ = false;
const MOTION = ${motion};
const UNITS = ${JSON.stringify(spec.units)};
${spec.valuesAfter}
</script>
<script src="loop-tap.js"></script>
</body>
</html>
`;
  writeFileSync(path.join(out, "index.html"), html);
  return path.join(out, "index.html");
}
