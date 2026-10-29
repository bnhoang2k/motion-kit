import { describe, expect, it } from "vitest";
import { checkEdges, checkExtents, edgeOf, EDGES, extentsOf, HOLDERS_MS, membershipSteps, type Edge, type Extents } from "../src/gate/extents.ts";
import { FRAME_MS, type Frame } from "../src/gate/harness.ts";
import type { Box } from "../src/gate/objects.ts";

/** The guard on a 1280 by 720 page. `n` frames: frame `i` holds `values(i)` and the boxes `boxes(i)`. */
const VW = 1280;
const VH = 720;
const frames = (n: number, boxes: (i: number) => Record<string, Box>, values: (i: number) => Record<string, number>): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ ms: i * FRAME_MS, values: values(i), boxes: boxes(i) }));
const records = (...names: string[]) => Object.fromEntries(names.map((n) => [n, { box: [0, 0, 10, 10], moves: [] }]));
const GONE: Box = [0, 0, 1, 1];
/** The edge of the union of the drawn boxes (not gone, inside the viewport) of one frame. */
const edgeOfBoxes = (boxes: Record<string, Box>, edge: Edge) => edgeOf(Object.values(boxes).filter((b) => b[0] + b[2] > 0 && b[0] < VW && b[1] + b[3] > 0 && b[1] < VH), edge);
const A: Box = [100, 200, 40, 60];
const B: Box = [300, 150, 50, 80];
const C: Box = [200, 400, 30, 20];
/** The union of A, B and C: x 100..350, y 150..420. */
const EDGE_OF: Record<Edge, number> = { top: 150, bottom: 420, left: 100, right: 350, width: 250, height: 270 };
/** The declaration, geometry and group of an extent (checkEdges), and then all of the guard (checkExtents), which also reads how its edge moves. */
const check = (fs: Frame[], extents: Extents, names = ["a", "b", "c"], units: Record<string, string> = { v: "px" }) => checkEdges(fs, extents, records(...names), units, VW, VH);
const guard = (fs: Frame[], extents: Extents, names = ["a", "b", "c"], units: Record<string, string> = { v: "px" }) => checkExtents(fs, extents, records(...names), units, VW, VH);
const three = (v: number, edge: Edge = "top") => frames(10, () => ({ a: A, b: B, c: C }), () => ({ v }));

describe("extentsOf", () => {
  it("reads each value's edge and parts, and drops what is not one", () => {
    expect(extentsOf({ extents: { v: { edge: "top", parts: ["a", "b"] }, w: { edge: "height", parts: ["a", "b", "c"] } } })).toEqual({ v: { edge: "top", parts: ["a", "b"] }, w: { edge: "height", parts: ["a", "b", "c"] } });
    expect(extentsOf({ extents: { v: { edge: "middle", parts: ["a", "b"] }, w: { edge: "top", parts: "ab" }, x: null, y: { edge: "left", parts: ["a", 2] } } })).toEqual({});
    expect(extentsOf({ extents: ["top"] })).toEqual({});
    expect(extentsOf(undefined)).toEqual({});
  });
});

describe("checkExtents: a value is an edge of the union of its parts' boxes", () => {
  it.each(EDGES)("the %s of three drawn boxes passes, and 1 px off fails", (edge) => {
    expect(check(three(EDGE_OF[edge]), { v: { edge, parts: ["a", "b", "c"] } })).toEqual([]);
    expect(check(three(EDGE_OF[edge] + 1), { v: { edge, parts: ["a", "b", "c"] } })).toEqual([`extents: v is not the ${edge} of its parts at 0 ms`]);
  });

  it("holds within the px floor (0.5 px) and not beyond", () => {
    expect(check(three(150.5), { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([]);
    expect(check(three(150.6), { v: { edge: "top", parts: ["a", "b", "c"] } })).toHaveLength(1);
  });

  it("names the first frame where it fails", () => {
    const fs = frames(10, () => ({ a: A, b: B, c: C }), (i) => ({ v: i < 4 ? 150 : 140 }));
    expect(check(fs, { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([`extents: v is not the top of its parts at ${+(4 * FRAME_MS).toFixed(1)} ms`]);
  });

  it("follows the extreme part as it changes: another part becomes the top", () => {
    const fs = frames(
      20,
      (i) => ({ a: [100, 200 - i * 4, 40, 60], b: [300, 150 + i * 2, 50, 80], c: C }),
      (i) => ({ v: Math.min(200 - i * 4, 150 + i * 2, 400) }),
    );
    expect(check(fs, { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([]);
  });

  it("a part left out of the list leaves its edge out of the union", () => {
    expect(check(three(150), { v: { edge: "top", parts: ["a", "c"] } })).toEqual([`extents: v is not the top of its parts at 0 ms`]);
    expect(check(three(200), { v: { edge: "top", parts: ["a", "c"] } })).toEqual([]);
  });

  it("a gone part (1 by 1) or one wholly off the viewport is not in the union", () => {
    const fs = (box: Box) => frames(10, () => ({ a: A, b: box, c: C }), () => ({ v: 200 }));
    expect(check(fs(GONE), { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([]);
    expect(check(fs([300, -500, 50, 80]), { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([]);
    expect(check(fs([300, 100, 50, 80]), { v: { edge: "top", parts: ["a", "b", "c"] } })).toHaveLength(1);
  });

  it("a frame where no part is drawn is not judged; a frame where one is drawn is", () => {
    const fs = frames(
      30,
      (i) => (i < 5 ? { a: GONE, b: GONE, c: GONE } : i < 8 ? { a: A, b: GONE, c: GONE } : { a: A, b: B, c: C }),
      (i) => ({ v: i < 5 ? 0 : i < 8 ? 200 : 150 }),
    );
    expect(check(fs, { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([]);
    const wrong = frames(30, (i) => (i < 5 ? { a: GONE, b: GONE, c: GONE } : i < 8 ? { a: A, b: GONE, c: GONE } : { a: A, b: B, c: C }), (i) => ({ v: i < 8 ? 0 : 150 }));
    expect(check(wrong, { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([`extents: v is not the top of its parts at ${+(5 * FRAME_MS).toFixed(1)} ms`]);
  });
});

describe("checkExtents: it must be a group", () => {
  it("names fewer than 2 parts: a single body cannot be named", () => {
    expect(check(three(200), { v: { edge: "top", parts: ["a"] } })).toEqual(["extents: v names 1 part; an extent is the edge of 2 or more parts, and a single body cannot be named"]);
    expect(check(three(200), { v: { edge: "top", parts: ["a", "a"] } })).toEqual(["extents: v names 1 part; an extent is the edge of 2 or more parts, and a single body cannot be named"]);
  });

  it("a second part that is never drawn makes no group", () => {
    const fs = frames(30, () => ({ a: A, b: GONE, c: GONE }), () => ({ v: 200 }));
    expect(check(fs, { v: { edge: "top", parts: ["a", "b"] } })).toEqual(["extents: v has 2 parts drawn in 0 of 30 frames where any is; an extent is the edge of parts drawn together"]);
  });

  it("2 parts drawn in more than half of the frames where any is drawn make a group, and in half or fewer do not", () => {
    const some = (twoIn: number) => frames(20, (i) => (i < twoIn ? { a: A, b: B, c: C } : { a: A, b: GONE, c: GONE }), (i) => ({ v: i < twoIn ? 150 : 200 }));
    expect(check(some(11), { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual([]);
    expect(check(some(10), { v: { edge: "top", parts: ["a", "b", "c"] } })).toEqual(["extents: v has 2 parts drawn in 10 of 20 frames where any is; an extent is the edge of parts drawn together"]);
  });
});

describe("checkExtents: what is declared", () => {
  it("the value is a value the page reports, in px", () => {
    expect(check(three(150), { zz: { edge: "top", parts: ["a", "b"] } })).toEqual(["extents: zz is not a value the page reports"]);
    expect(check(three(150), { v: { edge: "top", parts: ["a", "b"] } }, ["a", "b", "c"], { v: "deg" })).toEqual(["extents: v is not a px value; an edge is in px"]);
    expect(check(three(150), { v: { edge: "top", parts: ["a", "b"] } }, ["a", "b", "c"], {})).toEqual(["extents: v is not a px value; an edge is in px"]);
  });

  it("each part is an object in the page's record", () => {
    expect(check(three(150), { v: { edge: "top", parts: ["a", "zz"] } })).toEqual(["extents: v names zz, which is not an object the page reports"]);
  });

  it("each extent is read on its own", () => {
    const fs = frames(10, () => ({ a: A, b: B, c: C }), () => ({ v: 150, w: 270 }));
    expect(check(fs, { v: { edge: "top", parts: ["a", "b", "c"] }, w: { edge: "height", parts: ["a", "b", "c"] } }, ["a", "b", "c"], { v: "px", w: "px" })).toEqual([]);
    expect(check(fs, { v: { edge: "top", parts: ["a", "b", "c"] }, w: { edge: "height", parts: ["a", "b"] } }, ["a", "b", "c"], { v: "px", w: "px" })).toEqual([expect.stringMatching(/^extents: w is not the height of its parts at /)]);
  });

  it("a page that reports no boxes has no part drawn", () => {
    const fs: Frame[] = Array.from({ length: 10 }, (_, i) => ({ ms: i * FRAME_MS, values: { v: 150 } }));
    expect(check(fs, { v: { edge: "top", parts: ["a", "b"] } })).toEqual(["extents: v has 2 parts drawn in 0 of 0 frames where any is; an extent is the edge of parts drawn together"]);
  });
});

describe("checkExtents: the edge passes from one part to another, and no part that holds it turns round", () => {
  const top = { v: { edge: "top" as const, parts: ["a", "b", "c"] } };
  const HELD = (part: string) => [`extents: v is held by ${part} throughout; an extent is an edge that passes from one part to another`];
  const TURNS = (part: string) => [expect.stringMatching(new RegExp(`^extents: v has ${part} turn round at [\\d.]+ ms while it holds the edge and then comes to rest; a body that passes its rest is no handover$`))];
  /** How far a body has gone after frame `i`, of a 100 px slide that springs 10% past its rest: x = 100 (1 - e^(-a u) (cos(w u) + (a / w) sin(w u))). */
  const springAt = (i: number) => {
    const [a, u] = [8, (i * FRAME_MS) / 1000];
    const w = (a * Math.PI) / -Math.log(0.1);
    return 100 * (1 - Math.exp(-a * u) * (Math.cos(w * u) + (a / w) * Math.sin(w * u)));
  };
  /** A 4 px rise in 12 frame steps that falls back in 24 from frame 20 (a soft pulse), and the same rise that holds. */
  const pulseAt = (i: number) => (i < 20 ? 0 : i < 32 ? 4 * Math.sin(((i - 20) / 12) * (Math.PI / 2)) : i < 56 ? 4 * Math.cos(((i - 32) / 24) * (Math.PI / 2)) : 0);
  const riseAt = (i: number) => (i < 20 ? 0 : i < 32 ? 4 * Math.sin(((i - 20) / 12) * (Math.PI / 2)) : 4);

  it("a value held by one part throughout is no extent, however many parts sit beside it", () => {
    expect(guard(three(150), top)).toEqual(HELD("b"));
    expect(guard(three(150), { v: { edge: "top", parts: ["b", "a"] } })).toEqual(HELD("b"));
  });

  it("a body that springs past its rest beside parts that never take the edge from it is held by one part", () => {
    const fs = frames(
      40,
      (i) => ({ a: A, b: [300, 150 - springAt(i), 50, 80], c: C }),
      (i) => ({ v: 150 - springAt(i) }),
    );
    expect(guard(fs, top)).toEqual(HELD("b"));
  });

  it("an edge that changes hands once, the new part going on in one direction, passes", () => {
    // b is below a's top (200) and rises past it: a holds the top, then b, which goes on up.
    const fs = frames(
      30,
      (i) => ({ a: A, b: [300, 260 - i * 8, 50, 80], c: C }),
      (i) => ({ v: Math.min(200, 260 - i * 8) }),
    );
    expect(guard(fs, top)).toEqual([]);
  });

  it("an edge that changed hands before still fails when the part that holds it then turns round", () => {
    // b is below a at first and rises past it (a holds the top, then b); b slides 120 px up and springs 10% past its rest.
    const fs = frames(
      60,
      (i) => ({ a: A, b: [300, 260 - 1.2 * springAt(i), 50, 80], c: C }),
      (i) => ({ v: Math.min(200, 260 - 1.2 * springAt(i)) }),
    );
    expect(guard(fs, top)).toEqual(TURNS("b"));
  });

  // Three parts hold the top in turn: a runs off down, c holds it, then b rises past c and springs 10% past its rest. With a alone
  // (c far below), b has one partner and its turn is found; with c between them, three parts hold the edge and none is read.
  const inTurn = (partner: boolean) =>
    frames(
      90,
      (i) => ({ a: [100, 100 + i * 10, 40, 60], b: [300, 260 - 1.2 * springAt(i), 50, 80], c: partner ? [200, 160, 30, 20] : C }),
      (i) => ({ v: Math.min(100 + i * 10, 260 - 1.2 * springAt(i), partner ? 160 : 400) }),
    );
  it("an edge that three parts hold in turn around a turn is the edge of a group: a part's turn at it is not read", () => {
    expect(guard(inTurn(false), top)).toEqual(TURNS("b"));
    expect(guard(inTurn(true), top)).toEqual([]);
  });

  // Three parts hold the top in turn early (c rises past a in the first 13 frames and then holds still at 180), and then b, which sat
  // below, slides 120 px up from frame `start` and springs 10% past its rest, taking the edge from c. The turn comes 1 s or more after the
  // last frame where a held the top, so the three holders are not around it.
  const shuffleThenBody = (start: number, n = 400) =>
    frames(
      n,
      (i) => ({ a: [100, 200, 40, 60], c: [200, Math.max(180, 230 - 4 * i), 30, 20], b: [300, 240 - (i >= start ? 1.2 * springAt(i - start) : 0), 50, 80] }),
      (i) => ({ v: Math.min(200, Math.max(180, 230 - 4 * i), 240 - (i >= start ? 1.2 * springAt(i - start) : 0)) }),
    );
  it("three holders long before a turn do not excuse it: a body that springs past its rest 2 s after an intro shuffle is found", () => {
    expect(guard(shuffleThenBody(120), top)).toEqual(TURNS("b"));
  });

  it("the three holders count only within HOLDERS_MS of the turn: a shuffle just inside the window excuses it, and just outside it does not", () => {
    // a holds the top until c passes it at frame 8; b turns 34 frame steps after it starts. The window ends at HOLDERS_MS (60 steps) before the turn:
    // a start of 28 puts the turn at frame 62 (a still in the window), a start of 32 at frame 66 (a out of it).
    expect(HOLDERS_MS / FRAME_MS).toBeCloseTo(60, 6);
    expect(guard(shuffleThenBody(28), top)).toEqual([]);
    expect(guard(shuffleThenBody(32), top)).toEqual(TURNS("b"));
  });

  it("a soft turn of 4 px (a pulse that takes 12 frame steps to peak) is found, and a rise that holds is not", () => {
    // a runs off the top at once, so the top changes hands in the first frames; then b holds it alone.
    const fs = (rise: (i: number) => number) =>
      frames(
        80,
        (i) => ({ a: [100, 100 + i * 10, 40, 60], b: [300, 150 - rise(i), 50, 80], c: C }),
        (i) => ({ v: Math.min(100 + i * 10, 150 - rise(i)) }),
      );
    expect(guard(fs(pulseAt), top)).toEqual(TURNS("b"));
    expect(guard(fs(riseAt), top)).toEqual([]);
  });

  it("a card that goes on round its circle past its apex is no turn", () => {
    // Three cards on one circle of radius 200 round (500, 400), a quarter turn apart, turning 1.5 deg a frame: each takes the top in turn,
    // and the last passes its apex (where its height turns) and goes on.
    const card = (i: number, k: number): Box => {
      const phi = ((k * 90 + i * 1.5) * Math.PI) / 180;
      return [500 + 200 * Math.sin(phi) - 20, 400 - 200 * Math.cos(phi) - 30, 40, 60];
    };
    const fs = frames(
      150,
      (i) => ({ a: card(i, 0), b: card(i, 1), c: card(i, 2) }),
      (i) => ({ v: Math.min(card(i, 0)[1], card(i, 1)[1], card(i, 2)[1]) }),
    );
    expect(guard(fs, top)).toEqual([]);
  });

  // The left edge of a decoy that runs right past a dot (it holds the left at first, then the dot does) and of a dot that slides 300 px
  // right and springs 10% past its rest: with a drift across the edge (down `drift` px a frame for 40 frames), the dot's whole box never
  // turns back, but its left coordinate does.
  const driftFrames = (drift: number, over = 1) =>
    frames(
      120,
      (i) => {
        const dot: Box = [100 + 3 * springAt(i) * over, 300 + drift * Math.min(i, 40), 60, 60];
        const decoy: Box = [40 + 960 * (1 - (1 - Math.min(1, i / 18)) ** 2), 500, 60, 60];
        return { a: decoy, b: dot, c: C };
      },
      (i) => ({ v: Math.min(40 + 960 * (1 - (1 - Math.min(1, i / 18)) ** 2), 100 + 3 * springAt(i) * over) }),
    );
  const left = { v: { edge: "left" as const, parts: ["a", "b"] } };

  it.each([0, 3, 5, 6, 7, 8])("a body that springs past its rest while it drifts %d px a frame across the edge is found", (drift) => {
    expect(guard(driftFrames(drift), left)).toEqual(TURNS("b"));
  });

  it("a part that turns round and goes on, never at rest, is no body past its rest", () => {
    // b rises 40 px, turns and falls on at 2 px a frame to the end: it never comes to rest.
    const rise = (i: number) => (i < 20 ? 0 : i < 40 ? 2 * (i - 20) : 40 - 2 * (i - 40));
    const fs = frames(
      120,
      (i) => ({ a: [100, 100 + i * 10, 40, 60], b: [300, 150 - rise(i), 50, 80], c: C }),
      (i) => ({ v: Math.min(100 + i * 10, 150 - rise(i)) }),
    );
    expect(guard(fs, top)).toEqual([]);
    // The same turn that then holds still for 100 ms is a body past its rest.
    const rests = frames(
      120,
      (i) => ({ a: [100, 100 + i * 10, 40, 60], b: [300, 150 - rise(Math.min(i, 60)), 50, 80], c: C }),
      (i) => ({ v: Math.min(100 + i * 10, 150 - rise(Math.min(i, 60))) }),
    );
    expect(guard(rests, top)).toEqual(TURNS("b"));
  });

  it("a width is read on each of its sides: the part at the right turns round while another holds the left", () => {
    // a holds the left throughout. c runs left under b's right side (c holds the right at first, then b does); b then slides right and springs past its rest.
    const box = (i: number): Record<string, Box> => ({ a: [100, 300, 40, 60], b: [150 + 3 * springAt(i), 400, 50, 60], c: [700 - 40 * Math.min(i, 24), 500, 50, 20] });
    const fs = frames(120, box, (i) => ({ w: edgeOfBoxes(box(i), "width") }));
    expect(guard(fs, { w: { edge: "width", parts: ["a", "b", "c"] } }, ["a", "b", "c"], { w: "px" })).toEqual(TURNS("b").map(() => expect.stringMatching(/^extents: w has b turn round at /)));
  });

  it("an edge is read through its sides: a width has two, and it passes if either side changes hands", () => {
    // a and b slide apart: a holds the left of the union, b the right. The width is held by a and b throughout.
    const apart = (cx: (i: number) => number) =>
      frames(
        30,
        (i) => ({ a: [400 - i * 5, 300, 40, 60], b: [600 + i * 5, 300, 40, 60], c: [cx(i), 500, 20, 20] }),
        (i) => ({ w: Math.max(600 + i * 5 + 40, cx(i) + 20) - (400 - i * 5) }),
      );
    const width = { w: { edge: "width" as const, parts: ["a", "b", "c"] } };
    const names = ["a", "b", "c"];
    expect(guard(apart(() => 500), width, names, { w: "px" })).toEqual([`extents: w is held by a throughout; an extent is an edge that passes from one part to another`]);
    // c runs right and passes b: the right side changes hands, so the width does.
    expect(guard(apart((i) => 500 + i * 12), width, names, { w: "px" })).toEqual([]);
  });
});

describe("membershipSteps", () => {
  const parts = { edge: "top" as const, parts: ["a", "b", "c"] };
  it("lists the frame before each step where a part comes back or goes gone, with how far the edge of the parts in both frames moved", () => {
    const fs = frames(
      12,
      (i) => ({ a: A, b: i >= 3 && i < 8 ? B : GONE, c: i >= 5 ? C : GONE }),
      () => ({ v: 0 }),
    );
    // b comes back at frame 3 (step 2 to 3), c at frame 5, b goes gone at frame 8. a is the only part in both frames of the first step, and does not move.
    expect([...membershipSteps(fs, parts, VW, VH)]).toEqual([
      [2 * FRAME_MS, 0],
      [4 * FRAME_MS, 0],
      [7 * FRAME_MS, 0],
    ]);
  });

  it("a part that jumps in a step in which another comes back shows in the change of the parts in both frames", () => {
    const fs = frames(
      8,
      (i) => ({ a: [100, i < 4 ? 200 : 100, 40, 60], b: B, c: i >= 4 ? C : GONE }),
      () => ({ v: 0 }),
    );
    // a jumps 100 px up, from the top at 150 (b) to the top at 100, in the step in which c comes back (frame 3 to 4): the top over a and b moves by -50.
    expect([...membershipSteps(fs, parts, VW, VH)]).toEqual([[3 * FRAME_MS, -50]]);
  });

  it("a step where every part comes or goes has nothing in both frames: 0", () => {
    const fs = frames(6, (i) => (i < 3 ? { a: GONE, b: GONE, c: GONE } : { a: A, b: B, c: C }), () => ({ v: 0 }));
    expect([...membershipSteps(fs, parts, VW, VH)]).toEqual([[2 * FRAME_MS, 0]]);
  });

  it("a part that moves while it stays drawn is no step, and a part that leaves the viewport is gone", () => {
    const moving = frames(8, (i) => ({ a: [100 + i * 50, 200, 40, 60], b: B, c: C }), () => ({ v: 0 }));
    expect(membershipSteps(moving, parts, VW, VH).size).toBe(0);
    const leaves = frames(8, (i) => ({ a: i < 4 ? A : [-500, 200, 40, 60], b: B, c: C }), () => ({ v: 0 }));
    expect([...membershipSteps(leaves, parts, VW, VH).keys()]).toEqual([3 * FRAME_MS]);
  });

  it("a part the extent does not name makes no step", () => {
    const fs = frames(8, (i) => ({ a: A, b: B, c: C, d: i < 4 ? A : GONE }), () => ({ v: 0 }));
    expect(membershipSteps(fs, parts, VW, VH).size).toBe(0);
  });
});
