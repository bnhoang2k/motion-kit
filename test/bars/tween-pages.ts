import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * A control that acts out a tap with a keyframe tween beside the bodies: a tile that goes 0, -a, +a, 0 px (`first` -1)
 * or 0, +a, -a, 0 (+1), its turns at a quarter and three quarters of the time or at a third and two thirds, each leg
 * on one curve, as CSS keyframes ease each segment.
 */
export type Tween = { px?: number; ms?: number; ease?: "ease" | "ease-in-out" | "linear"; first?: -1 | 1; legs?: "quarters" | "thirds" };

/** Where each knob sits in sim.js's MOTION block. */
const SLOTS: Record<keyof Tween, RegExp> = {
  px: /(\n  tweenPx: )[^,]*(,)/,
  ms: /(\n  tweenMs: )[^,]*(,)/,
  ease: /(\n  tweenEase: )[^,]*(,)/,
  first: /(\n  tweenFirst: )[^,]*(,)/,
  legs: /(\n  tweenLegs: )[^,]*(,)/,
};

/**
 * A copy of the sim tween fixture as a copied bar, in its own folder under `dir`: the tween written into the copied
 * script's MOTION block (sim.js has the defaults, a 3 px tween over 350 ms on CSS ease), a planted `fault`
 * (sim.js: "tween-pop", "tween-away", "tween-throw", or any of its others), `tweens` as the bar's trace.json names
 * them (none: the tween unnamed). Returns its index.html.
 */
export function tweenPage(dir: string, tween: Tween = {}, fault = "", tweens: string[] = [], base = "sim-tween.html"): string {
  const out = mkdtempSync(path.join(dir, "sim-tween-"));
  const slug = path.basename(out);
  let js = readFileSync(path.join(PAGES, "sim.js"), "utf8");
  for (const [k, v] of Object.entries(tween)) js = js.replace(SLOTS[k as keyof Tween], `$1${JSON.stringify(v)}$2`);
  writeFileSync(path.join(out, "sim.js"), js);
  const set = `window.FAULT = ${JSON.stringify(fault)}; window.VARIANT = "";`;
  const html = readFileSync(path.join(PAGES, base), "utf8")
    .replace(/<script>window\.FAULT = [^<]*<\/script>/, `<script>${set}</script>`)
    .replace(/<meta name="motion-kit-kind" content="sim">/, `<meta name="motion-kit-bar" content="${slug}">`);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "index.html"), html);
  writeFileSync(path.join(out, "bar.json"), JSON.stringify({ slug, kinds: ["sim"] }));
  writeFileSync(path.join(out, "trace.json"), JSON.stringify(tweens.length === 0 ? {} : { tweens }));
  return path.join(out, "index.html");
}
