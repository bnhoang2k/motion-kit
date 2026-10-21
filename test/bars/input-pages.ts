import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Live and scroll pages whose input drives a stepped value, on the shared fixtures `live.js` (a dot dragged on a grid)
 * and `scroll.js` (a flipbook drawn by the scroll). Each page is a copied bar whose trace.json marks the stepped values.
 * The kind gate tests and the style sweep write them into a temp folder.
 */

const KINDS = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * `stepPx` is the grid cell (live) or the flipbook's step (scroll); `sizePx` the size of the dot or the square bar;
 * `fault` sets window.FAULT; `aheadAfterS` when the live jump-ahead and minor-jump faults jump; `smoothS` the scroll's
 * smoothing time. A time is set from the page's own MOTION block, in a block scope so it does not clash with the shared
 * script's. Live only: `variant` sets window.VARIANT (live.js: "thumb", "springy" or "badge"; a badge page also marks
 * the badge's b stepped); `twos` draws the dot on twos instead of on the grid (`stepPx` is then not used).
 */
export type InputPage = {
  kind: "live" | "scroll";
  stepPx: number;
  sizePx: number;
  fault?: string;
  aheadAfterS?: number;
  smoothS?: number;
  variant?: "thumb" | "springy" | "badge";
  twos?: boolean;
};

/** The badge a "badge" page shows: a 24 px square, away from the dot's path. */
const BADGE_CSS = "#badge { position: fixed; left: 100px; top: 100px; width: 24px; height: 24px; background: #c33 }";

function html(slug: string, p: InputPage): string {
  const s = p.sizePx;
  const [css, globals, script] =
    p.kind === "live"
      ? [
          `#dot { position: fixed; left: calc(50% - ${s / 2}px); top: calc(50% - ${s / 2}px); width: ${s}px; height: ${s}px; border-radius: 50%; background: #333 }${p.variant === "badge" ? ` ${BADGE_CSS}` : ""}`,
          `${p.twos ? `window.STEP = "twos";` : `window.STEP = "grid";\nwindow.GRID_PX = ${p.stepPx};`}${p.variant ? `\nwindow.VARIANT = ${JSON.stringify(p.variant)};` : ""}${p.aheadAfterS ? `\n{ const MOTION = { aheadAfterS: ${p.aheadAfterS} }; window.AHEAD_AFTER_S = MOTION.aheadAfterS; }` : ""}`,
          "live.js",
        ]
      : [`body { height: 3000px } #bar { position: fixed; left: 0; top: 340px; width: ${s}px; height: ${s}px; background: #333 }`, `window.VARIANT = "flipbook";\nwindow.FLIP_PX = ${p.stepPx};${p.smoothS ? `\n{ const MOTION = { smoothS: ${p.smoothS} }; window.SMOOTH_S = MOTION.smoothS; }` : ""}`, "scroll.js"];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-bar" content="${slug}">
<title>bar: ${slug}</title>
<style>html { background: #fff } body { margin: 0 } ${css}</style>
</head>
<body>
<div id="${p.kind === "live" ? "dot" : "bar"}"></div>${p.variant === "badge" ? '\n<div id="badge"></div>' : ""}
<script>
window.FAULT = ${JSON.stringify(p.fault ?? "")};
${globals}
</script>
<script src="../${script}"></script>
</body>
</html>
`;
}

export const inputSlug = (p: InputPage) =>
  `${p.kind}-${p.twos ? "twos" : `step${p.stepPx}`}-size${p.sizePx}${p.variant ? `-${p.variant}` : ""}${p.smoothS ? `-smooth${p.smoothS}` : ""}${p.fault ? `-${p.fault}` : ""}${p.aheadAfterS ? `-at${p.aheadAfterS * 1000}ms` : ""}`;

/** The stepped values a page's trace.json marks: the dot's x and y (and a badge's b), or the flipbook's f. */
export const steppedOf = (p: InputPage) => (p.kind === "live" ? ["x", "y", ...(p.variant === "badge" ? ["b"] : [])] : ["f"]);

/** Writes the page as a copied bar under `root`, and returns its index.html. */
export function writeInputBar(root: string, p: InputPage, slug = inputSlug(p)): string {
  const script = p.kind === "live" ? "live.js" : "scroll.js";
  if (!existsSync(path.join(root, script))) copyFileSync(path.join(KINDS, script), path.join(root, script));
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), html(slug, p));
  writeFileSync(path.join(dir, "bar.json"), JSON.stringify({ slug, kinds: [p.kind] }));
  writeFileSync(path.join(dir, "trace.json"), JSON.stringify({ stepped: steppedOf(p) }));
  return path.join(dir, "index.html");
}
