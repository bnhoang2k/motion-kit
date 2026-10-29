import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeBrowser, FRAME_MS, openPage, playwrightOrNull, replayInput, type GatePage, type InputSamples } from "../../src/gate/harness.ts";
import { emptySelector, missingChannel, noHook, realClockGap, suddenJumps, zeroFrames } from "../../src/gate/self-checks.ts";
import { inputChanges } from "../../src/gate/synthetic-input.ts";
import { lineAt, poseLine, poses, restsOf } from "../../src/gate/poses.ts";
import { rangeOf, stillEps } from "../../src/gate/series.ts";
import { printVerdict, runChecks, type Check, type Verdict } from "../../src/gate/verdict.ts";
import { FAULTY, HONEST, writeSteppedBar, type SteppedPage } from "./stepped-pages.ts";
import { dragSamples, writeJumpPage, type JumpPage } from "./jump-pages.ts";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages");
const page = (name: string) => path.join(PAGES, `${name}.html`);

const SELECTORS = ["#dot"];
const TRACE = { channels: [{ name: "x" }, { name: "o" }] };
const TRACE_WITH_EXTRA = { channels: [{ name: "x" }, { name: "o" }, { name: "scale" }] };
/** One press: the pointer jumps from x 20 to x 320 in the first 50 ms, then holds there until 1 s. */
const POINTER: InputSamples = {
  kind: "pointer",
  samples: Array.from({ length: 61 }, (_, i): [number, number, number] => [i * FRAME_MS, Math.min(320, 20 + 6 * i * FRAME_MS), 100]),
};
const CHECK_NAMES = ["noHook", "emptySelector", "zeroFrames", "missingChannel", "suddenJumps", "realClockGap"] as const;
type CheckName = (typeof CHECK_NAMES)[number];

/** Every self-check on one page, keyed by name. */
function selfChecks(p: GatePage, trace = TRACE, cuts: number[] = []): Record<CheckName, Check> {
  return {
    noHook: () => noHook(p),
    emptySelector: () => emptySelector(p, SELECTORS),
    zeroFrames: async () => zeroFrames(await p.frames(0, 1000)),
    missingChannel: async () => missingChannel(trace, await p.frames(0, 1000)),
    suddenJumps: () => suddenJumps(p, trace.channels.map((c) => c.name), cuts),
    realClockGap: () => realClockGap(p),
  };
}

/** The names of the checks that report a failure, and the names of the checks that throw. */
async function outcomes(checks: Record<CheckName, Check>) {
  const failed: string[] = [];
  const threw: string[] = [];
  for (const name of CHECK_NAMES) {
    try {
      if ((await checks[name]()).length > 0) failed.push(name);
    } catch {
      threw.push(name);
    }
  }
  return { failed, threw };
}

async function withPage<T>(name: string, fn: (p: GatePage) => Promise<T>, opts: Parameters<typeof openPage>[1] = {}): Promise<T> {
  const p = await openPage(page(name), opts);
  try {
    return await fn(p);
  } finally {
    await p.close();
  }
}

afterAll(async () => {
  await closeBrowser();
});

describe("the harness", () => {
  it("finds playwright", async () => {
    expect(await playwrightOrNull()).not.toBeNull();
  });

  it("sets __input before the page loads", async () => {
    const input = [{ t: 0, x: 1 }, { t: 16.7, x: 2 }];
    const seen = await withPage("good-seek", (p) => p.page.evaluate(() => (window as unknown as { __input: unknown }).__input), { input });
    expect(seen).toEqual(input);
  });

  it("opens with reduced motion on request", async () => {
    const reduced = await withPage("good-seek", (p) => p.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), { reducedMotion: true });
    expect(reduced).toBe(true);
  });

  it("seeks on the fixed clock and reads the page state", async () => {
    await withPage("good-seek", async (p) => {
      expect(p.page.url()).toMatch(/\?seek$/);
      await p.seek(250);
      const at250 = await p.state();
      // x follows 200 px with tau 0.25 s: after 0.25 s it is 200 * (1 - e^-1).
      expect(at250.values.x).toBeCloseTo(200 * (1 - Math.exp(-1)), 6);
      await p.seek(250);
      expect((await p.state()).values.x).toBe(at250.values.x);
      const frames = await p.frames(0, 100);
      expect(frames.map((f) => Math.round(f.ms * 10) / 10)).toEqual([0, 16.7, 33.3, 50, 66.7, 83.3, 100]);
      expect(frames[0]?.values).toEqual({ x: 0, o: 0 });
      await p.seek(3000);
      expect(Object.keys((await p.state()).events)).toEqual(["rest"]);
    });
  });

  describe("a ?seek page is a pure function of time, so a time read once is read once", () => {
    /** Counts the seeks the page itself runs, whoever asks. */
    const countSeeks = (p: GatePage) =>
      p.page.evaluate(() => {
        const w = window as unknown as { __seek(ms: number): void; __seeks: number };
        const seek = w.__seek;
        w.__seeks = 0;
        w.__seek = (ms) => {
          w.__seeks++;
          seek(ms);
        };
      });
    const seeks = (p: GatePage) => p.page.evaluate(() => (window as unknown as { __seeks: number }).__seeks);

    it("a second read of the same times runs no seek for them, and returns the same frames", async () => {
      await withPage("good-seek", async (p) => {
        const first = await p.frames(0, 500);
        await countSeeks(p);
        const again = await p.frames(0, 500);
        expect(again).toEqual(first);
        expect(await seeks(p)).toBe(0);
        // A shorter read inside the first one: the page already stands at 500, so it seeks only to end where this read ends.
        expect(await p.frames(0, 250)).toEqual(first.slice(0, 16));
        expect(await seeks(p)).toBeLessThanOrEqual(1);
      });
    });

    it("a read that reaches past the first one seeks only the new times", async () => {
      await withPage("good-seek", async (p) => {
        await p.frames(0, 500);
        await countSeeks(p);
        const longer = await p.frames(0, 600);
        expect(longer).toHaveLength(37);
        expect(await seeks(p)).toBe(6);
      });
    });

    it("framesAt shares the reads with frames, and a read leaves the page at the last time it was asked for", async () => {
      await withPage("good-seek", async (p) => {
        await p.frames(0, 500);
        const [f250] = await p.framesAt([250]);
        await p.framesAt([0, 500]);
        await p.framesAt([250]);
        // The page stands at 250 as if it had been seeked there.
        expect((await p.state()).values).toEqual(f250!.values);
      });
    });

    it("the frames a read returns are the caller's: changing them does not change the next read", async () => {
      await withPage("good-seek", async (p) => {
        const first = await p.frames(0, 100);
        const copy = structuredClone(first);
        for (const f of first) {
          f.values.x = -1;
          f.ms = -1;
        }
        expect(await p.frames(0, 100)).toEqual(copy);
      });
    });
  });

  it("lists each element whose transform, opacity or filter changed, as a selector", async () => {
    await withPage("good-seek", async (p) => {
      expect(await p.changedElements()).toEqual([]);
      await p.frames(0, 200);
      expect(await p.changedElements()).toEqual(["#dot"]);
    });
  });

  it("collects console output", async () => {
    await withPage("good-seek", async (p) => {
      expect(p.console()).toEqual([]);
      await p.page.evaluate(() => console.warn("planted"));
      expect(p.console()).toEqual(["warning: planted"]);
    });
  });

  it("counts live rAF callbacks in a time window", async () => {
    type Live = { __state(): { events: Record<string, number> } };
    await withPage(
      "good-seek",
      async (p) => {
        // Both windows start from times read on the page, so a slow load cannot shift them.
        const loaded = await p.page.evaluate(() => performance.now());
        expect(await p.rafCountAfter(loaded, 300)).toBeGreaterThan(5);
        // The dot rests after about 2.5 s, and the live loop stops there. The wait polls on a timer,
        // because rAF polling would add callbacks of its own.
        await p.page.waitForFunction(() => (window as unknown as Live).__state().events.rest !== undefined, null, { timeout: 20_000, polling: 50 });
        const rested = await p.page.evaluate(() => performance.now());
        expect(await p.rafCountAfter(rested, 500)).toBe(0);
      },
      { seek: false },
    );
  });

  it("replays scroll samples as scroll steps, timed by the wall clock", async () => {
    await withPage(
      "follow-pointer",
      async (p) => {
        const start = performance.now();
        await replayInput(p, { kind: "scroll", samples: [[0, 0], [50, 400], [100, 800]] });
        expect(performance.now() - start).toBeGreaterThanOrEqual(99);
        expect(await p.page.evaluate(() => window.scrollY)).toBe(800);
      },
      { seek: false },
    );
  });
});

describe("the self-checks", () => {
  it("good-seek passes every self-check", async () => {
    await withPage("good-seek", async (p) => {
      expect(await outcomes(selfChecks(p))).toEqual({ failed: [], threw: [] });
      expect((await runChecks(selfChecks(p))).status).toBe("passed");
    });
  });

  it("a page with no hook fails noHook, and the run does not pass", async () => {
    await withPage("no-hook", async (p) => {
      expect(await noHook(p)).toEqual(["noHook: the page has no window.__seek", "noHook: the page has no window.__state"]);
      const v = await runChecks(selfChecks(p));
      expect(v.status).not.toBe("passed");
      expect(v.failures).toContain("noHook: the page has no window.__seek");
    });
  });

  const faults: [string, CheckName, typeof TRACE][] = [
    ["empty-selector", "emptySelector", TRACE],
    ["empty-state", "zeroFrames", TRACE],
    ["good-seek", "missingChannel", TRACE_WITH_EXTRA],
    ["step", "suddenJumps", TRACE],
    ["no-cap", "realClockGap", TRACE],
  ];

  it.each(faults)("%s fails exactly %s", async (name, check, trace) => {
    await withPage(name, async (p) => {
      expect(await outcomes(selfChecks(p, trace))).toEqual({ failed: [check], threw: [] });
      const v = await runChecks(selfChecks(p, trace));
      expect(v.status).toBe("failed");
      expect(v.failures.length).toBeGreaterThan(0);
      expect(v.failures.every((f) => f.startsWith(`${check}: `))).toBe(true);
    });
  });

  it("a cut in the trace lets the step page pass suddenJumps", async () => {
    await withPage("step", async (p) => {
      expect(await suddenJumps(p, ["x", "o"], [])).not.toEqual([]);
      expect(await suddenJumps(p, ["x", "o"], [510])).toEqual([]);
    });
  });

  describe("suddenJumps tells a speed corner from a jump", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-harness-corner-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const TEMPLATE = readFileSync(path.join(PAGES, "corner/corner.html"), "utf8");
    const EMPTY_CFG = "const CFG = { moves: [] };";
    const FRACTIONS = [0, 0.24, 0.48, 0.72, 0.96];
    const at = (frame: number, share = 0) => (frame + share) * FRAME_MS;
    let written = 0;
    type Move = { type: "linear"; start: number; stop: number; speed: number } | { type: "expOut"; start: number; to: number; k: number } | { type: "expIn"; start: number; to: number; amp: number; g: number } | { type: "spring"; start: number; to: number; w: number; z: number } | { type: "jump"; at: number; by: number };

    /** suddenJumps on x for a copy of the corner page with these moves planted. */
    async function run(moves: Move[]): Promise<string[]> {
      expect(TEMPLATE).toContain(EMPTY_CFG);
      const file = path.join(root, `corner-${written++}.html`);
      writeFileSync(file, TEMPLATE.replace(EMPTY_CFG, `const CFG = ${JSON.stringify({ moves })};`));
      const p = await openPage(file);
      try {
        return await suddenJumps(p, ["x"], [], 1500);
      } finally {
        await p.close();
      }
    }
    const jumps = expect.arrayContaining([expect.stringMatching(/^suddenJumps: x moves /)]);

    it.each(FRACTIONS)("a value that holds, jumps one object length in one frame and holds fails, jumping %s of a frame in", async (f) => {
      expect(await run([{ type: "jump", at: at(30, f), by: 40 }])).toEqual(jumps);
    });

    it.each(FRACTIONS)("a jump of 3 times the speed in the middle of a steady move fails, %s of a frame in", async (f) => {
      expect(await run([{ type: "linear", start: 0, stop: at(20), speed: 20 }, { type: "jump", at: at(10, f), by: 60 }])).toEqual(jumps);
    });

    it.each(FRACTIONS)("a linear move started %s of a frame in passes", async (f) => {
      expect(await run([{ type: "linear", start: at(3, f), stop: at(10), speed: 40 }])).toEqual([]);
    });

    it.each(FRACTIONS)("a linear move stopped %s of a frame in passes", async (f) => {
      expect(await run([{ type: "linear", start: at(3), stop: at(9, f), speed: 40 }])).toEqual([]);
    });

    it.each(FRACTIONS)("a linear move started and stopped %s of a frame in passes", async (f) => {
      expect(await run([{ type: "linear", start: at(3, f), stop: at(9, f), speed: 40 }])).toEqual([]);
    });

    // Largest sub-step 62.5 against 2.5 times its 12.5 px neighbour: the jump hides inside a fast move.
    it.each(FRACTIONS)("a jump of half the speed inside a 100 px a frame move fails, %s of a frame in", async (f) => {
      expect(await run([{ type: "linear", start: 0, stop: at(20), speed: 100 }, { type: "jump", at: at(10, f), by: 50 }])).toEqual(jumps);
    });

    // A 1 px kink inside a 40 px a frame move, as a measured centre makes when one grain leaves it: its sub-step stands
    // out by ratio but carries 6 of the frame's 41, under JUMP_CARRIES, so nothing on screen jumps.
    it.each(FRACTIONS)("a 1 px kink inside a 40 px a frame move passes, %s of a frame in", async (f) => {
      expect(await run([{ type: "linear", start: 0, stop: at(20), speed: 40 }, { type: "jump", at: at(10, f), by: 1 }])).toEqual([]);
    });

    // A jump of 20 inside a 40 px a frame move carries 25 of the frame's 60, over JUMP_CARRIES.
    it.each(FRACTIONS)("a jump of 20 inside a 40 px a frame move fails, %s of a frame in", async (f) => {
      expect(await run([{ type: "linear", start: 0, stop: at(20), speed: 40 }, { type: "jump", at: at(10, f), by: 20 }])).toEqual(jumps);
    });

    // The gap left after a frame: an ease-out that keeps 0.75 of its gap each frame, and one that keeps 0.826.
    it.each(FRACTIONS.flatMap((f) => [0.75, 0.826].map((left): [number, number] => [left, f])))("an exponential ease-out from rest that keeps %s of its gap a frame, started %s of a frame in, passes", async (left, f) => {
      expect(await run([{ type: "expOut", start: at(3, f), to: 400, k: 1 - left }])).toEqual([]);
    });

    // A hold, a 40 px tween of a few milliseconds and a hold is a jump at 60 fps. The tween splits over 1 to 4 adjacent sub-steps.
    it.each(FRACTIONS.flatMap((f) => [1, 2, 4, 6, 8].map((ms): [number, number] => [ms, f])))("a hold, a 40 px tween of %s ms and a hold fails, %s of a frame in", async (ms, f) => {
      const start = at(10, f);
      expect(await run([{ type: "linear", start, stop: start + ms, speed: 40 / (ms / FRAME_MS) }])).toEqual(jumps);
    });

    // Sharper ease-outs than the row above: the step after the start keeps only 0.2 to 0.6 of the gap.
    it.each(FRACTIONS.flatMap((f) => [0.2, 0.25, 0.4, 0.5, 0.6].map((left): [number, number] => [left, f])))("an exponential ease-out from rest that keeps %s of its gap a frame, started %s of a frame in, passes", async (left, f) => {
      expect(await run([{ type: "expOut", start: at(3, f), to: 400, k: 1 - left }])).toEqual([]);
    });

    // The speed of the fast-move fault, without the jump.
    it.each(FRACTIONS)("a linear move at 100 px a frame, started %s of a frame in, passes", async (f) => {
      expect(await run([{ type: "linear", start: at(3, f), stop: at(13, f), speed: 100 }])).toEqual([]);
    });

    // A speed corner of 3 times, inside one frame step.
    it.each(FRACTIONS)("a linear move that speeds from 20 to 60 px a frame in one frame, %s of a frame in, passes", async (f) => {
      expect(await run([{ type: "linear", start: 0, stop: at(10, f), speed: 20 }, { type: "linear", start: at(10, f), stop: at(14), speed: 60 }])).toEqual([]);
    });

    it("an exponential ease-in speeding up 1.155 a frame, started mid-frame, passes", async () => {
      expect(await run([{ type: "expIn", start: at(3, 0.5), to: 400, amp: 5, g: 1.155 }])).toEqual([]);
    });

    // A damped spring from rest: fast and sharp at its start, then ringing around its target.
    it.each(FRACTIONS.flatMap((f) => [[100, 0.3], [100, 0.7], [120, 0.3], [120, 0.7]].map(([w, z]): [number, number, number] => [w!, z!, f])))("a damped spring of %s rad/s and damping %s, started %s of a frame in, passes", async (w, z, f) => {
      expect(await run([{ type: "spring", start: at(3, f), to: 400, w, z }])).toEqual([]);
    });
  });

  describe("a page opened with stepped values", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-harness-stepped-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it.each(["twos24", "threes24-ends8", "stop12"])("%s: frames(), framesAt() and state() read y as its pose line; rawFrames() as its drawings", async (slug) => {
      const file = writeSteppedBar(root, slug, HONEST[slug]!);
      const p = await openPage(file, { stepped: ["y"] });
      try {
        const raw = (await p.rawFrames(0, 7000)).map((f) => f.values.y!);
        const line = poseLine(raw, stillEps(rangeOf(raw)));
        const lined = (await p.frames(0, 3000)).map((f) => f.values.y!);
        lined.forEach((y, i) => expect(y, `frame ${i}`).toBeCloseTo(line[i]!, 9));
        // Raw holds its drawings; the line moves through them.
        expect(new Set(raw.slice(0, 180)).size).toBeLessThan(new Set(lined).size);
        const at = 1234.5;
        expect((await p.framesAt([at]))[0]!.values.y).toBeCloseTo(lineAt(poses(raw, stillEps(rangeOf(raw))), restsOf(poses(raw, stillEps(rangeOf(raw)))), at / FRAME_MS)!, 9);
        await p.seek(60 * FRAME_MS);
        expect((await p.state()).values.y).toBeCloseTo(line[60]!, 9);
      } finally {
        await p.close();
      }
    });

    it("objects: state() reads the box the page drew, frames() carries it, and a page without objects keeps its frames as they were", async () => {
      const file = writeSteppedBar(root, "twos24-objects", HONEST.twos24!);
      const p = await openPage(file, { stepped: ["y"] });
      try {
        await p.seek(500);
        // The page is read before state(), which reads ahead and leaves the page at a later time.
        const drawn = await p.page.evaluate(() => {
          const r = document.getElementById("dot")!.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
        const s = await p.state();
        expect(Object.keys(s.objects)).toEqual(["dot"]);
        expect(s.objects.dot!.moves).toEqual(["y"]);
        s.objects.dot!.box.forEach((n, i) => expect(n, `box[${i}]`).toBeCloseTo(drawn[i]!, 0));
        // Boxes are raw on frames, framesAt and rawFrames: the same dot position at the same time.
        const [framed] = await p.framesAt([500]);
        const [rawed] = await p.rawFrames(500, 500);
        expect(framed!.boxes!.dot).toEqual(s.objects.dot!.box);
        expect(rawed!.boxes!.dot).toEqual(s.objects.dot!.box);
        expect((await p.frames(0, 1000, 100)).every((f) => f.boxes && f.boxes.dot!.length === 4)).toBe(true);
        // On the grid the box follows the drawing: y changes the box top, raw and lined alike.
        const raw = await p.rawFrames(0, 2000);
        const tops = new Set(raw.map((f) => f.boxes!.dot![1]));
        expect(tops.size).toBe(new Set(raw.map((f) => f.values.y)).size);
      } finally {
        await p.close();
      }
      const plain = await openPage(page("kinds/idle-good"));
      try {
        const s = await plain.state();
        expect(s.objects).toEqual({});
        expect((await plain.frames(0, 100, 50)).every((f) => !("boxes" in f))).toBe(true);
        expect(Object.keys((await plain.frames(0, 50, 50))[0]!).sort()).toEqual(["ms", "values"]);
      } finally {
        await plain.close();
      }
    });

    it("objects: the record's halo passes through as the page sets it, frames carry the scroll where they carry boxes, and viewport() is the page's size", async () => {
      const halo = writeSteppedBar(root, "twos24-halo", { ...HONEST.twos24!, halo: 12 });
      const text = writeSteppedBar(root, "twos24-halo-text", { ...HONEST.twos24!, halo: "4" });
      const none = writeSteppedBar(root, "twos24-no-halo", HONEST.twos24!);
      // Both read paths: the in-page one, and the stepped grid.
      for (const opts of [{}, { stepped: ["y"] }]) {
        const read = async (file: string) => {
          const p = await openPage(file, opts);
          try {
            await p.seek(500);
            const dot = (await p.state()).objects.dot!;
            const raw = await p.rawFrames(0, 500, 100);
            expect(raw.map((f) => f.scroll)).toEqual([0, 0, 0, 0, 0, 0]);
            expect(await p.viewport()).toEqual(p.page.viewportSize());
            return dot;
          } finally {
            await p.close();
          }
        };
        expect((await read(halo)).halo).toBe(12);
        // A halo that is not a number comes through as it is, for the objects rule to name.
        expect((await read(text)).halo).toBe("4");
        expect("halo" in (await read(none))).toBe(false);
      }
      // A page that scrolls itself under ?seek: the scroll is window.scrollY at each frame, on both read paths.
      const scrolls = path.join(PAGES, "kinds/drawn-scroll.html");
      for (const opts of [{}, { stepped: ["f"] }]) {
        const p = await openPage(scrolls, { ...opts, input: [[0, 0], [100, 400]] });
        try {
          const raw = await p.rawFrames(0, 300, 100);
          expect(raw.map((f) => f.scroll)).toEqual([0, 400, 400, 400]);
          expect(raw.every((f) => f.boxes?.bar !== undefined)).toBe(true);
        } finally {
          await p.close();
        }
      }
    });

    it("sizePx: the stepped dot is drawn at the size the page sets, and its unit says what y does to it", async () => {
      const boxAt = async (name: string, page: SteppedPage, ms: number) => {
        const p = await openPage(writeSteppedBar(root, name, page), { stepped: ["y"] });
        try {
          await p.seek(ms);
          const s = await p.state();
          expect(s.objects.dot!.moves).toEqual(["y"]);
          return s.objects.dot!.box;
        } finally {
          await p.close();
        }
      };
      const near = (got: number[], want: number[]) => want.forEach((n, i) => expect(got[i], `box[${i}]`).toBeCloseTo(n, 1));
      // The dot sits at left 600, top 320, so its centre is (600 + size / 2, 320 + size / 2).
      near(await boxAt("size12", { drawings: [[0, 0]], sizePx: 12 }, 100), [600, 320, 12, 12]);
      near(await boxAt("size-default", { drawings: [[0, 0]] }, 100), [600, 320, 40, 40]);
      near(await boxAt("size-px", { drawings: [[0, 0], [500, -30]], sizePx: 12 }, 600), [600, 290, 12, 12]);
      near(await boxAt("size-scale", { drawings: [[0, 1], [500, 2]], unit: "scale", sizePx: 12 }, 600), [594, 314, 24, 24]);
      near(await boxAt("size-deg", { drawings: [[0, 0], [500, 45]], unit: "deg", sizePx: 12 }, 600), [606 - 6 * Math.SQRT2, 326 - 6 * Math.SQRT2, 12 * Math.SQRT2, 12 * Math.SQRT2]);
      near(await boxAt("size-opacity", { drawings: [[0, 1], [500, 0.5]], unit: "opacity", sizePx: 12 }, 600), [600, 320, 12, 12]);
      near(await boxAt("size-index", { drawings: [[0, 0], [500, 3]], unit: "index", sizePx: 12 }, 600), [600, 320, 12, 12]);
      // An object that is not drawn reports 1 by 1.
      near(await boxAt("size-gone", { drawings: [[0, 1], [500, 0]], unit: "opacity", sizePx: 12 }, 600), [600, 320, 1, 1]);
    });

    it("objects: the live grid dot and the scroll flipbook bar report the box they draw and the values that move it", async () => {
      const bars = path.join(PAGES, "kinds");
      const live = await openPage(path.join(bars, "bar-live-grid/index.html"), { stepped: ["x", "y"], input: [[0, 100, 100, 1], [500, 190, 130, 1]] });
      try {
        await live.seek(0);
        // Faded out at load, so not drawn.
        expect((await live.state()).objects.dot!.box.slice(2)).toEqual([1, 1]);
        await live.seek(500);
        const s = await live.state();
        expect(s.objects.dot!.moves).toEqual(["x", "y", "o"]);
        expect(s.objects.dot!.box.slice(2)).toEqual([40, 40]);
        const at = (ms: number) => live.seek(ms).then(() => live.state()).then((r) => r.objects.dot!.box);
        // 90 px of x and 30 of y land on the 20 px grid: the box moves in whole cells.
        const [a, b] = [await at(0), await at(500)];
        expect([b[0] - a[0], b[1] - a[1]]).toEqual([100, 40]);
      } finally {
        await live.close();
      }
      const scroll = await openPage(path.join(bars, "bar-scroll-flipbook/index.html"), { stepped: ["f"], input: [[0, 0], [100, 400]] });
      try {
        await scroll.seek(300);
        const s = await scroll.state();
        expect(Object.keys(s.objects)).toEqual(["bar"]);
        expect(s.objects.bar!.moves).toEqual(["f"]);
        // The bar is drawn at the flipbook's drawing, not at the smoothed scroll position.
        // state() gives f as its pose line; rawFrames() as the page drew it.
        const [raw] = await scroll.rawFrames(300, 300);
        expect(raw!.values.f).not.toBe(raw!.values.p);
        expect(s.objects.bar!.box[0]).toBeCloseTo(raw!.values.f!, 1);
        expect(s.objects.bar!.box.slice(2)).toEqual([40, 40]);
      } finally {
        await scroll.close();
      }
    });

    it("objects: idle pages report their dot only when they hold the lift in poses, and scroll pages their bar only in the stepped variant", async () => {
      const kinds = path.join(PAGES, "kinds");
      const idle = await openPage(path.join(kinds, "bar-stepped/index.html"), { stepped: ["y"] });
      try {
        await idle.seek(0);
        // Faded out at load, so not drawn.
        expect((await idle.state()).objects.dot!.box.slice(2)).toEqual([1, 1]);
        await idle.seek(750);
        const s = await idle.state();
        expect(Object.keys(s.objects)).toEqual(["dot", "ring"]);
        expect(s.objects.dot!.moves).toEqual(["y", "o"]);
        // The ring is drawn as its 6 px shadow, so its box is the ring's grown by 6 px; it has faded out by 750 ms.
        expect(s.objects.ring!.moves).toEqual(["f"]);
        expect(s.objects.ring!.box.slice(2)).toEqual([1, 1]);
        expect(s.objects.dot!.box[3]).toBe(40);
        // The dot is 40 px at the page centre; its top is lifted by y.
        const [raw] = await idle.rawFrames(750, 750);
        expect(raw!.values.y).not.toBe(0);
        expect(s.objects.dot!.box[1]).toBeCloseTo((await idle.page.evaluate(() => innerHeight)) / 2 - 40 + raw!.values.y!, 1);
        await idle.seek(130);
        const ring = (await idle.state()).objects.ring!.box;
        const [w, h] = await idle.page.evaluate(() => [innerWidth, innerHeight]);
        expect(ring).toEqual([w! / 2 - 46, h! / 2 - 46, 52, 52]);
      } finally {
        await idle.close();
      }
      const smooth = await openPage(path.join(kinds, "idle-good.html"));
      try {
        expect((await smooth.state()).objects).toEqual({});
      } finally {
        await smooth.close();
      }
      const stepped = await openPage(path.join(kinds, "scroll-stepped.html"), { input: [[0, 0], [100, 400]] });
      try {
        await stepped.seek(300);
        const s = await stepped.state();
        expect(s.objects.bar!.moves).toEqual(["p", "z", "o"]);
        // Scaled about its centre: z times 40 px wide.
        expect(s.objects.bar!.box[2]).toBeCloseTo(40 * s.values.z!, 1);
      } finally {
        await stepped.close();
      }
      const plain = await openPage(path.join(kinds, "scroll-good.html"));
      try {
        expect((await plain.state()).objects).toEqual({});
      } finally {
        await plain.close();
      }
    });

    it("suddenJumps judges a stepped value at its drawing rate: honest twos pass, a spike drawing fails, unmarked twos fail", async () => {
      const honest = await openPage(writeSteppedBar(root, "twos24", HONEST.twos24!));
      const pop = await openPage(writeSteppedBar(root, "twos24-pop", FAULTY["twos24-pop"]!));
      try {
        expect(await suddenJumps(honest, ["y"], [], 3000, null, ["y"])).toEqual([]);
        expect(await suddenJumps(honest, ["y"], [], 3000)).toEqual([expect.stringMatching(/^suddenJumps: y moves [-\d.]+ in the frame after [\d.]+ ms, and [-\d.]+ in its first half; no cut marks it$/)]);
        expect(await suddenJumps(pop, ["y"], [], 3000, null, ["y"])).toEqual([expect.stringMatching(/^suddenJumps: y jumps 0.6 object lengths in the drawing at [\d.]+ ms, a spike; no cut marks it$/)]);
      } finally {
        await honest.close();
        await pop.close();
      }
    });

    it("a seek and a state read cost at most 2 page seeks once the grid is read", async () => {
      const p = await openPage(writeSteppedBar(root, "twos24", HONEST.twos24!), { stepped: ["y"] });
      try {
        await p.frames(0, 3000);
        await p.page.evaluate(() => {
          const w = window as unknown as { __seek(ms: number): void; __seeks: number };
          const seek = w.__seek;
          w.__seeks = 0;
          w.__seek = (ms) => {
            w.__seeks++;
            seek(ms);
          };
        });
        await p.seek(1000);
        await p.state();
        expect(await p.page.evaluate(() => (window as unknown as { __seeks: number }).__seeks)).toBeLessThanOrEqual(2);
      } finally {
        await p.close();
      }
    });
  });

  it("suddenJumps leaves out an input step at its own pace: a 1:1 follower passes, a pop in a move's frame does not", async () => {
    // live-good follows the pointer 1:1, so under ?seek each pointer sample moves the dot in one step (100 px here).
    const live = path.join(PAGES, "kinds/live-good.html");
    expect(inputChanges(POINTER, { flags: false, end: false })).toHaveLength(4);
    const p = await openPage(live, { input: POINTER.samples });
    try {
      expect(await suddenJumps(p, ["x"], [], 1000)).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
      expect(await suddenJumps(p, ["x"], [], 1000, POINTER)).toEqual([]);
      // The same steps as scroll input are the scroll's steps: the same pace.
      const scroll: InputSamples = { kind: "scroll", samples: POINTER.samples.map(([ms, x]): [number, number] => [ms, x]) };
      expect(await suddenJumps(p, ["x"], [], 1000, scroll, [], true)).toEqual([]);
    } finally {
      await p.close();
    }
    // The step page's opacity pops 0 to 1 at 510 ms; a pointer move in that frame does not excuse it.
    const moveAtPop: InputSamples = { kind: "pointer", samples: [[0, 20, 100], [510, 25, 100]] };
    await withPage("step", async (s) => {
      expect(await suddenJumps(s, ["o"], [], 1000, moveAtPop)).toEqual([expect.stringMatching(/^suddenJumps: o moves 1 in the frame after 500 ms/)]);
    });
  });

  it("inputChanges: the press, each change and the end; with flags false and end false, only the moves", () => {
    const input: InputSamples = { kind: "pointer", samples: [[0, 10, 10, 1], [10, 20, 10, 1], [20, 20, 10, 0], [30, 20, 10, 1], [40, 20, 10, 1]] };
    expect(inputChanges(input)).toEqual([0, 10, 20, 30, 40]);
    expect(inputChanges(input, { flags: false, end: false })).toEqual([0, 10]);
    expect(inputChanges(null)).toEqual([]);
  });

  it("realClockGap replays pointer input: a capped input page passes, one with no cap fails", async () => {
    const run = (name: string) => withPage(name, (p) => realClockGap(p, { input: POINTER }), { input: POINTER.samples });
    expect(await run("follow-pointer")).toEqual([]);
    const failures = await run("follow-pointer-no-cap");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^realClockGap: x moves [\d.]+ in the frame after the 2000 ms gap; its one-frame budget is [\d.]+$/);
  });

  it("realClockGap fails an input page it cannot drive, and drive replaces the default replay", async () => {
    await withPage(
      "follow-pointer",
      async (p) => {
        expect(await realClockGap(p)).toEqual([
          "realClockGap: the live loop ran 0 frames and stopped before the 2000 ms gap; a page that moves only on input needs input or drive",
        ]);
        let drove = 0;
        const idle = async () => void drove++;
        expect(await realClockGap(p, { input: POINTER, drive: idle })).toEqual(["realClockGap: the live loop ran 0 frames and stopped before the 2000 ms gap"]);
        expect(drove).toBe(1);
        expect(await realClockGap(p, { drive: (live) => replayInput(live, POINTER) })).toEqual([]);
      },
      { input: POINTER.samples },
    );
  });

  it("zeroFrames fails on no frames at all", () => {
    expect(zeroFrames([])).toEqual(["zeroFrames: 0 of 0 frames hold a value"]);
  });
});

describe("suddenJumps reads motion between frames on any page (jump-pages.ts)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-harness-jumps-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let written = 0;
  type Opts = { input?: InputSamples; unplayed?: boolean; cuts?: number[]; spanMs?: number; notes?: string[] };

  /** suddenJumps on every value of a page written from `spec`; the page plays `input`, and suddenJumps is told of it unless `unplayed`. */
  async function run(spec: JumpPage, opts: Opts = {}): Promise<string[]> {
    const p = await openPage(writeJumpPage(root, `jump-${written++}`, spec), opts.input ? { input: opts.input.samples } : {});
    try {
      const names = Object.keys((await p.state()).values);
      const told = opts.unplayed ? null : (opts.input ?? null);
      return await suddenJumps(p, names, opts.cuts ?? [], opts.spanMs ?? 3000, told, [], told?.kind === "scroll", opts.notes);
    } finally {
      await p.close();
    }
  }
  const px = { x: "px" };
  const jumps = [expect.stringMatching(/^suddenJumps: x moves /)];

  describe("a step is examined when it is large next to the steps beside it, not only when it is 5% of the range", () => {
    // A 1660 px fly-in, then a layout shift of 60 px (3.6% of the range) with nothing beside it.
    it("a 60 px layout pop after a 1660 px fly-in fails", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: -1600 + tween(ms, 300, 600, 1600, outCubic) + (ms >= 1800.4 ? 60 : 0) }; }" })).toEqual(jumps);
    });

    // A long scroll-linked move at up to 35 px a frame, a 100 px pop in its direction (4.2% of 2400).
    it("a 100 px pop in a long smooth move fails", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: -0.8 * 3000 * inOut(ms / 3000) - (ms >= 1400.2 ? 100 : 0) }; }" })).toEqual(jumps);
    });

    // The centre of 20 drifting grains, one of which teleports 400 px: a kink of 20 px in a 600 px move.
    it("a measured centre that kinks by 20 px in a 600 px move fails", async () => {
      const body = `function values(ms) {
        let sum = 0;
        for (let g = 0; g < 20; g++) sum += g * 10 + 600 * inOut((ms - g * 20) / 2400) + 8 * Math.sin(ms / 300 + g) + (g === 7 && ms >= 1500.2 ? 400 : 0);
        return { x: sum / 20 };
      }`;
      expect(await run({ units: px, body })).toEqual(jumps);
    });

    // An ease-out that stops short and snaps to rest: 8, 10 and 12 px of 300.
    it.each([8, 10, 12])("an ease-out that snaps the last %s px to rest fails", async (by) => {
      expect(await run({ units: px, body: `function values(ms) { const v = ${300 - by} * outCubic((ms - 1000) / 900); return { x: ms >= 1700.3 ? 300 : v }; }` })).toEqual(jumps);
    });

    it("a smooth long move, an ease-out and a ticker at a steady speed pass", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: -1600 + tween(ms, 300, 600, 1600, outCubic) }; }" })).toEqual([]);
      expect(await run({ units: px, body: "function values(ms) { return { x: -2400 * ms / 3000 }; }" })).toEqual([]);
      expect(await run({ units: px, body: "function values(ms) { return { x: spring(ms, 1000, 300, 25, 0.3) }; }" })).toEqual([]);
    });
  });

  describe("a NaN frame fails its channel", () => {
    const body = "function values(ms) { if (ms > 2490 && ms < 2510) return { x: 0 / 0 }; return { x: ms >= 1500.3 ? 300 : 0 }; }";
    it("a teleport and a NaN frame after it", async () => {
      expect(await run({ units: px, body })).toEqual(expect.arrayContaining([expect.stringMatching(/^suddenJumps: x is NaN at 2500 ms; /)]));
    });

    it("a NaN frame in a value that moves smoothly", async () => {
      expect(await run({ units: px, body: "function values(ms) { if (ms > 990 && ms < 1010) return { x: 0 / 0 }; return { x: ms / 10 }; }" })).toEqual([expect.stringMatching(/^suddenJumps: x is NaN at 1000 ms; /)]);
    });
  });

  describe("a value whose whole range is within its unit floor is still", () => {
    it("float noise of 1e-5 px and a 1/64 px snap pass", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: 100 + 1e-5 * Math.sin(ms * 7) }; }" })).toEqual([]);
      expect(await run({ units: px, body: "function values(ms) { return { x: Math.round((100 + 0.05 * ms / 3000) * 64) / 64 }; }" })).toEqual([]);
    });

    // The centre of a rotating rectangle is 200 up to rounding: its range is 1e-14 and no unit is declared.
    it("rounding noise in a value that declares no unit passes", async () => {
      const body = "function values(ms) { const a = ms / 300, c = Math.cos(a), s = Math.sin(a); return { x: [[-50, -30], [50, -30], [50, 30], [-50, 30]].map(([x, y]) => 200 + c * x - s * y).reduce((p, q) => p + q, 0) / 4 }; }";
      expect(await run({ body })).toEqual([]);
    });

    it("the same snap in a value with a visible range fails", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: ms >= 1500.3 ? 1 : 0 }; }" })).toEqual(jumps);
      expect(await run({ units: px, body: "function values(ms) { return { x: ms >= 1500.3 ? 0.4 : 0 }; }" })).toEqual([]);
    });
  });

  describe("under a drag a value's step is compared with the pointer's step in the same frame", () => {
    const drag = (frames: number, perFrame: number): InputSamples => ({ kind: "pointer", samples: dragSamples(60, frames, perFrame) });
    const follows = (extra: string) => ({ kind: "live" as const, units: px, body: `function values(ms) { const px = pointerX(ms) - 400; const f = Math.floor(ms / F + 1e-6); return { x: px${extra} }; }` });

    it("a value that follows the pointer one to one passes", async () => {
      expect(await run(follows(""), { input: drag(60, 10) })).toEqual([]);
    });

    it("a value that follows a hand that moves every 6th frame passes", async () => {
      const sparse: InputSamples = { kind: "pointer", samples: Array.from({ length: 11 }, (_, i): [number, number, number, 1] => [(60 + 6 * i) * FRAME_MS, 400 + 60 * i, 300, 1]) };
      expect(await run(follows(""), { input: sparse })).toEqual([]);
    });

    // Two lurches of 150 px in two frames in a row at 10 px a frame: each is large next to the pointer's step, and
    // the other lurch beside it does not excuse it.
    it("two lurches in two frames in a row fail", async () => {
      expect(await run(follows(" + (f >= 90 ? 150 : 0) + (f >= 91 ? 150 : 0)"), { input: drag(60, 10) })).toEqual(jumps);
    });

    // The value follows the hand at 28 px a frame, and goes on at that speed after the hand lets go until it stops dead
    // at a wall three quarters of a frame later: a speed corner. With the frame the hand moved in left out beside it, the stop
    // stands out; counted, it does not, and the position is continuous.
    it("a value that follows the hand and stops dead against a wall the frame after it lets go passes", async () => {
      expect(await run({ kind: "live", units: px, body: "function values(ms) { return { x: 28 * Math.min(Math.max(ms / F - 60, 0), 8.75) }; }" }, { input: drag(8, 28) })).toEqual([]);
    });

    it("a lurch in a frame where the pointer holds still fails", async () => {
      expect(await run(follows(" + (f >= 140 ? 150 : 0)"), { input: drag(60, 10) })).toEqual(jumps);
    });
  });

  // The page answers the start of the input with a response out of proportion to the input's step: a thumb that jumps to
  // the press (the pointer's first sample has no step), a body that tilts when it is grabbed, a toast that shows on the
  // first scroll tick. The one frame step that the press lands in, or the burst starts in, is not judged; the step
  // before it and the steps after it are.
  describe("the step where a press lands or a scroll burst starts is not judged", () => {
    const drag: InputSamples = { kind: "pointer", samples: dragSamples(60, 60, 10) };
    const thumb = (at: number) => ({ kind: "live" as const, units: px, body: `function values(ms) { return { x: pointerX(ms) - 400 + (ms >= ${at} ? 320 : 0) }; }` });

    it("a thumb that jumps to the press passes", async () => {
      expect(await run(thumb(995.3), { input: drag })).toEqual([]);
    });

    it("the same jump one frame before the press, or one frame after it, fails", async () => {
      expect(await run(thumb(975.3), { input: drag })).toEqual(jumps);
      expect(await run(thumb(1010.3), { input: drag })).toEqual(jumps);
    });

    it("the same jump with the gate told of no input fails: only an input has a start", async () => {
      expect(await run(thumb(995.3), { input: drag, unplayed: true })).toEqual(jumps);
    });

    it("a second press after a lift is a start too", async () => {
      const twice: InputSamples = { kind: "pointer", samples: [...dragSamples(60, 20, 10), [1500, 600, 300, 0], ...dragSamples(120, 20, 10, 400).map((s): [number, number, number, 1] => [s[0], s[1], s[2], 1])] };
      const pop = (at: number) => ({ kind: "live" as const, units: px, body: `function values(ms) { return { x: pointerX(ms) * 0 + (ms >= ${at} ? 320 : 0) }; }` });
      expect(await run(pop(1990.3), { input: twice })).toEqual([]);
      expect(await run(pop(2060.3), { input: twice })).toEqual(jumps);
    });

    const scroll: InputSamples = { kind: "scroll", samples: [[12, 0], [13, 60], [14, 120], [15, 180], [48, 180]].map(([f, y]): [number, number] => [f! * FRAME_MS, y!]) };
    const toast = (at: number) => ({ kind: "scroll" as const, units: { x: "px" }, body: `function values(ms) { return { x: 0.2 * scrollAt(ms) + (ms >= ${at} ? 80 : 0) }; }` });

    it("a response on the first scroll tick passes, and one after it fails", async () => {
      expect(await run(toast(212.3), { input: scroll })).toEqual([]);
      expect(await run(toast(400.3), { input: scroll })).toEqual(jumps);
    });
  });

  describe("a scroll-linked value held between scroll samples", () => {
    const samples: [number, number][] = [];
    for (let f = 0, y = 0, v = 60; f <= 150; f++, y += v, v *= 0.95) samples.push([200 + f * FRAME_MS, Math.round(y)]);
    const scroll: InputSamples = { kind: "scroll", samples };
    const parallax = (extra = "") => ({ kind: "scroll" as const, units: { x: "px" }, body: `function values(ms) { return { x: -0.4 * scrollAt(ms)${extra} }; }` });

    // The sky moves 0.4 px per scroll px, read straight from the scroll position: it steps once per scroll sample.
    it("steps with each scroll sample and passes", async () => {
      expect(await run(parallax(), { input: scroll })).toEqual([]);
    });

    it("a pop beyond the scroll's step fails", async () => {
      expect(await run(parallax(" + (ms >= 1000.2 ? 120 : 0)"), { input: scroll })).toEqual(jumps);
    });

    it("the same page, with the gate told of no scroll input, fails: only an input excuses a held value", async () => {
      expect(await run(parallax(), { input: scroll, unplayed: true })).toEqual(jumps);
    });
  });

  describe("a page that moves its value in whole frames only", () => {
    // 300 px in 10 frames, held between frames: the sub-steps of every step show a hold and a jump.
    const staircase: JumpPage = { units: px, wholeFrames: true, body: "function values(ms) { return { x: 30 * Math.min(Math.max(Math.floor((ms - 1000) / F + 1e-6), 0), 10) }; }" };

    it("is skipped with a note: the gate cannot read between its frames", async () => {
      const notes: string[] = [];
      expect(await run(staircase, { notes })).toEqual([]);
      expect(notes).toEqual([expect.stringMatching(/^note: suddenJumps cannot read x between frames: .*whole frames only/)]);
    });

    it("a single teleport on a page that holds between frames still fails", async () => {
      const notes: string[] = [];
      expect(await run({ units: px, wholeFrames: true, body: "function values(ms) { return { x: ms >= 1500.3 ? 300 : 0 }; }" }, { notes })).toEqual(jumps);
      expect(notes).toEqual([]);
    });

    it("a page that reads the time between frames gets no note", async () => {
      const notes: string[] = [];
      expect(await run({ units: px, body: "function values(ms) { return { x: 300 * lin((ms - 1000) / (10 * F)) }; }" }, { notes })).toEqual([]);
      expect(notes).toEqual([]);
    });
  });

  describe("a cut exempts the steps near it", () => {
    it("a pop 100 ms after a cut is not exempt; the cut's own jump is", async () => {
      const body = "function values(ms) { return { x: (ms >= 1500 ? 500 : 0) + (ms >= 1600.2 ? 200 : 0) }; }";
      expect(await run({ units: px, body }, { cuts: [1500] })).toEqual(jumps);
      expect(await run({ units: px, body: "function values(ms) { return { x: ms >= 1500 ? 500 : 0 }; }" }, { cuts: [1500] })).toEqual([]);
    });
  });

  // circInOut (Motion, GSAP, Penner) has infinite speed at its midpoint: a square-root cusp, no jump. Its sub-steps stand
  // out from their neighbours by 2.7 to 2.9 at every duration and phase, over JUMP_FACTOR, so the first sub-step reading
  // fails it. A cusp keeps that ratio when the sub-steps are cut finer; a jump does not (it is infinite, or it grows).
  describe("a square-root cusp is no jump (circInOut)", () => {
    const circ = (ms: number, start: number) => `const circ = (u) => { u = clamp01(u); return u < 0.5 ? (1 - Math.sqrt(1 - 4 * u * u)) / 2 : (Math.sqrt(1 - Math.pow(-2 * u + 2, 2)) + 1) / 2; }; function values(ms) { return { x: -300 + tween(ms, ${start}, ${ms}, 300, circ) }; }`;
    const PHASES = [0, 0.12, 0.36, 0.6, 0.84, 0.96];
    const begin = (share: number) => 1000 + share * FRAME_MS;

    it.each([300, 600, 1200].flatMap((ms) => PHASES.map((share): [number, number] => [ms, share])))("an ease of %s ms started %s of a frame in passes", async (ms, share) => {
      expect(await run({ units: px, body: circ(ms, begin(share)) })).toEqual([]);
    });

    // The ease-in and the ease-out of the same circle end in a cusp against a hold, which is the same edge.
    it.each([300, 600, 1200])("circIn and circOut of %s ms pass", async (ms) => {
      for (const body of [`function values(ms) { return { x: 300 * (1 - Math.sqrt(1 - Math.pow(lin((ms - 1000) / ${ms}), 2))) }; }`, `function values(ms) { return { x: 300 * Math.sqrt(1 - Math.pow(1 - lin((ms - 1000) / ${ms}), 2)) }; }`]) {
        expect(await run({ units: px, body })).toEqual([]);
      }
    });

    // A snap on the ease fails, at its midpoint and away from it: the cusp is not an excuse for a jump beside it.
    it.each([620, 1000, 1100])("a 15 px snap added to a 600 ms ease at %s ms in fails", async (at) => {
      const body = circ(600, 1000).replace("function values(ms) { return { x: ", `function values(ms) { return { x: (ms >= ${at}.3 ? 15 : 0) + `);
      expect(await run({ units: px, body })).toEqual(jumps);
    });

    // A jump among noise keeps its size and its ratio when the sub-steps get finer, and the ratio is far over a cusp's.
    it("a 40 px snap in a value with 0.05 px of shimmer fails", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: (ms >= 1500.3 ? 40 : 0) + 0.05 * Math.sin(ms * 13) }; }" })).toEqual(jumps);
    });
  });

  // A cusp is told from a jump by its size, not by its ratio to the sub-steps beside it: a power-law cusp |t|^a that
  // stands out from its neighbours by any ratio has a largest sub-step that shrinks by about 2^-a each time the sub-steps
  // are cut in half (0.71 for a square root, 0.79 for a cube root), and a jump keeps its size (0.98 to 1.0 in a smooth
  // move; 0.86, 0.92 for the smallest jump the rule examines). A tween of a few ms shrinks too (0.5), and is told from
  // a cusp by its bounded speed.
  describe("a steep ease is no jump: its largest sub-step shrinks as the sub-steps are cut finer", () => {
    const BEZ = `const bez = (x1, y1, x2, y2) => { const at = (a, b, s) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3; return (u) => { u = clamp01(u); if (u <= 0 || u >= 1) return u; let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < u) lo = mid; else hi = mid; } return at(y1, y2, (lo + hi) / 2); }; };`;
    const CURVES: Record<string, string> = {
      "cubic-bezier(1,0,0,1)": "bez(1, 0, 0, 1)",
      "cubic-bezier(0.9,0,0.1,1)": "bez(0.9, 0, 0.1, 1)",
      "cubic-bezier(0,1,0,1)": "bez(0, 1, 0, 1)",
      expoInOut: "(u) => { u = clamp01(u); return u === 0 || u === 1 ? u : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2; }",
      circInOut: "(u) => { u = clamp01(u); return u < 0.5 ? (1 - Math.sqrt(1 - 4 * u * u)) / 2 : (Math.sqrt(1 - Math.pow(-2 * u + 2, 2)) + 1) / 2; }",
    };
    const ease = (curve: string, ms: number, delay: number, extra = "") => `${BEZ} const E = ${CURVES[curve]}; function values(ms) { return { x: -300 + tween(ms, ${1000 + delay}, ${ms}, 300, E)${extra} }; }`;
    const cases = Object.keys(CURVES).flatMap((curve) => [250, 400, 600, 1200, 2000].flatMap((ms) => [0, 5, 9].map((delay): [string, number, number] => [curve, ms, delay])));

    // The start of an ease-out that leaves its hold at a vertical tangent (a cube-root cusp against a hold): the sub-step
    // that holds the start can end at the same time on three grids in a row, so the largest single sub-step keeps its
    // size for two halvings, and only a window that slides over the sub-steps shrinks as a cusp does.
    it.each([0, 1, 3, 5, 7, 9, 12])("cubic-bezier(0,1,0,1) over 500 ms started %s ms in passes", async (delay) => {
      expect(await run({ units: px, body: ease("cubic-bezier(0,1,0,1)", 500, delay) })).toEqual([]);
    });

    it.each(cases)("%s over %s ms started %s ms in passes", async (curve, ms, delay) => {
      expect(await run({ units: px, body: ease(curve, ms, delay) })).toEqual([]);
    });

    // The cusp is no excuse for a jump beside it: the same ease with a snap before it, after it and on it. A snap on the
    // cusp is hidden by the cusp's own sub-step unless it carries a third of the frame's change (JUMP_CARRIES), here 107 px.
    it.each([["cubic-bezier(1,0,0,1)", 1100, 15], ["cubic-bezier(1,0,0,1)", 1330, 15], ["cubic-bezier(1,0,0,1)", 1900, 15], ["cubic-bezier(1,0,0,1)", 1200, 60], ["cubic-bezier(1,0,0,1)", 1205, 60], ["expoInOut", 1500, 15]] as const)("%s with a snap at %s ms of %s px fails", async (curve, at, by) => {
      expect(await run({ units: px, body: ease(curve, 400, 0, ` + (ms >= ${at}.3 ? ${by} : 0)`) })).toEqual(jumps);
    });

    // The smallest jump that the rule examines: a third of a fast ramp's frame step. Cut finer, its largest sub-step
    // goes 0.86, 0.92, 0.96 of the one before; a cusp goes 0.83 at most.
    it.each([7, 8, 10, 15])("a %s px jump in a ramp of 21 px a frame fails", async (by) => {
      expect(await run({ units: px, body: `function values(ms) { return { x: 300 * lin((ms - 1000) / 238) + (ms >= 1100.3 ? ${by} : 0) }; }` })).toEqual(jumps);
    });

    // A tween shrinks as fast as a cusp or faster (0.5), but its speed is bounded.
    it.each([2, 3, 5])("a linear tween of %s ms fails", async (ms) => {
      expect(await run({ units: px, body: `function values(ms) { return { x: 300 * lin((ms - 1500.3) / ${ms}) }; }` })).toEqual(jumps);
    });

    it.each([2, 5, 20])("an eased tween of %s ms fails", async (ms) => {
      expect(await run({ units: px, body: `function values(ms) { return { x: 300 * outCubic((ms - 1500.3) / ${ms}) }; }` })).toEqual(jumps);
    });

    // Whole-pixel rounding is a known limit (REFERENCE.md): a rounded move's 1 px step beside a hold reads as a 1 px snap,
    // with a factor of 1.000 on every grid. The shrink test must not be the thing that lets either one through.
    it("a 1 px snap on a still value fails", async () => {
      expect(await run({ units: px, body: "function values(ms) { return { x: ms >= 1500.3 ? 1 : 0 }; }" })).toEqual(jumps);
    });

    // A move of 150 px over 2 s, rounded to whole pixels: it moves 1 or 2 px a frame, and skips a pixel now and then.
    // Its own steps pass, so the failure below is the snap's and nothing else. The control is the same page without it.
    const rounded = (snap: string) => `function values(ms) { return { x: Math.round(150 * lin((ms - 1000) / 2000))${snap} }; }`;

    it("a rounded move that skips a pixel passes without a snap", async () => {
      expect(await run({ units: px, body: rounded("") })).toEqual([]);
    });

    it("a 1 px snap inside a rounded move that skips a pixel fails, and names the snap's frame", async () => {
      expect(await run({ units: px, body: rounded(" + (ms >= 1550.3 ? 1 : 0)") })).toEqual([expect.stringMatching(/^suddenJumps: x moves \d+ in the frame after 1550 ms/)]);
    });

    // cubic-bezier(x1,0,1-x1,1) with x1 just under 1 has a bounded speed: its middle is a straight line far narrower than a
    // frame, which the zoom reads as a tween. What tells it from a flick is the frame around it. The frame steps beside it
    // fall away on both sides (at least 1.45 times the step beyond, where a hold beside a flick moves 0 and a steady move
    // beside a tween 1.0 to 1.07), and it bends smoothly into its flanks: halved from two frames to 1/16 of a frame, the
    // window keeps no more at each halving than at the one before (a tween holds its size once the window covers it).
    describe("a steep ease whose speed is bounded is no jump: its middle is the top of one bell", () => {
      const MBEZ = `const mbez = (x1, y1, x2, y2) => { const at = (t, a1, a2) => (((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t + 3 * a1) * t; const solve = (x) => { let lo = 0, hi = 1, t, d, i = 0; do { t = lo + (hi - lo) / 2; d = at(t, x1, x2) - x; if (d > 0) hi = t; else lo = t; } while (Math.abs(d) > 1e-7 && ++i < 12); return t; }; return (u) => { u = clamp01(u); return u <= 0 || u >= 1 ? u : at(solve(u), y1, y2); }; };`;
      const EASES = `const expoInOut = (u) => { u = clamp01(u); return u === 0 || u === 1 ? u : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2; }; const quintInOut = (u) => { u = clamp01(u); return u < 0.5 ? 16 * Math.pow(u, 5) : 1 - Math.pow(-2 * u + 2, 5) / 2; };`;
      const steep = (x1: number, ms: number, delay: number, by = 300, solver = "bez") =>
        `${BEZ} ${MBEZ} const E = ${solver}(${x1}, 0, ${+(1 - x1).toFixed(3)}, 1); function values(ms) { return { x: tween(ms, ${1000 + delay}, ${ms}, ${by}, E) }; }`;
      const band = [0.9, 0.94, 0.96, 0.98, 0.99, 0.995].flatMap((x1) => [150, 300, 600, 1200].flatMap((ms) => [0, 5, 9].map((delay): [number, number, number] => [x1, ms, delay])));

      it.each(band)("cubic-bezier(x1,0,1-x1,1) at x1 = %s over %s ms started %s ms in passes", async (x1, ms, delay) => {
        expect(await run({ units: px, body: steep(x1, ms, delay) })).toEqual([]);
      });

      it.each([0, 5, 9])("the same ease on Motion's cubicBezier solver, (0.98,0,0.02,1) over 1200 ms started %s ms in, passes", async (delay) => {
        expect(await run({ units: px, body: steep(0.98, 1200, delay, 300, "mbez") })).toEqual([]);
      });

      it("a turn of 180 deg on cubic-bezier(0.98,0,0.02,1) over 600 ms passes", async () => {
        expect(await run({ units: { x: "deg" }, body: steep(0.98, 600, 5, 180) })).toEqual([]);
      });

      it("a fade from 0 to 1 on cubic-bezier(0.98,0,0.02,1) over 600 ms passes", async () => {
        expect(await run({ units: { x: "opacity" }, body: steep(0.98, 600, 5, 1) })).toEqual([]);
      });

      // A hold, a flick and a hold: the frame steps beside it do not move.
      it.each([2, 5, 10].flatMap((ms) => [0, 5, 9].map((delay): [number, number] => [ms, delay])))("a linear flick of 300 px over %s ms started %s ms in fails", async (ms, delay) => {
        expect(await run({ units: px, body: `function values(ms) { return { x: 300 * lin((ms - ${1539.6 + delay}) / ${ms}) }; }` })).toEqual(expect.arrayContaining(jumps));
      });

      it.each(["expoInOut", "quintInOut"].flatMap((e) => [2, 5, 10, 20].flatMap((ms) => [0, 5, 9].map((delay): [string, number, number] => [e, ms, delay]))))("a tween on %s of %s ms started %s ms in fails", async (e, ms, delay) => {
        expect(await run({ units: px, body: `${EASES} function values(ms) { return { x: 300 * ${e}((ms - ${1500.3 + delay}) / ${ms}) }; }` })).toEqual(expect.arrayContaining(jumps));
      });

      // A recoil: 40 px out in 10 ms, then back over 400 ms on an ease-out. One side of it holds still.
      const recoil = (ease: string, start: number) =>
        `${BEZ} ${EASES} const E = ${ease}; const back = bez(0, 0, 0.2, 1); function values(ms) { const t = ms - ${start}; return { x: t <= 0 ? 0 : t < 10 ? 40 * E(t / 10) : 40 * (1 - back(Math.min(1, (t - 10) / 400))) }; }`;
      it.each(["lin", "expoInOut", "quintInOut", "bez(0.9, 0, 0.1, 1)"].flatMap((e) => [1000, 1006.3, 1010.4].map((start): [string, number] => [e, start])))("a recoil out on %s in 10 ms from %s ms, and back over 400 ms, fails", async (e, start) => {
        expect(await run({ units: px, body: recoil(e, start) })).toEqual(jumps);
      });

      // A tween inside a steady move of 21 px a frame: the frame steps beside it move as much as the steps beyond them.
      it.each([["lin", 2], ["lin", 5], ["lin", 10], ["expoInOut", 5]] as const)("a 50 px tween on %s of %s ms inside a steady move fails", async (e, ms) => {
        expect(await run({ units: px, body: `${EASES} function values(ms) { return { x: 21 * Math.max(ms - 1000, 0) / F + 50 * ${e}((ms - 1500.3) / ${ms}) }; }` })).toEqual(jumps);
      });

      // A tween on the top of a fast ease: the steps beside it fall away as an ease's do, but its change holds its size as
      // the window narrows past the tween, so a halving keeps more than the one before it.
      it.each([
        ["cubic-bezier(0.98,0,0.02,1) over 600 ms", "bez(0.98, 0, 0.02, 1)", 600, 1310, "lin", 2, 80],
        ["cubic-bezier(0.98,0,0.02,1) over 600 ms", "bez(0.98, 0, 0.02, 1)", 600, 1305, "expoInOut", 10, 80],
        ["expoInOut over 300 ms", "expoInOut", 300, 1135, "lin", 2, 40],
        ["quintInOut over 300 ms", "quintInOut", 300, 1135, "lin", 2, 40],
      ] as const)("a tween on the top of %s fails", async (_, ease, ms, at, tween, tweenMs, by) => {
        expect(await run({ units: px, body: `${BEZ} ${EASES} function values(ms) { return { x: tween(ms, 1000, ${ms}, 300, ${ease}) + ${by} * ${tween}((ms - ${at}) / ${tweenMs}) }; }` })).toEqual(jumps);
      });
    });

    // The jump sweep (test/jump-sweep.test.ts) reads this rule at 64 start phases a frame; these pages are its rows that
    // a fix moved, read in a browser. A steep ease on a range of a few unit floors moves its flanks under the unit floor,
    // a cusp in the last or first tenth of a frame used to be read only up to the frame's edge, and the zoom used to
    // start just after a cusp at the start of an ease-out. A flick shaped on a true cusp used to pass as a cusp.
    describe("a steep ease passes at any range and start phase; a flick fails on any ease", () => {
      const CIRC = "const circInOut = (u) => { u = clamp01(u); return u < 0.5 ? (1 - Math.sqrt(1 - 4 * u * u)) / 2 : (Math.sqrt(1 - Math.pow(-2 * u + 2, 2)) + 1) / 2; };";
      const on = (curve: string, from: number, by: number, ms: number, start: number) => `${BEZ} const E = ${curve}; function values(ms) { return { x: ${from} + tween(ms, ${start}, ${ms}, ${by}, E) }; }`;

      it.each([
        ["scale", "bez(0.98, 0, 0.02, 1)", 1, 0.02, 300],
        ["opacity", "bez(0.98, 0, 0.02, 1)", 0.9, 0.1, 1200],
        ["px", "bez(0.98, 0, 0.02, 1)", 0, 4, 300],
        ["px", "bez(0.9, 0, 0.1, 1)", 0, 4, 150],
        ["scale", "bez(0.995, 0, 0.005, 1)", 1, 0.02, 600],
      ] as const)("a %s change on %s from %s by %s over %s ms passes", async (unit, curve, from, by, ms) => {
        expect(await run({ units: { x: unit }, body: on(curve, from, by, ms, 1000 + 0.3 * FRAME_MS) })).toEqual([]);
      });

      // cubic-bezier(0,1,0,1) leaves its hold at a vertical tangent in the last tenth of a frame; (1,0,1,0) reaches its hold
      // in the first tenth; (0,1,0.3,1) leaves 7/64 of a frame in, where the span that stood out started after the cusp.
      it.each([
        ["bez(0, 1, 0, 1)", 0.95],
        ["bez(1, 0, 1, 0)", 0.05],
        ["bez(0, 1, 0.3, 1)", 7 / 64],
        ["bez(0, 0.8, 0.2, 1)", 23 / 64],
        // 15.104 ms: the cusp sits in the last seventh of a fine sub-step, so the steepest fine sub-step is the one after it.
        ["bez(0, 1, 0, 1)", 15.104 / FRAME_MS],
      ] as const)("%s over 300 ms started %s of a frame in passes", async (curve, share) => {
        expect(await run({ units: px, body: on(curve, 0, 300, 300, 1000 + share * FRAME_MS) })).toEqual([]);
      });

      // Out on circIn and back on circOut: the value turns at a vertical tangent on a frame, and between two.
      it.each([0, 0.4])("out 300 px on circIn and back on circOut, legs of 300 ms, turning %s of a frame in, passes", async (share) => {
        const legs = "const circIn = (u) => 1 - Math.sqrt(1 - clamp01(u) ** 2); const circOut = (u) => Math.sqrt(1 - (1 - clamp01(u)) ** 2);";
        expect(await run({ units: px, body: `${legs} function values(ms) { const u = (ms - ${1000 + share * FRAME_MS}) / 300; return { x: u <= 1 ? 300 * circIn(u) : 300 - 300 * circOut(u - 1) }; }` })).toEqual([]);
      });

      // 40 px in 5 ms, one way, inside a steady move of 21 px a frame: the steps beside it move as much as the steps beyond.
      it.each(["circInOut", "bez(1, 0, 0, 1)", "bez(0.98, 0, 0.02, 1)"])("a one-way flick of 40 px on %s in 5 ms inside a steady move fails", async (curve) => {
        expect(await run({ units: px, body: `${BEZ} ${CIRC} const E = ${curve}; function values(ms) { return { x: 21 * Math.max(ms - 1000, 0) / F + 40 * E((ms - 1500.3) / 5) }; }` })).toEqual(jumps);
      });

      // A recoil out on a true cusp, and a 20 ms flick in a hold whose tails reach into the frames beside it.
      it.each([
        ["a recoil of 40 px out on circInOut in 10 ms, and back over 400 ms,", `const t = ms - 1004.2; return { x: t <= 0 ? 0 : t < 10 ? 40 * circInOut(t / 10) : 40 * (1 - bez(0, 0, 0.2, 1)(Math.min(1, (t - 10) / 400))) };`],
        ["a recoil of 200 px out on cubic-bezier(1,0,0,1) in 10 ms, and back over 400 ms,", `const t = ms - 1004.2; return { x: t <= 0 ? 0 : t < 10 ? 200 * bez(1, 0, 0, 1)(t / 10) : 200 * (1 - bez(0, 0, 0.2, 1)(Math.min(1, (t - 10) / 400))) };`],
        ["a flick of 300 px on circInOut in 20 ms in a hold", "return { x: 300 * circInOut((ms - 1500.3) / 20) };"],
        // A flick of a few ms that leaves a hold at a vertical tangent, or reaches one, is back at rest a frame later: it is no
        // ease-out and no ease-in (those are still moving a frame past the cusp, or were a frame before it).
        ["a flick of 300 px on circOut in 5 ms in a hold", "return { x: 300 * Math.sqrt(1 - (1 - clamp01((ms - 1500.3) / 5)) ** 2) };"],
        ["a flick of 300 px on circIn in 5 ms in a hold", "return { x: 300 * (1 - Math.sqrt(1 - clamp01((ms - 1500.3) / 5) ** 2)) };"],
      ])("%s fails", async (_, body) => {
        expect(await run({ units: px, body: `${BEZ} ${CIRC} function values(ms) { ${body} }` })).toEqual(jumps);
      });
    });
  });
});

describe("the verdict", () => {
  const lines = (v: Verdict) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = printVerdict(v, { out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join(""), err: err.join("") };
  };

  it("prints passed and exits 0", () => {
    expect(lines({ status: "passed", failures: [] })).toEqual({ code: 0, out: "passed\n", err: "" });
  });

  it("prints failed: n with each failure, and exits non-zero", () => {
    const r = lines({ status: "failed", failures: ["a: one", "b: two"] });
    expect(r.out).toBe("failed: 2\n");
    expect(r.err).toBe("a: one\nb: two\n");
    expect(r.code).toBe(1);
  });

  it("never prints passed for a verdict that holds failures", () => {
    expect(lines({ status: "passed", failures: ["a: one"] })).toMatchObject({ out: "failed: 1\n", code: 1 });
  });

  it("a partial run (one check throws) is partial, with a non-zero exit", async () => {
    const v = await runChecks({ ok: () => [], broken: () => { throw new Error("no browser"); } });
    expect(v).toEqual({ status: "partial", failures: ["broken: could not run: no browser"] });
    const r = lines(v);
    expect(r.out).toBe("partial\n");
    expect(r.code).toBe(1);
  });

  it("a run with no checks is partial, never passed", async () => {
    expect((await runChecks({})).status).toBe("partial");
  });

  it("collects failures from every check", async () => {
    expect(await runChecks({ a: () => ["a: one"], b: async () => ["b: two"], c: () => [] })).toEqual({ status: "failed", failures: ["a: one", "b: two"] });
  });
});

describe("playwrightOrNull", () => {
  it("returns null when playwright cannot be imported", async () => {
    vi.resetModules();
    vi.doMock("playwright", () => {
      throw new Error("Cannot find package 'playwright'");
    });
    try {
      const fresh = await import("../../src/gate/harness.ts");
      expect(await fresh.playwrightOrNull()).toBeNull();
      await expect(fresh.openPage(page("good-seek"), {})).rejects.toThrow(/pnpm add -D playwright/);
    } finally {
      vi.doUnmock("playwright");
      vi.resetModules();
    }
  });
});
