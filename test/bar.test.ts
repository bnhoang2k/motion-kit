import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run, type CliIo } from "../src/cli/run.ts";
import { absolutePathProblems, TOLERANCE_FLOORS, validateBar } from "../src/core/bar.ts";
import { MAX_PER_MOMENT, readBars, readMoments, render } from "../scripts/gen-bars-index.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIX = "test/fixtures/bars";
const j = (...parts: string[]) => parts.join("");

/** Reads a repo-relative path from disk, or undefined when it is missing. */
const fromDisk = (p: string): string | undefined => {
  const abs = path.join(ROOT, p);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
};

const dial = (bar: string, over: Record<string, unknown> = {}) => ({
  knob: "idle.period", value: 4, unit: "s", bar, path: "loop.periodS", row: "Row 1", base: false, ...over,
});

/** Stubs kinds/idle/dials.json with one entry per fixture slug; every other path comes from disk. */
function reader(dials: unknown[] | undefined = undefined, files: Record<string, string> = {}) {
  const fixtures = readdirSync(path.join(ROOT, FIX));
  const entries = dials ?? fixtures.map((s) => dial(s, s === "bad-dial-path" ? { path: "loop.speed" } : {}));
  return (p: string): string | undefined => {
    if (Object.hasOwn(files, p)) return files[p];
    if (p === "kinds/idle/dials.json") return JSON.stringify(entries);
    if (p.startsWith("kinds/") && !p.endsWith("/dial-set.json")) return undefined;
    return fromDisk(p);
  };
}

const goodBar = () => JSON.parse(fromDisk(`${FIX}/good/bar.json`)!) as Record<string, unknown>;
const withBar = (bar: Record<string, unknown>) => reader(undefined, { [`${FIX}/good/bar.json`]: JSON.stringify(bar) });

describe("validateBar", () => {
  it("passes the good fixture", () => {
    expect(validateBar(`${FIX}/good`, reader())).toEqual([]);
  });

  it("reads only the four bar files and the kit files", () => {
    const seen: string[] = [];
    const read = reader();
    expect(validateBar(`${FIX}/good`, (p) => (seen.push(p), read(p)))).toEqual([]);
    const bar = ["index.html", "bar.json", "notes.md", "trace.json"].map((f) => `${FIX}/good/${f}`);
    expect([...new Set(seen)].sort()).toEqual([...bar, "bars/moments.json", "kinds/idle/dial-set.json", "kinds/idle/dials.json"].sort());
  });

  it.each([
    ["bad-no-feel", "bar.json feel: missing"],
    ["bad-long-feel", "bar.json feel: at most 300 characters, got 327"],
    ["bad-unknown-moment", 'bar.json moments[0]: "not-a-moment" is not in bars/moments.json'],
    ["bad-dial-path", "bar.json dials[0].path: loop.speed is not in the MOTION block"],
    ["bad-six-dials", "bar.json dials: needs 1 to 5 entries, got 6"],
    ["bad-marker", 'index.html: the motion-kit-bar marker names "other", expected "bad-marker"'],
  ])("%s gives its one problem", (slug, problem) => {
    expect(validateBar(`${FIX}/${slug}`, reader())).toEqual([problem]);
  });

  it("flags a home path in notes.md", () => {
    const notes = `# Fixture bar\n\nThe clip sits at ${j("~", "/clips/loop.mp4")}.\n`;
    const read = reader(undefined, { [`${FIX}/good/notes.md`]: notes });
    expect(validateBar(`${FIX}/good`, read)).toEqual(['notes.md:3: absolute path: "~/"']);
  });

  it("flags a home path in bar.json", () => {
    const home = j("/Us", "ers/someone/page.mp4");
    expect(validateBar(`${FIX}/good`, withBar({ ...goodBar(), fits: `A loop like ${home}.` }))).toEqual([
      'bar.json:1: absolute path: "/Us' + 'ers/"',
    ]);
  });

  it("lists every problem at once", () => {
    const bar = { ...goodBar(), kinds: [], rung: 5, title: 3, extra: true };
    expect(validateBar(`${FIX}/good`, withBar(bar))).toEqual([
      "bar.json extra: unknown field",
      "bar.json title: must be a non-empty string",
      "bar.json kinds: needs at least one kind",
      "bar.json rung: must be a whole number from 1 to 4, or [lo, hi] with lo below hi",
    ]);
  });

  it("checks kinds, rung ranges, feel sentences and one-line fields", () => {
    const problems = (over: Record<string, unknown>) => validateBar(`${FIX}/good`, withBar({ ...goodBar(), ...over }));
    expect(problems({ kinds: ["idle", "oneshot"] })).toEqual(['bar.json kinds[1]: unknown kind "oneshot"']);
    expect(problems({ rung: 3 })).toEqual([]);
    expect(problems({ rung: [3, 2] })).toHaveLength(1);
    expect(problems({ feel: "One. Two. Three. Four." })).toEqual(["bar.json feel: needs 1 to 3 sentences, got 4"]);
    expect(problems({ fits: "two\nlines" })).toEqual(["bar.json fits: must be one line"]);
    expect(problems({ superseded: "good-two" })).toEqual([]);
  });

  it("checks the dial value against the page and against dials.json", () => {
    const off = withBar({ ...goodBar(), dials: [{ path: "loop.periodS", value: 5, unit: "s", knob: "idle.period", row: "Row 1" }] });
    expect(validateBar(`${FIX}/good`, off)).toEqual([
      "bar.json dials[0].value: 5, but the MOTION block holds 4",
      "bar.json dials[0].value: 5, but kinds/idle/dials.json holds 4",
    ]);
    const unknownKnob = withBar({ ...goodBar(), dials: [{ path: "loop.periodS", value: 4, unit: "s", knob: "idle.speed", row: "Row 1" }] });
    expect(validateBar(`${FIX}/good`, unknownKnob)).toEqual(['bar.json dials[0].knob: unknown knob "idle.speed": not in kinds/idle/dial-set.json']);
  });

  it("takes a dial from the dial set with no dials.json entry when the knob is not public", () => {
    const set = JSON.stringify([{ name: "idle.period", unit: "s", meaning: "loop" }, { name: "idle.rest", unit: "s", meaning: "the still part of a loop" }]);
    const own = { ...goodBar(), dials: [{ path: "loop.periodS", value: 4, unit: "s", knob: "idle.rest", row: "Row 1" }] };
    const read = reader([], { [`${FIX}/good/bar.json`]: JSON.stringify(own), "kinds/idle/dial-set.json": set });
    expect(validateBar(`${FIX}/good`, read)).toEqual([]);
    const noKind = { ...own, dials: [{ ...own.dials[0], knob: "spin.rate" }] };
    expect(validateBar(`${FIX}/good`, reader([], { [`${FIX}/good/bar.json`]: JSON.stringify(noKind) }))).toEqual(['bar.json dials[0].knob: unknown knob "spin.rate"']);
  });

  it("finds the dials.json entry by bar and knob, and uses `from` when it is there", () => {
    const dir = `${FIX}/good`;
    expect(validateBar(dir, reader([dial("other-bar")]))).toEqual([
      "bar.json dials[0]: kinds/idle/dials.json has no idle.period entry for good",
    ]);
    expect(validateBar(dir, reader([dial("good", { path: "loop.restShare" })]))).toEqual([
      "bar.json dials[0].path: loop.periodS, but kinds/idle/dials.json holds loop.restShare",
    ]);
    const conv = (from: Record<string, number>) => dial("good", { value: 0.004, path: ["loop.periodS"], from, convert: "msToS" });
    expect(validateBar(dir, reader([conv({ "loop.periodS": 4 })]))).toEqual([]);
    expect(validateBar(dir, reader([conv({ "loop.periodS": 4.5 })]))).toEqual([
      "bar.json dials[0].value: 4, but kinds/idle/dials.json holds 4.5",
    ]);
    expect(validateBar(dir, reader([conv({ other: 4 })]))).toEqual([
      "bar.json dials[0].path: loop.periodS is not in the from map of kinds/idle/dials.json",
    ]);
  });

  it("checks trace names, the fault text and the asset contract", () => {
    const problems = (over: Record<string, unknown>) => validateBar(`${FIX}/good`, withBar({ ...goodBar(), ...over }));
    expect(problems({ trace: [{ name: "dotY", tolerance: 0.5 }, { name: "o", tolerance: 0.01 }] })).toEqual([
      "bar.json trace: names dotY, o, but trace.json channels are dotY, opacity",
    ]);
    // trace holds 2 to 5 channels.
    expect(problems({ trace: [{ name: "dotY", tolerance: 0.5 }] })).toEqual([
      "bar.json trace: needs 2 to 5 entries, got 1",
      "bar.json trace: names dotY, but trace.json channels are dotY, opacity",
    ]);
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `c${i}`, tolerance: 0.5 }));
    expect(problems({ trace: six })[0]).toBe("bar.json trace: needs 2 to 5 entries, got 6");
    expect(problems({ trace: [] })).toEqual(["bar.json trace: needs 2 to 5 entries, got 0"]);
    expect(problems({ faults: [{ name: "x", find: "nowhere", replace: "y" }] })).toEqual([
      "bar.json faults[0].find: not found in index.html",
    ]);
    expect(problems({ faults: [{ name: "x", find: "<meta", replace: "<span" }] })).toEqual([
      "bar.json faults[0].find: found 2 times in index.html, needs exactly once",
    ]);
    expect(problems({ assetContract: { dot: { draw: ".dot", aspect: "1:1", view: "front", facing: "none", background: "sky" } } })).toEqual([
      'bar.json assetContract.dot.background: must be "cutout" or "full-bleed"',
    ]);
  });

  it("keeps one tolerance per channel, at or above the floor for its unit", () => {
    const good = JSON.parse(fromDisk(`${FIX}/good/trace.json`)!) as { channels: Record<string, unknown>[] };
    const traceFile = (channels: unknown[]) => JSON.stringify({ ...good, channels });
    const check = (bar: Record<string, unknown>, channels: unknown[]) =>
      validateBar(`${FIX}/good`, reader(undefined, { [`${FIX}/good/bar.json`]: JSON.stringify(bar), [`${FIX}/good/trace.json`]: traceFile(channels) }));
    const [dotY, opacity] = good.channels as [Record<string, unknown>, Record<string, unknown>];
    expect(check(goodBar(), [{ ...dotY, tolerance: 0.75, rebuildError: 0.375 }, opacity])).toEqual([
      "trace.json channels[0].tolerance: 0.75, but bar.json trace holds 0.5",
    ]);
    const tight = { ...goodBar(), trace: [{ name: "dotY", tolerance: 0.2 }, { name: "opacity", tolerance: 0.01 }] };
    expect(check(tight, [{ ...dotY, tolerance: 0.2 }, opacity])).toEqual([
      "bar.json trace[0].tolerance: 0.2 is below the px floor 0.5",
      "trace.json: dotY tolerance 0.2, but max(2 x rebuildError 0.1, px floor 0.5) is 0.5",
    ]);
    expect(TOLERANCE_FLOORS).toEqual({ px: 0.5, deg: 0.5, ratio: 0.01, opacity: 0.01, scale: 0.002, s: 0.017 });
  });

  it("refuses a trace.json that the bar gate cannot play, and a tolerance it would refuse", () => {
    const trace = JSON.parse(fromDisk(`${FIX}/good/trace.json`)!) as Record<string, unknown>;
    const check = (over: Record<string, unknown>) => validateBar(`${FIX}/good`, reader(undefined, { [`${FIX}/good/trace.json`]: JSON.stringify({ ...trace, ...over }) }));
    expect(check({ fps: 30 })).toEqual(["trace.json: fps must be 60, got 30; the gate seeks in 1/60 s frames and events land within 17 ms"]);
    expect(check({ samples: [[0, 0, 1], [16.667, 0, 1]] })).toEqual([
      "trace.json: samples[1] ms 16.667 is not on the 1/60 s grid (k * 1000 / 60); store the time at full precision, for example 1000 / 60 = 16.666666666666668, not a rounded value",
    ]);
    const channels = (trace.channels as Record<string, unknown>[]).map((c, i) => (i === 0 ? { ...c, rebuildError: 0.4 } : c));
    expect(check({ channels })).toEqual(["trace.json: dotY tolerance 0.5, but max(2 x rebuildError 0.4, px floor 0.5) is 0.8"]);
  });

  it("names each missing file, and a page with no MOTION block", () => {
    const read = reader(undefined, { [`${FIX}/good/index.html`]: '<meta name="motion-kit-bar" content="good">' });
    expect(validateBar(`${FIX}/good`, read)).toEqual([
      "index.html: no `const MOTION = {` block",
      "bar.json faults[0].find: not found in index.html",
    ]);
    expect(validateBar(`${FIX}/missing`, reader())).toEqual([
      "index.html: missing",
      "bar.json: missing",
      "notes.md: missing",
      "trace.json: missing",
    ]);
  });
});

describe("absolute path check", () => {
  it("matches home paths only, one line each", () => {
    expect(absolutePathProblems("notes.md", `A plain line.\nAn upgrade, a generated file.\nsee ~/x and ${j("/Us", "ers/y")}`)).toEqual([
      'notes.md:3: absolute path: "~/"',
      'notes.md:3: absolute path: "/Us' + 'ers/"',
    ]);
  });
});

describe("bars/moments.json", () => {
  const moments = JSON.parse(fromDisk("bars/moments.json")!) as { name: string; meaning: string }[];

  it("holds unique lowercase dashed names, each with a one-line meaning", () => {
    expect(new Set(moments.map((m) => m.name)).size).toBe(moments.length);
    for (const m of moments) {
      expect(m.name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(m.meaning).toMatch(/^[^\n]{10,}$/);
      expect(Object.keys(m).sort()).toEqual(["meaning", "name"]);
    }
  });

  it("names no absolute path", () => {
    expect(absolutePathProblems("bars/moments.json", fromDisk("bars/moments.json")!)).toEqual([]);
  });
});

describe("real bar folders", () => {
  it("every bars/<slug>/ folder passes validate-bar", () => {
    const slugs = readdirSync(path.join(ROOT, "bars"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const problems = slugs.flatMap((s) => validateBar(`bars/${s}`, fromDisk).map((p) => `${s}: ${p}`));
    expect(problems).toEqual([]);
  });
});

describe("bars/INDEX.md", () => {
  const bar = (slug: string, over: Record<string, unknown> = {}) => ({
    slug, kinds: ["idle"], moments: ["idle-stretch"], rung: 2, feel: "A slow loop.", fits: "Calm pages.", wrongFor: "Forms.", ...over,
  });
  const moments = readMoments();

  it("is up to date with every bar.json (run pnpm gen:bars)", () => {
    expect(fromDisk("bars/INDEX.md")).toBe(render(readBars(), moments));
  });

  it("says it is generated, and has no moment section with no bars", () => {
    const text = render([], moments);
    expect(text).toMatch(/generated by scripts\/gen-bars-index\.mjs/i);
    expect(text).not.toMatch(/^## /m);
  });

  it("gives one section per moment with a row per bar, and leaves superseded bars out", () => {
    const text = render([bar("b-two", { rung: [2, 3], fits: "a | b" }), bar("a-one"), bar("c-old", { superseded: "a-one" })], moments);
    expect(text.match(/^## /gm)).toHaveLength(1);
    expect(text).toContain("## idle-stretch");
    expect(text).toContain("| [a-one](a-one/index.html) | idle | 2 | A slow loop. | Calm pages. | Forms. | `bars/a-one/` |");
    expect(text).toContain("| [b-two](b-two/index.html) | idle | 2 to 3 | A slow loop. | a \\| b | Forms. | `bars/b-two/` |");
    expect(text.indexOf("a-one")).toBeLessThan(text.indexOf("b-two"));
    expect(text).not.toContain("c-old");
  });

  it(`allows at most ${MAX_PER_MOMENT} bars per moment`, () => {
    const three = ["a", "b", "c"].map((s) => bar(s));
    expect(() => render(three, moments)).not.toThrow();
    expect(() => render([...three, bar("d")], moments)).toThrow("idle-stretch: 4 bars, at most 3");
    expect(() => render([...three, bar("d", { superseded: "a" })], moments)).not.toThrow();
  });
});

describe("motion-kit validate-bar", () => {
  function io(files: Record<string, string | undefined>) {
    const out: string[] = [];
    const err: string[] = [];
    const api: CliIo = {
      cwd: ROOT,
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      read: (p) => (Object.hasOwn(files, p) ? files[p] : fromDisk(path.relative(ROOT, p))),
      write: () => {
        throw new Error("validate-bar writes nothing");
      },
    };
    return { api, out, err };
  }
  const stub = { [path.join(ROOT, "kinds/idle/dials.json")]: JSON.stringify(readdirSync(path.join(ROOT, FIX)).map((s) => dial(s))) };

  it("exits 0 on a good folder", () => {
    const t = io(stub);
    expect(run(["validate-bar", `${FIX}/good`], t.api)).toBe(0);
    expect(t.out.join("")).toBe(`${FIX}/good is valid.\n`);
  });

  it("exits 1 and lists the problems", () => {
    const t = io(stub);
    expect(run(["validate-bar", path.join(ROOT, FIX, "bad-marker")], t.api)).toBe(1);
    expect(t.err.join("")).toBe('index.html: the motion-kit-bar marker names "other", expected "bad-marker"\n');
  });

  it("exits 2 on a missing bar file or on JSON that does not parse, like validate", () => {
    const missing = io({ ...stub, [path.join(ROOT, FIX, "good/notes.md")]: undefined });
    expect(run(["validate-bar", `${FIX}/good`], missing.api)).toBe(2);
    expect(missing.err.join("")).toBe(`${FIX}/good/notes.md: missing\n`);
    const broken = io({ ...stub, [path.join(ROOT, FIX, "good/trace.json")]: "{ nope" });
    expect(run(["validate-bar", `${FIX}/good`], broken.api)).toBe(2);
    expect(broken.err.join("")).toMatch(new RegExp(`^${FIX}/good/trace\\.json: not valid JSON: `));
    const badBar = io({ ...stub, [path.join(ROOT, FIX, "good/bar.json")]: "[" });
    expect(run(["validate-bar", `${FIX}/good`], badBar.api)).toBe(2);
  });

  it("exits 2 on a folder it cannot read, and on bad usage", () => {
    const a = io(stub);
    expect(run(["validate-bar", `${FIX}/nope`], a.api)).toBe(2);
    expect(a.err.join("")).toBe(`Cannot read ${FIX}/nope.\n`);
    const b = io(stub);
    expect(run(["validate-bar"], b.api)).toBe(2);
    expect(b.err.join("")).toMatch(/^Usage: [\s\S]*validate-bar <dir>/);
    const c = io(stub);
    expect(run(["validate-bar", "a", "b"], c.api)).toBe(2);
    const d = io(stub);
    expect(run(["validate-bar", `${FIX}/good`, "--in", "x.json"], d.api)).toBe(2);
  });
});
