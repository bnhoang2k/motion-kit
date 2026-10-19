import { type Verdict } from "./verdict.ts";
/**
 * Gate A, the bar gate. It plays a copied bar's `index.html?seek` on the fixed clock, with the
 * recorded input of its `trace.json`, and compares the page with the trace: every channel sample
 * within the channel's tolerance, and every event within 1 frame (17 ms). It also runs the checks
 * on the gates themselves (a gate cannot pass on nothing, no sudden jumps, the real clock), the
 * coverage check, and the reduced-motion rule that every page of a kind meets.
 *
 * Each failure line starts with the name of the check that found it.
 */
export { checkTrace, EVENT_MS, TRACE_FPS, toleranceFor, type TraceChannel, type TraceJson } from "../core/trace.ts";
/**
 * Runs Gate A on the bar folder `dir` (it reads `index.html`, `bar.json` and `trace.json`). A
 * bar.json or trace.json that is missing, does not parse or cannot be played fails at once,
 * without opening the page.
 */
export declare function barGate(dir: string): Promise<Verdict>;
