export declare const LIMITS: {
    readonly bounce: readonly [0, 0.4];
    readonly visualDuration: readonly [0.05, 1.5];
    readonly stagger: readonly [0, 0.2];
    readonly amount: readonly [0.5, 1.5];
    readonly reducedFade: readonly [0.05, 0.5];
};
/**
 * Returns every problem in a project's overrides (the contents of motion.json). An empty list means the shape is right.
 * It checks keys, object shapes and value types. It does not check ranges or whether a name exists: validate() does that on the merged result.
 */
export declare function validateOverrides(o: unknown): string[];
/** Returns every problem in a resolved config. An empty list means it is valid. */
export declare function validate(cfg: unknown): string[];
