import { type SheetOptions } from "../gate/sheet.ts";
import type { CliIo, GateDeps } from "./run.ts";
export declare const SHEET_SAMPLES: {
    readonly default: 8;
    readonly min: 2;
    readonly max: 24;
};
/** Parses `--samples`: a whole number from 2 to 24. Throws a usage line otherwise. */
export declare function parseSamples(raw: string | undefined): number;
/** The latest `--to`: each seek replays the page from 0, so a far time is slow. */
export declare const SHEET_MAX_TO_MS = 60000;
/** Parses `--to`: the last frame's time in ms, above 0 and at most 60 s. Throws a usage line otherwise. */
export declare function parseTo(raw: string | undefined): number | undefined;
/**
 * `sheet <page.html> [--out sheet.png] [--samples 8] [--to ms] [--full]`: draws the page at evenly spaced times, with
 * the input the kind gate plays, as one labelled PNG grid for an agent to look at, cropped to where pixels change
 * unless `--full`. Exit 0 when written, 2 when the page cannot be read, Playwright or its Chromium is missing, or the
 * sheet cannot be drawn.
 */
export declare function sheetCommand(file: string, out: string, options: SheetOptions, io: CliIo, deps: GateDeps): Promise<number>;
