import type { MoveName } from "../../src/core/types.ts";
import type { SpringSpec } from "../../src/core/tx.ts";

export interface MomentContext {
  /** Transform spring. Bounce is already 0 unless a touch caused the move. */
  spring: SpringSpec;
  /** Opacity and color spring. Bounce is always 0. */
  flat: SpringSpec;
  amount: number;
  stagger: number;
  /** false, or the move's reduced-motion fallback. */
  reduced: false | "instant" | "fade";
  reducedFade: number;
  /** Lab-only candidate feels: the Move moment fades out, jumps and fades back instead of traveling. */
  fadeTravel: boolean;
}

export interface Moment {
  move: MoveName;
  label: string;
  mount(stage: HTMLElement): { play(ctx: MomentContext): void };
}
