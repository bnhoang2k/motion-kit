export interface SpringPoint {
    /** Offset from the target. */
    x: number;
    /** Velocity, units per second. */
    v: number;
}
/** Offset from the target at time t (seconds), starting at offset e0 with velocity v0. */
export type SpringState = (t: number, e0: number, v0?: number) => SpringPoint;
/** Closed-form damped spring. The same curve Motion runs, so every engine can share it. */
export declare function springState(visualDuration: number, bounce: number): SpringState;
/** Progress from 0 to 1 for a move that starts at rest. */
export declare function springProgress(visualDuration: number, bounce: number): (t: number) => number;
/** After this time the offset stays under 0.5 % of the distance, for any bounce from 0 to 0.4. */
export declare const settleTime: (visualDuration: number) => number;
/** Peak overshoot as a fraction of the distance, for a move that starts at rest. */
export declare function peakOvershoot(visualDuration: number, bounce: number): number;
