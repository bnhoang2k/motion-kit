import { FRAME_MS, type Frame, type GatePage } from "../src/gate/harness.ts";
import { suddenJumps } from "../src/gate/self-checks.ts";

/**
 * The cases of the jump sweep (jump-sweep.test.ts): motion that crosses a frame faster than the frame can show, as pure
 * functions of time, each read by the real suddenJumps through a page that seeks the function. No browser: a case is
 * read at PHASES start times spread over one frame, so a verdict that hangs on where the motion falls in its frame
 * shows up as a count.
 */

/** How many start times over one frame each case is read at. */
export const PHASES = 64;

/**
 * Where in the frame the k-th of n start times falls, as a share of the frame. The even ones fall on k/n, which is on
 * the grids suddenJumps reads at (a motion that starts on a frame or on an even sub-step of it). The odd ones fall a
 * part of a phase later that changes from one to the next (the fractional part of k times the golden ratio), so they
 * land off every grid and at every place inside the finest sub-step, as start times written in rounded milliseconds do.
 */
export const phaseAt = (k: number, n: number) => (k + (k % 2) * ((k * 0.6180339887498949) % 1)) / n;

/** Where the motion of each case starts, before its phase. */
const START = 500;

/** One motion: its value at `ms`, when its motion starts at `start`. */
export type Motion = (start: number) => (ms: number) => number;

export type JumpCase = {
  name: string;
  /** Honest motion passes at every phase; a fault fails at every phase. */
  honest: boolean;
  unit: string;
  motion: Motion;
  /** The span suddenJumps reads, in ms from 0. */
  spanMs: number;
  phases?: number;
};

const clamp01 = (u: number) => Math.min(Math.max(u, 0), 1);

/** A CSS cubic-bezier, solved by bisection to float precision (what a browser draws). */
export const bez = (x1: number, y1: number, x2: number, y2: number) => {
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
  return (u: number) => {
    if (u <= 0 || u >= 1) return clamp01(u);
    let [lo, hi] = [0, 1];
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < u) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
};

const outOf = (e: (u: number) => number) => (u: number) => 1 - e(1 - u);
const inOutOf = (e: (u: number) => number) => (u: number) => (u < 0.5 ? e(2 * u) / 2 : 1 - e(2 - 2 * u) / 2);
const BACK = 1.70158;

/** Easing curves as the libraries write them (Penner's, which Motion and GSAP follow). */
export const EASES: Record<string, (u: number) => number> = {
  linear: clamp01,
  // Penner's expo.in leaves 0 with a true jump of 2^-10 of the range; GSAP's too.
  expoIn: (u) => (u <= 0 ? 0 : 2 ** (10 * clamp01(u) - 10)),
  expoOut: (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(u))),
  expoInOut: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2),
  circIn: (u) => 1 - Math.sqrt(1 - clamp01(u) ** 2),
  circOut: (u) => Math.sqrt(1 - (1 - clamp01(u)) ** 2),
  circInOut: (u) => inOutOf((v) => 1 - Math.sqrt(1 - clamp01(v) ** 2))(clamp01(u)),
  quintIn: (u) => clamp01(u) ** 5,
  quintOut: (u) => outOf((v) => v ** 5)(clamp01(u)),
  quintInOut: (u) => inOutOf((v) => v ** 5)(clamp01(u)),
  cubicIn: (u) => clamp01(u) ** 3,
  cubicOut: (u) => outOf((v) => v ** 3)(clamp01(u)),
  cubicInOut: (u) => inOutOf((v) => v ** 3)(clamp01(u)),
  backIn: (u) => ((v) => (BACK + 1) * v ** 3 - BACK * v * v)(clamp01(u)),
  backOut: (u) => outOf((v) => (BACK + 1) * v ** 3 - BACK * v * v)(clamp01(u)),
  backInOut: (u) => {
    const c = BACK * 1.525;
    const v = clamp01(u);
    return v < 0.5 ? ((2 * v) ** 2 * ((c + 1) * 2 * v - c)) / 2 : ((2 * v - 2) ** 2 * ((c + 1) * (2 * v - 2) + c) + 2) / 2;
  },
};

/** The steep in-out eases: cubic-bezier(x1,0,1-x1,1) from a cube-root cusp (x1 = 1) down to the easings.net presets. */
export const STEEP: Record<string, (u: number) => number> = Object.fromEntries(
  [1, 0.995, 0.99, 0.98, 0.96, 0.94, 0.9, 0.87, 0.85, 0.83].map((x1) => [`cubic-bezier(${x1},0,${+(1 - x1).toFixed(3)},1)`, bez(x1, 0, +(1 - x1).toFixed(3), 1)]),
);

/** Steep eases that are not symmetric, and eases that leave or reach a hold at a vertical tangent. */
export const EDGE: Record<string, (u: number) => number> = Object.fromEntries(
  [
    [0.9, 0, 0.4, 1],
    [1, 0, 0.5, 1],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 1, 0.3, 1],
    [0, 1, 0.2, 1],
    [0, 0.8, 0.2, 1],
  ].map(([a, b, c, d]) => [`cubic-bezier(${a},${b},${c},${d})`, bez(a!, b!, c!, d!)]),
);

/** A tween of `by` from `from` over `ms`, on `ease`, that starts at `start`. */
const tween = (from: number, by: number, ms: number, ease: (u: number) => number) => (start: number) => (t: number) => from + by * ease((t - start) / ms);

/** The ranges an honest tween covers: [label, unit, from, by]. Each is a few unit floors to thousands of them. */
export const RANGES: [string, string, number, number][] = [
  ["scale 1 to 1.02", "scale", 1, 0.02],
  ["opacity 0.9 to 1", "opacity", 0.9, 0.1],
  ["4 px", "px", 0, 4],
  ["8 px", "px", 0, 8],
  ["20 px", "px", 0, 20],
  ["300 px", "px", 0, 300],
  ["5000 px", "px", 0, 5000],
];

export const DURATIONS = [150, 300, 600, 1200];

/** The span a motion of `ms` needs: its start, a frame of phase, the motion and a quarter second after it. */
const spanFor = (ms: number) => Math.ceil(START + FRAME_MS + ms + 250);

function honestTweens(): JumpCase[] {
  const out: JumpCase[] = [];
  const all = { ...STEEP, ...Object.fromEntries(Object.entries(EASES).filter(([n]) => n !== "linear")), ...EDGE };
  for (const [ease, e] of Object.entries(all))
    for (const ms of DURATIONS)
      for (const [range, unit, from, by] of RANGES) out.push({ name: `${ease} over ${ms} ms, ${range}`, honest: true, unit, motion: tween(from, by, ms, e), spanMs: spanFor(ms) });
  return out;
}

/** A tween of 300 px on `ease` retargeted at progress `u` from where it is, to `to`, over the same time on the same ease. */
const retarget = (ease: (u: number) => number, ms: number, u: number, to: number) => (start: number) => {
  const at = start + u * ms;
  const from = 300 * ease(u);
  return (t: number) => (t < at ? 300 * ease((t - start) / ms) : from + (to - from) * ease((t - at) / ms));
};

function honestRetargets(): JumpCase[] {
  const b98 = STEEP["cubic-bezier(0.98,0,0.02,1)"]!;
  return [300, 600].flatMap((ms) =>
    [0.5, 0.53].flatMap((u) =>
      [
        ["back to 0", 0],
        ["on to 600", 600],
      ].map(([where, to]): JumpCase => ({ name: `cubic-bezier(0.98,0,0.02,1) over ${ms} ms retargeted at u = ${u}, ${where}`, honest: true, unit: "px", motion: retarget(b98, ms, u, to as number), spanMs: spanFor(2 * ms) })),
    ),
  );
}

/** The eases a flick is made on. */
const FLICK_EASES = ["linear", "expoInOut", "quintInOut", "circInOut", "cubic-bezier(1,0,0,1)", "cubic-bezier(0.98,0,0.02,1)"];
const easeOf = (name: string) => EASES[name] ?? STEEP[name] ?? EDGE[name]!;
const settle = bez(0, 0, 0.2, 1);

function flicks(): JumpCase[] {
  const out: JumpCase[] = [];
  for (const ease of FLICK_EASES)
    for (const ms of [2, 5, 10, 20]) {
      const e = easeOf(ease);
      // A hold, 300 px in a few ms, and a hold: a teleport drawn as a tween.
      out.push({ name: `a flick of 300 px on ${ease} in ${ms} ms, in a hold`, honest: false, unit: "px", motion: tween(0, 300, ms, e), spanMs: spanFor(200) });
      // 40 px in a few ms, one way, inside a steady move of 300 px over 600 ms (8.3 px a frame).
      out.push({
        name: `a flick of 40 px on ${ease} in ${ms} ms, one way inside a steady move`,
        honest: false,
        unit: "px",
        motion: (start) => (t) => 300 * clamp01((t - start + 300) / 600) + 40 * e((t - start) / ms),
        spanMs: spanFor(600),
      });
      // 40 px out in a few ms, and back over 400 ms on an ease-out: a recoil.
      out.push({
        name: `a recoil of 40 px out on ${ease} in ${ms} ms, and back over 400 ms`,
        honest: false,
        unit: "px",
        motion: (start) => (t) => (t <= start ? 0 : t < start + ms ? 40 * e((t - start) / ms) : 40 * (1 - settle((t - start - ms) / 400))),
        spanMs: spanFor(450),
      });
    }
  // 40 px out in a few ms at the top of a 300 ms ease-in of 260 px, and back over 400 ms on an ease-out: a turn made by a flick.
  for (const ease of FLICK_EASES)
    for (const ms of [2, 5, 10, 20]) {
      const e = easeOf(ease);
      out.push({
        name: `a flick of 40 px on ${ease} in ${ms} ms at the top of an ease-in, and back over 400 ms`,
        honest: false,
        unit: "px",
        motion: (start) => (t) => (t < start ? 260 * EASES.cubicIn!((t - start + 300) / 300) : t < start + ms ? 260 + 40 * e((t - start) / ms) : 300 * (1 - settle((t - start - ms) / 400))),
        spanMs: spanFor(450),
      });
    }
  // A flick that leaves a hold at a vertical tangent, or reaches one: an ease-out or an ease-in squeezed into a few ms.
  for (const ease of ["circOut", "circIn"])
    for (const ms of [2, 5, 10, 20]) out.push({ name: `a flick of 300 px on ${ease} in ${ms} ms, in a hold`, honest: false, unit: "px", motion: tween(0, 300, ms, easeOf(ease)), spanMs: spanFor(200) });
  // A recoil out on circIn: it turns at the vertical tangent where the flick ends.
  for (const ms of [2, 5, 10, 20])
    out.push({
      name: `a recoil of 40 px out on circIn in ${ms} ms, and back over 400 ms`,
      honest: false,
      unit: "px",
      motion: (start) => (t) => (t <= start ? 0 : t < start + ms ? 40 * EASES.circIn!((t - start) / ms) : 40 * (1 - settle((t - start - ms) / 400))),
      spanMs: spanFor(450),
    });
  return out;
}

/** The steep eases a snap is planted on: every steep in-out ease, both asymmetric ones, and the library's steep eases. */
const SNAP_EASES = [...Object.keys(STEEP), "cubic-bezier(0.9,0,0.4,1)", "cubic-bezier(1,0,0.5,1)", "expoInOut", "circInOut", "quintInOut"];

function snaps(): JumpCase[] {
  const out: JumpCase[] = [];
  // A snap of 10 to 40 px on the way along a 300 ms ease of 300 px less the snap.
  for (const ease of SNAP_EASES)
    for (const by of [10, 20, 40])
      for (const u of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        const e = easeOf(ease);
        out.push({ name: `a snap of ${by} px at u = ${u} on ${ease} over 300 ms`, honest: false, unit: "px", motion: (start) => (t) => (300 - by) * e((t - start) / 300) + (t >= start + u * 300 ? by : 0), spanMs: spanFor(300) });
      }
  // A snap where an ease leaves or reaches a hold: before its start, or after its end. At a vertical tangent (an ease-out
  // that leaves a hold, an ease-in that reaches one) and on the ordinary eases, steep or not.
  const ends: [string, (u: number) => number, "start" | "end"][] = [
    ["circOut", EASES.circOut!, "start"],
    ["cubic-bezier(0,1,0,1)", EDGE["cubic-bezier(0,1,0,1)"]!, "start"],
    ["circIn", EASES.circIn!, "end"],
    ["cubic-bezier(1,0,1,0)", EDGE["cubic-bezier(1,0,1,0)"]!, "end"],
    ...["linear", "cubicInOut", "cubicOut", "quintInOut", "cubic-bezier(0.98,0,0.02,1)", "cubic-bezier(0.9,0,0.4,1)"].flatMap((ease): [string, (u: number) => number, "start" | "end"][] => [
      [ease, easeOf(ease), "start"],
      [ease, easeOf(ease), "end"],
    ]),
  ];
  for (const [ease, e, where] of ends)
    for (const by of [10, 20, 40])
      out.push({
        name: `a snap of ${by} px at the ${where} of ${ease} over 300 ms`,
        honest: false,
        unit: "px",
        motion: (start) => (t) => (where === "start" ? (t < start ? 0 : by + (300 - by) * e((t - start) / 300)) : (300 - by) * e((t - start) / 300) + (t >= start + 300 ? by : 0)),
        spanMs: spanFor(300),
      });
  return out;
}

function small(): JumpCase[] {
  const out: JumpCase[] = [];
  // A jump under 5% of a long move: 120 px in a few ms inside 3000 px over 2000 ms (25 px a frame).
  for (const ease of ["linear", "circInOut", "cubic-bezier(1,0,0,1)"])
    for (const ms of [2, 5, 10, 20]) {
      const e = easeOf(ease);
      out.push({ name: `a flick of 120 px on ${ease} in ${ms} ms inside a move of 3000 px`, honest: false, unit: "px", motion: (start) => (t) => 3000 * clamp01((t - start + 1000) / 2000) + 120 * e((t - start) / ms), spanMs: spanFor(1100) });
    }
  // A snap of 20 px at the fastest point of a 1000 px move on a cubic in-out over 600 ms (about 42 px a frame there).
  out.push({ name: "a snap of 20 px in the middle of a move of 1000 px", honest: false, unit: "px", motion: (start) => (t) => 1000 * EASES.cubicInOut!((t - start + 300) / 600) + (t >= start ? 20 : 0), spanMs: spanFor(400) });
  // A 1 px snap: on a still value, and inside a slow drift of 0.25 px a frame.
  out.push({ name: "a snap of 1 px in a hold", honest: false, unit: "px", motion: (start) => (t) => (t >= start ? 1 : 0), spanMs: spanFor(200) });
  out.push({ name: "a snap of 1 px inside a drift of 0.25 px a frame", honest: false, unit: "px", motion: (start) => (t) => (0.25 * t) / FRAME_MS + (t >= start ? 1 : 0), spanMs: spanFor(200) });
  // A swing from -40 to 40 px whose crossing of home is |s|^0.2: a cusp far steeper than any ease, eased at its ends.
  for (const ms of [300, 600])
    out.push({
      name: `a swing of 80 px over ${ms} ms that crosses home as |s|^0.2`,
      honest: false,
      unit: "px",
      motion: (start) => (t) => {
        const s = 2 * clamp01((t - start) / ms) - 1;
        return 40 * Math.sign(s) * Math.abs(s) ** 0.2;
      },
      spanMs: spanFor(ms),
    });
  return out;
}

/** An underdamped spring (stiffness k, damping c, mass 1) from `x0` off its rest at `to`, with a start speed of `v0` px/s. */
const spring = (k: number, c: number, x0: number, v0: number, to: number) => (start: number) => (t: number) => {
  const s = (t - start) / 1000;
  if (s <= 0) return to + x0;
  const [w0, z] = [Math.sqrt(k), c / (2 * Math.sqrt(k))];
  const wd = w0 * Math.sqrt(1 - z * z);
  return to + Math.exp(-z * w0 * s) * (x0 * Math.cos(wd * s) + ((v0 + z * w0 * x0) / wd) * Math.sin(wd * s));
};

function honestSprings(): JumpCase[] {
  return [
    ["a stiff spring from 300 px off (k 1000, c 20)", spring(1000, 20, -300, 0, 300)],
    ["a stiffer spring from 300 px off (k 3000, c 30)", spring(3000, 30, -300, 0, 300)],
    ["a spring kicked from rest at 8000 px/s (k 500, c 15)", spring(500, 15, 0, 8000, 0)],
    ["a spring kicked from rest at 20000 px/s (k 2000, c 40)", spring(2000, 40, 0, 20000, 0)],
  ].map(([name, motion]): JumpCase => ({ name: name as string, honest: true, unit: "px", motion: motion as Motion, spanMs: spanFor(1500) }));
}

/** Out and back with a turn at a vertical tangent on both sides (a bounce off a wall): in on one ease, out on the other. */
function honestTurns(): JumpCase[] {
  const pairs: [string, (u: number) => number, (u: number) => number][] = [
    ["circIn, then back on circOut", EASES.circIn!, EASES.circOut!],
    ["cubic-bezier(1,0,1,0), then back on cubic-bezier(0,1,0,1)", EDGE["cubic-bezier(1,0,1,0)"]!, EDGE["cubic-bezier(0,1,0,1)"]!],
  ];
  return pairs.flatMap(([name, out, back]) =>
    [150, 300, 600, 1200].flatMap((ms) =>
      [
        ["20 px", 20],
        ["300 px", 300],
      ].map(([range, by]): JumpCase => ({
        name: `out ${range} on ${name}, legs of ${ms} ms`,
        honest: true,
        unit: "px",
        motion: (start) => (t) => {
          const u = (t - start) / ms;
          return (by as number) * (u <= 1 ? out(u) : 1 - back(u - 1));
        },
        spanMs: spanFor(2 * ms),
      })),
    ),
  );
}

export const HONEST: JumpCase[] = [...honestTweens(), ...honestRetargets(), ...honestSprings(), ...honestTurns()];
export const FAULTS: JumpCase[] = [...flicks(), ...snaps(), ...small()];

/** A page whose seek reads `f`: what suddenJumps reads of a `?seek` page, without a browser. */
export function functionPage(f: (ms: number) => number, unit: string): GatePage {
  let now = 0;
  const frame = (ms: number): Frame => ({ ms, values: { x: f(ms) } });
  const page = {
    seek: async (ms: number) => {
      now = ms;
    },
    state: async () => ({ values: { x: f(now) }, units: { x: unit }, objects: {}, events: {} }),
    frames: async (from: number, to: number, step = FRAME_MS) => {
      const out: Frame[] = [];
      for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(frame(from + i * step));
      return out;
    },
  };
  return page as unknown as GatePage;
}

/** The phases of `c` at which suddenJumps passes x, out of c.phases (PHASES by default). */
export async function passes(c: JumpCase): Promise<number> {
  const n = c.phases ?? PHASES;
  let count = 0;
  for (let k = 0; k < n; k++) {
    const f = c.motion(START + phaseAt(k, n) * FRAME_MS);
    if ((await suddenJumps(functionPage(f, c.unit), ["x"], [], c.spanMs)).length === 0) count++;
  }
  return count;
}
