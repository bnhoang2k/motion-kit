import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/defaults.ts";
import { validate, validateOverrides } from "../src/core/validate.ts";
import { MotionConfigError, resolve } from "../src/core/merge.ts";
import { flatTx, feelFor, staggerOf, tx } from "../src/core/tx.ts";
import { MOVES } from "../src/core/types.ts";

describe("defaults", () => {
  it("are valid", () => expect(validate(DEFAULTS)).toEqual([]));

  it("keep exits flat, taps short and bounce at most 0.4", () => {
    for (const [name, feel] of Object.entries(DEFAULTS.feels)) {
      expect(feel.moves.exit.bounce, `${name} exit`).toBe(0);
      expect(feel.moves.tap.visualDuration, `${name} tap`).toBeLessThanOrEqual(0.15);
      expect(feel.moves.exit.visualDuration, `${name} exit`).toBeCloseTo(0.6 * feel.moves.enter.visualDuration, 1);
      for (const m of MOVES) expect(feel.moves[m].bounce).toBeLessThanOrEqual(0.4);
    }
  });
});

describe("validate", () => {
  const bad = (patch: (c: typeof DEFAULTS) => void): string[] => {
    const c = structuredClone(DEFAULTS);
    patch(c);
    return validate(c);
  };

  it("rejects bounce above 0.4 and names the path", () => {
    expect(bad((c) => (c.feels.calm!.moves.tap.bounce = 0.5))).toEqual([
      "feels.calm.moves.tap.bounce: must be a number from 0 to 0.4, got 0.5",
    ]);
  });

  it("rejects negative bounce", () => {
    expect(bad((c) => (c.feels.sleek!.moves.move.bounce = -0.1))[0]).toMatch(/^feels\.sleek\.moves\.move\.bounce/);
  });

  it("rejects a move without reduced", () => {
    expect(bad((c) => delete (c.feels.calm!.moves.enter as Partial<{ reduced: string }>).reduced)).toEqual([
      'feels.calm.moves.enter.reduced: must be "instant" or "fade"',
    ]);
  });

  it("rejects an unknown move and a missing move", () => {
    const errs = bad((c) => {
      const moves = c.feels.calm!.moves as Record<string, unknown>;
      moves.wiggle = moves.tap;
      delete moves.celebrate;
    });
    expect(errs).toContain("feels.calm.moves.wiggle: unknown move (allowed: tap, enter, exit, move, attention, celebrate)");
    expect(errs).toContain("feels.calm.moves.celebrate: missing");
  });

  it("rejects visualDuration outside 0.05 to 1.5 s", () => {
    expect(bad((c) => (c.feels.calm!.moves.move.visualDuration = 2))).toHaveLength(1);
    expect(bad((c) => (c.feels.calm!.moves.move.visualDuration = 0.01))).toHaveLength(1);
  });

  it("rejects an unknown key on a move", () => {
    expect(bad((c) => ((c.feels.calm!.moves.tap as unknown as Record<string, unknown>).bouce = 0.3))).toEqual(["feels.calm.moves.tap.bouce: unknown key"]);
  });

  it("rejects a surface with the name of a feel, and a prototype member as a target", () => {
    expect(bad((c) => (c.use = { calm: "sleek" }))).toEqual(["use.calm: a surface cannot have the name of a feel"]);
    expect(bad((c) => (c.use = { s: "constructor" }))).toEqual(['use.s: unknown feel "constructor"']);
  });

  it("says a feel without describe or stagger is missing them", () => {
    const errs = bad((c) => {
      const f = c.feels.calm as unknown as Record<string, unknown>;
      delete f.describe;
      delete f.stagger;
    });
    expect(errs).toEqual(["feels.calm.describe: missing", "feels.calm.stagger: missing"]);
  });

  it("rejects a surface that points at an unknown feel", () => {
    expect(bad((c) => (c.use = { station: "nope" }))).toEqual(['use.station: unknown feel "nope"']);
  });
});

describe("validateOverrides", () => {
  const parse = (json: string): unknown => JSON.parse(json);

  it("accepts a good override and an empty one", () => {
    expect(validateOverrides({})).toEqual([]);
    expect(validateOverrides({ version: 1, reducedFade: 0.2, feels: { calm: { stagger: 0.05, moves: { tap: { bounce: 0.1 } } } }, use: { station: "calm" } })).toEqual([]);
  });

  it("names a misspelled move key", () => {
    expect(validateOverrides(parse('{"feels":{"calm":{"moves":{"tap":{"bouce":0.3}}}}}'))).toEqual(["feels.calm.moves.tap.bouce: unknown key"]);
  });

  it("names a misspelled feel key and a stray top-level key", () => {
    expect(validateOverrides({ feels: { calm: { stager: 0.1 } } })).toEqual(["feels.calm.stager: unknown key"]);
    expect(validateOverrides({ feel: {} })).toEqual(["feel: unknown key"]);
  });

  it("rejects an unknown move name", () => {
    expect(validateOverrides({ feels: { calm: { moves: { wiggle: {} } } } })).toEqual([
      "feels.calm.moves.wiggle: unknown move (allowed: tap, enter, exit, move, attention, celebrate)",
    ]);
  });

  it("rejects anything that is not a plain object where an object is needed", () => {
    expect(validateOverrides(null)).toEqual(["config: must be an object"]);
    expect(validateOverrides([])).toEqual(["config: must be an object"]);
    expect(validateOverrides({ feels: [] })).toEqual(["feels: must be an object"]);
    expect(validateOverrides({ feels: null })).toEqual(["feels: must be an object"]);
    expect(validateOverrides({ feels: { calm: null } })).toEqual(["feels.calm: must be an object"]);
    expect(validateOverrides({ feels: { calm: [] } })).toEqual(["feels.calm: must be an object"]);
    expect(validateOverrides({ feels: { calm: { moves: [] } } })).toEqual(["feels.calm.moves: must be an object"]);
    expect(validateOverrides({ feels: { calm: { moves: { tap: null } } } })).toEqual(["feels.calm.moves.tap: must be an object"]);
    expect(validateOverrides({ use: [] })).toEqual(["use: must be an object"]);
  });

  it("rejects a feel or surface name that could swap a prototype", () => {
    expect(validateOverrides(parse('{"feels":{"__proto__":{"stagger":0.1}}}'))).toEqual([
      "feels.__proto__: name must be lowercase letters, digits and dashes",
    ]);
    expect(validateOverrides(parse('{"use":{"__proto__":"calm"}}'))).toEqual(["use.__proto__: name must be lowercase letters, digits and dashes"]);
    expect(validateOverrides(parse('{"feels":{"calm":{"moves":{"__proto__":{}}}}}'))).toHaveLength(1);
  });

  it("rejects a surface that has the name of a feel", () => {
    expect(validateOverrides({ use: { calm: "sleek" } })).toEqual(["use.calm: a surface cannot have the name of a feel"]);
    expect(validateOverrides({ feels: { demo: { extends: "calm" } }, use: { demo: "sleek" } })).toEqual([
      "use.demo: a surface cannot have the name of a feel",
    ]);
  });

  it("rejects values of the wrong type that a merge would swallow", () => {
    expect(validateOverrides({ reducedFade: null })).toEqual(["reducedFade: must be a number, got null"]);
    expect(validateOverrides({ feels: { calm: { stagger: null } } })).toEqual(["feels.calm.stagger: must be a number, got null"]);
    expect(validateOverrides({ feels: { calm: { describe: 3 } } })).toEqual(["feels.calm.describe: must be a string, got 3"]);
    expect(validateOverrides({ feels: { calm: { extends: 3 } } })).toEqual(["feels.calm.extends: must be a string, got 3"]);
    expect(validateOverrides({ version: 2 })).toEqual(["version: expected 1, got 2"]);
    expect(validateOverrides({ use: { station: 3 } })).toEqual(["use.station: must be a string, got 3"]);
    expect(validateOverrides({ feels: { calm: { moves: { tap: { reduced: "slow" } } } } })).toEqual(['feels.calm.moves.tap.reduced: must be "instant" or "fade"']);
  });

  it("lists every problem at once", () => {
    expect(validateOverrides({ x: 1, feels: { calm: { stager: 1, moves: { tap: { bouce: 1 } } } } })).toEqual([
      "x: unknown key",
      "feels.calm.stager: unknown key",
      "feels.calm.moves.tap.bouce: unknown key",
    ]);
  });
});

describe("resolve", () => {
  const problemsOf = (o: unknown): string[] => {
    try {
      resolve(o);
    } catch (e) {
      return (e as MotionConfigError).problems;
    }
    throw new Error("resolve did not throw");
  };

  it("rejects malformed overrides before it merges them", () => {
    expect(problemsOf(null)).toEqual(["config: must be an object"]);
    expect(problemsOf({ feels: { calm: null } })).toEqual(["feels.calm: must be an object"]);
    expect(problemsOf({ feels: { calm: { moves: { tap: { bouce: 0.3 } } } } })).toEqual(["feels.calm.moves.tap.bouce: unknown key"]);
    expect(problemsOf({ feels: [] })).toEqual(["feels: must be an object"]);
  });

  it("does not let a use target be a prototype member", () => {
    expect(problemsOf({ use: { s: "constructor" } })).toEqual(['use.s: unknown feel "constructor"']);
  });

  it("reports extends of a prototype member as an unknown feel", () => {
    expect(problemsOf({ feels: { x: { extends: "constructor" } } })).toEqual(['feels.x.extends: unknown feel "constructor"']);
  });

  it("does not build a new feel on a prototype member", () => {
    const p = problemsOf({ feels: { constructor: { stagger: 0.05 } } });
    expect(p).toContain("feels.constructor.describe: missing");
  });

  it("says which part a new feel without a base lacks", () => {
    const p = problemsOf({ feels: { brand: { moves: {} } } });
    expect(p).toContain("feels.brand.describe: missing");
    expect(p).toContain("feels.brand.stagger: missing");
    expect(p).toContain("feels.brand.moves.tap: missing");
  });

  it("says which part of a new move is missing", () => {
    const p = problemsOf({ feels: { brand: { describe: "d", stagger: 0.05, moves: { tap: { bounce: 0.1 }, enter: { visualDuration: 0.2, bounce: 0, reduced: "fade" } } } } });
    expect(p).toContain("feels.brand.moves.tap.visualDuration: missing");
    expect(p).toContain('feels.brand.moves.tap.reduced: must be "instant" or "fade"');
  });

  it("returns the defaults with no overrides", () => expect(resolve()).toEqual(DEFAULTS));

  it("lets the project win, one value at a time", () => {
    const c = resolve({ feels: { calm: { moves: { move: { visualDuration: 0.3 } } } } });
    expect(c.feels.calm!.moves.move).toEqual({ ...DEFAULTS.feels.calm!.moves.move, visualDuration: 0.3 });
    expect(c.feels.calm!.moves.enter).toEqual(DEFAULTS.feels.calm!.moves.enter);
  });

  it("builds a project feel from extends", () => {
    const c = resolve({ feels: { "demo-guest": { extends: "whimsical", moves: { tap: { bounce: 0.25 } } } }, use: { guest: "demo-guest" } });
    expect(c.feels["demo-guest"]!.moves.tap.bounce).toBe(0.25);
    expect(c.feels["demo-guest"]!.moves.enter).toEqual(DEFAULTS.feels.whimsical!.moves.enter);
    expect(c.use).toEqual({ guest: "demo-guest" });
  });

  it("throws with every problem listed", () => {
    expect(() => resolve({ feels: { calm: { moves: { tap: { bounce: 0.9 } } } } }, "demo/motion.json")).toThrow(MotionConfigError);
    try {
      resolve({ feels: { calm: { moves: { tap: { bounce: 0.9 } } } } }, "demo/motion.json");
    } catch (e) {
      expect((e as MotionConfigError).message).toBe(
        "demo/motion.json is not a valid motion config:\n- feels.calm.moves.tap.bounce: must be a number from 0 to 0.4, got 0.9",
      );
    }
  });

  it("extends another project feel in either key order", () => {
    const b = { extends: "a", moves: { tap: { bounce: 0.1 } } };
    const a = { extends: "calm", stagger: 0.05 };
    const one = resolve({ feels: { b, a } });
    const two = resolve({ feels: { a, b } });
    expect(one.feels).toEqual(two.feels);
    expect(one.feels.b!.stagger).toBe(0.05);
    expect(one.feels.b!.moves.tap.bounce).toBe(0.1);
  });

  it("extends sees the project's override of a default in either key order", () => {
    const p = { extends: "calm" };
    const calm = { stagger: 0.1 };
    expect(resolve({ feels: { p, calm } }).feels.p!.stagger).toBe(0.1);
    expect(resolve({ feels: { calm, p } }).feels.p!.stagger).toBe(0.1);
  });

  it("rejects an extends cycle", () => {
    const cfg = { feels: { a: { extends: "b" }, b: { extends: "a" } } };
    expect(() => resolve(cfg)).toThrow(MotionConfigError);
    try {
      resolve(cfg);
    } catch (e) {
      expect((e as MotionConfigError).problems).toEqual(["feels.a.extends: cycle a -> b -> a"]);
    }
  });

  it("rejects extends of an unknown feel", () => {
    expect(() => resolve({ feels: { x: { extends: "nope" } } })).toThrow(/feels\.x\.extends: unknown feel "nope"/);
  });
});

describe("tx", () => {
  const cfg = resolve({ use: { station: "calm", guest: "whimsical" } });

  it("keeps bounce only when a touch caused the move", () => {
    expect(tx(cfg, "whimsical", "tap", { byTouch: true }).bounce).toBe(0.35);
    expect(tx(cfg, "whimsical", "tap", { byTouch: false }).bounce).toBe(0);
  });

  it("resolves a surface name through use", () => {
    expect(feelFor(cfg, "guest")).toBe(cfg.feels.whimsical);
  });

  it("carries amount and reduced", () => {
    expect(tx(cfg, "calm", "attention", { byTouch: false })).toEqual({ visualDuration: 0.3, bounce: 0, amount: 1.08, reduced: "instant" });
  });

  it("gives opacity and color bounce 0", () => {
    expect(flatTx(cfg, "whimsical", "enter")).toEqual({ visualDuration: 0.48, bounce: 0 });
  });

  it("reads stagger", () => expect(staggerOf(cfg, "guest")).toBe(0.065));

  it("throws on an unknown feel", () => {
    expect(() => tx(cfg, "nope", "tap", { byTouch: true })).toThrow('unknown feel or surface "nope"');
  });

  it("does not read a prototype member as a feel or a surface", () => {
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => tx(cfg, name, "tap", { byTouch: true }), name).toThrow(`unknown feel or surface "${name}"`);
    }
    expect(() => feelFor({ ...cfg, use: undefined } as never, "constructor")).toThrow('unknown feel or surface "constructor"');
  });
});
