export const MOVES = ["tap", "enter", "exit", "move", "attention", "celebrate"] as const;
export type MoveName = (typeof MOVES)[number];

/** What a move does when the person asks for reduced motion. */
export type Reduced = "instant" | "fade";

export interface Move {
  /** Seconds until the move looks done (Motion's visualDuration). */
  visualDuration: number;
  /** 0 = no overshoot. Used only when a touch caused the move. Max 0.4. */
  bounce: number;
  /** Optional scale target, for tap and attention. */
  amount?: number;
  reduced: Reduced;
}

export interface Feel {
  describe: string;
  /** Seconds between items that move together. */
  stagger: number;
  moves: Record<MoveName, Move>;
}

export interface MotionConfig {
  version: 1;
  /** Seconds for a reduced-motion fade. */
  reducedFade: number;
  feels: Record<string, Feel>;
  /** Maps a surface (for example "station") to a feel name. */
  use?: Record<string, string>;
}

export type MoveOverride = Partial<Move>;

export interface FeelOverride {
  /** Start from another feel, then apply this override. */
  extends?: string;
  describe?: string;
  stagger?: number;
  moves?: Partial<Record<MoveName, MoveOverride>>;
}

export interface Overrides {
  version?: 1;
  reducedFade?: number;
  feels?: Record<string, FeelOverride>;
  use?: Record<string, string>;
}
