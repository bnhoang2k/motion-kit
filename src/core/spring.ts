import { toPhysics } from "./convert.ts";

export interface SpringPoint {
  /** Offset from the target. */
  x: number;
  /** Velocity, units per second. */
  v: number;
}

/** Offset from the target at time t (seconds), starting at offset e0 with velocity v0. */
export type SpringState = (t: number, e0: number, v0?: number) => SpringPoint;

/** Closed-form damped spring. The same curve Motion runs, so every engine can share it. */
export function springState(visualDuration: number, bounce: number): SpringState {
  if (bounce < 0) throw new RangeError("bounce must be 0 or more, got " + bounce);
  const { w0, dampingRatio: z } = toPhysics(visualDuration, bounce);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return (t, e0, v0 = 0) => {
      const a = e0;
      const b = (v0 + z * w0 * e0) / wd;
      const k = Math.exp(-z * w0 * t);
      const c = Math.cos(wd * t);
      const s = Math.sin(wd * t);
      return {
        x: k * (a * c + b * s),
        v: k * ((-z * w0 * a + wd * b) * c + (-z * w0 * b - wd * a) * s),
      };
    };
  }
  return (t, e0, v0 = 0) => {
    const b = v0 + w0 * e0;
    const k = Math.exp(-w0 * t);
    return { x: k * (e0 + b * t), v: k * (b - w0 * (e0 + b * t)) };
  };
}

/** Progress from 0 to 1 for a move that starts at rest. */
export function springProgress(visualDuration: number, bounce: number): (t: number) => number {
  const s = springState(visualDuration, bounce);
  return (t) => 1 - s(t, 1).x;
}

/** After this time the offset stays under 0.5 % of the distance, for any bounce from 0 to 0.4. */
export const settleTime = (visualDuration: number): number => 1.8 * visualDuration;

/** Peak overshoot as a fraction of the distance, for a move that starts at rest. */
export function peakOvershoot(visualDuration: number, bounce: number): number {
  const { dampingRatio: z } = toPhysics(visualDuration, bounce);
  if (z >= 1) return 0;
  return Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
}
