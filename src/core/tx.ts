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
export function feelFor(cfg: MotionConfig, feelOrSurface: string): Feel {
  const name = cfg.use && Object.hasOwn(cfg.use, feelOrSurface) ? cfg.use[feelOrSurface]! : feelOrSurface;
  const feel = Object.hasOwn(cfg.feels, name) ? cfg.feels[name] : undefined;
  if (!feel) throw new Error(`unknown feel or surface "${feelOrSurface}"`);
  return feel;
}

/**
 * The numbers for one move. Bounce only answers a touch: with byTouch false, bounce is 0.
 * byTouch has no default on purpose, so every caller decides.
 */
export function tx(cfg: MotionConfig, feel: string, move: MoveName, { byTouch }: { byTouch: boolean }): MoveSpec {
  const m = feelFor(cfg, feel).moves[move];
  return {
    visualDuration: m.visualDuration,
    bounce: byTouch ? m.bounce : 0,
    reduced: m.reduced,
    ...(m.amount !== undefined ? { amount: m.amount } : {}),
  };
}

/** The spring for opacity, color and shadow: this move's visualDuration with bounce 0. Used for the "flat" keys. */
export function flatTx(cfg: MotionConfig, feel: string, move: MoveName): SpringSpec {
  return { visualDuration: feelFor(cfg, feel).moves[move].visualDuration, bounce: 0 };
}

export const staggerOf = (cfg: MotionConfig, feel: string): number => feelFor(cfg, feel).stagger;
