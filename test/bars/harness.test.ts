import { mkdtempSync, rmSync } from "node:fs";
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

  it("suddenJumps leaves out a pointer step at its own pace: a 1:1 follower passes, a pop in a move's frame and a scroll input do not", async () => {
    // live-good follows the pointer 1:1, so under ?seek each pointer sample moves the dot in one step (100 px here).
    const live = path.join(PAGES, "kinds/live-good.html");
    expect(inputChanges(POINTER, { flags: false, end: false })).toHaveLength(4);
    const p = await openPage(live, { input: POINTER.samples });
    try {
      expect(await suddenJumps(p, ["x"], [], 1000)).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
      expect(await suddenJumps(p, ["x"], [], 1000, POINTER)).toEqual([]);
      // The same samples as scroll input get no exemption.
      const scroll: InputSamples = { kind: "scroll", samples: POINTER.samples.map(([ms, x]): [number, number] => [ms, x]) };
      expect(await suddenJumps(p, ["x"], [], 1000, scroll)).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
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
