import type { Feel } from "../src/core/types.ts";
import { DEFAULTS } from "../src/core/defaults.ts";

/**
 * Lab-only feels. They are never saved. "cool" is a guess at what the word means:
 * fades over travel, no bounce, a little slower than sleek. The Lab plays it as a fade.
 */
export const CANDIDATES: Record<string, Feel> = {
  cool: {
    describe: "Candidate: detached, fades instead of travel, no bounce.",
    stagger: 0.02,
    moves: Object.fromEntries(
      Object.entries(DEFAULTS.feels.sleek!.moves).map(([m, mv]) => [m, { ...mv, bounce: 0, visualDuration: Math.min(1.5, mv.visualDuration * 1.6) }]),
    ) as Feel["moves"],
  },
};
