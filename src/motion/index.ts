import { flatTx, staggerOf, tx } from "../core/tx.ts";
import type { MotionConfig, MoveName } from "../core/types.ts";

export interface MotionSpring {
  type: "spring";
  visualDuration: number;
  bounce: number;
}

/** The keys that get the bounce-0 spring: opacity, color and shadow. */
export const FLAT_KEYS = [
  "opacity",
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "caretColor",
  "fill",
  "stroke",
  "boxShadow",
] as const;

export type MotionTransition = MotionSpring & Record<(typeof FLAT_KEYS)[number], MotionSpring>;

/**
 * A Motion `transition` for one move. Pass it to `animate()` or a `motion` component.
 * Transforms get the feel's bounce only when a touch caused the move.
 * Opacity, color and shadow always settle without bounce.
 * In Motion, a per-value transition replaces the root for that value, so overriding `visualDuration` on the root does not reach these keys.
 * Wrap the app in `<MotionConfig reducedMotion="user">`, so Motion drops travel and keeps fades.
 */
export function transition(cfg: MotionConfig, feel: string, move: MoveName, opts: { byTouch: boolean }): MotionTransition {
  const s = tx(cfg, feel, move, opts);
  const flat: MotionSpring = { type: "spring", ...flatTx(cfg, feel, move) };
  const t = { type: "spring", visualDuration: s.visualDuration, bounce: s.bounce } as MotionTransition;
  for (const k of FLAT_KEYS) t[k] = { ...flat };
  return t;
}

/** The fallback when the person asks for reduced motion: jump, or a short linear fade. */
export function reducedTransition(cfg: MotionConfig, feel: string, move: MoveName): { duration: number; ease: "linear" } {
  const { reduced } = tx(cfg, feel, move, { byTouch: false });
  return { duration: reduced === "fade" ? cfg.reducedFade : 0, ease: "linear" };
}

export { staggerOf };
