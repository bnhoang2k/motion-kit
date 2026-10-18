export interface Physics {
    mass: 1;
    stiffness: number;
    damping: number;
    dampingRatio: number;
    /** Undamped angular frequency, rad/s. */
    w0: number;
}
/**
 * Motion's mapping from (visualDuration, bounce) to a spring.
 * Source: motion-dom src/animation/generators/spring.ts (main @ 790a654).
 * Exact for bounce from 0 to just under 1, which covers motion-kit's 0 to 0.4.
 */
export declare function toPhysics(visualDuration: number, bounce: number): Physics;
/** The inverse of toPhysics, for presets written as stiffness and damping (mass 1). */
export declare function fromPhysics(stiffness: number, damping: number): {
    visualDuration: number;
    bounce: number;
};
/** SwiftUI's duration is the undamped period, 2π/w0, so it is 1.2 × Motion's visualDuration. */
export declare const fromAppleDuration: (duration: number) => number;
export declare const toAppleDuration: (visualDuration: number) => number;
