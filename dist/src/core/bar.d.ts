import { TOLERANCE_FLOORS } from "./trace.ts";
export { TOLERANCE_FLOORS };
/** One dial in bar.json: a single MOTION path and its raw page value. */
export interface BarDial {
    path: string;
    value: number;
    unit: string;
    /** "<kind>.<name>", an entry of kinds/<kind>/dial-set.json. A public knob (a key of KNOB_FIELDS) also needs its dials.json entry. */
    knob: string;
    /** The notes.md row the value belongs to. */
    row: string;
}
/** How the page draws one asset slot, so a copy can swap the asset. */
export interface AssetSlot {
    draw: string;
    aspect: string;
    view: string;
    facing: string;
    background: "cutout" | "full-bleed";
}
/** The public contract of a bar folder. */
export interface BarJson {
    slug: string;
    title: string;
    /** Main kind first. */
    kinds: string[];
    /** Names from bars/moments.json. */
    moments: string[];
    /** 1 quiet, 2 expressive, 3 immersive, 4 playable; or [lo, hi] for a page that spans two. */
    rung: number | [number, number];
    fits: string;
    wrongFor: string;
    /** 1 to 3 sentences on what the motion does in time. */
    feel: string;
    dials: BarDial[];
    assetContract: Record<string, AssetSlot>;
    /** The fixed-clock hook the page exposes. */
    clock: string;
    /** The trace.json channels, in order, with the tolerance of each. */
    trace: {
        name: string;
        tolerance: number;
    }[];
    /** The page's own planted faults, as find-and-replace pairs on index.html. */
    faults: {
        name: string;
        find: string;
        replace: string;
    }[];
    /** The slug of the bar that replaced this one. */
    superseded?: string;
    /** Selectors of moving elements that no trace channel reads. */
    cover?: string[];
}
/** Every home path in `text`, as "<file>:<line>: absolute path: "<match>"". */
export declare function absolutePathProblems(file: string, text: string): string[];
/**
 * When `text[i]` opens a string, a template or a comment, the index of its last character; else `i`.
 * Template literals end at the next backtick: a `${...}` inside one is not followed.
 */
export declare function skipStringOrComment(text: string, i: number): number;
/** Where the object literal after `const MOTION =` sits in the page: `start` at its `{`, `end` just past its `}`. Skips braces inside strings and comments. */
export declare function motionRange(html: string): {
    start: number;
    end: number;
} | undefined;
/** Evaluates a MOTION object literal's source in an empty context. Throws when it does not evaluate. */
export declare function evaluateMotion(src: string): unknown;
/** The value at a dotted key path, or undefined when a step is missing. */
export declare function valueAtPath(obj: unknown, keyPath: string): unknown;
/**
 * The file errors in a bar folder: each missing bar file, and bar.json or trace.json that is not
 * valid JSON. validateBar lists these too; the CLI uses them to tell a file error from a contract problem.
 */
export declare function barFileErrors(dir: string, read: (p: string) => string | undefined): string[];
/**
 * Checks a bar folder against the bar.json contract and returns every problem (empty when it passes).
 * `dir` and every path given to `read` are repo-relative (for example `bars/x/bar.json` or
 * `kinds/idle/dials.json`); `read` returns undefined for a missing file. It reads the four bar files and the kit
 * files (bars/moments.json, kinds/<kind>/dial-set.json, kinds/<kind>/dials.json), and nothing else. `readKit` reads the kit files when they
 * live apart from the bar folder (the CLI reads them from the kit's own folder); it defaults to `read`.
 */
export declare function validateBar(dir: string, read: (p: string) => string | undefined, readKit?: (p: string) => string | undefined): string[];
