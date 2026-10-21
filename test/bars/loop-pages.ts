import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Idle loops for the loop sweep, on the shared fixture `loops/loops.js`: designed loops that hop, settle and pulse
 * (a loader, a relay of hops, a breath, a badge, a ticking hand, a blink), and the faults the loop rule must still
 * catch. Every shape is timed in shares of its period P, so one shape runs at any period from 0.5 to 7.5 s. Before
 * the lead-in ends, the page holds the loop's first state.
 */

export const LOOPS_JS = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds/loops/loops.js");

export type LoopShape =
  | "loader" | "relay" | "breath" | "badge" | "tick" | "blink" | "swing" | "spin" | "shimmer" | "hops2" | "noisySwing"
  | "ballDrop" | "antic" | "linearHold" | "marquee"
  | "bounce" | "overcap" | "springOnce" | "pops" | "drift" | "shimmerOver" | "lateSpring" | "latePop" | "lateSettle" | "latePopLoop" | "reducedLate"
  | "stepOnRebound" | "stepOnReboundLoop" | "homeSettle";
/** `stillAt`, when set, moves the reduced-motion still moment to that share of the period (0: the start state). */
export type LoopSpec = { shape: LoopShape; periodS: number; leadS: number; stillAt?: number };

const HELPERS = `const clamp01 = (p) => Math.min(1, Math.max(0, p));
const eis = (p) => (1 - Math.cos(Math.PI * clamp01(p))) / 2;
const eout = (p) => 1 - (1 - clamp01(p)) ** 2;
const ein = (p) => clamp01(p) ** 2;
// A damped spring from 0 to 1 that rests at exactly 1 at tEnd.
const spr = (t, w, z, tEnd) => (t <= 0 ? 0 : t >= tEnd ? 1 : 1 - Math.exp(-z * w * t) * Math.cos(w * Math.sqrt(1 - z * z) * t) * (1 - t / tEnd));
const backOut = (p, k) => { p = clamp01(p) - 1; return 1 + (k + 1) * p ** 3 + k * p ** 2; };
// From 0 to 1 over p: eases out past 1 by os (a share of the move), then eases back to rest at exactly 1.
const settle = (p, os) => { p = clamp01(p); return p < 0.5 ? (1 + os) * eis(2 * p) : 1 + os - os * eis(2 * p - 1); };
// Keyframes [[s, value], ...], eased (K) or straight (L) between them.
const keys = (e) => (t, ks) => { if (t <= ks[0][0]) return ks[0][1]; for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) { const [a, va] = ks[i - 1], [b, vb] = ks[i]; return va + (vb - va) * e((t - a) / (b - a)); } return ks[ks.length - 1][1]; };
const K = keys(eis), L = keys(clamp01);
// A ball that hops from the ground (0) to each height in turn (y up is negative), gravity g px/s^2, then rests.
const ball = (t, hs, g) => { if (t <= 0) return 0; for (const h of hs) { const T2 = 2 * Math.sqrt((2 * h) / g); if (t < T2) { const v = (g * T2) / 2; return -(v * t - (g * t * t) / 2); } t -= T2; } return 0; };`;

/** Each shape: its units, its MOTION fields (beyond periodS, leadS, stillAtS, maxStepS) and its valuesAt body over t, the time since the lead-in ended. */
const SHAPES: Record<LoopShape, { units: Record<string, string>; motion: string; body: string; stillAt: number }> = {
  // A hop over the whole period, and a squash at each landing that springs back past its rest.
  loader: {
    units: { y: "px", sy: "scale" },
    motion: "hopPx: 60, squashShare: 0.05, squash: 0.8, zeta: 0.3, springShare: 0.35",
    body: `const P = MOTION.periodS, ph = t % P, u = ph / P;
      const y = -MOTION.hopPx * 4 * u * (1 - u);
      const pre = P * (1 - MOTION.squashShare), end = MOTION.springShare * P, w = 9 / end;
      const sy = ph >= pre ? 1 - (1 - MOTION.squash) * eis((ph - pre) / (P - pre)) : t < P ? 1 : 1 - (1 - MOTION.squash) * (1 - spr(ph, w, MOTION.zeta, end));
      return { y, sy };`,
    stillAt: 0.5,
  },
  // Three dots hop in turn, each dipping a little below its rest as it lands: uneven starts, the same each cycle.
  relay: {
    units: { d1: "px", d2: "px", d3: "px" },
    motion: "starts: [0.04, 0.18, 0.43], upShare: 0.12, downShare: 0.12, dipShare: 0.1, hopPx: 12, dipPx: 2",
    body: `const P = MOTION.periodS, ph = t % P, out = {};
      const [up, down, dip] = [MOTION.upShare * P, MOTION.downShare * P, MOTION.dipShare * P];
      MOTION.starts.forEach((s, k) => {
        const u = ph - s * P;
        let y = 0;
        if (u > 0 && u < up) y = -MOTION.hopPx * eout(u / up);
        else if (u >= up && u < up + down) y = -MOTION.hopPx * (1 - ein((u - up) / down));
        else if (u >= up + down && u < up + down + dip) y = MOTION.dipPx * Math.sin((Math.PI * (u - up - down)) / dip);
        out["d" + (k + 1)] = y;
      });
      return out;`,
    stillAt: 0.2,
  },
  // A breath: in past full and back, a hold, out past rest and back, a rest.
  breath: {
    units: { s: "scale" },
    motion: "inShare: 0.35, holdShare: 0.15, outShare: 0.35, amp: 0.06, backK: 1.2",
    body: `const P = MOTION.periodS, ph = t % P;
      const [a, h, o] = [MOTION.inShare * P, MOTION.holdShare * P, MOTION.outShare * P];
      const b = ph < a ? backOut(ph / a, MOTION.backK) : ph < a + h ? 1 : 1 - backOut((ph - a - h) / o, MOTION.backK);
      return { s: 1 + MOTION.amp * b };`,
    stillAt: 0.4,
  },
  // A badge springs in past full size and back, holds, and shrinks away.
  badge: {
    units: { s: "scale" },
    motion: "inShare: 0.1, springShare: 0.3, zeta: 0.35, holdShare: 0.4, outShare: 0.1",
    body: `const P = MOTION.periodS, u = (t % P) - MOTION.inShare * P;
      const end = MOTION.springShare * P, outAt = end + MOTION.holdShare * P, w = 9 / end;
      const s = u < outAt ? spr(u, w, MOTION.zeta, end) : 1 - ein((u - outAt) / (MOTION.outShare * P));
      return { s: Math.max(0, s) };`,
    stillAt: 0.5,
  },
  // A ticking hand: each period it moves on one tick and settles past it and back.
  tick: {
    units: { r: "deg" },
    motion: "tickDeg: 6, zeta: 0.35, springShare: 0.4",
    body: `const P = MOTION.periodS, k = Math.floor(t / P), end = MOTION.springShare * P;
      return { r: MOTION.tickDeg * (k + spr(t - k * P, 9 / end, MOTION.zeta, end)) };`,
    stillAt: 0.5,
  },
  // A blink: opacity falls to 0.2 over 200 ms and comes back over 300 ms, once a period.
  blink: {
    units: { o: "opacity" },
    motion: "downS: 0.2, upS: 0.3",
    body: `const ph = t % MOTION.periodS;
      const o = ph < MOTION.downS ? 1 - 0.8 * eis(ph / MOTION.downS) : ph < MOTION.downS + MOTION.upS ? 0.2 + 0.8 * eis((ph - MOTION.downS) / MOTION.upS) : 1;
      return { o };`,
    stillAt: 0.1,
  },
  // A swing: out past its far rest by 30% and back, a hold, home past its rest by 30% and back, a rest.
  swing: {
    units: { x: "px" },
    motion: "goShare: 0.15, holdShare: 0.35, backShare: 0.15, d: 60, os: 0.3",
    body: `const u = (t % MOTION.periodS) / MOTION.periodS, [g, h, b] = [MOTION.goShare, MOTION.holdShare, MOTION.backShare];
      const x = u < g ? MOTION.d * settle(u / g, MOTION.os) : u < g + h ? MOTION.d : u < g + h + b ? MOTION.d * (1 - settle((u - g - h) / b, MOTION.os)) : 0;
      return { x };`,
    stillAt: 0.3,
  },
  // A spinner that turns on by 45 deg each period, eased, its angle reported as it grows.
  spin: {
    units: { r: "deg" },
    motion: "stepDeg: 45, easeShare: 0.4",
    body: `const P = MOTION.periodS, k = Math.floor(t / P + 1e-9);
      return { r: MOTION.stepDeg * (k + eis((t - k * P) / (MOTION.easeShare * P))) };`,
    stillAt: 0.5,
  },
  // A skeleton shimmer: opacity from 1 down to 0.4 and back on a sine, never still, starting at its high. A loop, not a
  // fade that rises.
  shimmer: {
    units: { o: "opacity" },
    motion: "low: 0.4",
    body: "return { o: MOTION.low + ((1 - MOTION.low) * (1 + Math.cos((2 * Math.PI * t) / MOTION.periodS))) / 2 };",
    stillAt: 0.25,
  },
  // A relay dot that hops twice a period, the same height, the first landing settling 30% past rest, the second 10%:
  // it crosses its mid level every half period, but repeats only every period.
  hops2: {
    units: { y: "px" },
    motion: "upShare: 0.15, downShare: 0.2, hopPx: 40",
    body: `const P = MOTION.periodS, ph = t % P, half = P / 2, os = ph < half ? 0.3 : 0.1, v = ph % half;
      const [up, down] = [MOTION.upShare * P, MOTION.downShare * P];
      return { y: v < up ? -MOTION.hopPx * eis(v / up) : -MOTION.hopPx * (1 - settle((v - up) / down, os)) };`,
    stillAt: 0.4,
  },
  // The swing with 0.2 px of noise on top, below the 0.5 px floor: each cycle still holds still.
  noisySwing: {
    units: { x: "px" },
    motion: "goShare: 0.15, holdShare: 0.35, backShare: 0.15, d: 60, os: 0.3",
    body: `const u = (t % MOTION.periodS) / MOTION.periodS, [g, h, b] = [MOTION.goShare, MOTION.holdShare, MOTION.backShare];
      const x = u < g ? MOTION.d * settle(u / g, MOTION.os) : u < g + h ? MOTION.d : u < g + h + b ? MOTION.d * (1 - settle((u - g - h) / b, MOTION.os)) : 0;
      return { x: x + 0.1 * Math.sin(t * 97.3) + 0.1 * Math.sin(t * 41.1) };`,
    stillAt: 0.3,
  },
  // A ball dropped from 100 px that bounces 40, 15 and 5 px and lands: it never passes the ground, though the frame
  // nearest each landing falls short of it by up to a frame's fall.
  ballDrop: {
    units: { y: "px" },
    motion: "dropS: Math.sqrt(200 / 4000)",
    body: "return { y: t < MOTION.dropS ? -100 + 2000 * t * t : ball(t - MOTION.dropS, [40, 15, 5], 4000) };",
    stillAt: 4,
  },
  // An anticipation: a dip of 80 px, then a move to 100 that passes it by 55 (31% of the move from the dip), a hold, home.
  antic: {
    units: { x: "px" },
    motion: "dip: 80, os: 55",
    body: `const u = (t % MOTION.periodS) / MOTION.periodS;
      return { x: K(u, [[0, 0], [0.025, 0], [0.1, -MOTION.dip], [0.25, 100 + MOTION.os], [0.35, 100], [0.6, 100], [0.775, 0], [1, 0]]) };`,
    stillAt: 0.45,
  },
  // Straight moves out past a far rest and back by 30%, held 6 frames, the same on the way home: the frame steps
  // during each hold sit at the steps' mid level, so their noise must not move where the period is read.
  linearHold: {
    units: { x: "px" },
    motion: "holdS: 0.1, settleS: 0.2",
    body: `const P = MOTION.periodS, [h, a2] = [MOTION.holdS, MOTION.settleS], a1 = P / 2 - a2 - h;
      return { x: L(t % P, [[0, 0], [a1, 78], [a1 + a2, 60], [a1 + a2 + h, 60], [2 * a1 + a2 + h, -18], [P - h, 0], [P, 0]]) };`,
    stillAt: 0.45,
  },
  // A marquee that slides on at one steady speed: its start state never comes back, yet under reduced motion it is no
  // entrance.
  marquee: {
    units: { x: "px" },
    motion: "pxPerS: 60",
    body: "return { x: -MOTION.pxPerS * t };",
    stillAt: 0,
  },
  // Faults. An endless attention bounce: a hop that lands on a loose spring and never holds still.
  bounce: {
    units: { y: "px" },
    motion: "upShare: 0.2, hopPx: 40, zeta: 0.08",
    body: `const P = MOTION.periodS, ph = t % P, up = MOTION.upShare * P, w = 40 * (0.6 / P);
      return { y: ph < up ? -MOTION.hopPx * eout(ph / up) : -MOTION.hopPx * (1 - spr(ph - up, w, MOTION.zeta, P - up)) };`,
    stillAt: 0.1,
  },
  // A badge that springs in past full size by 60% of its move, holds, and shrinks away: past the 50% cap.
  overcap: {
    units: { s: "scale" },
    motion: "inShare: 0.1, springShare: 0.3, os: 0.6, holdShare: 0.4, outShare: 0.1",
    body: `const P = MOTION.periodS, u = (t % P) - MOTION.inShare * P;
      const end = MOTION.springShare * P, outAt = end + MOTION.holdShare * P;
      const s = u < outAt ? settle(u / end, MOTION.os) : 1 - ein((u - outAt) / (MOTION.outShare * P));
      return { s: Math.max(0, s) };`,
    stillAt: 0.5,
  },
  // A spring at load, once: no loop.
  springOnce: {
    units: { s: "scale" },
    motion: "atS: 0.2, zeta: 0.35, endS: 0.7",
    body: "return { s: spr(t - MOTION.atS, 22, MOTION.zeta, MOTION.endS) };",
    stillAt: 2,
  },
  // A loop that sets its lift in one frame each cycle, then eases back.
  pops: {
    units: { y: "px" },
    motion: "backShare: 0.4, liftPx: 20",
    body: "const ph = t % MOTION.periodS; return { y: t > 0 ? -MOTION.liftPx * (1 - eis(ph / (MOTION.backShare * MOTION.periodS))) : 0 };",
    stillAt: 0.1,
  },
  // A shimmer whose opacity dips 40% of its move past its low and comes back: opacity never overshoots, in a loop too.
  shimmerOver: {
    units: { o: "opacity" },
    motion: "low: 0.4, downShare: 0.3, holdShare: 0.2, upShare: 0.3",
    body: `const u = (t % MOTION.periodS) / MOTION.periodS, [d, h, w] = [MOTION.downShare, MOTION.holdShare, MOTION.upShare], m = 1 - MOTION.low;
      return { o: u < d ? 1 - m * settle(u / d, 0.4) : u < d + h ? MOTION.low : u < d + h + w ? MOTION.low + m * eis((u - d - h) / w) : 1 };`,
    stillAt: 0.4,
  },
  // Faults after the first 3 s. A one-time spring that passes its rest by 40%, 3.5 s after load.
  lateSpring: {
    units: { x: "px" },
    motion: "atS: 3.5, inS: 0.5",
    body: "return { x: 80 * settle((t - MOTION.atS) / MOTION.inS, 0.4) };",
    stillAt: 5,
  },
  // A value set in one frame, 4 s after load.
  latePop: {
    units: { x: "px" },
    motion: "atS: 4",
    body: "return { x: t >= MOTION.atS ? 80 : 0 };",
    stillAt: 5,
  },
  // A 7 s swing whose way home, 3.6 s into the cycle, passes its rest by 80%.
  lateSettle: {
    units: { x: "px" },
    motion: "goS: 0.6, holdS: 3, backS: 0.6, d: 60, os: 0.3, os2: 0.8",
    body: `const u = t % MOTION.periodS, [g, h, b] = [MOTION.goS, MOTION.holdS, MOTION.backS];
      const x = u < g ? MOTION.d * settle(u / g, MOTION.os) : u < g + h ? MOTION.d : u < g + h + b ? MOTION.d * (1 - settle((u - g - h) / b, MOTION.os2)) : 0;
      return { x };`,
    stillAt: 0.3,
  },
  // A 6 s loop that slides out, holds, and jumps home in one frame 4 s in.
  latePopLoop: {
    units: { x: "px" },
    motion: "goS: 0.6, homeAtS: 4",
    body: "const u = t % MOTION.periodS; return { x: u >= MOTION.homeAtS ? 0 : u < MOTION.goS ? 60 * settle(u / MOTION.goS, 0.2) : 60 };",
    stillAt: 0.3,
  },
  // A bob that holds still under reduced motion for 3.5 s, then runs anyway.
  reducedLate: {
    units: { y: "px" },
    motion: "bobPx: 40, reducedRunsAtS: 3.5",
    body: "return { y: -MOTION.bobPx * (1 - Math.cos((2 * Math.PI * t) / MOTION.periodS)) / 2 };",
    stillAt: 0.5,
  },
  // A move to 100 that passes it by 40 and rebounds to 95, then goes on to 200 from the rebound, once: the rebound
  // starts the next move, so the first is judged against it.
  stepOnRebound: {
    units: { x: "px" },
    motion: "",
    body: "return { x: K(t, [[0, 0], [0.3, 140], [0.45, 95], [0.8, 200]]) };",
    stillAt: 4,
  },
  // The same in a loop, passing 100 by 70 and rebounding to 90, then on to 200, a hold, home (lp-b2b-turn-os70).
  stepOnReboundLoop: {
    units: { x: "px" },
    motion: "",
    body: `const u = (t % MOTION.periodS) / MOTION.periodS;
      return { x: K(u, [[0, 0], [0.14, 170], [0.2, 90], [0.34, 200], [0.56, 200], [0.72, 0], [1, 0]]) };`,
    stillAt: 0.45,
  },
  // A slow move out, held 50 ms, and a way home that settles 80% past home: not a pulse, since it peaks after 500 ms
  // (lp-home-slow-os80-h50).
  homeSettle: {
    units: { x: "px" },
    motion: "",
    body: `const P = MOTION.periodS, u = t % P;
      return { x: u < 1 ? 100 * eis(u) : u < 1.05 ? 100 : 100 * (1 - settle((u - 1.05) / 0.6, 0.8)) };`,
    stillAt: 0.2,
  },
  // A hop that settles past its rest, its period 2% longer each cycle: it never repeats.
  drift: {
    units: { y: "px" },
    motion: "driftShare: 0.02, hopPx: 16, zeta: 0.35, upShare: 0.12, springShare: 0.4",
    body: `let start = 0, P = MOTION.periodS;
      while (start + P <= t) { start += P; P *= 1 + MOTION.driftShare; }
      const u = t - start, up = MOTION.upShare * MOTION.periodS, end = MOTION.springShare * MOTION.periodS;
      return { y: u < up ? -MOTION.hopPx * eout(u / up) : -MOTION.hopPx * (1 - spr(u - up, 9 / end, MOTION.zeta, end)) };`,
    stillAt: 0.1,
  },
};

export const loopSlug = (s: LoopSpec) => `${s.shape}-p${s.periodS}-lead${s.leadS}${s.stillAt === undefined ? "" : `-still${s.stillAt}`}`;

/** Writes the loop page at `root/slug.html` (with loops.js in `root/loops/`) and returns its path. */
export function writeLoopPage(root: string, s: LoopSpec): string {
  mkdirSync(path.join(root, "loops"), { recursive: true });
  if (!existsSync(path.join(root, "loops", "loops.js"))) copyFileSync(LOOPS_JS, path.join(root, "loops", "loops.js"));
  const shape = SHAPES[s.shape];
  const file = path.join(root, `${loopSlug(s)}.html`);
  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="motion-kit-kind" content="idle">
<title>idle: ${loopSlug(s)}</title>
<style>html { background: #fff } body { margin: 0 } .b { position: fixed; top: 320px; width: 40px; height: 40px; border-radius: 50%; background: #333 }</style>
</head>
<body>
<script>
const MOTION = { periodS: ${s.periodS}, leadS: ${s.leadS}, stillAtS: ${s.leadS + (s.stillAt ?? shape.stillAt) * s.periodS}, maxStepS: 0.05, ${shape.motion} };
const UNITS = ${JSON.stringify(shape.units)};
${HELPERS}
function valuesAt(T) {
  const t = Math.max(0, T - MOTION.leadS);
  ${shape.body}
}
</script>
<script src="loops/loops.js"></script>
</body>
</html>
`,
  );
  return file;
}
