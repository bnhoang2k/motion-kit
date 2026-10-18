import { describe, expect, it } from "vitest";
import { spring } from "motion";
import { resolve } from "../src/core/merge.ts";
import { springProgress } from "../src/core/spring.ts";
import { FLAT_KEYS, reducedTransition, staggerOf, transition } from "../src/motion/index.ts";

const cfg = resolve();

describe("motion adapter", () => {
  it("passes duration and bounce for a touch", () => {
    const t = transition(cfg, "whimsical", "move", { byTouch: true });
    expect(t).toMatchObject({ type: "spring", visualDuration: 0.48, bounce: 0.35 });
  });

  it("forces bounce 0 without a touch", () => {
    expect(transition(cfg, "whimsical", "move", { byTouch: false }).bounce).toBe(0);
  });

  it("never bounces opacity or color", () => {
    const t = transition(cfg, "whimsical", "move", { byTouch: true });
    for (const k of FLAT_KEYS) {
      expect(t[k]).toEqual({ type: "spring", visualDuration: 0.48, bounce: 0 });
    }
  });

  it("gives each flat key its own object", () => {
    const t = transition(cfg, "whimsical", "move", { byTouch: true });
    t.opacity.bounce = 0.9;
    expect(t.color.bounce).toBe(0);
  });

  it("gives the reduced-motion fallback", () => {
    expect(reducedTransition(cfg, "calm", "tap")).toEqual({ duration: 0, ease: "linear" });
    expect(reducedTransition(cfg, "calm", "enter")).toEqual({ duration: 0.15, ease: "linear" });
  });

  it("reads stagger", () => expect(staggerOf(cfg, "sleek")).toBe(0.025));

  it("drives Motion's spring along motion-kit's curve", () => {
    const t = transition(cfg, "snappy", "enter", { byTouch: true });
    const gen = spring({ keyframes: [0, 1000], visualDuration: t.visualDuration, bounce: t.bounce });
    const ours = springProgress(t.visualDuration, t.bounce);
    for (let s = 0; s < 0.4; s += 1 / 30) expect(gen.next(s * 1000).value / 1000).toBeCloseTo(ours(s), 3);
  });
});
