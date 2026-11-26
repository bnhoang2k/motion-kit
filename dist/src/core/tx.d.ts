import type { Feel, MotionConfig, MoveName, Reduced } from "./types.ts";
export interface SpringSpec {
    visualDuration: number;
    bounce: number;
}
export interface MoveSpec extends SpringSpec {
    reduced: Reduced;
    amount?: number;
}
/** Finds a feel by its name, or by a surface name listed in `use`. */
export declare function feelFor(cfg: MotionConfig, feelOrSurface: string): Feel;
/**
 * The numbers for one move. Bounce only answers a touch: with byTouch false, bounce is 0.
 * byTouch has no default on purpose, so every caller decides.
 */
export declare function tx(cfg: MotionConfig, feel: string, move: MoveName, { byTouch }: {
    byTouch: boolean;
}): MoveSpec;
/** The spring for opacity, color and shadow: this move's visualDuration with bounce 0. Used for the "flat" keys. */
export declare function flatTx(cfg: MotionConfig, feel: string, move: MoveName): SpringSpec;
export declare const staggerOf: (cfg: MotionConfig, feel: string) => number;
