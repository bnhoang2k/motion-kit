import { settleTime, springState } from "../core/spring.ts";
import type { MoveSpec, SpringSpec } from "../core/tx.ts";

export interface Scheduler {
  /** Milliseconds. */
  now(): number;
  frame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  timeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  reduced(): boolean;
}

export function browserScheduler(): Scheduler {
  return {
    now: () => performance.now(),
    frame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    timeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    reduced: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export interface TweenOptions {
  from: number;
  to: number;
  /** From tx(). Its bounce is already 0 unless a touch caused the move. */
  spring: MoveSpec;
  /** cfg.reducedFade, in seconds. */
  reducedFade: number;
  onUpdate(x: number): void;
  onDone?(): void;
  /** Called under reduced motion when the move's fallback is a fade. Fade the object yourself. */
  onReducedFade?(seconds: number): void;
  /** Starting velocity, units per second. */
  velocity?: number;
}

export interface Tween {
  readonly value: number;
  readonly velocity: number;
  readonly done: boolean;
  /**
   * Changes the target mid-flight. Position and velocity carry over.
   * Pass `spring` to switch to a different spring, for example when a touch gives way to a server event.
   * Without it the spring the tween started with stays. A MoveSpec also replaces the reduced-motion fallback.
   * Carried velocity can overshoot a bounce-0 spring by up to about 4 % on a late retarget to the same target.
   */
  retarget(to: number, spring?: SpringSpec | MoveSpec): void;
  /** Stops without landing and without onDone. */
  stop(): void;
}

/** Landing timer slack, so the timer usually does not beat the last frame. */
const LAND_SLACK_MS = 50;

/**
 * Runs motion-kit's spring on one number in a render loop.
 * A timer lands the end value even when the page is hidden and no frames run.
 */
export function tween(opts: TweenOptions, sched: Scheduler = browserScheduler()): Tween {
  let f = springState(opts.spring.visualDuration, opts.spring.bounce);
  let settleMs = settleTime(opts.spring.visualDuration) * 1000;
  let reducedMode = opts.spring.reduced;
  let target = opts.to;
  let e0 = opts.from - opts.to;
  let v0 = opts.velocity ?? 0;
  let t0 = sched.now();
  let done = false;
  let stopped = false;
  let raf: number | undefined;
  let timer: unknown;
  /** Position frozen by stop(). Set only while stopped. */
  let held: number | undefined;

  /** Elapsed time is clamped at 0: a frame stamp can predate a retarget made earlier in the same frame. */
  const at = (now: number) => f(Math.max(0, (now - t0) / 1000), e0, v0);
  const cancel = () => {
    if (raf !== undefined) sched.cancelFrame(raf);
    raf = undefined;
    sched.clearTimeout(timer);
  };
  const finish = () => {
    if (done || stopped) return;
    done = true;
    cancel();
    opts.onUpdate(target);
    opts.onDone?.();
  };
  const step = (now: number) => {
    raf = undefined;
    if (done || stopped) return;
    if (now - t0 >= settleMs) return finish();
    opts.onUpdate(target + at(now).x);
    raf = sched.frame(step);
  };
  const start = () => {
    sched.clearTimeout(timer);
    timer = sched.timeout(finish, settleMs + LAND_SLACK_MS);
    if (raf === undefined) raf = sched.frame(step);
  };

  /** Reduced motion: jump to `to`, and ask for a fade when the move says fade. */
  const land = (to: number) => {
    target = to;
    held = undefined;
    done = false;
    stopped = false;
    if (reducedMode === "fade") opts.onReducedFade?.(opts.reducedFade);
    finish();
  };

  const handle: Tween = {
    get value() {
      if (done) return target;
      if (stopped) return held ?? target;
      return target + at(sched.now()).x;
    },
    get velocity() {
      return done || stopped ? 0 : at(sched.now()).v;
    },
    get done() {
      return done;
    },
    retarget(to, spring) {
      const now = sched.now();
      const s = done || stopped ? { x: 0, v: 0 } : at(now);
      const x = stopped && !done ? (held ?? target) : target + s.x;
      if (spring) {
        if ("reduced" in spring) reducedMode = spring.reduced;
        f = springState(spring.visualDuration, spring.bounce);
        settleMs = settleTime(spring.visualDuration) * 1000;
      }
      if (sched.reduced()) return land(to);
      held = undefined;
      target = to;
      e0 = x - to;
      v0 = s.v;
      t0 = now;
      done = false;
      stopped = false;
      start();
    },
    stop() {
      if (stopped) return;
      if (!done) held = target + at(sched.now()).x;
      stopped = true;
      cancel();
    },
  };

  if (sched.reduced()) {
    land(target);
    return handle;
  }
  start();
  return handle;
}
