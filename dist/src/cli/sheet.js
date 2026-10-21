import path from "node:path";
import { timeLabel } from "../gate/sheet.js";
import { chromiumReady, closeHarness, firstLine, playwrightInstall } from "./playwright.js";
export const SHEET_SAMPLES = { default: 8, min: 2, max: 24 };
/** Parses `--samples`: a whole number from 2 to 24. Throws a usage line otherwise. */
export function parseSamples(raw) {
    if (raw === undefined)
        return SHEET_SAMPLES.default;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < SHEET_SAMPLES.min || n > SHEET_SAMPLES.max) {
        throw new Error(`--samples takes a whole number from ${SHEET_SAMPLES.min} to ${SHEET_SAMPLES.max}.`);
    }
    return n;
}
/** The latest `--to`: each seek replays the page from 0, so a far time is slow. */
export const SHEET_MAX_TO_MS = 60_000;
/** Parses `--to`: the last frame's time in ms, above 0 and at most 60 s. Throws a usage line otherwise. */
export function parseTo(raw) {
    if (raw === undefined)
        return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > SHEET_MAX_TO_MS)
        throw new Error(`--to takes the last frame's time in ms, above 0 and at most ${SHEET_MAX_TO_MS}.`);
    return n;
}
/**
 * `sheet <page.html> [--out sheet.png] [--samples 8] [--to ms] [--full]`: draws the page at evenly spaced times, with
 * the input the kind gate plays, as one labelled PNG grid for an agent to look at, cropped to where pixels change
 * unless `--full`. Exit 0 when written, 2 when the page cannot be read, Playwright or its Chromium is missing, or the
 * sheet cannot be drawn.
 */
export async function sheetCommand(file, out, options, io, deps) {
    const target = path.resolve(io.cwd, file);
    if (io.read(target) === undefined) {
        io.err(`Cannot read ${file}.\n`);
        return 2;
    }
    if (!(await chromiumReady(deps.playwrightOrNull))) {
        io.err(`${playwrightInstall("sheet")}\n`);
        return 2;
    }
    let sheet;
    try {
        sheet = await (deps.frameSheet ?? (await import("../gate/sheet.js")).frameSheet)(target, options);
    }
    catch (e) {
        io.err(`motion-kit sheet could not run: ${firstLine(e)}\n`);
        return 2;
    }
    finally {
        if (!deps.frameSheet)
            await closeHarness();
    }
    io.write(path.resolve(io.cwd, out), sheet.png);
    const step = sheet.times.length > 1 ? sheet.times[1] - sheet.times[0] : Infinity;
    const times = sheet.times.map((t) => timeLabel(t, step)).join(", ");
    io.out(`Wrote ${out}: ${sheet.times.length} frames at ${times}, ${sheet.note}, ${sheet.view}.\n`);
    return 0;
}
