import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openPage } from "../../src/gate/harness.ts";
import { ALL_RULES, type KindRule, type RuleContext } from "../../src/gate/kind-gate.ts";
import { syntheticInput } from "../../src/gate/synthetic-input.ts";

/**
 * A live or scroll page with a designed pause. On a live page a drag moves a dot one to one; on a scroll page a bar
 * follows the scroll position (`p`, px) as the wheel scrolls down and back up. On release (the pointer lifts, or the
 * scroll is back at the top) the first element fades out (`o`), the page holds blank for `beatMs`, and a second element
 * arrives (`n`, opacity), as a gate fades out, a blank beat, and the next page comes in. After the second element is in,
 * the page's loop stops, unless `fault` says otherwise:
 *
 * - "loop-forever": the loop keeps running for as long as the page is open.
 * - "loop-past": the loop runs `pastMs` more after the second element is in.
 * - "stalls": the loop stops when the first element has faded out, in the pause, so the second element never arrives live.
 *
 * With `loop`, the page also has a designed value loop, a breath `b` (scale) of `1 + amp * sin(2 pi t / periodS)` from
 * load. The page's clock then runs for as long as the page is on screen, and the loop pauses while the page is hidden
 * and resumes when it is shown, unless `fault` is "no-pause": the loop then ignores that the page is off screen. With
 * `loop.from` "input" the breath begins at the release (it holds 1 until then), and the page idles its rAF until the
 * input, then runs it for as long as the page is on screen.
 */
export type Beat = {
  kind?: "live" | "scroll";
  beatMs: number;
  fadeMs?: number;
  inMs?: number;
  fault?: "" | "loop-forever" | "loop-past" | "stalls" | "no-pause";
  pastMs?: number;
  loop?: { periodS: number; amp: number; from?: "load" | "input" };
};

export function beatPage(dir: string, b: Beat): string {
  const out = mkdtempSync(path.join(dir, "beat-"));
  const m = { kind: "live", fadeMs: 250, inMs: 300, fault: "", pastMs: 1000, loop: null, ...b };
  const scroll = m.kind === "scroll";
  const file = path.join(out, "index.html");
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="${m.kind}">
<title>${m.kind}: a fade, a blank beat, then the next arrives</title>
<style>html { background: #fff } body { margin: 0${scroll ? "; height: 3000px" : ""} } #dot { position: fixed; left: 620px; top: 340px; width: 40px; height: 40px; border-radius: 50%; background: #333 } #next { position: fixed; left: 300px; top: 200px; width: 680px; height: 320px; background: #888; opacity: 0 } #loop { position: fixed; left: 40px; top: 40px; width: 60px; height: 60px; background: #555 }</style>
</head>
<body>
<div id="dot"></div><div id="next"></div><div id="loop"></div>
<script>
const FAULT = ${JSON.stringify(m.fault)};
const SCROLL = ${scroll};
const LOOP = ${JSON.stringify(m.loop)};
const M = {
  enterS: 0.2,              // the first element fades in at load
  fadeS: ${m.fadeMs / 1000},   // the release: the first element fades out over this long
  beatS: ${m.beatMs / 1000},   // ...the page holds blank this long
  inS: ${m.inMs / 1000},       // ...then the second element fades in over this long
  pastS: ${m.pastMs / 1000},   // FAULT "loop-past": the loop runs this long past the end
  maxStepS: 0.05,           // the live loop caps one time step
};
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot"), next = document.getElementById("next"), loop = document.getElementById("loop");
const clamp01 = (p) => Math.min(1, Math.max(0, p));
const smooth = (p) => { p = clamp01(p); return p * p * (3 - 2 * p); };
const hand = { down: false, x: 0, y: 0 };
let S;
function reset() { S = { t: 0, down: false, relAt: null, x: 0, y: 0, p: 0, o: 0, n: 0 }; }
// The input at ms: a pointer (down, x, y), or on a scroll page the scroll position (held while it is below the top).
function inputAt(ms) {
  const s = window.__input || [];
  if (SCROLL) {
    let y = 0;
    if (!seekMode) y = window.scrollY;
    else for (const q of s) if (q[0] <= ms + 1e-6) y = q[1];
    return { down: y > 0, x: 0, y };
  }
  if (!seekMode) return hand;
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  if (!p) return { down: false, x: 0, y: 0 };
  return { down: p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6, x: p[1], y: p[2] };
}
function step(h) {
  const end = S.t + h, p = inputAt(end * 1000);
  if (SCROLL) S.p = p.y;
  if (p.down) { S.down = true; if (!SCROLL) { S.x = p.x - 640; S.y = p.y - 360; } }
  else if (S.down) { S.down = false; S.relAt = S.t; }
  const u = S.relAt === null ? 0 : end - S.relAt;
  S.o = smooth(end / M.enterS) * (S.relAt === null ? 1 : 1 - smooth(u / M.fadeS));
  S.n = S.relAt === null ? 0 : smooth((u - M.fadeS - M.beatS) / M.inS);
  S.t = end;
}
// The loop's clock: from load, or from the release.
const breath = () => {
  if (!LOOP) return null;
  const d = LOOP.from === "input" ? (S.relAt === null ? 0 : S.t - S.relAt) : S.t;
  return 1 + LOOP.amp * Math.sin((2 * Math.PI * d) / LOOP.periodS);
};
function values() {
  const v = SCROLL ? { p: S.p, o: S.o, n: S.n } : { x: S.x, y: S.y, o: S.o, n: S.n };
  return LOOP ? { ...v, b: breath() } : v;
}
function draw() {
  dot.style.transform = "translate(" + (SCROLL ? S.p : S.x) + "px, " + (SCROLL ? 0 : S.y) + "px)";
  dot.style.opacity = String(S.o);
  next.style.opacity = String(S.n);
  if (LOOP) loop.style.transform = "scale(" + breath() + ")";
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor(ms * 60 / 1000 + 1e-6);
  for (let i = 0; i < n; i++) step(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) step(rest);
  draw();
};
const units = SCROLL ? { p: "px", o: "opacity", n: "opacity" } : { x: "px", y: "px", o: "opacity", n: "opacity" };
window.__state = () => ({ values: values(), events: {}, units: LOOP ? { ...units, b: "scale" } : units });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const endS = () => S.relAt + M.fadeS + M.beatS + M.inS;
  // The sequence is over for FAULT "loop-past" only after pastS more; a page with a loop keeps going while it is on screen
  // (a loop the input starts, from the release). Until the release such a page runs only the fade-in and the hand.
  const busy = () => {
    if (LOOP && !(LOOP.from === "input" && S.relAt === null)) return FAULT === "no-pause" || !document.hidden;
    if (FAULT === "loop-forever") return true;
    if (S.down || S.o < 1 && S.relAt === null) return true;
    if (S.relAt === null) return false;
    if (FAULT === "stalls") return S.t < S.relAt + M.fadeS;
    return S.t < endS() + (FAULT === "loop-past" ? M.pastS : 0);
  };
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, M.maxStepS);
    last = now;
    step(h);
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf && (FAULT === "no-pause" || !document.hidden)) { last = null; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && FAULT !== "no-pause") { cancelAnimationFrame(raf); raf = 0; last = null; }
    else wake();
  });
  if (SCROLL) addEventListener("scroll", wake);
  else {
    addEventListener("pointerdown", (e) => { hand.down = true; hand.x = e.clientX; hand.y = e.clientY; wake(); });
    addEventListener("pointermove", (e) => { hand.x = e.clientX; hand.y = e.clientY; if (hand.down) wake(); });
    addEventListener("pointerup", () => { hand.down = false; wake(); });
  }
  wake();
}
</script>
</body>
</html>
`,
  );
  return file;
}

/**
 * The context the gate gives a page of this kind with its synthetic input, and that input's samples. `spanMs` is the
 * span the rules read.
 */
export function beatContext(kind: "live" | "scroll"): RuleContext {
  const input = syntheticInput(kind)!;
  return { kind, input, cuts: [], spanMs: 6000 };
}

/**
 * The loopStopsAtRest rule on a beat page, driven by the synthetic input of its kind: the lines it prints. A page with a
 * designed pause is at rest only after its sequence ends.
 */
export async function atRest(dir: string, b: Beat): Promise<string[]> {
  const ctx = beatContext(b.kind ?? "live");
  const p = await openPage(beatPage(dir, b), { input: ctx.input!.samples });
  try {
    return await ALL_RULES.find((r) => r.name === "loopStopsAtRest")!.check(p, ctx);
  } finally {
    await p.close();
  }
}

/**
 * The rules named by `names`, run on a beat page: the shared rules (ALL_RULES) and the page's own kind's `rules`. A rule
 * the kind's list lacks, as pausesOffScreen on a live or scroll gate before it takes the idle rules, is not found.
 */
export async function kindRulesOn(dir: string, b: Beat, names: string[]): Promise<string[]> {
  const kind = b.kind ?? "live";
  const { rules } = (await import(`../../kinds/${kind}/gate.ts`)) as { rules: KindRule[] };
  const ctx = beatContext(kind);
  const p = await openPage(beatPage(dir, b), { input: ctx.input!.samples });
  try {
    const out: string[] = [];
    for (const name of names) {
      const rule = [...ALL_RULES, ...rules].find((r) => r.name === name);
      out.push(...(rule ? await rule.check(p, ctx) : [`${name}: the ${kind} gate has no such rule`]));
    }
    return out;
  } finally {
    await p.close();
  }
}
