import { describe, expect, it } from "vitest";
import { spring } from "motion";
import { fitSpring, type Sample } from "../src/core/fit.ts";

interface RecordOpts {
  /** Still frames before the move. */
  idle?: number;
  /** Peak noise, in position units. Applied to every frame, idle ones too. */
  noise?: number;
  from?: number;
  to?: number;
  fps?: number;
  /** Recording length after the start, in multiples of visualDuration. */
  dur?: number;
  /** Fraction of a frame by which the move starts after a frame tick. */
  phase?: number;
  /** Seed for the noise. */
  seed?: number;
}

function record(vd: number, bounce: number, opts: RecordOpts = {}): Sample[] {
  const from = opts.from ?? 40;
  const to = opts.to ?? 340;
  const fps = opts.fps ?? 60;
  const idle = opts.idle ?? 0;
  const gen = spring({ keyframes: [from, to], visualDuration: vd, bounce });
  let seed = opts.seed ?? 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out: Sample[] = [];
  const total = idle + Math.ceil((opts.dur ?? 2) * vd * fps) + 1;
  for (let i = 0; i < total; i++) {
    const moved = i / fps - (idle + (opts.phase ?? 0)) / fps;
    const x = moved <= 0 ? from : gen.next(moved * 1000).value;
    out.push({ t: i / fps, x: x + (opts.noise ?? 0) * rand() });
  }
  return out;
}

const within = (f: { visualDuration: number; bounce: number }, vd: number, b: number): void => {
  expect(Math.abs(f.bounce - b)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(f.visualDuration - vd) / vd).toBeLessThanOrEqual(0.1);
};

describe("fitSpring", () => {
  it.each([
    [0.35, 0.25],
    [0.2, 0],
    [0.5, 0.4],
    [0.15, 0.1],
  ])("recovers visualDuration %s and bounce %s", (vd, b) => {
    const f = fitSpring(record(vd, b));
    expect(f.ok).toBe(true);
    expect(Math.abs(f.bounce - b)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(f.visualDuration - vd) / vd).toBeLessThanOrEqual(0.1);
  });

  it("ignores still frames before the move starts", () => {
    const f = fitSpring(record(0.35, 0.25, { idle: 20 }));
    expect(Math.abs(f.bounce - 0.25)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(f.visualDuration - 0.35) / 0.35).toBeLessThanOrEqual(0.1);
  });

  it("tolerates 1 px of recording noise", () => {
    const f = fitSpring(record(0.35, 0.25, { noise: 1 }));
    expect(Math.abs(f.bounce - 0.25)).toBeLessThanOrEqual(0.05);
  });

  it("works when the element moves left", () => {
    const f = fitSpring(record(0.3, 0.2, { from: 300, to: 20 }));
    expect(Math.abs(f.bounce - 0.2)).toBeLessThanOrEqual(0.05);
  });

  it("flags a motion that is not a spring", () => {
    const steps: Sample[] = [0, 0, 0, 1, 1, 1, 0.2, 0.2, 1, 1].map((x, i) => ({ t: i / 30, x }));
    expect(fitSpring(steps).ok).toBe(false);
  });

  it("throws when nothing moved or there are too few samples", () => {
    expect(() => fitSpring([0, 1, 2, 3].map((t) => ({ t, x: 5 })))).toThrow("fitSpring: the element did not move");
    expect(() => fitSpring([{ t: 0, x: 0 }])).toThrow("fitSpring needs at least 4 samples");
  });

  it.each([
    [60, 0.5],
    [30, 0.5],
    [60, 0.9],
    [30, 0.1],
  ])("recovers a move that starts inside a frame (%s fps, phase %s)", (fps, phase) => {
    const f = fitSpring(record(0.15, 0.1, { fps, phase, idle: 4 }));
    within(f, 0.15, 0.1);
  });

  it("recovers a late start with no idle frames at 30 fps", () => {
    within(fitSpring(record(0.35, 0.25, { fps: 30, phase: 0.5 })), 0.35, 0.25);
  });

  it.each([0.3, 1])("recovers from 20 idle frames with %s px of noise and a sub-frame start", (noise) => {
    const f = fitSpring(record(0.35, 0.25, { idle: 20, noise, phase: 0.5 }));
    within(f, 0.35, 0.25);
  });

  it("recovers at 120 fps over 3 s in under 250 ms", () => {
    const s = record(1.5, 0.3, { fps: 120, idle: 10, noise: 0.5, phase: 0.4 });
    const t0 = performance.now();
    const f = fitSpring(s);
    const ms = performance.now() - t0;
    within(f, 1.5, 0.3);
    expect(ms).toBeLessThan(250);
  });

  it("does not report ok for a recording that stops before the element is at rest", () => {
    const f = fitSpring(record(0.5, 0.4, { dur: 1 }));
    expect(f.ok).toBe(false);
  });

  it("does not hang on a sample that is not a finite number", { timeout: 2000 }, () => {
    const good = record(0.35, 0.25);
    expect(() => fitSpring(good.map((s, i) => (i === 5 ? { t: s.t, x: Number.NaN } : s)))).toThrow("finite");
    expect(() => fitSpring(good.map((s, i) => (i === 5 ? { t: Number.NaN, x: s.x } : s)))).toThrow("finite");
    expect(() => fitSpring(good.map((s, i) => (i === 9 ? { t: s.t, x: Number.POSITIVE_INFINITY } : s)))).toThrow("finite");
  });

  it("throws when time does not strictly increase", () => {
    const good = record(0.35, 0.25);
    const swapped = good.slice();
    [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];
    expect(() => fitSpring(swapped)).toThrow("strictly increase");
    expect(() => fitSpring(good.map((s, i) => (i === 6 ? { t: good[5]!.t, x: s.x } : s)))).toThrow("strictly increase");
  });

  it.each([
    ["30 fps, vd 0.104, bounce 0.15", 30, 0.104, 0.15],
    ["30 fps, vd 0.06, bounce 0.35", 30, 0.06, 0.35],
    ["60 fps, vd 0.06, bounce 0.15", 60, 0.06, 0.15],
  ])("never reports a wrong fit as ok for a clean short spring (%s)", (_label, fps, vd, b) => {
    const f = fitSpring(record(vd, b, { fps, idle: 5 }));
    if (f.ok) within(f, vd, b);
    else expect(f.reason).toBe("too-few-frames");
  });

  it("recovers a clean 30 fps spring that lasts a few frames", () => {
    within(fitSpring(record(0.104, 0.15, { fps: 30, idle: 5 })), 0.104, 0.15);
  });

  it("is never ok:true outside the bar on clean recordings, at any start phase", () => {
    for (const fps of [30, 60]) {
      for (const vd of [0.05, 0.07, 0.09, 0.12, 0.2]) {
        for (const b of [0, 0.15, 0.3, 0.4]) {
          for (const phase of [0, 0.5]) {
            const f = fitSpring(record(vd, b, { fps, idle: 5, phase }));
            if (f.ok) within(f, vd, b);
          }
        }
      }
    }
  });

  it.each([4, -4, 8, -8])("is not fooled by a %s px glitch on the last sample", (glitch) => {
    const s = record(0.15, 0.1, { fps: 30, idle: 0 });
    s[s.length - 1] = { t: s[s.length - 1]!.t, x: s[s.length - 1]!.x + glitch };
    const f = fitSpring(s);
    if (f.ok) within(f, 0.15, 0.1);
  });

  it("recovers a spring whose last sample is a 4 px glitch at 60 fps with idle frames", () => {
    const s = record(0.35, 0.25, { fps: 60, idle: 5, noise: 0.3 });
    s[s.length - 1] = { t: s[s.length - 1]!.t, x: s[s.length - 1]!.x - 4 };
    const f = fitSpring(s);
    expect(f.ok).toBe(true);
    within(f, 0.35, 0.25);
  });

  it("is never ok:true outside the bar for noisy 2-frame springs with no idle frames", () => {
    for (const noise of [0.5, 1]) {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        for (const b of [0, 0.1, 0.2, 0.3]) {
          const f = fitSpring(record(0.06, b, { fps: 30, idle: 0, noise, phase }));
          if (f.ok) within(f, 0.06, b);
        }
      }
    }
  });

  it.each([
    ["the first moving frame", 1],
    ["1 visualDuration into the move", 9],
  ])("is not fooled by a 12 px glitch on %s (30 fps)", (_label, frame) => {
    const s = record(0.3, 0, { fps: 30, idle: 5, phase: 0.3 });
    const i = 5 + frame;
    s[i] = { t: s[i]!.t, x: s[i]!.x + 12 };
    const f = fitSpring(s);
    if (f.ok) within(f, 0.3, 0);
  });

  it.each([
    [0.04, 0.15, 0],
    [0.04, 0.2, 0],
    [0.04, 0.3, 0.25],
  ])("does not trust a clean spring that lasts under 2 frames (vd %s, bounce %s, phase %s)", (vd, b, phase) => {
    // Without the frame limit, each of these fits a different spring with ok:true.
    const f = fitSpring(record(vd, b, { fps: 30, idle: 5, phase }));
    if (f.ok) within(f, vd, b);
    else expect(f.reason).toBe("too-few-frames");
  });

  it.each([
    // fps, vd, bounce, idle, phase, sample, glitch (px). Each fooled an earlier fit into ok:true outside the bar.
    [60, 0.1, 0, 0, 0.7, 1, 8],
    [60, 0.075, 0.2, 5, 0, 7, 20],
    [120, 0.07, 0.1, 0, 0, 1, -12],
    [60, 0.06, 0.1, 0, 0, 2, 4],
  ])("is not fooled by a glitch near the start of a short spring (%s fps, vd %s, bounce %s, idle %s, phase %s, sample %s, %s px)", (fps, vd, b, idle, phase, i, glitch) => {
    const s = record(vd, b, { fps, idle, phase });
    s[i] = { t: s[i]!.t, x: s[i]!.x + glitch };
    const f = fitSpring(s);
    if (f.ok) within(f, vd, b);
    else expect(f.reason).toBeDefined();
  });

  it("does not trust a short spring whose last two samples are both glitched", () => {
    // 4 frames per visualDuration. The robust fit alone bends to the pair: ok:true with bounce 0.111.
    const s = record(0.12, 0, { fps: 30, idle: 5, phase: 0.5 });
    for (const i of [s.length - 1, s.length - 2]) s[i] = { t: s[i]!.t, x: s[i]!.x - 8 };
    const f = fitSpring(s);
    if (f.ok) within(f, 0.12, 0);
    else expect(f.reason).toBe("poor-fit");
  });

  it("does not trust a noisy move of under 4 frames whose residuals show the noise", () => {
    // 2 px noise, 4 frames per visualDuration. Without the stricter frame limit for noisy recordings this is ok:true
    // with bounce 0.054.
    const f = fitSpring(record(0.12, 0, { fps: 30, idle: 5, noise: 2, seed: 17 }));
    if (f.ok) within(f, 0.12, 0);
    else expect(f.reason).toBe("too-few-frames");
  });

  it("skips a glitched frame in the tail when it checks that the element came to rest", () => {
    // 20 px is 7 % of the move, past the 3 % settled band: without the skip this reads as cut-short.
    const s = record(0.35, 0.25, { fps: 60, idle: 5 });
    const i = s.length - 2;
    s[i] = { t: s[i]!.t, x: s[i]!.x + 20 };
    const f = fitSpring(s);
    expect(f.ok).toBe(true);
    within(f, 0.35, 0.25);
  });

  describe("reason", () => {
    it("is absent when ok", () => {
      const f = fitSpring(record(0.35, 0.25));
      expect(f.ok).toBe(true);
      expect(f.reason).toBeUndefined();
    });

    it("is poor-fit for a motion that is not a spring", () => {
      const steps: Sample[] = [0, 0, 0, 1, 1, 1, 0.2, 0.2, 1, 1].map((x, i) => ({ t: i / 30, x }));
      expect(fitSpring(steps)).toMatchObject({ ok: false, reason: "poor-fit" });
    });

    it("is cut-short for a recording that stops before rest", () => {
      expect(fitSpring(record(0.5, 0.4, { dur: 1 }))).toMatchObject({ ok: false, reason: "cut-short" });
    });

    it("is too-few-frames for a move of about one or two frames", () => {
      expect(fitSpring(record(0.05, 0.3, { fps: 30, idle: 5 }))).toMatchObject({ ok: false, reason: "too-few-frames" });
    });
  });
});
