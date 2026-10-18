import { FRAME_MS, type Frame, type GatePage, type InputSamples } from "../../src/gate/harness.ts";
import { rangeOf, reopen, round, series, spanOf, stillEps, valueNames, type KindRule, type RuleContext } from "../../src/gate/kind-gate.ts";
import { JUMP_FACTOR } from "../../src/gate/self-checks.ts";
import { inputSpan } from "../../src/gate/synthetic-input.ts";

/**
 * The live rules (kinds/live/rules.md): it follows the input, a release starts from the hand's
 * speed, and a regrab mid-settle picks up with no jump. Each rule judges the input's first press:
 * down at the first pointer sample, a move at each sample, up after the last sample before the first
 * one with down 0. Every rule runs on the fixed clock.
 */

/** A value follows when it moves in at least this share of the drag's frames. */
const FOLLOW_SHARE = 0.8;
/** Right after the release, a value keeps at least this share of its speed in the drag's last frame. */
const RELEASE_SHARE = 0.5;
/** The release speed is read over this long, in ms, from the release. */
const RELEASE_PROBE_MS = 1;
/**
 * The hand holds still in the drag's last frame when it moves a value less than this share of the
 * value's largest frame step during the drag. A held hand has no speed to keep, so the value is
 * not judged: a spring may pull back from rest speed.
 */
const HELD_SHARE = 0.05;
/** The regrab presses this many frames after the release (83 ms), while the page is still settling. */
const REGRAB_AFTER_FRAMES = 5;
/** ...and holds still for this many frames (300 ms). */
const REGRAB_HOLD_FRAMES = 18;
// A regrab jumps when one frame moves more than JUMP_FACTOR times the largest frame step just before it.
/** ...and more than this share of the value's whole range. */
const JUMP_SHARE = 0.01;

type Pointer = Extract<InputSamples, { kind: "pointer" }>;

/**
 * The first press of the input: the samples before the first one with down 0. The live rules judge
 * this press only, so a recorded input with a second press (a bar's trace.json) is judged the same
 * way as a one-press input.
 */
function pointer(ctx: RuleContext): Pointer {
  if (ctx.input?.kind !== "pointer") throw new Error("the live rules need pointer input");
  const lift = ctx.input.samples.findIndex((s) => s[3] === 0);
  return lift < 0 ? ctx.input : { kind: "pointer", samples: ctx.input.samples.slice(0, lift) };
}

const follows: KindRule = {
  name: "follows",
  async check(page, ctx) {
    const { start, end } = inputSpan(pointer(ctx));
    const frames = await page.frames(0, spanOf(ctx));
    const steps: number[] = [];
    for (let i = 0; i + 1 < frames.length; i++) if (frames[i]!.ms >= start - 1e-6 && frames[i + 1]!.ms <= end + 1e-6) steps.push(i);
    let best = { name: "", share: 0 };
    for (const n of valueNames(frames)) {
      const v = series(frames, n);
      const eps = stillEps(rangeOf(v));
      const share = steps.length === 0 ? 0 : steps.filter((i) => Math.abs(v[i + 1]! - v[i]!) > eps).length / steps.length;
      if (share > best.share) best = { name: n, share };
    }
    if (best.share >= FOLLOW_SHARE) return [];
    if (best.share === 0) return [`follows: no value moves while the pointer drags from ${round(start)} to ${round(end)} ms`];
    return [`follows: the value that follows best, ${best.name}, moves in only ${Math.round(best.share * 100)}% of the drag's frames; a live page follows the input in ${FOLLOW_SHARE * 100}% or more`];
  },
};

const releaseSpeed: KindRule = {
  name: "releaseSpeed",
  async check(page, ctx) {
    const { start, end } = inputSpan(pointer(ctx));
    const at = async (ms: number) => {
      await page.seek(ms);
      return (await page.state()).values;
    };
    const frames = await page.frames(0, spanOf(ctx));
    const before = await at(end - FRAME_MS);
    const atRelease = await at(end);
    // A page may see the release in the frame after the last sample, so both frames are probed.
    const probes: [Record<string, number>, Record<string, number>][] = [];
    for (const b of [end, end + FRAME_MS]) probes.push([await at(b), await at(b + RELEASE_PROBE_MS)]);
    let best: { name: string; share: number } | null = null;
    const inDrag = frames.filter((f) => f.ms >= start - 1e-6 && f.ms <= end + 1e-6);
    for (const n of valueNames(frames)) {
      const d = (atRelease[n] ?? Number.NaN) - (before[n] ?? Number.NaN);
      if (!(Math.abs(d) > stillEps(rangeOf(series(frames, n))))) continue;
      // A step with a cut in it may jump by design, so it does not set the hand's pace.
      const v = series(inDrag, n);
      const cutIn = (i: number) => ctx.cuts.some((c) => c > inDrag[i]!.ms + 1e-6 && c <= inDrag[i + 1]!.ms + 1e-6);
      const peak = Math.max(0, ...v.slice(1).map((x, i) => (cutIn(i) ? 0 : Math.abs(x - v[i]!))).filter(Number.isFinite));
      if (Math.abs(d) < HELD_SHARE * peak) continue;
      const perMs = d / FRAME_MS;
      const share = Math.max(...probes.map(([a, b]) => ((b[n] ?? Number.NaN) - (a[n] ?? Number.NaN)) / RELEASE_PROBE_MS / perMs));
      if (best === null || share > best.share) best = { name: n, share };
    }
    // No value moved in the drag's last frame (that is the follows rule's failure), or the hand held still there.
    if (best === null || best.share >= RELEASE_SHARE) return [];
    return [`releaseSpeed: at release, ${best.name} leaves at ${Math.round(best.share * 100)}% of its speed in the drag's last frame; a release starts from the hand's speed (${RELEASE_SHARE * 100}% or more)`];
  },
};

/** A value tracks a pointer axis when it moves with it this closely during the drag (|r|). */
const TRACK_R = 0.9;
/** A press grabs the page when, while the pointer holds still, a tracked value covers at most this share of its way to rest. */
const HOLD_SHARE = 0.25;

type Track = { axis: 1 | 2; name: string; slope: number };

/**
 * For each pointer axis, the value that moves with it during the drag, and how many value units
 * it moves per px. Each value goes to the one axis it follows best, so one value never aims both.
 */
function tracks(frames: Frame[], input: Pointer): Track[] {
  const { start, end } = inputSpan(input);
  const inDrag = frames.filter((f) => f.ms >= start - 1e-6 && f.ms <= end + 1e-6);
  const pointerAt = (ms: number) => [...input.samples].reverse().find((q) => q[0] <= ms + 1e-6) ?? input.samples[0]!;
  const best = new Map<1 | 2, Track & { r: number }>();
  for (const n of valueNames(frames)) {
    const v = inDrag.map((f) => f.values[n] ?? Number.NaN);
    const fits = ([1, 2] as const).map((axis) => ({ axis, fit: linearFit(inDrag.map((f) => pointerAt(f.ms)[axis]), v) }));
    const top = fits.reduce((a, b) => (Math.abs(b.fit?.r ?? 0) > Math.abs(a.fit?.r ?? 0) ? b : a));
    if (!top.fit || Math.abs(top.fit.r) < TRACK_R || top.fit.slope === 0) continue;
    const held = best.get(top.axis);
    if (!held || Math.abs(top.fit.r) > Math.abs(held.r)) best.set(top.axis, { axis: top.axis, name: n, slope: top.fit.slope, r: top.fit.r });
  }
  return [...best.values()].map(({ axis, name, slope }) => ({ axis, name, slope }));
}

function linearFit(x: number[], y: number[]): { slope: number; r: number } | null {
  const n = x.length;
  if (n < 3 || y.some((v) => !Number.isFinite(v))) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return { slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
}

type Sample = [number, number, number] | [number, number, number, 0 | 1];

/**
 * A regrab mid-settle picks up with no jump. It runs on the fixed clock: one `?seek` input holds
 * the drag, the release (a sample with `down` 0 just after the last drag sample), and a press held
 * still from 5 frames after the release. The press lands where the handle is: the point where the
 * drag grabbed it, moved by how far each tracked value has gone since, through the drag's
 * px-per-unit slope; an axis no value follows keeps the grab point. A page may test the hit
 * against where it last drew the handle or where it draws it next, so the press first aims at the
 * handle one frame before the press, then at the handle at the press, and the first one that grabs
 * is judged. The press must grab: while it holds still, a tracked value that was still on its way
 * to rest covers at most 25% of that way (a tracked value already at rest is not judged; when all
 * are, the rule fails, because there is nothing to test). And no value may jump. The rest and each
 * value's range come from a run of the first press alone: a second press would move the rest. With
 * no value that tracks the pointer, the press cannot be aimed, and the rule fails.
 */
const regrab: KindRule = {
  name: "regrab",
  async check(page, ctx) {
    const input = pointer(ctx);
    const alone = input.samples.length === ctx.input!.samples.length ? page : await reopen(page, { input: input.samples });
    try {
      return await regrabFrom(alone, page, input, ctx);
    } finally {
      if (alone !== page) await alone.close();
    }
  },
};

/** The regrab rule on `alone`, a run of the first press only. Each regrab run reopens `page` with its own input. */
async function regrabFrom(alone: GatePage, page: GatePage, input: Pointer, ctx: RuleContext): Promise<string[]> {
  const frames = await alone.frames(0, spanOf(ctx));
  const followed = tracks(frames, input);
  if (followed.length === 0) return ["regrab: cannot aim a regrab: no value tracks the pointer"];
  const { start, end } = inputSpan(input);
  const pressMs = end + REGRAB_AFTER_FRAMES * FRAME_MS;
  const holdEnd = pressMs + REGRAB_HOLD_FRAMES * FRAME_MS;
  const valuesAt = async (ms: number) => {
    await alone.seek(ms);
    return (await alone.state()).values;
  };
  const grabbed = await valuesAt(start);
  const first = input.samples[0]!;
  const last = input.samples[input.samples.length - 1]!;
  const rest = frames[frames.length - 1]!.values;
  const index = (fs: Frame[], ms: number) => fs.reduce((k, f, i) => (f.ms <= ms + 1e-6 ? i : k), 0);
  let verdict: string[] | null = null;
  for (const aimMs of [pressMs - FRAME_MS, pressMs]) {
    const handle = await valuesAt(aimMs);
    const aim: [number, number] = [first[1], first[2]];
    for (const t of followed) aim[t.axis - 1] = first[t.axis] + ((handle[t.name] ?? 0) - (grabbed[t.name] ?? 0)) / t.slope;
    const [x, y] = aim;
    const samples: Sample[] = [...input.samples, [end + 1, last[1], last[2], 0]];
    for (let k = 0; k <= REGRAB_HOLD_FRAMES; k++) samples.push([pressMs + k * FRAME_MS, x, y, 1]);
    const run = await reopen(page, { input: samples });
    let rf: Frame[];
    try {
      rf = await run.frames(0, spanOf(ctx));
    } finally {
      await run.close();
    }
    const where = `the press at (${Math.round(x)}, ${Math.round(y)}), ${Math.round(pressMs - end)} ms after the release`;
    const jumps: string[] = [];
    const missed: string[] = [];
    const resting: string[] = [];
    const iPress = index(rf, pressMs);
    for (const n of valueNames(rf)) {
      const v = series(rf, n);
      const range = Math.max(rangeOf(v), rangeOf(series(frames, n)));
      let before = 0;
      let around = 0;
      for (let k = 1; k < rf.length; k++) {
        const move = Math.abs(v[k]! - v[k - 1]!);
        if (!Number.isFinite(move)) continue;
        if (k > iPress - 6 && k < iPress) before = Math.max(before, move);
        else if (k >= iPress && k <= iPress + 4) around = Math.max(around, move);
      }
      if (around > JUMP_FACTOR * before + JUMP_SHARE * range) {
        jumps.push(`regrab: ${n} jumps ${round(around)} in one frame on ${where} (it moved at most ${round(before)} per frame just before)`);
      } else if (followed.some((t) => t.name === n)) {
        const pressed = v[iPress - 1]!;
        const toRest = Math.abs((rest[n] ?? Number.NaN) - pressed);
        const moved = Math.abs(v[index(rf, holdEnd - 2 * FRAME_MS)]! - pressed);
        if (!(toRest > JUMP_SHARE * range)) resting.push(n);
        else if (moved > HOLD_SHARE * toRest) missed.push(`regrab: ${where} grabs nothing: ${n} moves ${round(moved)} of its ${round(toRest)} to rest while the pointer holds still`);
      }
    }
    // A tracked value already at rest says nothing about the press; only when every one rests is there nothing to test.
    if (resting.length === followed.length) return [`regrab: ${resting.join(" and ")} ${resting.length > 1 ? "are" : "is"} at rest ${Math.round(pressMs - end)} ms after the release, so a regrab mid-settle cannot be checked`];
    if (missed.length === 0) return jumps;
    verdict ??= [...missed, ...jumps];
  }
  return verdict ?? [];
}

export const rules: KindRule[] = [follows, releaseSpeed, regrab];
