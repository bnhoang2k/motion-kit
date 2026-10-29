import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateBar, type BarJson } from "../../src/core/bar.ts";
import { barGate, checkTrace } from "../../src/gate/bar-gate.ts";
import { plantFault } from "../../src/gate/faults.ts";
import { closeBrowser, openPage } from "../../src/gate/harness.ts";
import type { Verdict } from "../../src/gate/verdict.ts";
import { withBarCopy } from "./bar-gate-suite.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DEMO_REL = "test/fixtures/bars/gate-demo";
const DEMO = path.join(ROOT, DEMO_REL);
const demoFile = (name: string) => readFileSync(path.join(DEMO, name), "utf8");
const demoBar = () => JSON.parse(demoFile("bar.json")) as BarJson;
const demoTrace = () => JSON.parse(demoFile("trace.json")) as Record<string, unknown> & { events: Record<string, number>; channels: Record<string, unknown>[] };

/** The names of the checks that report a failure: each line starts with its check's name. */
const failing = (v: Verdict) => [...new Set(v.failures.map((f) => (f.includes(":") ? f.slice(0, f.indexOf(":")) : f)))].sort();

/** A page with a MOTION block and nothing else. */
const page = (motion: string, rest = "") => `<!doctype html>\n<script>\nconst MOTION = ${motion};\n${rest}</script>\n`;
const bar = (over: Partial<BarJson> = {}): BarJson => ({ ...demoBar(), ...over });

afterAll(async () => {
  await closeBrowser();
});

describe("the gate-demo fixture", () => {
  it("passes validateBar", () => {
    const entry = { knob: "idle.period", value: 2.4, unit: "s", bar: "gate-demo", path: "loop.periodS", row: "Row 1", base: false };
    const read = (p: string): string | undefined => {
      if (p === "kinds/idle/dials.json") return JSON.stringify([entry]);
      const abs = path.join(ROOT, p);
      return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
    };
    expect(validateBar(DEMO_REL, read)).toEqual([]);
  });
});

describe("plantFault", () => {
  describe("dial25", () => {
    it("multiplies the first dial's MOTION value by 1.25, wrapping an expression", () => {
      const html = page("{ a: { speed: 9.7/60, other: 2 }, b: 1 }");
      const out = plantFault(html, "dial25", bar({ dials: [{ path: "a.speed", value: 9.7 / 60, unit: "s", knob: "idle.period", row: "r" }] }));
      expect(out).toContain("a: { speed: (9.7/60)*1.25, other: 2 }");
    });

    it("finds a quoted key, and leaves the comments and the other keys alone", () => {
      const html = page('{\n  // speed: 3\n  "loop": { periodS: 4.0, /* periodS: 9 */ },\n  periodS: 7,\n}');
      const out = plantFault(html, "dial25", bar({ dials: [{ path: "loop.periodS", value: 4, unit: "s", knob: "idle.period", row: "r" }] }));
      expect(out).toContain('"loop": { periodS: (4.0)*1.25, /* periodS: 9 */ },\n  periodS: 7,');
      expect(out).toContain("// speed: 3");
    });

    it("fails with a clear line when the path is not a value in MOTION", () => {
      expect(() => plantFault(page("{ a: 1 }"), "dial25", bar())).toThrow("dial25: loop.periodS is not a value in the MOTION block");
      expect(() => plantFault("<p>no script</p>", "dial25", bar())).toThrow("dial25: the page has no `const MOTION = {` block");
    });
  });

  describe("linear", () => {
    it("swaps the first curve in MOTION source order for linear", () => {
      const html = page('{ fade: { ease: "easeOut" }, lift: { ease: [0.42, 0, 0.58, 1] } }');
      expect(plantFault(html, "linear", bar())).toContain('{ fade: { ease: "linear" }, lift: { ease: [0.42, 0, 0.58, 1] } }');
    });

    it("swaps a cubic-bezier array, a CSS easing string and a one-argument easing function", () => {
      expect(plantFault(page("{ size: [3, 4, 5, 6], ease: [0.2, 1.4, 0.6, 1] }"), "linear", bar())).toContain("{ size: [3, 4, 5, 6], ease: [0, 0, 1, 1] }");
      expect(plantFault(page("{ ease: 'cubic-bezier(0.2, 0, 0, 1)' }"), "linear", bar())).toContain('{ ease: "linear" }');
      expect(plantFault(page("{ n: 2, curve: (t) => 1 - (1 - t) ** 3 }"), "linear", bar())).toContain("{ n: 2, curve: (t) => t }");
      expect(plantFault(page("{ curve: function (p) { return p * p; } }"), "linear", bar())).toContain("{ curve: (t) => t }");
    });

    it("skips a curve that is already linear", () => {
      expect(plantFault(page('{ a: "linear", b: [0, 0, 1, 1], c: "ease-in-out" }'), "linear", bar())).toContain('{ a: "linear", b: [0, 0, 1, 1], c: "linear" }');
    });

    it("uses the bar.json fault named linear first, then the first curve in MOTION", () => {
      const spring = page("{ springOmega: 22.25, springZeta: 0.84 }", "const step = (x, v, dt) => springStep(x, v, dt);\n");
      const withLinear = bar({ faults: [...demoBar().faults, { name: "linear", find: "springStep(x, v, dt)", replace: "linearStep(x, v, dt)" }] });
      expect(plantFault(spring, "linear", withLinear)).toContain("const step = (x, v, dt) => linearStep(x, v, dt);");
      // The named entry wins over a minor easing in MOTION, which stays as it is.
      const both = plantFault(page('{ fade: { ease: "easeOut" } }', "springStep(x, v, dt)"), "linear", withLinear);
      expect(both).toContain("linearStep(x, v, dt)");
      expect(both).toContain('{ fade: { ease: "easeOut" } }');
      // With no named entry, the first curve in MOTION is swapped.
      expect(plantFault(page('{ fade: { ease: "easeOut" } }'), "linear", bar())).toContain('{ fade: { ease: "linear" } }');
      // The named entry needs no MOTION block.
      expect(plantFault("<p>springStep(x, v, dt)</p>", "linear", withLinear)).toBe("<p>linearStep(x, v, dt)</p>");
    });

    it("names a missing MOTION block when bar.json has no linear fault", () => {
      expect(() => plantFault("<p>no script</p>", "linear", bar())).toThrow("linear: the page has no `const MOTION = {` block");
    });

    it("fails with a clear line when MOTION holds no curve and bar.json has no linear fault", () => {
      expect(() => plantFault(page('{ periodS: 4, label: "slow", size: [1, 2, 3, 4] }'), "linear", bar())).toThrow(
        'linear: the MOTION block holds no curve to swap (a cubic-bezier array, an easing name, or a one-argument easing function), and bar.json has no fault named "linear"; add one of the two',
      );
    });
  });

  describe("reducedIgnored", () => {
    it("turns every reduced-motion query false, in script and in CSS", () => {
      const html = '<style>@media (prefers-reduced-motion: reduce) { * { animation: none } }</style>\n<script>const r = matchMedia("(prefers-reduced-motion:reduce)").matches; const m = matchMedia("(prefers-reduced-motion: no-preference)");</script>';
      const out = plantFault(html, "reducedIgnored", bar());
      expect(out).toBe('<style>@media not all { * { animation: none } }</style>\n<script>const r = matchMedia("not all").matches; const m = matchMedia("(min-width: 0px)");</script>');
    });

    it("fails with a clear line when the page has no reduced-motion query", () => {
      expect(() => plantFault(page("{ a: 1 }"), "reducedIgnored", bar())).toThrow("reducedIgnored: the page has no prefers-reduced-motion query");
    });
  });

  describe("own", () => {
    it("applies the bar's own fault", () => {
      expect(plantFault(demoFile("index.html"), { own: "taller lift" }, demoBar())).toContain("px: 30, ease:");
    });

    it("fails with a clear line on an unknown name or a find that is not exactly once", () => {
      expect(() => plantFault("x", { own: "nope" }, demoBar())).toThrow('own: bar.json has no fault named "nope"');
      expect(() => plantFault("px: 24 px: 24", { own: "taller lift" }, demoBar())).toThrow('own: "taller lift" finds "px: 24" 2 times in the page, needs exactly once');
    });
  });
});

describe("the bar gate", () => {
  it("passes the clean gate-demo page", async () => {
    const v = await barGate(DEMO);
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it("passes an event 16 ms late, and fails one 18 ms late", async () => {
    const at = (late: number) => {
      const trace = demoTrace();
      trace.events = { ...trace.events, lift: trace.events.lift! - late };
      return withBarCopy(DEMO, { "trace.json": JSON.stringify(trace) }, barGate);
    };
    const ok = await at(16);
    expect(ok.failures).toEqual([]);
    expect(ok.status).toBe("passed");
    const late = await at(18);
    expect(late.status).toBe("failed");
    expect(late.failures).toEqual(["events: lift lands at 600 ms, 18 ms after its trace time 582 ms; an event lands within 17 ms"]);
  });

  it("fails an event the page never records", async () => {
    const trace = demoTrace();
    trace.events = { ...trace.events, bounce: 900 };
    const v = await withBarCopy(DEMO, { "trace.json": JSON.stringify(trace) }, barGate);
    expect(v.failures).toEqual(["events: bounce is in trace.json at 900 ms, but the page never records it"]);
  });

  it("fails coverage for an element that moves but sits in no channel and no cover entry", async () => {
    const { cover: _cover, ...rest } = demoBar();
    const v = await withBarCopy(DEMO, { "bar.json": JSON.stringify(rest) }, barGate);
    expect(v.status).toBe("failed");
    expect(v.failures).toEqual(["coverage: #halo changes its transform, opacity or filter, but no trace channel's selectors and no bar.json cover entry match it"]);
  });

  it("fails a channel that misses its trace, with its worst sample", async () => {
    const v = await withBarCopy(DEMO, { "index.html": demoFile("index.html").replace("dim: 0.55", "dim: 0.5") }, barGate);
    expect(v.status).toBe("failed");
    expect(failing(v)).toEqual(["trace"]);
    expect(v.failures).toEqual([expect.stringMatching(/^trace: dotOpacity misses its trace at \d+ of 241 samples; the worst is 0\.0\d+ opacity off at [\d.]+ ms \(tolerance 0\.01 opacity\)$/)]);
  });

  it("fails a channel value that is not a finite number", async () => {
    const v = await withBarCopy(DEMO, { "index.html": demoFile("index.html").replace("values: { y, o }", "values: { y, o: o + NaN }") }, barGate);
    expect(v.status).toBe("failed");
    expect(v.failures).toContain("trace: dotOpacity misses its trace at 241 of 241 samples; the page reads NaN, not a number, at 0 ms (tolerance 0.01 opacity)");
  });

  it("skips a trace value of null (not measured) and counts only measured samples; a NaN page value on a measured sample still misses", async () => {
    const trace = demoTrace();
    // dotOpacity measured only from row 120 on; rows 0 to 119 hold null.
    const rows = (trace.samples as (number | null)[][]).map((r, i) => (i < 120 ? [r[0]!, r[1]!, null] : r));
    const sparse = { ...trace, samples: rows };
    const clean = await withBarCopy(DEMO, { "trace.json": JSON.stringify(sparse) }, barGate);
    expect(clean.failures).toEqual([]);
    expect(clean.status).toBe("passed");
    // The fade-in (0 to 300 ms) sits in the null rows, so a slower fade-in is not compared.
    const slowEnter = await withBarCopy(DEMO, { "trace.json": JSON.stringify(sparse), "index.html": demoFile("index.html").replace("enterS: 0.3", "enterS: 0.5") }, barGate);
    expect(slowEnter.failures).toEqual([]);
    const dim = await withBarCopy(DEMO, { "trace.json": JSON.stringify(sparse), "index.html": demoFile("index.html").replace("dim: 0.55", "dim: 0.5") }, barGate);
    expect(dim.failures).toEqual([expect.stringMatching(/^trace: dotOpacity misses its trace at \d+ of 121 samples; /)]);
    const nan = await withBarCopy(DEMO, { "trace.json": JSON.stringify(sparse), "index.html": demoFile("index.html").replace("values: { y, o }", "values: { y, o: o + NaN }") }, barGate);
    expect(nan.failures).toContain("trace: dotOpacity misses its trace at 121 of 121 samples; the page reads NaN, not a number, at 2000 ms (tolerance 0.01 opacity)");
  });

  it("fails a trace.json with a channel that has no measured sample, or a value that is not a number or null", async () => {
    const trace = demoTrace();
    const allNull = { ...trace, samples: (trace.samples as number[][]).map((r) => [r[0]!, r[1]!, null]) };
    expect((await withBarCopy(DEMO, { "trace.json": JSON.stringify(allNull) }, barGate)).failures).toEqual(["trace.json: channels[1] dotOpacity has no measured sample; every value is null"]);
    const text = { ...trace, samples: (trace.samples as number[][]).map((r, i) => (i === 3 ? [r[0]!, "x", r[2]!] : r)) };
    expect((await withBarCopy(DEMO, { "trace.json": JSON.stringify(text) }, barGate)).failures).toEqual([
      "trace.json: samples[3] must be [ms, ...one value per channel]: 3 entries, each value a number or null (not measured)",
    ]);
  });

  it("fails a sample time that is off the 1/60 s grid (a rounded 16.667), and passes 1000 / 60 at full precision", async () => {
    const trace = demoTrace();
    const rows = trace.samples as number[][];
    expect(rows[1]![0]).toBe(1000 / 60);
    const rounded = { ...trace, samples: rows.map((r, i) => (i === 1 ? [16.667, r[1]!, r[2]!] : r)) };
    expect((await withBarCopy(DEMO, { "trace.json": JSON.stringify(rounded) }, barGate)).failures).toEqual([
      "trace.json: samples[1] ms 16.667 is not on the 1/60 s grid (k * 1000 / 60); store the time at full precision, for example 1000 / 60 = 16.666666666666668, not a rounded value",
    ]);
    const exact = await withBarCopy(DEMO, { "trace.json": JSON.stringify(trace) }, barGate);
    expect(exact.failures).toEqual([]);
    expect(exact.status).toBe("passed");
  });

  it("accepts pointer input samples of [ms, x, y] and [ms, x, y, down], down 0 or 1, and nothing else", () => {
    const withInput = (samples: unknown[]) => checkTrace({ ...demoTrace(), input: { kind: "pointer", samples } }).shape;
    expect(withInput([[0, 10, 20], [16, 10, 30], [24, 10, 30, 0], [40, 10, 20, 1]])).toEqual([]);
    const bad = "trace.json: each pointer input sample must be [ms, x, y] or [ms, x, y, down] with down 0 or 1";
    expect(withInput([[0, 10, 20, 2]])).toEqual([bad]);
    expect(withInput([[0, 10]])).toEqual([bad]);
    expect(withInput([[0, 10, 20, 1, 5]])).toEqual([bad]);
    expect(checkTrace({ ...demoTrace(), input: { kind: "scroll", samples: [[0, 10, 1]] } }).shape).toEqual(["trace.json: each scroll input sample must be 2 numbers"]);
  });

  it("accepts stepped as a list of distinct value names, a channel's read or another page value", () => {
    const reads = demoTrace().channels.map((c) => c.read as string);
    const withStepped = (stepped: unknown) => checkTrace({ ...demoTrace(), stepped }).shape;
    expect(withStepped([reads[0]])).toEqual([]);
    expect(withStepped([reads[0], "boil"])).toEqual([]);
    expect(withStepped([reads[0], reads[0]])).toEqual(["trace.json: stepped names a value twice"]);
    expect(withStepped("y")).toEqual(["trace.json: stepped must be a list of value names"]);
    expect(withStepped([""])).toEqual(["trace.json: stepped must be a list of value names"]);
  });

  it("accepts tweens as a list of distinct value names, a channel's read or another page value", () => {
    const reads = demoTrace().channels.map((c) => c.read as string);
    const withTweens = (tweens: unknown) => checkTrace({ ...demoTrace(), tweens }).shape;
    expect(withTweens([reads[0]])).toEqual([]);
    expect(withTweens([reads[0], "tile"])).toEqual([]);
    expect(withTweens([reads[0], reads[0]])).toEqual(["trace.json: tweens names a value twice"]);
    expect(withTweens("t")).toEqual(["trace.json: tweens must be a list of value names"]);
    expect(withTweens([""])).toEqual(["trace.json: tweens must be a list of value names"]);
  });

  it("accepts extents as a map from a value to its edge and 2 or more distinct parts", () => {
    const reads = demoTrace().channels.map((c) => c.read as string);
    const withExtents = (extents: unknown) => checkTrace({ ...demoTrace(), extents }).shape;
    expect(withExtents({ [reads[0]!]: { edge: "top", parts: ["a", "b"] } })).toEqual([]);
    expect(withExtents({ [reads[0]!]: { edge: "height", parts: ["a", "b", "c"] }, other: { edge: "left", parts: ["a", "b"] } })).toEqual([]);
    expect(withExtents({})).toEqual([]);
    expect(withExtents(["top"])).toEqual(["trace.json: extents must map each value name to { edge, parts }"]);
    expect(withExtents("top")).toEqual(["trace.json: extents must map each value name to { edge, parts }"]);
    expect(withExtents({ v: { edge: "middle", parts: ["a", "b"] } })).toEqual(["trace.json: extents.v.edge must be one of top, bottom, left, right, width, height"]);
    expect(withExtents({ v: { parts: ["a", "b"] } })).toEqual(["trace.json: extents.v.edge must be one of top, bottom, left, right, width, height"]);
    expect(withExtents({ v: { edge: "top", parts: ["a"] } })).toEqual(["trace.json: extents.v.parts must list 2 or more distinct object names"]);
    expect(withExtents({ v: { edge: "top", parts: ["a", "a"] } })).toEqual(["trace.json: extents.v.parts must list 2 or more distinct object names"]);
    expect(withExtents({ v: { edge: "top", parts: ["a", ""] } })).toEqual(["trace.json: extents.v.parts must list 2 or more distinct object names"]);
    expect(withExtents({ v: { edge: "top", parts: "ab" } })).toEqual(["trace.json: extents.v.parts must list 2 or more distinct object names"]);
    expect(withExtents({ v: null })).toEqual(["trace.json: extents.v must be { edge, parts }"]);
  });

  it("a stepped bar: the trace compares the drawings the original held, and suddenJumps judges them at the drawing rate", async () => {
    // gate-demo with its lift y drawn 12 times a second, and a trace recorded from those drawings.
    const html = demoFile("index.html").replace("return { y: -MOTION.lift.px * s,", "return { y: -MOTION.lift.px * share(Math.floor(T * 12 + 1e-9) / 12 % MOTION.loop.periodS),");
    expect(html).not.toBe(demoFile("index.html"));
    const run = (stepped: string[]) =>
      withBarCopy(DEMO, { "index.html": html }, async (copy) => {
        const trace = demoTrace() as ReturnType<typeof demoTrace> & { samples: number[][] };
        const p = await openPage(path.join(copy, "index.html"));
        try {
          const rows = await p.framesAt(trace.samples.map((r) => r[0]!));
          trace.samples = trace.samples.map((r, i) => [r[0]!, rows[i]!.values.y!, r[2]!]);
        } finally {
          await p.close();
        }
        writeFileSync(path.join(copy, "trace.json"), JSON.stringify({ ...trace, stepped }));
        return barGate(copy);
      });
    expect((await run(["y"])).failures).toEqual([]);
    expect(failing(await run([]))).toEqual(["suddenJumps"]);
  });

  it("fails a trace.json whose fps is not 60, or with fewer than 2 channels", async () => {
    const at30 = { ...demoTrace(), fps: 30 };
    expect((await withBarCopy(DEMO, { "trace.json": JSON.stringify(at30) }, barGate)).failures).toEqual([
      "trace.json: fps must be 60, got 30; the gate seeks in 1/60 s frames and events land within 17 ms",
    ]);
    const trace = demoTrace();
    const one = { ...trace, channels: trace.channels.slice(0, 1), samples: (trace.samples as number[][]).map((r) => r.slice(0, 2)) };
    expect((await withBarCopy(DEMO, { "trace.json": JSON.stringify(one) }, barGate)).failures).toEqual(["trace.json: channels must hold 2 to 5 channels, got 1"]);
  });

  it("fails a tolerance that is not max(2 x rebuildError, the unit's floor)", async () => {
    const trace = demoTrace();
    trace.channels[0] = { ...trace.channels[0], rebuildError: 0.1 };
    const v = await withBarCopy(DEMO, { "trace.json": JSON.stringify(trace) }, barGate);
    expect(v.failures).toEqual(["trace.json: dotY tolerance 0.6, but max(2 x rebuildError 0.1, px floor 0.5) is 0.5"]);
  });

  it("fails a channel the page does not record, and a selector that matches nothing", async () => {
    const trace = demoTrace();
    trace.channels[1] = { ...trace.channels[1], read: "opacity", selectors: ["#gone"] };
    const v = await withBarCopy(DEMO, { "trace.json": JSON.stringify(trace) }, barGate);
    expect(v.status).toBe("failed");
    expect(failing(v)).toEqual(["emptySelector", "missingChannel"]);
  });

  it("does not pass a page with no clock hook", async () => {
    const v = await withBarCopy(DEMO, { "index.html": demoFile("index.html").replace("window.__seek =", "window.__seekGone =") }, barGate);
    expect(v.status).not.toBe("passed");
    expect(v.failures).toContain("noHook: the page has no window.__seek");
  });

  it("fails a trace.json it cannot use, without opening the page", async () => {
    const v = await withBarCopy(DEMO, { "trace.json": JSON.stringify({ fps: 60, input: { kind: "none", samples: [] }, channels: [], samples: [], events: {} }) }, barGate);
    expect(v.status).toBe("failed");
    expect(v.failures).toEqual(["trace.json: channels must hold 2 to 5 channels, got 0", "trace.json: samples must hold 1 or more rows"]);
  });

  it("plays a scroll bar's live run as wheel ticks: a page that smooths the wheel itself passes, and fails with no time-step cap", async () => {
    // bar-wheel smooths wheel ticks itself and follows a scroll it did not make at once. Set positions never start
    // its live loop, so the live run must send wheel ticks to reach the gap mid-move.
    const WHEEL = path.join(ROOT, "test/fixtures/gate-pages/kinds/bar-wheel");
    const clean = await barGate(WHEEL);
    expect(clean.failures).toEqual([]);
    expect(clean.status).toBe("passed");
    const html = readFileSync(path.join(WHEEL, "index.html"), "utf8");
    const noCap = html.replace("Math.min(now - last, MOTION.maxStepMs)", "(now - last)");
    expect(noCap).not.toBe(html);
    const v = await withBarCopy(WHEEL, { "index.html": noCap }, barGate);
    expect(failing(v)).toEqual(["realClockGap"]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^realClockGap: p moves [\d.]+ in the frame after the 2000 ms gap; its one-frame budget is [\d.]+$/)]));
  });

  it("judges reduced motion over the trace's whole span: a page that smooths under reduced motion fails, with input after 3 s", async () => {
    // bar-wheel with its input and rows moved 4 s later: the first wheel tick lands at 4250 ms, past SPAN_MS.
    const WHEEL = path.join(ROOT, "test/fixtures/gate-pages/kinds/bar-wheel");
    const t = JSON.parse(readFileSync(path.join(WHEEL, "trace.json"), "utf8")) as { input: { samples: number[][] }; samples: number[][] };
    const SHIFT = 4000;
    const shifted = {
      ...t,
      input: { ...t.input, samples: t.input.samples.map(([ms, ...v]) => [ms! + SHIFT, ...v]) },
      samples: [...Array.from({ length: SHIFT / (1000 / 60) }, (_, k) => [(k * 1000) / 60, 0, 0]), ...t.samples.map(([ms, ...v]) => [ms! + SHIFT, ...v])],
    };
    const late = { "trace.json": JSON.stringify(shifted) };
    const clean = await withBarCopy(WHEEL, late, barGate);
    expect(clean.failures).toEqual([]);
    const html = readFileSync(path.join(WHEEL, "index.html"), "utf8");
    const v = await withBarCopy(WHEEL, { ...late, "index.html": plantFault(html, "reducedIgnored", JSON.parse(readFileSync(path.join(WHEEL, "bar.json"), "utf8")) as BarJson) }, barGate);
    expect(failing(v)).toEqual(["reducedMotion"]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^reducedMotion: p still moves at (4[2-9]\d\d|5\d\d\d)(\.\d+)? ms/)]));
  });

  it("fails each planted fault, each on its own cause", async () => {
    const html = demoFile("index.html");
    const run = (fault: Parameters<typeof plantFault>[1]) => withBarCopy(DEMO, { "index.html": plantFault(html, fault, demoBar()) }, barGate);
    expect(failing(await run("dial25"))).toEqual(["trace"]);
    expect(failing(await run("linear"))).toEqual(["trace"]);
    expect(failing(await run("reducedIgnored"))).toEqual(["reducedMotion"]);
    expect(failing(await run({ own: "taller lift" }))).toEqual(["trace"]);
  });
});
