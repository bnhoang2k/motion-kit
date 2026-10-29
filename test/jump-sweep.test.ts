import { describe, expect, it } from "vitest";
import { FAULTS, HONEST, passes, PHASES, type JumpCase } from "./jump-cases.ts";

/**
 * The jump sweep: the steep-ease jump rule (suddenJumps) must hold across the whole class of motion that crosses a
 * frame faster than the frame can show, at every start phase inside the frame, not only on the pages that prompted it.
 * Each row is a motion as a pure function of time, read by the real suddenJumps at PHASES start times spread over one
 * frame (jump-cases.ts), with no browser. A row asserts how many of its phases pass: every phase for honest motion, none
 * for a fault, so a change that moves any count turns a row red.
 */

/**
 * The rule's known limits (the suddenJumps paragraph of each kind's rules.md, and REFERENCE.md), with the phases that
 * pass. A row here is a written limit, not a fix waiting to land: a change that moves its count must say why.
 */
const KNOWN = new Map<string, number>([
  // Penner's and GSAP's expo.in leaves rest with a true jump of 2^-10 of the range, expo.out reaches its end with one, and
  // expoInOut has 2^-11 at each end: 2.4 to 4.9 px over 5000 px. These are real jumps, judged right.
  ["expoIn over 600 ms, 5000 px", 0],
  ["expoIn over 1200 ms, 5000 px", 0],
  ["expoOut over 600 ms, 5000 px", 0],
  ["expoOut over 1200 ms, 5000 px", 0],
  ["expoInOut over 1200 ms, 5000 px", 0],
  // A steep ease retargeted from where it is near its middle (an interrupted transition) stops dead at its fastest, so
  // the frame after it is no flank of a bell.
  ["cubic-bezier(0.98,0,0.02,1) over 300 ms retargeted at u = 0.5, back to 0", 0],
  ["cubic-bezier(0.98,0,0.02,1) over 300 ms retargeted at u = 0.5, on to 600", 2],
  ["cubic-bezier(0.98,0,0.02,1) over 300 ms retargeted at u = 0.53, back to 0", 11],
  ["cubic-bezier(0.98,0,0.02,1) over 300 ms retargeted at u = 0.53, on to 600", 21],
  ["cubic-bezier(0.98,0,0.02,1) over 600 ms retargeted at u = 0.5, back to 0", 0],
  ["cubic-bezier(0.98,0,0.02,1) over 600 ms retargeted at u = 0.5, on to 600", 6],
  ["cubic-bezier(0.98,0,0.02,1) over 600 ms retargeted at u = 0.53, back to 0", 49],
  ["cubic-bezier(0.98,0,0.02,1) over 600 ms retargeted at u = 0.53, on to 600", 50],
  // A linear tween of 20 ms is smooth at the eight sub-steps a frame, so no span of it stands out.
  ["a flick of 300 px on linear in 20 ms, in a hold", 64],
  ["a flick of 40 px on linear in 20 ms, one way inside a steady move", 64],
  ["a recoil of 40 px out on linear in 20 ms, and back over 400 ms", 64],
  // A flick of 2 to 10 ms that leaves a hold and is back at rest a frame later fails at every phase. One of 20 ms is
  // longer than a frame, is still moving a frame past its cusp, and is read as an ease-out or an ease-in; a recoil that
  // turns at a vertical tangent is read as a bounce.
  ["a flick of 300 px on circOut in 20 ms, in a hold", 46],
  ["a flick of 300 px on circIn in 20 ms, in a hold", 45],
  ["a recoil of 40 px out on circIn in 10 ms, and back over 400 ms", 47],
  ["a recoil of 40 px out on circIn in 20 ms, and back over 400 ms", 46],
  // A flick at the top of a fast ease-in moves about as much as the ease's own frame steps, so it is often not examined.
  ["a flick of 40 px on linear in 2 ms at the top of an ease-in, and back over 400 ms", 7],
  ["a flick of 40 px on linear in 5 ms at the top of an ease-in, and back over 400 ms", 49],
  ["a flick of 40 px on linear in 10 ms at the top of an ease-in, and back over 400 ms", 64],
  ["a flick of 40 px on linear in 20 ms at the top of an ease-in, and back over 400 ms", 64],
  ["a flick of 40 px on expoInOut in 2 ms at the top of an ease-in, and back over 400 ms", 7],
  ["a flick of 40 px on expoInOut in 5 ms at the top of an ease-in, and back over 400 ms", 7],
  ["a flick of 40 px on expoInOut in 10 ms at the top of an ease-in, and back over 400 ms", 4],
  ["a flick of 40 px on quintInOut in 2 ms at the top of an ease-in, and back over 400 ms", 8],
  ["a flick of 40 px on quintInOut in 5 ms at the top of an ease-in, and back over 400 ms", 7],
  ["a flick of 40 px on quintInOut in 10 ms at the top of an ease-in, and back over 400 ms", 4],
  ["a flick of 40 px on circInOut in 2 ms at the top of an ease-in, and back over 400 ms", 62],
  ["a flick of 40 px on circInOut in 5 ms at the top of an ease-in, and back over 400 ms", 60],
  ["a flick of 40 px on circInOut in 10 ms at the top of an ease-in, and back over 400 ms", 6],
  ["a flick of 40 px on cubic-bezier(1,0,0,1) in 2 ms at the top of an ease-in, and back over 400 ms", 12],
  ["a flick of 40 px on cubic-bezier(1,0,0,1) in 5 ms at the top of an ease-in, and back over 400 ms", 64],
  ["a flick of 40 px on cubic-bezier(1,0,0,1) in 10 ms at the top of an ease-in, and back over 400 ms", 4],
  ["a flick of 40 px on cubic-bezier(0.98,0,0.02,1) in 2 ms at the top of an ease-in, and back over 400 ms", 12],
  ["a flick of 40 px on cubic-bezier(0.98,0,0.02,1) in 5 ms at the top of an ease-in, and back over 400 ms", 62],
  ["a flick of 40 px on cubic-bezier(0.98,0,0.02,1) in 10 ms at the top of an ease-in, and back over 400 ms", 4],
  // A snap on the middle of a steep ease can be read as part of the ease, and a small snap on its flank may be too small
  // beside the ease's own steps to be examined (under 5% of the range and under 2.5 times the steps beside it).
  ["a snap of 10 px at u = 0.2 on cubic-bezier(1,0,0,1) over 300 ms", 17],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(1,0,0,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(1,0,0,1) over 300 ms", 18],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(1,0,0,1) over 300 ms", 64],
  ["a snap of 40 px at u = 0.5 on cubic-bezier(1,0,0,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.995,0,0.005,1) over 300 ms", 19],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.995,0,0.005,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.995,0,0.005,1) over 300 ms", 19],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.995,0,0.005,1) over 300 ms", 64],
  ["a snap of 40 px at u = 0.5 on cubic-bezier(0.995,0,0.005,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.98,0,0.02,1) over 300 ms", 25],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.98,0,0.02,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.98,0,0.02,1) over 300 ms", 25],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.98,0,0.02,1) over 300 ms", 64],
  ["a snap of 40 px at u = 0.5 on cubic-bezier(0.98,0,0.02,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.94,0,0.06,1) over 300 ms", 39],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.94,0,0.06,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.94,0,0.06,1) over 300 ms", 40],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.9,0,0.1,1) over 300 ms", 52],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.9,0,0.1,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.9,0,0.1,1) over 300 ms", 52],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.9,0,0.1,1) over 300 ms", 54],
  ["a snap of 10 px at u = 0.2 on expoInOut over 300 ms", 11],
  ["a snap of 10 px at u = 0.3 on expoInOut over 300 ms", 2],
  ["a snap of 10 px at u = 0.4 on expoInOut over 300 ms", 27],
  ["a snap of 10 px at u = 0.5 on expoInOut over 300 ms", 64],
  ["a snap of 10 px at u = 0.6 on expoInOut over 300 ms", 26],
  ["a snap of 10 px at u = 0.7 on expoInOut over 300 ms", 2],
  ["a snap of 10 px at u = 0.8 on expoInOut over 300 ms", 12],
  ["a snap of 20 px at u = 0.5 on expoInOut over 300 ms", 54],
  ["a snap of 10 px at u = 0.5 on circInOut over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on quintInOut over 300 ms", 45],
  ["a snap of 10 px at u = 0.4 on quintInOut over 300 ms", 36],
  ["a snap of 10 px at u = 0.5 on quintInOut over 300 ms", 64],
  ["a snap of 10 px at u = 0.6 on quintInOut over 300 ms", 35],
  ["a snap of 10 px at u = 0.8 on quintInOut over 300 ms", 46],
  ["a snap of 20 px at u = 0.5 on quintInOut over 300 ms", 22],
  // The same on the rest of the steep eases (0.99, 0.96, the easings.net presets) and on the two asymmetric ones, whose
  // middle is not at u = 0.5.
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.99,0,0.01,1) over 300 ms", 21],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.99,0,0.01,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.99,0,0.01,1) over 300 ms", 21],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.99,0,0.01,1) over 300 ms", 64],
  ["a snap of 40 px at u = 0.5 on cubic-bezier(0.99,0,0.01,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.96,0,0.04,1) over 300 ms", 32],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.96,0,0.04,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.96,0,0.04,1) over 300 ms", 32],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.96,0,0.04,1) over 300 ms", 64],
  ["a snap of 40 px at u = 0.5 on cubic-bezier(0.96,0,0.04,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.87,0,0.13,1) over 300 ms", 49],
  ["a snap of 10 px at u = 0.4 on cubic-bezier(0.87,0,0.13,1) over 300 ms", 12],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.87,0,0.13,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.6 on cubic-bezier(0.87,0,0.13,1) over 300 ms", 11],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.87,0,0.13,1) over 300 ms", 49],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.87,0,0.13,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.85,0,0.15,1) over 300 ms", 42],
  ["a snap of 10 px at u = 0.4 on cubic-bezier(0.85,0,0.15,1) over 300 ms", 16],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.85,0,0.15,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.6 on cubic-bezier(0.85,0,0.15,1) over 300 ms", 16],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.85,0,0.15,1) over 300 ms", 42],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.85,0,0.15,1) over 300 ms", 46],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.83,0,0.17,1) over 300 ms", 35],
  ["a snap of 10 px at u = 0.4 on cubic-bezier(0.83,0,0.17,1) over 300 ms", 16],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.83,0,0.17,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.6 on cubic-bezier(0.83,0,0.17,1) over 300 ms", 16],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(0.83,0,0.17,1) over 300 ms", 34],
  ["a snap of 20 px at u = 0.5 on cubic-bezier(0.83,0,0.17,1) over 300 ms", 42],
  ["a snap of 10 px at u = 0.2 on cubic-bezier(0.9,0,0.4,1) over 300 ms", 22],
  ["a snap of 10 px at u = 0.5 on cubic-bezier(0.9,0,0.4,1) over 300 ms", 6],
  ["a snap of 10 px at u = 0.6 on cubic-bezier(0.9,0,0.4,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.7 on cubic-bezier(0.9,0,0.4,1) over 300 ms", 40],
  ["a snap of 20 px at u = 0.6 on cubic-bezier(0.9,0,0.4,1) over 300 ms", 16],
  ["a snap of 10 px at u = 0.3 on cubic-bezier(1,0,0.5,1) over 300 ms", 30],
  ["a snap of 10 px at u = 0.6 on cubic-bezier(1,0,0.5,1) over 300 ms", 19],
  ["a snap of 10 px at u = 0.7 on cubic-bezier(1,0,0.5,1) over 300 ms", 64],
  ["a snap of 10 px at u = 0.8 on cubic-bezier(1,0,0.5,1) over 300 ms", 24],
  ["a snap of 20 px at u = 0.7 on cubic-bezier(1,0,0.5,1) over 300 ms", 35],
  // A snap where an ease leaves or reaches a hold at a vertical tangent is read as part of the cusp.
  ["a snap of 10 px at the start of circOut over 300 ms", 64],
  ["a snap of 20 px at the start of circOut over 300 ms", 63],
  ["a snap of 10 px at the start of cubic-bezier(0,1,0,1) over 300 ms", 64],
  ["a snap of 20 px at the start of cubic-bezier(0,1,0,1) over 300 ms", 64],
  ["a snap of 40 px at the start of cubic-bezier(0,1,0,1) over 300 ms", 64],
  ["a snap of 10 px at the end of circIn over 300 ms", 64],
  ["a snap of 20 px at the end of circIn over 300 ms", 54],
  ["a snap of 10 px at the end of cubic-bezier(1,0,1,0) over 300 ms", 64],
  ["a snap of 20 px at the end of cubic-bezier(1,0,1,0) over 300 ms", 64],
  ["a snap of 40 px at the end of cubic-bezier(1,0,1,0) over 300 ms", 64],
  // A 10 px snap at the start or end of a linear ease (300 px in 300 ms, 16.7 px a frame) is under the frame steps beside
  // it and not examined; one at the start of cubicOut sits beside that ease's own steep first frames.
  ["a snap of 10 px at the start of linear over 300 ms", 16],
  ["a snap of 10 px at the end of linear over 300 ms", 17],
  ["a snap of 10 px at the start of cubicOut over 300 ms", 58],
  // A jump under 5% of a long move is examined only when it is more than 2.5 times the frame steps beside it.
  ["a flick of 120 px on linear in 2 ms inside a move of 3000 px", 5],
  ["a flick of 120 px on linear in 5 ms inside a move of 3000 px", 11],
  ["a flick of 120 px on linear in 10 ms inside a move of 3000 px", 21],
  ["a flick of 120 px on linear in 20 ms inside a move of 3000 px", 64],
  ["a flick of 120 px on circInOut in 2 ms inside a move of 3000 px", 2],
  ["a flick of 120 px on circInOut in 5 ms inside a move of 3000 px", 4],
  ["a flick of 120 px on circInOut in 10 ms inside a move of 3000 px", 7],
  ["a flick of 120 px on circInOut in 20 ms inside a move of 3000 px", 14],
  ["a flick of 120 px on cubic-bezier(1,0,0,1) in 2 ms inside a move of 3000 px", 1],
  ["a flick of 120 px on cubic-bezier(1,0,0,1) in 5 ms inside a move of 3000 px", 1],
  ["a flick of 120 px on cubic-bezier(1,0,0,1) in 10 ms inside a move of 3000 px", 4],
  ["a flick of 120 px on cubic-bezier(1,0,0,1) in 20 ms inside a move of 3000 px", 6],
  ["a snap of 20 px in the middle of a move of 1000 px", 64],
  // A swing whose crossing of home is |s|^0.2 is a cusp far steeper than any ease's, and tops one bell as an ease does.
  ["a swing of 80 px over 300 ms that crosses home as |s|^0.2", 64],
  ["a swing of 80 px over 600 ms that crosses home as |s|^0.2", 64],
]);

const expected = (c: JumpCase) => KNOWN.get(c.name) ?? (c.honest ? (c.phases ?? PHASES) : 0);
const title = (c: JumpCase) => `${KNOWN.has(c.name) ? "known limit: " : ""}${c.name} passes at ${expected(c)} of ${c.phases ?? PHASES} phases`;

describe("the jump sweep: honest motion passes at every phase", () => {
  it.each(HONEST.map((c) => [title(c), c] as const))("%s", async (_, c) => {
    expect(await passes(c)).toBe(expected(c));
  });
});

describe("the jump sweep: a fault fails at every phase", () => {
  it.each(FAULTS.map((c) => [title(c), c] as const))("%s", async (_, c) => {
    expect(await passes(c)).toBe(expected(c));
  });
});

describe("the jump sweep's own rows", () => {
  it("every row has its own name, and every known limit names a row", () => {
    const names = [...HONEST, ...FAULTS].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...KNOWN.keys()].filter((n) => !names.includes(n))).toEqual([]);
  });
});
