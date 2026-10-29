import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openPage } from "../../src/gate/harness.ts";
import { causesOf } from "../../src/gate/causes.ts";
import { ALL_RULES, kindGate, pageInput, type KindRule, type RuleContext } from "../../src/gate/kind-gate.ts";
import type { KindName } from "../../src/core/types.ts";

/**
 * Pages whose sequence runs past 3 s, or whose loop starts late or runs beside a sequence, on three small engines in
 * fixtures/gate-pages/rest/. A test writes a page into a temp folder with the engine beside it and gates it.
 *
 * - `stalls.js` (`stallsPage`): a cause (a tap, the release of a drag, the first scroll) starts a list of pieces, each one
 *   value on its own timer; optional loops, a creep, and how the live page's rAF behaves (it sleeps in a gap, it keeps
 *   running late, it stops partway, it pauses and resumes off screen in several ways).
 * - `tracks.js` (`tracksPage`): the same, as tracks of timed segments on one value (a toast that slides in, holds and
 *   slides out), one loop, and how the live page gets through a gap in the timeline (its rAF runs, a timer wakes it, or
 *   nothing does), and what pauses off screen (the whole clock, or only the loop; the visibility event or an observer).
 * - `segments.js` (`riderPage`): a staggered slide with a close button that rides a bar, for the choreo interrupt runs.
 */

const REST = path.resolve(import.meta.dirname, "../fixtures/gate-pages/rest");

export type RestKind = "idle" | "live" | "scroll" | "choreo" | "sim";

function write(dir: string, name: string, kind: RestKind, engine: string, head: string, body: string, motion: object, extra = ""): string {
  const out = mkdtempSync(path.join(dir, `${name}-`));
  cpSync(path.join(REST, engine), path.join(out, engine));
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${kind}">
<title>${kind}: ${name}</title>
<style>html { background: #fff } ${head}</style>
</head>
<body>
${body}
<script>
const MOTION = ${JSON.stringify(motion, null, 1)};
</script>
<script src="${engine}"></script>
</body>
</html>
`,
  );
  return file;
}

// ---- stalls.js ---------------------------------------------------------------------------------

export type Piece = { n: string; unit: "px" | "opacity" | "scale" | "deg"; from: number; to: number; at: number; dur: number };
export type Loop = { n: string; unit: "px" | "opacity" | "scale" | "deg"; amp: number; period: number; at: number; from: "load" | "cause" };

/**
 * MOTION for stalls.js. `stop` is when the live page's rAF stops: "rest" (when the sequence is over), "never", "late" (`late`
 * s past the end), "first" (when the first piece is done) or "flight" (whenever no piece is mid-move, so a gap stalls it).
 * `pause` pauses it off screen, `pauseOn` says by what ("both", "vis", "io"), `resume` says how it comes back ("ok", "once"
 * for `resumeFrames` frames, "none", "loop-only": the sequence stays frozen where it was), and `lateLoopIgnoresHidden`
 * keeps a loop that has started running while the page is hidden. `creep` is a value that moves at `rate`/s, speeding up by `accel`/s each second, forever.
 */
export type Stalls = {
  stop?: "rest" | "never" | "late" | "first" | "flight";
  late?: number;
  pause?: boolean;
  pauseOn?: "both" | "vis" | "io";
  resume?: "ok" | "once" | "none" | "loop-only";
  resumeFrames?: number;
  lateLoopIgnoresHidden?: boolean;
  omega?: number;
  /** The share each live move goes past (or, negative, short of) the end the `?seek` frames show: a page that draws its live values at random. */
  liveFurther?: number;
  pieces?: Piece[];
  loops?: Loop[];
  creep?: { n: string; unit: "px" | "opacity" | "scale" | "deg"; rate: number; at: number; base?: number; accel?: number };
};

/** A card slides out, fades, holds blank for `beat` s, then the next card slides in. */
export const cards = (beat = 0.8): Piece[] => [
  { n: "a", unit: "px", from: 0, to: 200, at: 0, dur: 0.4 },
  { n: "o", unit: "opacity", from: 1, to: 0, at: 0.4, dur: 0.3 },
  { n: "b", unit: "px", from: 0, to: 200, at: 0.7 + beat, dur: 0.4 },
];
/** A bob of 8 px every 2 s, from load or from the cause, `at` s in. */
export const bob = (from: "load" | "cause" = "load", at = 0): Loop => ({ n: "g", unit: "px", amp: 8, period: 2, at, from });
/** A slide, then a fade that takes 1.2 s: the piece the stalled live page stops in the middle of. */
export const slowFade = (): Piece[] => [
  { n: "a", unit: "px", from: 0, to: 200, at: 0, dur: 0.6 },
  { n: "o", unit: "opacity", from: 0, to: 1, at: 0.3, dur: 1.2 },
];

export function stallsPage(dir: string, kind: RestKind, name: string, m: Stalls): string {
  const motion = { maxStepS: 0.05, omega: 22, restPx: 0.01, stop: "rest", pause: true, resume: "ok", ...(kind === "scroll" ? { smooth: 0.1667 } : {}), ...m };
  const ids = [...(motion.pieces ?? []), ...(motion.loops ?? []), ...(motion.creep ? [motion.creep] : [])].map((p) => p.n);
  if (kind === "live") ids.unshift("x");
  const els = ids.map((id, i) => `<div class="el" id="${id}" style="top:${120 + i * 70}px"></div>`).join("");
  return write(
    dir,
    name,
    kind,
    "stalls.js",
    `body { margin: 0; ${kind === "scroll" ? "height: 4000px" : ""} } #stage { position: fixed; inset: 0 } .el { position: absolute; left: 300px; width: 120px; height: 50px; background: #333; border-radius: 8px }`,
    `<div id="stage">${els}</div>`,
    motion,
  );
}

// ---- tracks.js ---------------------------------------------------------------------------------

type Seg = [startS: number, durS: number, from: number, to: number, ease: "out" | "inout" | "lin" | "outq"];
export type Track = [name: string, unit: "px" | "opacity" | "scale" | "deg", segs: Seg[]];

/**
 * MOTION for tracks.js. `gaps` is how the live page gets through a gap in a track: "tick" (its rAF runs through), "timer"
 * (it sleeps and a timer wakes it) or "stall" (it sleeps and nothing wakes it). `pause` says what stops off screen: "all"
 * (the whole clock) or "loop" (only the loop's). `watch` "io" pauses by an IntersectionObserver, else by the visibility event.
 * `mount` names tracks whose value is reported only from that many s after the cause.
 */
export type Tracks = {
  tracks?: Track[];
  loop?: { name: string; unit: "px" | "opacity" | "scale" | "deg"; base: number; amp: number; periodS: number; from: "load" | "cause"; startS?: number } | null;
  gaps?: "tick" | "timer" | "stall";
  pause?: "all" | "loop";
  watch?: "io" | "vis";
  mount?: Record<string, number>;
  omega?: number;
  zeta?: number;
  restPx?: number;
};

/** A breathing scale glow, 4% every 2 s. */
export const breath = (from: "load" | "cause", extra: { startS?: number; periodS?: number } = {}): NonNullable<Tracks["loop"]> => ({ name: "glow", unit: "scale", base: 1, amp: 0.04, periodS: 2, from, ...extra });
/** Three cards slide out one after the other. */
export const slideCards = (gapS = 0.12, slide = 0.4): Track[] => [0, 1, 2].map((i): Track => [`c${i}`, "px", [[i * gapS, slide, 0, 200, "out"]]]);
/** The first card fades out; a toast slides in, holds `holdS`, and slides out. */
export const toast = (holdS: number): Track[] => [
  ["card", "opacity", [[0, 0.25, 1, 0, "outq"]]],
  ["toast", "px", [[0.25, 0.3, 80, 0, "out"], [0.55 + holdS, 0.3, 0, 80, "inout"]]],
];
/** A pill that slides in on the first scroll, holds `holdS`, and slides out. */
export const pill = (holdS: number): Track[] => [["pill", "px", [[0, 0.3, 60, 0, "out"], [0.3 + holdS, 0.3, 0, 60, "inout"]]]];
/** A card fades out, holds blank for `beatS`, and the next fades in. */
export const beat = (beatS: number): Track[] => [
  ["card", "opacity", [[0, 0.3, 1, 0, "outq"]]],
  ["next", "opacity", [[0.3 + beatS, 0.4, 0, 1, "inout"]]],
];

export function tracksPage(dir: string, kind: RestKind, name: string, m: Tracks): string {
  const motion = { kind, tracks: [], loop: null, pause: "all", gaps: "tick", omega: 18, zeta: 0.8, restPx: 0.01, smoothS: 0.12, maxStepS: 0.05, segOmega: 20, segZeta: 0.7, segRest: 0.01, springSettleS: 0.8, substepsPerS: 480, drift: 1.618, ...m };
  return write(dir, name, kind, "tracks.js", `body { margin: 0${kind === "scroll" ? "; height: 3000px" : ""} }`, "", motion);
}

// ---- segments.js -------------------------------------------------------------------------------

/**
 * A staggered slide of three bars (`slideS` each, `staggerS` apart, 200 px) that a tap starts, and a close button that rides
 * the first bar. A press on the button docks the bars at `dockPx`, each `dockStaggerS` after the one before (0: the stagger of
 * the slide), so the control's own answer lasts `dockS` + 2 `dockStaggerS` at most.
 */
export type Rider = { slideS?: number; staggerS?: number; dockS?: number; dockStaggerS?: number; rideFromPx?: number };

const RIDER = `
const host = document.getElementById("stage");
host.innerHTML = \`<style>.bar { position: fixed; left: 128px; width: 384px; height: 40px; background: #333 } #b0 { top: 200px } #b1 { top: 260px } #b2 { top: 320px } #close { position: fixed; left: 0; top: 0; width: 32px; height: 32px; background: #c33; border: 0; padding: 0 }</style>
<div class="bar" id="b0"></div><div class="bar" id="b1"></div><div class="bar" id="b2"></div><button id="close" aria-label="Close"></button>\`;
const q = (s) => host.querySelector(s);
const bars = [q("#b0"), q("#b1"), q("#b2")], close = q("#close");
window.PAGE = {
  values: { b0: 0, b1: 0, b2: 0 },
  units: { b0: "px", b1: "px", b2: "px" },
  press(c, el) {
    const mid = c.playing();
    if (el && el.id === "close") {
      ["b0", "b1", "b2"].forEach((n, i) => c.tween(n, MOTION.dockPx, { dur: (MOTION.dockS * Math.abs(MOTION.dockPx - c.v(n))) / MOTION.travelPx, delay: MOTION.dockStaggerS ? i * MOTION.dockStaggerS : mid ? 0 : i * MOTION.staggerS }));
      return;
    }
    const to = c.v("b2") > MOTION.travelPx / 2 || (mid && c.st.out) ? 0 : MOTION.travelPx;
    c.st.out = to > 0;
    ["b0", "b1", "b2"].forEach((n, i) => c.tween(n, to, { dur: mid ? (MOTION.slideS * Math.abs(to - c.v(n))) / MOTION.travelPx : MOTION.slideS, delay: mid ? 0 : i * MOTION.staggerS }));
  },
  draw(v) {
    bars.forEach((b, i) => { b.style.transform = \`translateX(\${v["b" + i]}px)\`; });
    const cx = MOTION.rideFromPx + v.b0, h = MOTION.closePx / 2;
    close.style.transform = \`translate(\${cx - h}px, \${360 - h}px)\`;
    close.style.visibility = v.b0 > 0.5 ? "visible" : "hidden";
  },
};`;

/**
 * The rider page, and with `tapsMs` (the times of its taps, at the viewport centre) a copied bar around it: bar.json, and a
 * trace.json whose input is those taps. Returns the page's file.
 */
export function riderPage(dir: string, name: string, r: Rider = {}, tapsMs?: number[]): string {
  const bar = tapsMs !== undefined;
  const out = mkdtempSync(path.join(dir, `${name}-`));
  cpSync(path.join(REST, "segments.js"), path.join(out, "segments.js"));
  const motion = { slideS: 0.4, staggerS: 0.12, travelPx: 200, dockPx: 100, closePx: 32, dockS: 0.4, dockStaggerS: 0, ...r };
  // The close button's centre crosses the tap's spot (640) just as the second bar starts, unless the page says where.
  const ride = r.rideFromPx ?? 640 - motion.travelPx * (1 - (1 - motion.staggerS / motion.slideS) ** 3);
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="${bar ? "motion-kit-bar" : "motion-kit-kind"}" content="${bar ? name : "choreo"}">
<title>${name}: a close button rides the moving bar</title>
<style>html { background: #fff } body { margin: 0 } #stage { position: fixed; inset: 0; display: block }</style>
</head>
<body>
<div id="stage"></div>
<script>
const MOTION = ${JSON.stringify({ ...motion, rideFromPx: ride })};
${RIDER}
</script>
<script src="segments.js"></script>
</body>
</html>
`,
  );
  if (bar) {
    writeFileSync(path.join(out, "bar.json"), JSON.stringify({ slug: name, kinds: ["choreo"] }));
    const tap = (ms: number): number[][] => [[ms, 640, 360, 1], [ms + 1000 / 60, 640, 360, 0]];
    writeFileSync(path.join(out, "trace.json"), JSON.stringify({ input: { kind: "pointer", samples: tapsMs!.flatMap(tap) } }));
  }
  return file;
}

/** The static two-tap panel bar (fixtures/gate-pages/rest/two-taps-panel), copied with its engine beside it; `secondTapMs` sets the second tap. */
export function twoTapPanel(dir: string, secondTapMs: number): string {
  const out = mkdtempSync(path.join(dir, "panel-"));
  cpSync(path.join(REST, "panels.js"), path.join(out, "panels.js"));
  mkdirSync(path.join(out, "two-taps-panel"));
  cpSync(path.join(REST, "two-taps-panel"), path.join(out, "two-taps-panel"), { recursive: true });
  const trace = path.join(out, "two-taps-panel", "trace.json");
  const tap = (ms: number): number[][] => [[ms, 640, 360, 1], [ms + 1000 / 60, 640, 360, 0]];
  writeFileSync(trace, JSON.stringify({ fps: 60, input: { kind: "pointer", samples: [...tap(250), ...tap(secondTapMs)] } }));
  return path.join(out, "two-taps-panel", "index.html");
}

/** The rules that wait for the page to stop (and `span`, which says how far the rules read). */
export const REST_RULES = ["loopStopsAtRest", "pausesOffScreen", "resumes"];

/** The failure lines of `file`'s whole kind gate that belong to the rest rules and `span`. */
export async function restLines(file: string): Promise<string[]> {
  const v = await kindGate(file);
  return v.failures.filter((f) => [...REST_RULES, "span"].includes(f.slice(0, f.indexOf(":"))));
}

/**
 * The named rules run on `file` as the gate runs them (its input, its span), without the audit and the other rules, and
 * the page held open between runs: `run(names)` gives their failure lines. Close it with `close()`.
 */
export async function rulesOn(file: string) {
  const kind = /name="motion-kit-kind" content="([a-z]+)"/.exec(readFileSync(file, "utf8"))?.[1] ?? "choreo";
  const { input, spanMs } = await pageInput(file);
  const ctx: RuleContext = { kind: kind as KindName, input, cuts: [], spanMs, causes: causesOf(input), notes: [] };
  const { rules } = (await import(`../../kinds/${kind}/gate.ts`)) as { rules: KindRule[] };
  const page = await openPage(file, { ...(input ? { input: input.samples } : {}), steppedInputRaw: kind === "live" || kind === "scroll" });
  return {
    ctx,
    async run(names: string[]): Promise<string[]> {
      const out: string[] = [];
      for (const name of names) {
        const rule = [...ALL_RULES, ...rules].find((r) => r.name === name);
        out.push(...(rule ? await rule.check(page, ctx) : [`${name}: the ${kind} gate has no such rule`]));
      }
      return out;
    },
    close: () => page.close(),
  };
}

/** The failure lines of the named rules on `file`, run once (rulesOn). */
export async function ruleLines(file: string, names: string[]): Promise<string[]> {
  const on = await rulesOn(file);
  try {
    return await on.run(names);
  } finally {
    await on.close();
  }
}
