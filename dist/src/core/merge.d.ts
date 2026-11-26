import type { MotionConfig } from "./types.ts";
export declare class MotionConfigError extends Error {
    readonly problems: string[];
    constructor(problems: string[], source: string);
}
/**
 * Package defaults plus a project's overrides. Project values win.
 * Takes `unknown` because the overrides usually come from JSON.parse. Throws MotionConfigError, with every problem,
 * if the overrides have the wrong shape or the merged result is invalid.
 */
export declare function resolve(input?: unknown, source?: string): MotionConfig;
