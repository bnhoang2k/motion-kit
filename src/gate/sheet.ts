import path from "node:path";
import { openPage, type InputSamples } from "./harness.ts";
import { pageInput } from "./kind-gate.ts";
import { DIFF_PIXELS } from "./pixel-diff.ts";
import { inputSpan } from "./synthetic-input.ts";

/**
 * The frame sheet: one PNG grid of a page drawn at evenly spaced times, so an agent can look at its own motion.
 * It seeks the page on the fixed clock with the input the kind gate plays, screenshots each time, lays the shots
 * out as an HTML grid with a label under each, and screenshots that grid. No image library is needed.
 */

export const SHEET_COLUMNS = 4;
/** Each cell's width in px; the height keeps the page's viewport ratio. */
export const CELL_PX = 360;
const PAD_PX = 16;
const GAP_PX = 12;
/** The tallest sheet: an agent's image read shrinks anything larger. */
export const SHEET_MAX_PX = 2000;
/** Room for the header (two lines) and for each caption line, in px. */
const HEADER_PX = 56;
const CAPTION_PX = 24;

export type SheetCell = { ms: number; note: string; src: string; dot: [number, number] | null };
/** `note` says what input played; `view` says whether the shots are cropped, and to what. */
export type FrameSheet = { png: Uint8Array; times: number[]; note: string; view: string };

/** `samples` times from 0 to `spanMs`, evenly spaced, both ends included. */
export function sheetTimes(spanMs: number, samples: number): number[] {
  return Array.from({ length: samples }, (_, i) => (spanMs * i) / (samples - 1));
}

/** The last input sample at or before `ms`, or null before the input starts. */
function sampleAt(input: InputSamples, ms: number): number[] | null {
  let last: number[] | null = null;
  for (const s of input.samples as number[][]) if (s[0]! <= ms + 1e-6) last = s;
  return last;
}

/** What the input is doing at `ms`, for the cell's label: empty with no input or before it starts. */
export function inputNote(input: InputSamples | null, ms: number): string {
  if (!input) return "";
  const s = sampleAt(input, ms);
  if (!s) return "";
  if (input.kind === "scroll") return `scrollY ${Math.round(s[1]!)}`;
  if (ms > inputSpan(input).end + 1e-6) return "released";
  return `pointer ${s[3] === 0 ? "up" : "down"} ${Math.round(s[1]!)}, ${Math.round(s[2]!)}`;
}

/** Where the pointer is held at `ms`, or null when no pointer is down. */
export function pointerDown(input: InputSamples | null, ms: number): [number, number] | null {
  if (!input || input.kind !== "pointer" || ms > inputSpan(input).end + 1e-6) return null;
  const s = sampleAt(input, ms);
  return s && s[3] !== 0 ? [s[1]!, s[2]!] : null;
}

/** A frame's time: seconds to 2 places, or ms to 1 place when frames are under 50 ms apart, so no two labels match. */
export function timeLabel(ms: number, stepMs: number): string {
  return stepMs < 50 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A rectangle in CSS px. */
export type Box = { x: number; y: number; w: number; h: number };

/** Space kept around the changing pixels, and the smallest crop, in CSS px. */
const CROP_PAD = 24;
const CROP_MIN: readonly [number, number] = [160, 120];
/** A crop that keeps more than this share of the page shows the whole page instead. */
const CROP_MAX_SHARE = 0.6;

/**
 * The crop for the sheet: the box where pixels change, padded, grown to CROP_MIN around its center and kept inside the
 * viewport. Null (the whole page) when nothing changed or the crop would keep most of the page.
 */
export function cropBox(changed: Box | null, [vw, vh]: [number, number]): Box | null {
  if (!changed) return null;
  let w = Math.max(changed.w + 2 * CROP_PAD, CROP_MIN[0]);
  let h = Math.max(changed.h + 2 * CROP_PAD, CROP_MIN[1]);
  w = Math.min(w, vw);
  h = Math.min(h, vh);
  if (w * h > CROP_MAX_SHARE * vw * vh) return null;
  const x = Math.min(Math.max(changed.x + changed.w / 2 - w / 2, 0), vw - w);
  const y = Math.min(Math.max(changed.y + changed.h / 2 - h / 2, 0), vh - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** `box` grown to hold every point; null stays null, since a pointer alone is no motion. */
export function withPoints(box: Box | null, points: [number, number][]): Box | null {
  if (!box) return null;
  const xs = [box.x, box.x + box.w, ...points.map((p) => p[0])];
  const ys = [box.y, box.y + box.h, ...points.map((p) => p[1])];
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The sheet's width in px for `columns` cells. */
export const sheetWidth = (columns: number) => 2 * PAD_PX + columns * CELL_PX + (columns - 1) * GAP_PX;

/**
 * The grid page: a title line, then one cell per time with its shot, a ring where the pointer is held, and its label.
 * Each shot shows `crop` (CSS px), or the whole viewport when it is null, at most CELL_PX by CELL_PX.
 */
export function sheetHtml({ title, subtitle, cells, viewport = [1280, 720], crop = null }: { title: string; subtitle: string; cells: SheetCell[]; viewport?: [number, number]; crop?: Box | null }): string {
  const view = crop ?? { x: 0, y: 0, w: viewport[0], h: viewport[1] };
  // Cells shrink with more rows, so the sheet stays under SHEET_MAX_PX tall.
  const rows = Math.max(1, Math.ceil(cells.length / SHEET_COLUMNS));
  const fitH = Math.floor((SHEET_MAX_PX - 2 * PAD_PX - HEADER_PX - rows * CAPTION_PX - (rows - 1) * GAP_PX) / rows);
  const scale = Math.min(CELL_PX / view.w, Math.min(CELL_PX, fitH) / view.h);
  const stepMs = cells.length > 1 ? cells[1]!.ms - cells[0]!.ms : Infinity;
  const [cellW, cellH] = [Math.round(view.w * scale), Math.round(view.h * scale)];
  const img = `width:${(viewport[0] * scale).toFixed(1)}px;height:${(viewport[1] * scale).toFixed(1)}px;left:${(-view.x * scale).toFixed(1)}px;top:${(-view.y * scale).toFixed(1)}px`;
  const cell = (c: SheetCell) => {
    const dot = c.dot ? `<i class="dot" style="left:${((c.dot[0] - view.x) * scale).toFixed(1)}px;top:${((c.dot[1] - view.y) * scale).toFixed(1)}px"></i>` : "";
    return `<figure><div class="shot"><img src="${c.src}" style="${img}">${dot}</div><figcaption><b>${timeLabel(c.ms, stepMs)}</b>${c.note ? ` ${escape(c.note)}` : ""}</figcaption></figure>`;
  };
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{background:#111;color:#eee;font:13px/1.4 ui-monospace,Menlo,monospace;padding:${PAD_PX}px;width:${sheetWidth(SHEET_COLUMNS)}px}
header{margin-bottom:${GAP_PX}px;overflow-wrap:anywhere}header span{color:#999}
main{display:grid;grid-template-columns:repeat(${SHEET_COLUMNS},${CELL_PX}px);gap:${GAP_PX}px}
.shot{position:relative;width:${cellW}px;height:${cellH}px;overflow:hidden;outline:1px solid #333}
.shot img{position:absolute;display:block;max-width:none}
.dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;background:#ff3b30;box-shadow:0 0 0 1px #000}
figcaption{padding-top:4px;color:#bbb}figcaption b{color:#fff;font-weight:600}
</style><header><b>${escape(title)}</b> <span>${escape(subtitle)}</span></header><main>${cells.map(cell).join("")}</main>`;
}

/** Device pixels per CSS px in the shots, so a small crop is still sharp when it is scaled up. */
const PIXEL_RATIO = 2;

/**
 * Runs in the grid page: the box (device px) of every pixel that differs between the first shot and any other, or
 * between two shots in a row, by more than a little (so antialiasing noise does not count). Null when none does.
 */
const DIFF_BOX = String.raw`async (srcs) => {
  const pairs = [];
  for (let k = 1; k < srcs.length; k++) pairs.push([srcs[0], srcs[k]], [srcs[k - 1], srcs[k]]);
  const T = 24;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const differ = (a, b, o) => Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > T;
  await (${DIFF_PIXELS})(pairs, differ, (k, x, y) => {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  });
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}`;

export type SheetOptions = { samples: number; toMs?: number; full?: boolean };

/**
 * Draws `file` at `samples` evenly spaced times, with the input the kind gate plays, from 0 to `toMs` (default: the
 * span the kind gate reads). Unless `full`, every shot is cropped to where pixels change across the frames.
 */
export async function frameSheet(file: string, { samples, toMs, full = false }: SheetOptions): Promise<FrameSheet> {
  const { input, spanMs } = await pageInput(file);
  const endMs = toMs ?? spanMs;
  const times = sheetTimes(endMs, samples);
  const note = input ? `${input.kind} input from ${Math.round(inputSpan(input).start)} to ${Math.round(inputSpan(input).end)} ms` : "no input";
  const page = await openPage(file, { ...(input ? { input: input.samples } : {}), pixelRatio: PIXEL_RATIO });
  try {
    await page.page.evaluate(() => document.fonts.ready.then(() => undefined));
    const vp = page.page.viewportSize() ?? { width: 1280, height: 720 };
    const viewport: [number, number] = [vp.width, vp.height];
    const cells: SheetCell[] = [];
    for (const ms of times) {
      await page.seek(ms);
      const shot = await page.page.screenshot({ type: "png" });
      cells.push({ ms, note: inputNote(input, ms), src: `data:image/png;base64,${shot.toString("base64")}`, dot: pointerDown(input, ms) });
    }
    const grid = await page.page.context().newPage();
    const changed = (await grid.evaluate(`(${DIFF_BOX})(${JSON.stringify(cells.map((c) => c.src))})`)) as Box | null;
    const changedCss = changed && { x: changed.x / PIXEL_RATIO, y: changed.y / PIXEL_RATIO, w: changed.w / PIXEL_RATIO, h: changed.h / PIXEL_RATIO };
    // The crop keeps every held pointer in view, so no ring is cut off.
    const crop = full ? null : cropBox(withPoints(changedCss, cells.flatMap((c) => (c.dot ? [c.dot] : []))), viewport);
    const view = !changed ? "no pixel changes between frames" : crop ? `cropped to ${crop.w}x${crop.h} px at ${crop.x}, ${crop.y}, where pixels change` : "whole page";
    await grid.setViewportSize({ width: sheetWidth(SHEET_COLUMNS), height: 200 });
    const subtitle = `${samples} frames, 0 to ${(endMs / 1000).toFixed(2)} s, ${note}, ${view}`;
    const title = `${path.basename(path.dirname(file))}/${path.basename(file)}`;
    await grid.setContent(sheetHtml({ title, subtitle, cells, viewport, crop }), { waitUntil: "load" });
    // The grid itself at 1x: the sheet stays under the size an agent's image read takes.
    const png = await grid.screenshot({ type: "png", fullPage: true, scale: "css" });
    return { png, times, note, view };
  } finally {
    await page.close();
  }
}
