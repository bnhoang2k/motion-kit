import { describe, expect, it } from "vitest";
import { spring } from "motion";
import { fromAppleDuration, fromPhysics, toAppleDuration, toPhysics } from "../src/core/convert.ts";
import { peakOvershoot, settleTime, springProgress, springState } from "../src/core/spring.ts";

describe("convert", () => {
  it("matches Apple's Spring(duration: 0.5, bounce: 0.3) example", () => {
    const p = toPhysics(fromAppleDuration(0.5), 0.3);
    expect(p.stiffness).toBeCloseTo(157.91, 1);
    expect(p.damping).toBeCloseTo(17.59, 1);
  });

  it("matches Apple's Spring(mass: 1, stiffness: 100, damping: 10) example", () => {
    const s = fromPhysics(100, 10);
    expect(toAppleDuration(s.visualDuration)).toBeCloseTo(0.628, 3);
    expect(s.bounce).toBeCloseTo(0.5, 6);
  });

  it("rejects an overdamped preset", () => {
    expect(() => fromPhysics(100, 25)).toThrow(RangeError);
    expect(() => fromPhysics(100, 25)).toThrow("overdamped spring (damping ratio 1.250 > 1)");
  });

  it("treats a critically damped preset as bounce 0", () => {
    expect(fromPhysics(100, 20).bounce).toBe(0);
  });

  it("round-trips duration and bounce", () => {
    const p = toPhysics(0.35, 0.25);
    const s = fromPhysics(p.stiffness, p.damping);
    expect(s.visualDuration).toBeCloseTo(0.35, 9);
    expect(s.bounce).toBeCloseTo(0.25, 9);
  });
});

describe("spring", () => {
  it("matches Motion's own spring generator", () => {
    for (const [vd, b] of [[0.3, 0], [0.3, 0.25], [0.5, 0.4], [0.12, 0.15]] as const) {
      const gen = spring({ keyframes: [0, 1000], visualDuration: vd, bounce: b });
      const ours = springProgress(vd, b);
      for (let t = 0; t <= settleTime(vd); t += 1 / 60) {
        expect(gen.next(t * 1000).value / 1000).toBeCloseTo(ours(t), 3);
      }
    }
  });

  it("rejects a negative bounce", () => {
    expect(() => springState(0.3, -0.1)).toThrow(RangeError);
    expect(() => toPhysics(0.3, -0.1)).toThrow(RangeError);
  });

  it("reports velocity as the derivative of position", () => {
    const s = springState(0.3, 0.3);
    const h = 1e-6;
    for (const t of [0, 0.05, 0.1, 0.2]) {
      const numeric = (s(t + h, 1, 2).x - s(t - h, 1, 2).x) / (2 * h);
      expect(s(t, 1, 2).v).toBeCloseTo(numeric, 4);
    }
  });

  it("settles within 0.5% of the distance by settleTime for bounce 0 to 0.4", () => {
    for (const b of [0, 0.15, 0.3, 0.4]) {
      expect(Math.abs(1 - springProgress(0.3, b)(settleTime(0.3)))).toBeLessThan(0.005);
    }
  });

  it("predicts peak overshoot", () => {
    expect(peakOvershoot(0.3, 0)).toBe(0);
    expect(peakOvershoot(0.3, 0.15)).toBeCloseTo(0.0063, 3);
    expect(peakOvershoot(0.3, 0.4)).toBeCloseTo(0.095, 2);
    const f = springProgress(0.3, 0.3);
    let peak = 0;
    for (let t = 0; t < 1; t += 0.0005) peak = Math.max(peak, f(t) - 1);
    expect(peak).toBeCloseTo(peakOvershoot(0.3, 0.3), 3);
  });
});
