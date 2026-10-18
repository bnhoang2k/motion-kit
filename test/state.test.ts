import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/defaults.ts";
import { MotionConfigError, resolve } from "../src/core/merge.ts";
import type { Overrides } from "../src/core/types.ts";
import { adopt, config, createLabState, edit, overrides, type LabState } from "../src/lab-server/state.ts";

const TAP_BOUNCE = ["moves", "tap", "bounce"] as const;
const STAGGER = ["stagger"] as const;
const demo = (): Overrides => ({ feels: { "demo-playful": { extends: "whimsical", stagger: 0.07 } } });

/** What the Lab's Save does: send the overrides, the server checks and writes them, the Lab adopts what came back. */
function save(s: LabState): string {
  const written = JSON.parse(JSON.stringify(overrides(s))) as Overrides;
  resolve(written);
  adopt(s, written);
  return `${JSON.stringify(written, null, 2)}\n`;
}

const bounce = (s: LabState, feel: string) => config(s).feels[feel]!.moves.tap.bounce;

describe("Lab state", () => {
  it("a child follows a parent dragged step by step, and saving twice writes the same bytes", () => {
    const s = createLabState(demo());
    for (const v of [0.1, 0.2, 0.3]) {
      edit(s, "whimsical", TAP_BOUNCE, v);
      expect(bounce(s, "whimsical")).toBe(v);
      expect(bounce(s, "demo-playful")).toBe(v);
    }
    const first = save(s);
    expect(JSON.parse(first)).toEqual({
      feels: { "demo-playful": { extends: "whimsical", stagger: 0.07 }, whimsical: { moves: { tap: { bounce: 0.3 } } } },
    });
    expect(save(s)).toBe(first);
    expect(bounce(s, "demo-playful")).toBe(0.3);
    edit(s, "whimsical", TAP_BOUNCE, 0.25);
    expect(bounce(s, "demo-playful")).toBe(0.25);
  });

  it("a child set back to its own value after a parent edit keeps that value and owns it", () => {
    const s = createLabState(demo());
    edit(s, "whimsical", TAP_BOUNCE, 0.1);
    edit(s, "whimsical", STAGGER, 0.1);
    // tap bounce was inherited (0.35 at load); stagger was in the file (0.07).
    edit(s, "demo-playful", TAP_BOUNCE, 0.35);
    edit(s, "demo-playful", STAGGER, 0.09);
    edit(s, "demo-playful", STAGGER, 0.07);
    expect(bounce(s, "demo-playful")).toBe(0.35);
    expect(config(s).feels["demo-playful"]!.stagger).toBe(0.07);
    expect(overrides(s).feels!["demo-playful"]).toEqual({ extends: "whimsical", stagger: 0.07, moves: { tap: { bounce: 0.35 } } });
    edit(s, "whimsical", TAP_BOUNCE, 0.2);
    edit(s, "whimsical", STAGGER, 0.12);
    expect(bounce(s, "demo-playful")).toBe(0.35);
    expect(config(s).feels["demo-playful"]!.stagger).toBe(0.07);
  });

  it("a child set equal to its parent's current value drops the key and follows later parent edits", () => {
    const s = createLabState({ feels: { "demo-playful": { extends: "whimsical", stagger: 0.07, moves: { tap: { bounce: 0.2 } } } } });
    edit(s, "whimsical", TAP_BOUNCE, 0.25);
    edit(s, "demo-playful", TAP_BOUNCE, 0.25);
    expect(overrides(s).feels!["demo-playful"]).toEqual({ extends: "whimsical", stagger: 0.07 });
    edit(s, "whimsical", TAP_BOUNCE, 0.3);
    expect(bounce(s, "demo-playful")).toBe(0.3);
    expect(overrides(s).feels!["demo-playful"]).toEqual({ extends: "whimsical", stagger: 0.07 });
  });

  it("keeps a chain inherited when calm is dragged, in either key order", () => {
    const child = { extends: "parent", stagger: 0.01 };
    const parent = { extends: "calm", stagger: 0.07 };
    for (const existing of [{ feels: { child, parent } }, { feels: { parent, child } }] as Overrides[]) {
      const s = createLabState(existing);
      for (const v of [0.05, 0.1]) edit(s, "calm", TAP_BOUNCE, v);
      const out = overrides(s);
      expect(Object.keys(out.feels!)).toEqual([...Object.keys(existing.feels!), "calm"]);
      expect(out.feels!.parent).toEqual(parent);
      expect(out.feels!.child).toEqual(child);
      expect(out.feels!.calm).toEqual({ moves: { tap: { bounce: 0.1 } } });
      expect(bounce(s, "parent")).toBe(0.1);
      expect(bounce(s, "child")).toBe(0.1);
    }
  });

  it("a package feel edited back to its default leaves no trace, and keeps use and version", () => {
    const vd = DEFAULTS.feels.calm!.moves.move.visualDuration;
    const fresh = createLabState({});
    edit(fresh, "calm", ["moves", "move", "visualDuration"], 0.3);
    expect(overrides(fresh)).toEqual({ feels: { calm: { moves: { move: { visualDuration: 0.3 } } } } });
    edit(fresh, "calm", ["moves", "move", "visualDuration"], vd);
    expect(overrides(fresh)).toEqual({});

    const s = createLabState({ version: 1, use: { sidebar: "calm" }, feels: { calm: { moves: { move: { visualDuration: 0.3 } } } } });
    edit(s, "calm", ["moves", "move", "visualDuration"], vd);
    expect(overrides(s)).toEqual({ version: 1, use: { sidebar: "calm" } });
  });

  it("keeps a project feel's own keys even when they match nothing it could inherit", () => {
    const moves = structuredClone(DEFAULTS.feels.calm!.moves);
    const s = createLabState({ feels: { mine: { describe: "Mine", stagger: 0.01, moves } } });
    edit(s, "mine", TAP_BOUNCE, 0.2);
    edit(s, "mine", STAGGER, 0.01);
    expect(overrides(s).feels!.mine!.moves!.tap).toEqual({ ...moves.tap, bounce: 0.2 });
    expect(overrides(s).feels!.mine!.stagger).toBe(0.01);
  });

  it("refuses an edit that makes the config invalid and changes nothing", () => {
    const s = createLabState(demo());
    expect(() => edit(s, "whimsical", TAP_BOUNCE, 0.9)).toThrow(MotionConfigError);
    expect(() => edit(s, "nope", TAP_BOUNCE, 0.1)).toThrow(/unknown feel/);
    expect(overrides(s)).toEqual(demo());
  });

  it("treats a feel named like an Object property as a feel, not a prototype key", () => {
    const s = createLabState({ feels: { constructor: { extends: "calm" } } });
    edit(s, "constructor", TAP_BOUNCE, 0.1);
    expect(overrides(s)).toEqual({ feels: { constructor: { extends: "calm", moves: { tap: { bounce: 0.1 } } } } });
    edit(s, "constructor", TAP_BOUNCE, DEFAULTS.feels.calm!.moves.tap.bounce);
    expect(overrides(s)).toEqual({ feels: { constructor: { extends: "calm" } } });
  });

  it("refuses a file whose shape is wrong, so the Lab cannot save it", () => {
    expect(() => createLabState({ feels: [] } as never)).toThrow("feels: must be an object");
    expect(() => createLabState({ feels: { calm: { moves: { tap: { bouce: 1 } } } } } as never)).toThrow("feels.calm.moves.tap.bouce: unknown key");
    const s = createLabState({});
    expect(() => adopt(s, { feels: [] } as never)).toThrow(MotionConfigError);
    expect(overrides(s)).toEqual({});
  });

  it("hands out copies, so changing a returned object does not change the state", () => {
    const start = demo();
    const s = createLabState(start);
    start.feels!["demo-playful"]!.stagger = 0.1;
    overrides(s).feels!["demo-playful"]!.stagger = 0.1;
    config(s).feels["demo-playful"]!.stagger = 0.1;
    expect(overrides(s)).toEqual(demo());
    expect(config(s).feels["demo-playful"]!.stagger).toBe(0.07);
  });

  it("rejects an invalid file at load and an invalid adopt", () => {
    expect(() => createLabState({ feels: { x: { extends: "nope" } } })).toThrow(MotionConfigError);
    const s = createLabState(demo());
    expect(() => adopt(s, { reducedFade: 9 })).toThrow(MotionConfigError);
    expect(overrides(s)).toEqual(demo());
  });
});
