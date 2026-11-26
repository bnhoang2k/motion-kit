export declare const MOVES: readonly ["tap", "enter", "exit", "move", "attention", "celebrate"];
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
/** The kinds of motion that have knobs. One-shot moves are not a kind: they keep `feels`. */
export type KindName = "live" | "idle" | "scroll" | "choreo" | "sim";
/** The shape a knob value takes: one of the four curve shapes, or "number", a plain value in its unit (a period, a time constant, a time-step cap). */
export type KnobShape = "spring" | "tween" | "follow" | "loop" | "number";
export interface SpringKnob {
    /** Seconds until the spring looks done. */
    visualDuration: number;
    /** 0 up to, not including, 1. */
    bounce: number;
}
/** Knob values by kind, then by field. Overrides only: a file names the knobs it changes. */
export type KindsBlock = Partial<Record<KindName, Record<string, number | SpringKnob>>>;
export interface MotionConfig {
    version: 1 | 2;
    /** Seconds for a reduced-motion fade. */
    reducedFade: number;
    feels: Record<string, Feel>;
    /** Maps a surface (for example "sidebar") to a feel name. */
    use?: Record<string, string>;
    /** Only with version 2. Holds overrides, not base values. */
    kinds?: KindsBlock;
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
    version?: 1 | 2;
    reducedFade?: number;
    feels?: Record<string, FeelOverride>;
    use?: Record<string, string>;
    kinds?: KindsBlock;
}
