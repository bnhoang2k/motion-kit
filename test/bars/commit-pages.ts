import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FRAME_MS } from "../../src/gate/harness.ts";
import { INPUT_START_MS } from "../../src/gate/synthetic-input.ts";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");

/**
 * The live fixtures where a swipe commits (live.js, VARIANT "commit"): the dot follows the hand to 200 px right of its
 * rest, then runs right on its own, at its own speed, to the viewport's edge, and is gone there. The hand keeps going
 * at 500 px/s and lets go `liftMs` after the dot is gone.
 */
export const HAND_PX_S = 500;
const COMMIT_PX = 200;
const EXIT_PX = 660;
/** Where the stay and vanish faults stop the dot: this far past the commit. */
export const STAY_PX = 120;

/** A copy of the live fixture `base` in its own folder under `dir`, its dot running off at `runPxS` px/s. */
export function commitPage(dir: string, base: string, runPxS: number): string {
  const out = mkdtempSync(path.join(dir, `${base}_${runPxS}_`));
  copyFileSync(path.join(PAGES, "live.js"), path.join(out, "live.js"));
  const file = path.join(out, "index.html");
  writeFileSync(file, readFileSync(path.join(PAGES, `${base}.html`), "utf8").replace("<script>window.FAULT", `<script>window.RUN_PXS = ${runPxS}; window.FAULT`));
  return file;
}

/** The `liftMs` (after the dot is gone) at which the hand lifts `afterCommitMs` after the commit, while the dot, at `runPxS`, still runs. */
export function earlyLift(runPxS: number, afterCommitMs: number, stopPx = EXIT_PX): number {
  return afterCommitMs - ((stopPx - COMMIT_PX) / runPxS) * 1000;
}

/**
 * The hand's samples, one a frame: from the page's start of input to `liftMs` after the dot (running at `runPxS`)
 * reaches `stopPx` right of its rest, where it is gone, or for a fault, stops. A `liftMs` below 0 lifts the hand
 * before that: while the dot still runs.
 */
export function commitInput(runPxS: number, liftMs: number, stopPx = EXIT_PX): [number, number, number][] {
  const commitMs = INPUT_START_MS + (COMMIT_PX / HAND_PX_S) * 1000;
  const goneMs = commitMs + ((stopPx - COMMIT_PX) / runPxS) * 1000;
  const first = Math.round(INPUT_START_MS / FRAME_MS);
  const last = Math.ceil((goneMs + liftMs) / FRAME_MS - 1e-6);
  const samples: [number, number, number][] = [];
  for (let k = first; k <= last; k++) samples.push([k * FRAME_MS, 640 + (HAND_PX_S * (k * FRAME_MS - INPUT_START_MS)) / 1000, 360]);
  return samples;
}
