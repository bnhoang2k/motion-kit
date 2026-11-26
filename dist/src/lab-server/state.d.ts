import type { MotionConfig, MoveName, Overrides } from "../core/types.ts";
export type MoveKey = "visualDuration" | "bounce" | "amount" | "reduced";
/** One value the Lab can edit on a feel. */
export type EditPath = readonly ["describe"] | readonly ["stagger"] | readonly ["moves", MoveName, MoveKey];
/**
 * What the Lab is editing: the project's overrides, not a resolved config.
 * A key is here only because it was in motion.json or the person set it. Every other value is inherited,
 * so a feel that extends an edited feel follows it, and Save writes exactly these overrides.
 */
export interface LabState {
    working: Overrides;
    /** Names the file in error messages. */
    readonly source: string;
}
/** Starts editing `saved` (the motion.json contents). Throws MotionConfigError if it does not resolve. */
export declare function createLabState(saved: Overrides, source?: string): LabState;
/** The package defaults plus the working overrides. A fresh object on every call. */
export declare function config(state: LabState): MotionConfig;
/** A copy of the working overrides: what Save sends. */
export declare function overrides(state: LabState): Overrides;
/** Replaces the working overrides with what the server saved. Throws, and keeps the old ones, if they do not resolve. */
export declare function adopt(state: LabState, saved: Overrides): void;
/**
 * Sets one value on one feel. The key goes into that feel's override and nowhere else.
 * When the value equals what the feel would have without the key (the feel it extends, else the package
 * default), the key is removed, so the feel inherits again. `extends`, `use`, `version` and every other key
 * stay as they were. Throws, and changes nothing, for an unknown feel or a value that makes the config invalid.
 */
export declare function edit(state: LabState, feel: string, path: EditPath, value: string | number): void;
