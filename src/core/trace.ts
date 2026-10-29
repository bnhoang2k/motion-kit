/**
 * The trace.json contract: what a bar's recorded trace holds, and the check that says whether the
 * bar gate can play it. Pure: no browser, no file system. validate-bar and the bar gate both use it.
 */

/**
 * Recorded input, as trace.json holds it in `input: { kind, samples }`. One sample per 1/60 s,
 * each starting with its time in ms from the start of the input.
 * - `pointer`: `[ms, x, y]` or `[ms, x, y, down]` in page pixels. At a time t the pointer sits at
 *   the latest sample at or before t. It is down there unless that sample's `down` is 0, and it is
 *   up after the last sample. With no `down` flags, the samples are one press: down at the first
 *   sample, a move at each sample, up after the last. A 0 flag lifts the pointer until a later
 *   sample presses again.
 * - `scroll`: `[ms, scrollY]` in page pixels, the window's scroll position at that time.
 * A bar's trace.json input may carry the `down` flag too, so a recorded input can hold two presses.
 * `openPage({ input: samples })` hands the samples to the page as `window.__input`.
 */
export type InputSamples =
  | { kind: "pointer"; samples: ([ms: number, x: number, y: number] | [ms: number, x: number, y: number, down: 0 | 1])[] }
  | { kind: "scroll"; samples: [ms: number, scrollY: number][] };

/**
 * The smallest tolerance a trace channel may have, by unit. A channel with one of these units
 * cannot be checked more tightly than this. The bar gate reads the same table.
 */
export const TOLERANCE_FLOORS: Readonly<Record<string, number>> = { px: 0.5, deg: 0.5, ratio: 0.01, opacity: 0.01, scale: 0.002, s: 0.017 };

/** One traced value. `read` is the key of `__state().values` that holds it on the page. */
export interface TraceChannel {
  name: string;
  /** One of the units in TOLERANCE_FLOORS. */
  unit: string;
  read: string;
  /** The elements this value moves. Coverage counts them as traced. */
  selectors: string[];
  /** max(2 * rebuildError, the unit's floor). */
  tolerance: number;
  /** The page's own error against the trace on this channel. */
  rebuildError: number;
}

/** A bar's trace.json: the bar's reference motion as numbers, never frames. */
export interface TraceJson {
  /** Always 60. */
  fps: number;
  /** The input that drives the motion, one sample per frame; pointer samples may carry the down flag. An idle bar has kind "none" and no samples. */
  input: InputSamples | { kind: "none"; samples: [] };
  /** 2 to 5 channels. */
  channels: TraceChannel[];
  /**
   * Rows at 1/60 s frame times: `[ms, ...values]`, the values in channel order. Rows may skip
   * frames (a held frame, or time outside the traced windows). A value is
   * `null` where the trace has no value for that channel; the gate does not compare it.
   */
  samples: (number | null)[][];
  /** Named times in ms. */
  events: Record<string, number>;
  /** Times in ms where a value may jump. */
  cuts?: number[];
  /**
   * Names of page values (a channel's `read` key, or any other value the page reports, such as a boil frame) that
   * hold drawings on purpose: cel on twos or threes, stop-motion, a sprite. The gates judge their pops at the drawing
   * rate and read them elsewhere as their pose line (gate/poses.ts). The kind gate's `stepped` rule checks that the
   * page reports each one.
   */
  stepped?: string[];
  /**
   * Names of page values that act out a control's meaning with a keyframe tween beside the bodies (a tile that bobs or
   * shakes as it is tapped). The sim gate's `energyFalls` leaves them out, since a CSS ease segment ends at zero
   * speed and the next starts at 0.4 of its mean speed, which reads as a bounce that rises. The kind gate's `tweens`
   * rule checks that each is a value the page reports, that it changes, and that after every cause it ends where it
   * was just before and holds there.
   */
  tweens?: string[];
  /**
   * Page values that are an edge of many moving parts, such as the box around 24 cards on one canvas: `{ [value]: { edge,
   * parts } }`, `edge` one of top, bottom, left, right, width and height, and `parts` the names of 2 or more objects in
   * `__state().objects`. Such a value turns when another part becomes the extreme one, not because a body passes its rest,
   * so the kind gate's envelope leaves out its pulse attack and its `overshoot` rule leaves it out. The kind gate's
   * `extents` rule checks that in every frame the value is that edge of the union of the drawn parts' boxes, and that the
   * parts are a group.
   */
  extents?: Record<string, { edge: string; parts: string[] }>;
}

/** The edges of a union of boxes a value in `extents` may be. */
const EXTENT_EDGES = ["top", "bottom", "left", "right", "width", "height"];

/** An event lands within 1 frame of its trace time. */
export const EVENT_MS = 17;
/** A trace holds 2 to 5 channels. */
const CHANNELS = [2, 5] as const;
/** The gate seeks in 1/60 s frames, so the trace holds one sample per 1/60 s. */
export const TRACE_FPS = 60;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const round = (n: number) => Math.round(n * 1000) / 1000;
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** A sample time sits on the 1/60 s frame grid: k * 1000 / 60 for a whole k, within a relative 1e-9. */
function onFrameGrid(ms: number): boolean {
  const k = Math.round((ms * TRACE_FPS) / 1000);
  const grid = (k * 1000) / TRACE_FPS;
  return Math.abs(ms - grid) <= 1e-9 * Math.max(1, Math.abs(grid));
}

/** The tolerance a channel must have: 2 times the rebuild's error, and never below its unit's floor. */
export function toleranceFor(unit: string, rebuildError: number): number {
  return Math.max(2 * rebuildError, TOLERANCE_FLOORS[unit] ?? 0);
}

/**
 * Checks a parsed trace.json. `shape` lists what makes the trace unusable, so the gate cannot
 * play it. `tolerance` lists each channel whose tolerance is not max(2 * rebuildError, floor).
 */
export function checkTrace(value: unknown): { trace: TraceJson | undefined; shape: string[]; tolerance: string[] } {
  const shape: string[] = [];
  const tolerance: string[] = [];
  const p = (msg: string) => shape.push(`trace.json: ${msg}`);
  if (!isObj(value)) return { trace: undefined, shape: ["trace.json: must be an object"], tolerance };
  if (value.fps !== TRACE_FPS) p(`fps must be ${TRACE_FPS}, got ${JSON.stringify(value.fps)}; the gate seeks in 1/60 s frames and events land within ${EVENT_MS} ms`);

  const input = value.input;
  if (!isObj(input) || !Array.isArray(input.samples)) p("input must be { kind, samples }");
  else {
    const width = input.kind === "pointer" ? 3 : input.kind === "scroll" ? 2 : input.kind === "none" ? 0 : -1;
    // A pointer sample may carry a 4th number, down: 0 lifts the pointer, so one input can hold two presses.
    const pointerSample = (s: unknown[]) => s.every(isNum) && (s.length === 3 || (s.length === 4 && (s[3] === 0 || s[3] === 1)));
    if (width < 0) p(`input kind ${JSON.stringify(input.kind)} is not pointer, scroll or none`);
    else if (width === 0 && input.samples.length > 0) p("input of kind none holds no samples");
    else if (input.kind === "pointer") {
      if (!input.samples.every((s) => Array.isArray(s) && pointerSample(s))) p("each pointer input sample must be [ms, x, y] or [ms, x, y, down] with down 0 or 1");
    } else if (!input.samples.every((s) => Array.isArray(s) && s.length === width && s.every(isNum))) p(`each ${String(input.kind)} input sample must be ${width} numbers`);
  }

  const channels = Array.isArray(value.channels) ? value.channels : undefined;
  if (!channels || channels.length < CHANNELS[0] || channels.length > CHANNELS[1]) p(`channels must hold ${CHANNELS[0]} to ${CHANNELS[1]} channels, got ${channels?.length ?? 0}`);
  const names = new Set<string>();
  (channels ?? []).forEach((c: unknown, i) => {
    const where = `channels[${i}]`;
    if (!isObj(c)) return void p(`${where} must be an object`);
    const before = shape.length;
    if (!isText(c.name)) p(`${where}.name must be a non-empty string`);
    else if (names.has(c.name)) p(`${where}.name ${c.name} is used twice`);
    else names.add(c.name);
    if (!isText(c.unit) || !Object.hasOwn(TOLERANCE_FLOORS, c.unit)) p(`${where}.unit must be one of ${Object.keys(TOLERANCE_FLOORS).join(", ")}`);
    if (!isText(c.read)) p(`${where}.read must name a key of __state().values`);
    if (!Array.isArray(c.selectors) || !c.selectors.every(isText)) p(`${where}.selectors must be a list of selectors`);
    if (!(isNum(c.tolerance) && c.tolerance > 0)) p(`${where}.tolerance must be a number above 0`);
    if (!(isNum(c.rebuildError) && c.rebuildError >= 0)) p(`${where}.rebuildError must be a number, 0 or above`);
    if (shape.length > before) return;
    const want = toleranceFor(c.unit as string, c.rebuildError as number);
    if (!same(c.tolerance as number, want)) {
      tolerance.push(`trace.json: ${String(c.name)} tolerance ${String(c.tolerance)}, but max(2 x rebuildError ${String(c.rebuildError)}, ${String(c.unit)} floor ${TOLERANCE_FLOORS[c.unit as string]}) is ${round(want)}`);
    }
  });

  const samples = Array.isArray(value.samples) ? value.samples : undefined;
  if (!samples || samples.length === 0) p("samples must hold 1 or more rows");
  else {
    const width = 1 + (channels?.length ?? 0);
    const bad = samples.findIndex((r: unknown) => !Array.isArray(r) || r.length !== width || !isNum(r[0]) || !r.slice(1).every((v) => v === null || isNum(v)));
    if (bad >= 0) p(`samples[${bad}] must be [ms, ...one value per channel]: ${width} entries, each value a number or null (not measured)`);
    else if (samples.some((r, i) => i > 0 && !((r as number[])[0]! > (samples[i - 1] as number[])[0]!))) p("samples must run forward in time");
    else {
      // Each row sits on the 1/60 s grid. A rounded time (16.667) seeks off the frame, and near a cut it reads the other side.
      const off = samples.findIndex((r) => !onFrameGrid((r as number[])[0]!));
      if (off >= 0) p(`samples[${off}] ms ${String((samples[off] as number[])[0])} is not on the 1/60 s grid (k * 1000 / 60); store the time at full precision, for example 1000 / 60 = 16.666666666666668, not a rounded value`);
      (channels ?? []).forEach((c: unknown, ci) => {
        if (samples.every((r) => (r as unknown[])[ci + 1] === null)) p(`channels[${ci}] ${isObj(c) ? String(c.name) : ""} has no measured sample; every value is null`);
      });
    }
  }

  if (!isObj(value.events) || !Object.values(value.events).every(isNum)) p("events must map each name to a time in ms");
  if (value.cuts !== undefined && !(Array.isArray(value.cuts) && value.cuts.every(isNum))) p("cuts must be a list of times in ms");
  if (value.stepped !== undefined) {
    if (!(Array.isArray(value.stepped) && value.stepped.every((n) => typeof n === "string" && n !== ""))) p("stepped must be a list of value names");
    else if (new Set(value.stepped).size !== value.stepped.length) p("stepped names a value twice");
  }
  if (value.tweens !== undefined) {
    if (!(Array.isArray(value.tweens) && value.tweens.every((n) => typeof n === "string" && n !== ""))) p("tweens must be a list of value names");
    else if (new Set(value.tweens).size !== value.tweens.length) p("tweens names a value twice");
  }
  if (value.extents !== undefined) {
    if (!isObj(value.extents)) p("extents must map each value name to { edge, parts }");
    else
      for (const [name, e] of Object.entries(value.extents)) {
        if (!isObj(e)) p(`extents.${name} must be { edge, parts }`);
        else {
          if (typeof e.edge !== "string" || !EXTENT_EDGES.includes(e.edge)) p(`extents.${name}.edge must be one of ${EXTENT_EDGES.join(", ")}`);
          if (!(Array.isArray(e.parts) && e.parts.every(isText) && new Set(e.parts).size >= 2 && new Set(e.parts).size === e.parts.length)) p(`extents.${name}.parts must list 2 or more distinct object names`);
        }
      }
  }
  return { trace: shape.length === 0 ? (value as unknown as TraceJson) : undefined, shape, tolerance };
}

