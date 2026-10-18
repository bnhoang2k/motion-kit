import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeBrowser, FRAME_MS, openPage, playwrightOrNull, replayInput, type GatePage, type InputSamples } from "../../src/gate/harness.ts";
import { emptySelector, missingChannel, noHook, realClockGap, suddenJumps, zeroFrames } from "../../src/gate/self-checks.ts";
import { inputChanges } from "../../src/gate/synthetic-input.ts";
import { printVerdict, runChecks, type Check, type Verdict } from "../../src/gate/verdict.ts";

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
