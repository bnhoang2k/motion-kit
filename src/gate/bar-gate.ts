import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BarJson } from "../core/bar.ts";
import { checkTrace, EVENT_MS, type TraceJson } from "../core/trace.ts";
import type { KindName } from "../core/types.ts";
import { openPage, type Frame, type GatePage } from "./harness.ts";
import { reducedMotion, type RuleContext } from "./kind-gate.ts";
import { emptySelector, missingChannel, noHook, realClockGap, suddenJumps, zeroFrames } from "./self-checks.ts";
import { driveInput } from "./synthetic-input.ts";
import { runChecks, type Check, type Verdict } from "./verdict.ts";

/**
 * Gate A, the bar gate. It plays a copied bar's `index.html?seek` on the fixed clock, with the
 * recorded input of its `trace.json`, and compares the page with the trace: every channel sample
 * within the channel's tolerance, and every event within 1 frame (17 ms). It also runs the checks
 * on the gates themselves (a gate cannot pass on nothing, no sudden jumps, the real clock), the
 * coverage check, and the reduced-motion rule that every page of a kind meets.
 *
 * Each failure line starts with the name of the check that found it.
 */

// The trace.json contract lives in src/core/trace.ts, so validate-bar checks a trace the same way.
export { checkTrace, EVENT_MS, TRACE_FPS, toleranceFor, type TraceChannel, type TraceJson } from "../core/trace.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round = (n: number) => Math.round(n * 1000) / 1000;

function readJson(file: string): { value?: unknown; problem?: string } {
  const name = path.basename(file);
  if (!existsSync(file)) return { problem: `${name}: missing` };
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (e) {
    return { problem: `${name}: not valid JSON: ${(e as Error).message}` };
  }
}

/**
 * Compares every channel with its trace samples. A trace value of null was not measured, so it is
 * not compared and not counted. A page value that is not a finite number (NaN, Infinity) is a miss.
 * Values the page never records are for missingChannel.
 */
async function compareSamples(page: GatePage, trace: TraceJson): Promise<string[]> {
  const frames = await page.framesAt(trace.samples.map((r) => r[0]!));
  const out: string[] = [];
  trace.channels.forEach((c, ci) => {
    let misses = 0;
    let measured = 0;
    let worst = { off: 0, ms: 0 };
    let notFinite: { v: number; ms: number } | undefined;
    frames.forEach((f, j) => {
      const want = trace.samples[j]![ci + 1];
      const v = f.values[c.read];
      if (want === null || want === undefined || v === undefined) return;
      measured++;
      if (!Number.isFinite(v)) {
        misses++;
        notFinite ??= { v, ms: f.ms };
        return;
      }
      const off = Math.abs(v - want);
      if (off > c.tolerance * (1 + 1e-9) + 1e-12) misses++;
      if (off > worst.off) worst = { off, ms: f.ms };
    });
    if (misses === 0) return;
    const head = `trace: ${c.name} misses its trace at ${misses} of ${measured} samples`;
    const tol = `(tolerance ${c.tolerance} ${c.unit})`;
    if (notFinite) out.push(`${head}; the page reads ${String(notFinite.v)}, not a number, at ${round(notFinite.ms)} ms ${tol}`);
    else out.push(`${head}; the worst is ${round(worst.off)} ${c.unit} off at ${round(worst.ms)} ms ${tol}`);
  });
  return out;
}

/** Every trace event must land on the page within EVENT_MS of its trace time. */
async function compareEvents(page: GatePage, trace: TraceJson, spanMs: number): Promise<string[]> {
  const times = Object.values(trace.events);
  await page.seek(Math.max(spanMs, ...times.map((t) => t + EVENT_MS)));
  const { events } = await page.state();
  const out: string[] = [];
  for (const [name, ms] of Object.entries(trace.events)) {
    const got = events[name];
    if (got === undefined) out.push(`events: ${name} is in trace.json at ${round(ms)} ms, but the page never records it`);
    else if (Math.abs(got - ms) > EVENT_MS + 1e-9) {
      const d = got - ms;
      out.push(`events: ${name} lands at ${round(got)} ms, ${round(Math.abs(d))} ms ${d > 0 ? "after" : "before"} its trace time ${round(ms)} ms; an event lands within ${EVENT_MS} ms`);
    }
  }
  return out;
}

/** Every element whose transform, opacity or filter changed must match a channel's selectors or a bar.json `cover` entry. */
async function coverage(page: GatePage, covered: string[]): Promise<string[]> {
  const changed = await page.changedElements();
  const loose = await page.page.evaluate(
    ([all, cover]) =>
      all.filter((sel) => {
        const el = document.querySelector(sel);
        return el !== null && !cover.some((c) => el.matches(c));
      }),
    [changed, covered] as const,
  );
  return loose.map((sel) => `coverage: ${sel} changes its transform, opacity or filter, but no trace channel's selectors and no bar.json cover entry match it`);
}

/**
 * Runs Gate A on the bar folder `dir` (it reads `index.html`, `bar.json` and `trace.json`). A
 * bar.json or trace.json that is missing, does not parse or cannot be played fails at once,
 * without opening the page.
 */
export async function barGate(dir: string): Promise<Verdict> {
  const file = path.join(dir, "index.html");
  const barRead = readJson(path.join(dir, "bar.json"));
  const traceRead = readJson(path.join(dir, "trace.json"));
  const early = [
    ...(existsSync(file) ? [] : ["index.html: missing"]),
    ...[barRead.problem, traceRead.problem].filter((x): x is string => x !== undefined),
  ];
  const bar = isObj(barRead.value) ? (barRead.value as unknown as BarJson) : undefined;
  if (barRead.value !== undefined && !bar) early.push("bar.json: must be an object");
  else if (bar && !(Array.isArray(bar.kinds) && typeof bar.kinds[0] === "string")) early.push("bar.json: lists no kinds; its main kind comes first");
  const checked = traceRead.value === undefined ? undefined : checkTrace(traceRead.value);
  if (checked) early.push(...checked.shape);
  if (early.length > 0 || !bar || !checked?.trace) return { status: "failed", failures: early };

  const trace = checked.trace;
  const input = trace.input.kind === "none" ? null : trace.input;
  const cuts = trace.cuts ?? [];
  const spanMs = trace.samples[trace.samples.length - 1]![0]!;
  const reads = trace.channels.map((c) => c.read);
  const selectors = [...new Set(trace.channels.flatMap((c) => c.selectors))];
  // reducedMotion reads the trace's whole span, not the kind gate's 3 s: a bar's input may start late.
  const ctx: RuleContext = { kind: bar.kinds[0] as KindName, input, cuts, spanMs };

  let opened: Promise<GatePage> | undefined;
  const page = () => (opened ??= openPage(file, input ? { input: input.samples } : {}));
  // One span of seek frames for zeroFrames, missingChannel and coverage; suddenJumps uses the same span.
  let span: Promise<Frame[]> | undefined;
  const spanFrames = async () => (span ??= (await page()).frames(0, spanMs));

  const checks: Record<string, Check> = {
    "trace.json": () => checked.tolerance,
    noHook: async () => noHook(await page()),
    emptySelector: async () => emptySelector(await page(), selectors),
    zeroFrames: async () => zeroFrames(await spanFrames()),
    missingChannel: async () => missingChannel({ channels: reads.map((name) => ({ name })) }, await spanFrames()),
    trace: async () => compareSamples(await page(), trace),
    events: async () => compareEvents(await page(), trace, spanMs),
    suddenJumps: async () => suddenJumps(await page(), reads, cuts, spanMs, input),
    coverage: async () => {
      await spanFrames();
      return coverage(await page(), [...selectors, ...(bar.cover ?? [])]);
    },
    // The live run plays the input as Gate B does: pointer samples as they are, scroll samples as wheel ticks. Setting
    // the scroll position would skip a page that smooths the wheel itself, and its live loop would never run.
    realClockGap: async () => realClockGap(await page(), { spanMs, ...(input ? { input, drive: (live: GatePage) => driveInput(live, input) } : {}) }),
    reducedMotion: async () => reducedMotion.check(await page(), ctx),
  };
  try {
    return await runChecks(checks);
  } finally {
    if (opened) await opened.then((p) => p.close()).catch(() => undefined);
  }
}
