import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * A bob or shake: 0, -a, +a, 0 px (`first` -1) or 0, +a, -a, 0 (`first` +1), its turns at a quarter and three quarters
 * of the time (`legs` "quarters") or at a third and two thirds (`legs` "thirds", evenly spaced keyframes), each leg on the same curve: CSS "ease", "linear" or "sine" (a half cosine).
 */
export type Bob = { px?: number; ms?: number; ease?: "ease" | "linear" | "sine"; first?: -1 | 1; legs?: "quarters" | "thirds"; staggerMs?: number };

/** Where each knob sits in bob.js's MOTION block. */
const SLOTS: Record<keyof Bob, RegExp> = {
  px: /(\n  px: )[^,]*(,)/,
  ms: /(\n  ms: )[^,]*(,)/,
  ease: /(\n  ease: )[^,]*(,)/,
  first: /(\n  first: )[^,]*(,)/,
  legs: /(\n  legs: )[^,]*(,)/,
  staggerMs: /(\n  staggerMs: )[^,]*(,)/,
};

/**
 * A copy of the bob fixture for `kind` in its own folder under `dir`, with the bob written into the copied script's
 * MOTION block (bob.js has the defaults, a 3 px bob over 350 ms on CSS ease) and a planted `fault` ("jump", "set" or
 * "dip", or none).
 */
export function bobPage(dir: string, kind: "choreo" | "sim", bob: Bob = {}, fault = ""): string {
  const out = mkdtempSync(path.join(dir, `${kind}-bob-`));
  let js = readFileSync(path.join(PAGES, "bob.js"), "utf8");
  for (const [k, v] of Object.entries(bob)) js = js.replace(SLOTS[k as keyof Bob], `$1${JSON.stringify(v)}$2`);
  writeFileSync(path.join(out, "bob.js"), js);
  const set = `window.FAULT = ${JSON.stringify(fault)}; window.VARIANT = "";`;
  const file = path.join(out, "index.html");
  writeFileSync(file, readFileSync(path.join(PAGES, `${kind}-bob.html`), "utf8").replace(/<script>window\.FAULT = [^<]*<\/script>/, `<script>${set}</script>`));
  return file;
}
