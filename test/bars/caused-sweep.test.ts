import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "../../src/gate/harness.ts";
import { kindGate } from "../../src/gate/kind-gate.ts";

/**
 * The choreo and sim style sweep: the shared rules that read a caused sequence (envelope's pops and fades inside it,
 * the live rest after it, reduced motion's ends, repeats and held states) must hold across the class of sequences, not
 * only the fixtures that prompted them. Choreo: staggers from a near-unison 40 ms to 3 s pauses, slides from 150 ms
 * to 1 s, and each variant (a toggle, an ignored repeat, three stops, a shake, a toast). Sim: soft to stiff bounces
 * under light and heavy gravity. Honest cases must pass; each planted fault must fail its rule at every timing. The
 * grid is sampled, with variants and slides rotated across the staggers.
 */

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
const dir = mkdtempSync(path.join(os.tmpdir(), "motion-kit-caused-sweep-"));

afterAll(async () => {
  await closeBrowser();
  rmSync(dir, { recursive: true, force: true });
});

type Knobs = Record<string, string | number>;
/** Where each swept number sits in a fixture script's MOTION block. */
const SLOTS: Record<string, RegExp> = {
  STAGGER_S: /(\n  staggerS: )[^\n]*?(, \/\/)/,
  SLIDE_S: /(\n  slideS: )[^,]*(,)/,
  GRAVITY: /(\n  gravity: )[^,]*(,)/,
  BOUNCE: /(\n  bounce: )[^\n]*?(, \/\/)/,
};

/**
 * A copy of `base` (a fixture page) in its own folder: FAULT and VARIANT set as the fixtures set them, and each other
 * knob written into the copied script's MOTION block, where a page keeps its timings.
 */
function sweepPage(base: string, knobs: Knobs): string {
  const name = Object.entries(knobs).map(([k, v]) => `${k}-${v}`).join("_") || "base";
  const out = mkdtempSync(path.join(dir, `${base.replace(/\.html$/, "")}_${name}_`));
  const script = base.startsWith("sim") ? "sim.js" : "choreo.js";
  let js = readFileSync(path.join(PAGES, script), "utf8");
  for (const [k, v] of Object.entries(knobs)) if (SLOTS[k]) js = js.replace(SLOTS[k], `$1${v}$2`);
  writeFileSync(path.join(out, script), js);
  const set = `window.FAULT = ${JSON.stringify(knobs.FAULT ?? "")}; window.VARIANT = ${JSON.stringify(knobs.VARIANT ?? "")};`;
  const file = path.join(out, "index.html");
  writeFileSync(file, readFileSync(path.join(PAGES, base), "utf8").replace(/<script>window\.FAULT = [^<]*<\/script>/, `<script>${set}</script>`));
  return file;
}

const STAGGERS = [0.04, 0.12, 0.6, 1.5, 3];
const SLIDES = [0.15, 0.4, 1];
const VARIANTS = ["", "ignore", "cycle", "shake", "toast"];

const honest: Knobs[] = STAGGERS.flatMap((STAGGER_S, i) => [0, 1].map((j): Knobs => ({ VARIANT: VARIANTS[(i + 2 * j) % 5]!, STAGGER_S, SLIDE_S: SLIDES[(i + j) % 3]! })));

/** Each fault, the rule it fails and the line it prints, and the variant it needs. */
const FAULTS: { FAULT: string; VARIANT?: string; rule: string; line: RegExp }[] = [
  { FAULT: "set-piece", rule: "envelope", line: /^envelope: b2 at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/ },
  { FAULT: "fade-rises", rule: "envelope", line: /^envelope: o rises at [\d.]+ ms, during the fade that starts at [\d.]+ ms; fades only fall$/ },
  { FAULT: "reduced-once", rule: "reducedMotion", line: /^reducedMotion: b0 rests at 200 after the cause played again at [\d.]+ ms under reduced motion, and at 0 without it; reduced motion shows the sequence's end state$/ },
  { FAULT: "reduced-toast-skipped", VARIANT: "toast", rule: "reducedMotion", line: /^reducedMotion: b0 holds at (19\d|20\d)(\.\d+)? from [\d.]+ to [\d.]+ ms after the cause at [\d.]+ ms and comes back, but not under reduced motion; reduced motion shows a held state too$/ },
];
const faulty = STAGGERS.flatMap((STAGGER_S, i) => [0, 1].map((j) => {
  const f = FAULTS[(i + j) % FAULTS.length]!;
  return { knobs: { FAULT: f.FAULT, VARIANT: f.VARIANT ?? "", STAGGER_S, SLIDE_S: SLIDES[(i + 2 * j) % 3]! } as Knobs, rule: f.rule, line: f.line };
}));
// A live loop that sleeps when no bar is in flight stalls in every pause longer than a slide.
const stalls = [0.6, 3].map((STAGGER_S) => ({ FAULT: "live-stalls", STAGGER_S, SLIDE_S: 0.4 }));

const BODIES: Knobs[] = [0, 0.3, 0.7].map((BOUNCE, i) => ({ BOUNCE, GRAVITY: [1000, 3000, 2000][i]! }));

describe("the choreo and sim style sweep", () => {
  it.each(honest.map((k) => [JSON.stringify(k), k] as const))("choreo %s passes every rule", async (_, knobs) => {
    const v = await kindGate(sweepPage("choreo-pause.html", knobs));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(faulty.map((f) => [JSON.stringify(f.knobs), f] as const))("choreo %s fails its rule", async (_, f) => {
    const v = await kindGate(sweepPage("choreo-pause.html", f.knobs));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(f.line)]));
  });

  it.each(stalls.map((k) => [JSON.stringify(k), k] as const))("choreo %s fails loopStopsAtRest", async (_, knobs) => {
    const v = await kindGate(sweepPage("choreo-pause.html", knobs));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^loopStopsAtRest: the live page comes to rest with b\d still at its start, 0, where its \?seek frames end at 200; the live loop stopped before its sequence ended$/)]));
  });

  it.each(BODIES.map((k) => [JSON.stringify(k), k] as const))("sim %s passes every rule", async (_, knobs) => {
    const v = await kindGate(sweepPage("sim-good.html", knobs));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each(BODIES.slice(0, 2).map((k) => [JSON.stringify(k), k] as const))("sim %s with a one-frame drop fails envelope", async (_, knobs) => {
    const v = await kindGate(sweepPage("sim-good.html", { FAULT: "glow-pop", ...knobs }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: fade at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/)]));
  });
});
