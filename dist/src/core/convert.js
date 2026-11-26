const MIN_DAMPING = 0.05;
/**
 * Motion's mapping from (visualDuration, bounce) to a spring.
 * Source: motion-dom src/animation/generators/spring.ts (main @ 790a654).
 * Exact for bounce from 0 to just under 1, which covers motion-kit's 0 to 0.4.
 */
export function toPhysics(visualDuration, bounce) {
    if (bounce < 0)
        throw new RangeError("bounce must be 0 or more, got " + bounce);
    const w0 = (2 * Math.PI) / (1.2 * visualDuration);
    const dampingRatio = Math.max(1 - bounce, MIN_DAMPING);
    const stiffness = w0 * w0;
    return { mass: 1, stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness), dampingRatio, w0 };
}
/** The inverse of toPhysics, for presets written as stiffness and damping (mass 1). */
export function fromPhysics(stiffness, damping) {
    const w0 = Math.sqrt(stiffness);
    if (damping > 2 * w0 + 1e-9) {
        const ratio = damping / (2 * w0);
        throw new RangeError("overdamped spring (damping ratio " + ratio.toFixed(3) + " > 1) is outside motion-kit's range of bounce 0 to 0.4");
    }
    return { visualDuration: (2 * Math.PI) / (1.2 * w0), bounce: Math.max(0, 1 - damping / (2 * w0)) };
}
/** SwiftUI's duration is the undamped period, 2π/w0, so it is 1.2 × Motion's visualDuration. */
export const fromAppleDuration = (duration) => duration / 1.2;
export const toAppleDuration = (visualDuration) => visualDuration * 1.2;
