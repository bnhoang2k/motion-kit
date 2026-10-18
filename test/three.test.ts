import { describe, expect, it } from "vitest";
import { tween, type Scheduler } from "../src/three/index.ts";

function fake(reduced = false) {
  let now = 0;
  let id = 0;
  const frames = new Map<number, (n: number) => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  const fire = () => {
    for (const [i, t] of [...timers]) if (t.at <= now) {
      timers.delete(i);
      t.cb();
    }
  };
  const sched: Scheduler = {
    now: () => now,
    frame: (cb) => (frames.set(++id, cb), id),
    cancelFrame: (i) => void frames.delete(i),
    timeout: (cb, ms) => (timers.set(++id, { at: now + ms, cb }), id),
    clearTimeout: (i) => void timers.delete(i as number),
    reduced: () => reduced,
  };
  return {
    sched,
    tick(ms = 16) {
      now += ms;
      const fs = [...frames.values()];
      frames.clear();
      for (const f of fs) f(now);
      fire();
    },
    /** Run queued frame callbacks with a chosen timestamp, without moving the clock. */
    frameAt(stamp: number) {
      const fs = [...frames.values()];
      frames.clear();
      for (const f of fs) f(stamp);
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
      fire();
    },
  };
}

const springOf = (visualDuration: number, bounce: number) => ({ visualDuration, bounce, reduced: "fade" as const });

describe("three tween", () => {
  it("reaches the target and calls onDone once", () => {
    const f = fake();
    const seen: number[] = [];
    let done = 0;
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0), reducedFade: 0.15, onUpdate: (x) => seen.push(x), onDone: () => done++ }, f.sched);
    for (let i = 0; i < 60; i++) f.tick();
    expect(t.done).toBe(true);
    expect(seen.at(-1)).toBe(100);
    expect(done).toBe(1);
  });

  it("never passes the target when bounce is 0", () => {
    const f = fake();
    const seen: number[] = [];
    tween({ from: 0, to: 100, spring: springOf(0.3, 0), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, f.sched);
    for (let i = 0; i < 60; i++) f.tick();
    expect(Math.max(...seen)).toBeLessThanOrEqual(100);
  });

  it("overshoots when bounce is 0.3", () => {
    const f = fake();
    const seen: number[] = [];
    tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, f.sched);
    for (let i = 0; i < 60; i++) f.tick();
    expect(Math.max(...seen)).toBeGreaterThan(102);
  });

  it("lands with no frames (hidden page)", () => {
    const f = fake();
    let last = Number.NaN;
    let done = 0;
    tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => (last = x), onDone: () => done++ }, f.sched);
    f.advance(2000);
    expect(last).toBe(100);
    expect(done).toBe(1);
  });

  it("retarget keeps position and velocity", () => {
    const f = fake();
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: () => {} }, f.sched);
    for (let i = 0; i < 9; i++) f.tick();
    const x = t.value;
    const v = t.velocity;
    t.retarget(0);
    expect(t.value).toBeCloseTo(x, 9);
    expect(t.velocity).toBeCloseTo(v, 6);
    for (let i = 0; i < 80; i++) f.tick();
    expect(t.value).toBe(0);
  });

  it("restarts from rest when retargeted after it finished", () => {
    const f = fake();
    const t = tween({ from: 0, to: 10, spring: springOf(0.2, 0), reducedFade: 0.15, onUpdate: () => {} }, f.sched);
    for (let i = 0; i < 60; i++) f.tick();
    t.retarget(20);
    expect(t.done).toBe(false);
    expect(t.value).toBeCloseTo(10, 9);
    for (let i = 0; i < 60; i++) f.tick();
    expect(t.value).toBe(20);
  });

  it("jumps under reduced motion, and asks for a fade when the move says fade", () => {
    const f = fake(true);
    let last = Number.NaN;
    let fade = 0;
    tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => (last = x), onReducedFade: (s) => (fade = s) }, f.sched);
    expect(last).toBe(100);
    expect(fade).toBe(0.15);

    let fade2 = 0;
    tween({ from: 0, to: 1, spring: { visualDuration: 0.1, bounce: 0, reduced: "instant" }, reducedFade: 0.15, onUpdate: () => {}, onReducedFade: (s) => (fade2 = s) }, f.sched);
    expect(fade2).toBe(0);
  });

  it("stop() halts without calling onDone", () => {
    const f = fake();
    let done = 0;
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0), reducedFade: 0.15, onUpdate: () => {}, onDone: () => done++ }, f.sched);
    f.tick();
    t.stop();
    f.advance(5000);
    expect(done).toBe(0);
  });

  it("honors reduced motion on every retarget, not just the first move", () => {
    const f = fake(true);
    const seen: number[] = [];
    let fades = 0;
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => seen.push(x), onReducedFade: () => fades++ }, f.sched);
    t.retarget(0);
    expect(seen.at(-1)).toBe(0);
    expect(fades).toBe(2);
    const n = seen.length;
    f.tick();
    expect(seen.length).toBe(n);
    expect(t.done).toBe(true);
  });

  it("stop() freezes value and velocity", () => {
    const f = fake();
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: () => {} }, f.sched);
    f.tick();
    f.tick();
    t.stop();
    const x = t.value;
    f.advance(200);
    expect(t.value).toBe(x);
    expect(t.velocity).toBe(0);
  });

  it("retarget after stop() starts from the held position at rest", () => {
    const f = fake();
    const seen: number[] = [];
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, f.sched);
    f.tick();
    t.stop();
    const held = t.value;
    f.advance(200);
    seen.length = 0;
    t.retarget(held + 10);
    f.tick();
    expect(Math.abs(seen[0]! - held)).toBeLessThan(1);
  });

  it("never steps backwards when a frame stamp predates a retarget", () => {
    const f = fake();
    const seen: number[] = [];
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, f.sched);
    for (let i = 0; i < 5; i++) f.tick();
    const x = t.value;
    t.retarget(0);
    seen.length = 0;
    f.frameAt(f.now() - 4);
    expect(seen[0]).toBeCloseTo(x, 9);
  });

  it("retarget with a bounce-0 spring does not overshoot, and velocity carries", () => {
    const f = fake();
    const seen: number[] = [];
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, f.sched);
    for (let i = 0; i < 6; i++) f.tick();
    const x = t.value;
    const v = t.velocity;
    t.retarget(0, springOf(0.3, 0));
    expect(t.value).toBeCloseTo(x, 9);
    expect(t.velocity).toBeCloseTo(v, 6);
    seen.length = 0;
    for (let i = 0; i < 80; i++) f.tick();
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(t.value).toBe(0);
  });

  it("retarget without a spring keeps the first spring (bounces again)", () => {
    const f = fake();
    const seen: number[] = [];
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, f.sched);
    for (let i = 0; i < 6; i++) f.tick();
    t.retarget(0);
    seen.length = 0;
    for (let i = 0; i < 80; i++) f.tick();
    expect(Math.min(...seen)).toBeLessThan(-2);
  });

  it("retarget reads reduced motion at that moment, not at the start", () => {
    let reduced = false;
    const f = fake();
    const sched = { ...f.sched, reduced: () => reduced };
    const seen: number[] = [];
    const t = tween({ from: 0, to: 100, spring: springOf(0.3, 0.3), reducedFade: 0.15, onUpdate: (x) => seen.push(x) }, sched);
    f.tick();
    reduced = true;
    t.retarget(0, springOf(0.3, 0.3));
    expect(seen.at(-1)).toBe(0);
    expect(t.done).toBe(true);
    const n = seen.length;
    f.tick();
    expect(seen.length).toBe(n);
  });
});
