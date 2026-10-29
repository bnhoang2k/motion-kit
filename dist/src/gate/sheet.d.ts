import { type InputSamples } from "./harness.ts";
/**
 * The frame sheet: one PNG grid of a page drawn at evenly spaced times, so an agent can look at its own motion.
 * It seeks the page on the fixed clock with the input the kind gate plays, screenshots each time, lays the shots
 * out as an HTML grid with a label under each, and screenshots that grid. No image library is needed.
 */
export declare const SHEET_COLUMNS = 4;
/** Each cell's width in px; the height keeps the page's viewport ratio. */
export declare const CELL_PX = 360;
/** The tallest sheet: an agent's image read shrinks anything larger. */
export declare const SHEET_MAX_PX = 2000;
export type SheetCell = {
    ms: number;
    note: string;
    src: string;
    dot: [number, number] | null;
};
/** `note` says what input played; `view` says whether the shots are cropped, and to what. */
export type FrameSheet = {
    png: Uint8Array;
    times: number[];
    note: string;
    view: string;
};
/** `samples` times from 0 to `spanMs`, evenly spaced, both ends included. */
export declare function sheetTimes(spanMs: number, samples: number): number[];
/** What the input is doing at `ms`, for the cell's label: empty with no input or before it starts. */
export declare function inputNote(input: InputSamples | null, ms: number): string;
/** Where the pointer is held at `ms`, or null when no pointer is down. */
export declare function pointerDown(input: InputSamples | null, ms: number): [number, number] | null;
/** A frame's time: seconds to 2 places, or ms to 1 place when frames are under 50 ms apart, so no two labels match. */
export declare function timeLabel(ms: number, stepMs: number): string;
/** A rectangle in CSS px. */
export type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * The crop for the sheet: the box where pixels change, padded, grown to CROP_MIN around its center and kept inside the
 * viewport. Null (the whole page) when nothing changed or the crop would keep most of the page.
 */
export declare function cropBox(changed: Box | null, [vw, vh]: [number, number]): Box | null;
/** `box` grown to hold every point; null stays null, since a pointer alone is no motion. */
export declare function withPoints(box: Box | null, points: [number, number][]): Box | null;
/** The sheet's width in px for `columns` cells. */
export declare const sheetWidth: (columns: number) => number;
/**
 * The grid page: a title line, then one cell per time with its shot, a ring where the pointer is held, and its label.
 * Each shot shows `crop` (CSS px), or the whole viewport when it is null, at most CELL_PX by CELL_PX.
 */
export declare function sheetHtml({ title, subtitle, cells, viewport, crop }: {
    title: string;
    subtitle: string;
    cells: SheetCell[];
    viewport?: [number, number];
    crop?: Box | null;
}): string;
export type SheetOptions = {
    samples: number;
    toMs?: number;
    full?: boolean;
};
/**
 * Draws `file` at `samples` evenly spaced times, with the input the kind gate plays, from 0 to `toMs` (default: the
 * span the kind gate reads). Unless `full`, every shot is cropped to where pixels change across the frames.
 */
export declare function frameSheet(file: string, { samples, toMs, full }: SheetOptions): Promise<FrameSheet>;
