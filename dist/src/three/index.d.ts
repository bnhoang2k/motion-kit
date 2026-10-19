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
export declare function browserScheduler(): Scheduler;
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
/**
 * Runs motion-kit's spring on one number in a render loop.
 * A timer lands the end value even when the page is hidden and no frames run.
 */
export declare function tween(opts: TweenOptions, sched?: Scheduler): Tween;
