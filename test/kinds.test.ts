import { describe, expect, it } from "vitest";
import { MotionConfigError, resolve } from "../src/core/index.ts";

const problemsOf = (input: unknown): string[] => {
  try {
    resolve(input);
  } catch (e) {
    if (e instanceof MotionConfigError) return e.problems;
    throw e;
  }
  return [];
};

describe("motion.json v2 kinds block", () => {
  it("leaves v1 results alone", () => {
    expect(resolve({})).toEqual(resolve({ version: 1 }));
    expect("kinds" in resolve({})).toBe(false);
  });

  it("carries kinds as overrides only, and writes version 2", () => {
    const cfg = resolve({ version: 2, kinds: { idle: { period: 4 } } });
    expect(cfg.version).toBe(2);
    expect(cfg.kinds).toEqual({ idle: { period: 4 } });
  });

  it("rejects kinds without version 2", () => {
    expect(problemsOf({ version: 1, kinds: { idle: { period: 4 } } })).toContain("kinds: needs version 2");
    expect(problemsOf({ kinds: { idle: { period: 4 } } })).toContain("kinds: needs version 2");
  });

  it("rejects unknown knobs, unknown kinds and bad versions", () => {
    expect(problemsOf({ version: 2, kinds: { idle: { speed: 1 } } })).toContain("kinds.idle.speed: unknown knob (allowed: period)");
    expect(problemsOf({ version: 2, kinds: { oneshot: {} } })).toContain("kinds.oneshot: unknown kind");
    expect(problemsOf({ version: 3 })).toContain("version: expected 1 or 2, got 3");
  });

  it("accepts values with no ceiling", () => {
    expect(() => resolve({ version: 2, kinds: { idle: { period: 60 } } })).not.toThrow();
    expect(() => resolve({ version: 2, kinds: { scroll: { smooth: 3, maxStep: 0.05 } } })).not.toThrow();
    expect(() => resolve({ version: 2, kinds: { live: { release: { visualDuration: 6, bounce: 0.6 } } } })).not.toThrow();
  });

  it.each([0, -1, "4", Infinity, NaN, null])("rejects idle.period %s", (period) => {
    expect(problemsOf({ version: 2, kinds: { idle: { period } } }).join("\n")).toContain("kinds.idle.period:");
  });

  it("rejects bad spring knobs", () => {
    const live = (release: unknown) => problemsOf({ version: 2, kinds: { live: { release } } });
    expect(live({ visualDuration: 1, bounce: 1 }).join("\n")).toContain("kinds.live.release.bounce:");
    expect(live({ visualDuration: 1, bounce: -0.1 }).join("\n")).toContain("kinds.live.release.bounce:");
    expect(live({ visualDuration: 1 })).toContain("kinds.live.release.bounce: missing");
    expect(live({ visualDuration: 0, bounce: 0.2 }).join("\n")).toContain("kinds.live.release.visualDuration:");
    expect(live(2).join("\n")).toContain("kinds.live.release:");
  });

  it("keeps a kind with no fields valid, and rejects non-object blocks", () => {
    expect(() => resolve({ version: 2, kinds: { choreo: {} } })).not.toThrow();
    expect(problemsOf({ version: 2, kinds: [] })).toContain("kinds: must be an object");
    expect(problemsOf({ version: 2, kinds: { idle: 4 } })).toContain("kinds.idle: must be an object");
  });
});
