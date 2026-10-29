import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOB_CONVERT, KNOB_FIELDS, knob, knobBase, knobDistance, resolve } from "../src/core/index.ts";
import { KINDS } from "../src/core/kinds.ts";
import { readDials, render } from "../scripts/gen-knob-values.mjs";
import { base, baseBar } from "./knob-base.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("knob readers", () => {
  it("returns the base when the file has no override", () => {
    expect(knob(resolve({}), "idle", "period")).toBe(4);
  });

  it("returns the override when the file has one", () => {
    expect(knob(resolve({ version: 2, kinds: { idle: { period: 6 } } }), "idle", "period")).toBe(6);
  });

  it("returns the spring base for live.release", () => {
    const v = knob(resolve({}), "live", "release");
    expect(typeof v).not.toBe("number");
    expect((v as { bounce: number }).bounce).toBeCloseTo(0.16, 6);
    expect((v as { visualDuration: number }).visualDuration).toBeCloseTo(0.2353, 4);
  });

  it("knobBase names the base bar and lists the bars", () => {
    const info = knobBase("live", "release");
    expect((info.base.value as { bounce: number }).bounce).toBeCloseTo(0.16, 6);
    expect(info.base.bar).toBe(baseBar("live.release"));
    expect(info.bars.map((b) => b.bar)).toContain(baseBar("live.release"));
  });

  it("throws on a knob that does not exist", () => {
    expect(() => knobBase("idle", "nope")).toThrow("unknown knob: idle.nope");
    expect(() => knobDistance("idle.nope", 1)).toThrow("unknown knob: idle.nope");
  });
});

describe("knobDistance", () => {
  it("reads above base", () => {
    expect(knobDistance("idle.period", 6)).toEqual([`idle.period 6.0 s, 50% above base ${base("idle.period", "4.0 s")}`]);
  });

  it("reads below base, with 3 significant digits under 1", () => {
    expect(knobDistance("scroll.maxStep", 0.025)).toEqual([`scroll.maxStep 0.025 s, 50% below base ${base("scroll.maxStep", "0.05 s")}`]);
  });

  it("keeps one decimal when 3 significant digits round up to 1", () => {
    expect(knobDistance("idle.period", 0.9996)).toEqual([`idle.period 1.0 s, 75% below base ${base("idle.period", "4.0 s")}`]);
  });

  it("prints a spring base with no float noise", () => {
    const base = knobBase("live", "release").base.value as { visualDuration: number; bounce: number };
    expect(String(base.bounce)).toBe("0.16");
  });

  it("says at base when equal", () => {
    expect(knobDistance("idle.period", 4)).toEqual([`idle.period 4.0 s, at base ${base("idle.period", "4.0 s")}`]);
  });

  it("gives one line per number for a spring, with bounce as a plain ratio", () => {
    expect(knobDistance("live.release", { visualDuration: 0.3, bounce: 0.2 })).toEqual([
      `live.release.visualDuration 0.3 s, 27% above base ${base("live.release", "0.235 s")}`,
      `live.release.bounce 0.2, 25% above base ${base("live.release", "0.16")}`,
    ]);
  });

  it("rejects a value of the wrong shape", () => {
    expect(() => knobDistance("idle.period", { visualDuration: 1, bounce: 0 })).toThrow("expected a number");
    expect(() => knobDistance("live.release", 1)).toThrow("expected a spring");
  });
});

describe("dial sets", () => {
  const sets = KINDS.map((kind) => ({ kind, set: JSON.parse(readFileSync(path.join(ROOT, "kinds", kind, "dial-set.json"), "utf8")) as { name: string; unit: string; meaning: string }[] }));
  const all = sets.flatMap(({ set }) => set);

  it("names each dial once, under its own kind, with a unit and a meaning", () => {
    for (const { kind, set } of sets) for (const e of set) {
      expect(e.name.startsWith(`${kind}.`), e.name).toBe(true);
      expect(Object.keys(e).sort(), e.name).toEqual(["meaning", "name", "unit"]);
      expect(e.unit.length > 0 && e.meaning.length > 0, e.name).toBe(true);
    }
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length);
  });

  it("holds every public knob with the unit that KNOB_FIELDS names", () => {
    for (const [field, spec] of Object.entries(KNOB_FIELDS)) expect(all.find((e) => e.name === field)?.unit, field).toBe(spec.unit);
  });
});

describe("dials.json evidence lists", () => {
  const dials = readDials();

  it("has exactly one base entry for every knob in KNOB_FIELDS, and no other knob", () => {
    expect(new Set(dials.map((d) => d.knob))).toEqual(new Set(Object.keys(KNOB_FIELDS)));
    for (const field of Object.keys(KNOB_FIELDS)) {
      expect(dials.filter((d) => d.knob === field && d.base === true), field).toHaveLength(1);
    }
  });

  it("uses the unit that KNOB_FIELDS names", () => {
    for (const d of dials) expect(d.unit, d.knob).toBe(KNOB_FIELDS[d.knob]?.unit);
  });

  it("stores a value that equals convert(from) for every entry with a convert", () => {
    const converted = dials.filter((d) => d.convert !== undefined);
    expect(converted.length).toBeGreaterThan(0);
    for (const d of converted) {
      const fn = KNOB_CONVERT[d.convert as string];
      expect(fn, `${d.knob}: convert ${d.convert}`).toBeTypeOf("function");
      const paths = Array.isArray(d.path) ? d.path : [d.path];
      const out = fn!(paths.map((p) => (d.from as Record<string, number>)[p] as number));
      if (typeof d.value === "number") expect(out as number, d.knob).toBeCloseTo(d.value, 6);
      else {
        const o = out as { visualDuration: number; bounce: number };
        expect(o.visualDuration, d.knob).toBeCloseTo(d.value.visualDuration, 6);
        expect(o.bounce, d.knob).toBeCloseTo(d.value.bounce, 6);
      }
    }
  });

  it("keeps src/core/knob-values.ts in step with the dials.json files", () => {
    const onDisk = readFileSync(new URL("../src/core/knob-values.ts", import.meta.url), "utf8");
    expect(onDisk).toBe(render(dials));
    expect(onDisk.startsWith("// Generated by scripts/gen-knob-values.mjs")).toBe(true);
  });

  it("render refuses a knob with two base entries or none", () => {
    const one = dials[0]!;
    expect(() => render([one, { ...one }])).toThrow("exactly one");
    expect(() => render([{ ...one, base: false }])).toThrow("exactly one");
  });
});
