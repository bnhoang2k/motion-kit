import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, openPage } from "../../src/gate/harness.ts";
import { kindGate, pageInput } from "../../src/gate/kind-gate.ts";
import { syntheticInput } from "../../src/gate/synthetic-input.ts";
import { rules as liveRules } from "../../kinds/live/gate.ts";
import { atRest, kindRulesOn } from "./beat-pages.ts";
import { commitInput, commitPage, earlyLift, STAY_PX } from "./commit-pages.ts";
import { flingPage, scrollKickPage } from "./creep-pages.ts";
import { driftPage, driftRulesOn, type Drift } from "./drift-pages.ts";
import { drawsPage } from "./draw-pages.ts";
import { beat, breath, cards, pill, REST_RULES, type RestKind, ruleLines, rulesOn, type Stalls, stallsPage, toast, type Tracks, tracksPage } from "./rest-pages.ts";
import "./sweep-priority.ts";

/**
 * The style sweep for the live follows rule (the class guard, as loop-sweep.test.ts is for idle loops). A hand logged
 * less often than once a frame (a pointer at 30 Hz, or every third or fourth frame, on or off the frame grid) holds its
 * place between samples, and a value that follows it 1:1 cannot move in those frames. Honest followers, one that
 * copies the hand and one that chases it through its own spring, must pass under every hand; a page that ignores
 * moves of the hand, or follows it 100 ms late, fails under every hand.
 *
 * And for the live regrab rule: a drag that commits, as a swipe to dismiss or a pass slid through a reader, runs the
 * handle off at its own speed and it is gone by the release, so nothing settles and there is nothing to grab. Commits
 * that run off at 800 to 3000 px/s, with the hand lifting 0 to 200 ms after the handle is gone, must pass with a note;
 * each planted fault (a handle that stops on screen, one reported gone with no move, a spring-back that rests on screen,
 * a commit that reports no objects, a handle that blinks out at the release and comes back) must fail "cannot be checked"
 * at every one of those points. And a hand that lets go before the handle is gone (the dismiss most swipes make) lifts
 * 0 to 100 ms after the commit, while the handle runs: it passes, and the same faults fail there too.
 *
 * And for the loop-stops-at-rest rule on a live or scroll page with a designed pause (a fade-out, a blank beat, then the next element
 * arriving): the gate waits for the `?seek` frames' last move before it looks for rest, so a beat of 150 to 1500 ms is no rest.
 * Honest pages must pass at every beat; a loop that runs 1 s past the end, or never stops, fails with the rAF line at every
 * beat; a loop that stops at the start of the beat, so the second element never arrives live, fails at every beat.
 * A designed value loop on a live or scroll page (periods of 1, 2.5 and 4 s, a swing of 1% and of 10%) must pause off screen:
 * one that does passes the loop rules, and one that does not fails pausesOffScreen at every one of those points. The loop
 * runs from load, or the input starts it (a breath that begins at the release, on a page that idles its rAF until then): the
 * gate plays the input before it looks, so both are running when the off-screen and resume rules check.
 *
 * And a value that moves at one steady speed while nobody touches it (a marquee, a strip that drifts) is a loop too: drifts
 * of 20, 95 and 400 px/s that a 1:1 drag (or a scroll) holds and a release eases back to must pass the loop rules and pause
 * off screen; the planted faults (a drift that does not pause, a second value that wobbles forever beside it, a drift that
 * slows with a 3 s time constant, one whose speed wobbles by 20%, one that stops after the input while its clock runs on)
 * fail at every one of those speeds.
 */

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
const page = (name: string) => path.join(PAGES, `${name}.html`);

const dir = mkdtempSync(path.join(os.tmpdir(), "motion-kit-live-sweep-"));

afterAll(async () => {
  await closeBrowser();
  rmSync(dir, { recursive: true, force: true });
});

type Hand = { name: string; everyFrames: number; offsetMs: number };

/** The hands: one sample every 1, 2, 3 or 4 frames, with times on the frame grid and 5 ms off it. */
const hands: Hand[] = [
  { name: "every frame", everyFrames: 1, offsetMs: 0 },
  { name: "every 2nd frame (30 Hz)", everyFrames: 2, offsetMs: 0 },
  { name: "every 3rd frame (20 Hz)", everyFrames: 3, offsetMs: 0 },
  { name: "every 4th frame (15 Hz)", everyFrames: 4, offsetMs: 0 },
  { name: "every 2nd frame, 5 ms off the grid", everyFrames: 2, offsetMs: 5 },
  { name: "every 3rd frame, 5 ms off the grid", everyFrames: 3, offsetMs: 5 },
];

/** The synthetic drag's path (its first `frames` frames), logged once every `everyFrames` frames: only the logged samples exist. */
function logged({ everyFrames, offsetMs }: Hand, frames = 36): [number, number, number][] {
  const drag = syntheticInput("live")!.samples as [number, number, number][];
  const out: [number, number, number][] = [];
  for (let k = 0; k <= frames; k += everyFrames) out.push([drag[k]![0] + (k === 0 ? 0 : offsetMs), drag[k]![1], drag[k]![2]]);
  return out;
}

async function follows(name: string, samples: [number, number, number][]): Promise<string[]> {
  const p = await openPage(page(name), { input: samples });
  try {
    return await liveRules.find((r) => r.name === "follows")!.check(p, { kind: "live", input: { kind: "pointer", samples }, cuts: [] });
  } finally {
    await p.close();
  }
}

describe.concurrent("follows: honest followers pass under every hand", () => {
  const followers: [string, string][] = [
    ["a 1:1 follower", "live-good"],
    ["a smoothed follower", "live-springy"],
  ];
  for (const [label, name] of followers) {
    it.each(hands)(`${label} under a hand that moves $name`, async (hand) => {
      expect(await follows(name, logged(hand))).toEqual([]);
    });
  }
});

describe.concurrent("follows: a press held still", () => {
  // A hand that never changes place has no move to follow, so every frame of the drag counts: a value that moves on its
  // own under it passes, and one that does not fails as "no value moves". Held for as long as a flick and as the full drag.
  it.each([12, 36])("a value that moves under a press held for %i frames passes", async (frames) => {
    const held: [number, number, number][] = (syntheticInput("live")!.samples as [number, number, number][]).slice(0, frames + 1).map(([t]) => [t, 640, 360]);
    expect(await follows("live-drift", held)).toEqual([]);
    expect(await follows("live-good", held)).toEqual([expect.stringMatching(/^follows: no value moves while the pointer drags from \d+ to \d+ ms$/)]);
  });
});

describe.concurrent("follows: planted faults fail under every hand", () => {
  // Half of the hand's moves are ignored.
  it.each(hands)("a page that ignores every second move fails under a hand that moves $name", async (hand) => {
    expect(await follows("live-skip-moves", logged(hand))).toEqual([expect.stringMatching(/^follows: the value that follows best, [xy], moves in only \d+% of the drag's frames; a live page follows the input in 80% or more$/)]);
  });

  // A 12-frame flick, so the 6 frames of lag are half of the drag or more: a slow hand leaves the dot at rest for all of it.
  it.each(hands)("a page that follows 100 ms late fails a 12-frame flick of a hand that moves $name", async (hand) => {
    expect(await follows("live-lag", logged(hand, 12))).toEqual([expect.stringMatching(/^follows: (the value that follows best, [xy], moves in only \d+% of the drag's frames|no value moves while the pointer drags from \d+ to \d+ ms)/)]);
  });

  it.each(hands)("a page that follows no move fails under a hand that moves $name", async (hand) => {
    expect(await follows("live-no-follow", logged(hand))).toEqual([expect.stringMatching(/^follows: no value moves while the pointer drags from \d+ to \d+ ms$/)]);
  });
});

/** The commit's run-off speeds (px/s) and the ms the hand lifts after the handle is gone. */
const SPEEDS = [800, 1000, 1500, 2000, 3000];
const LIFTS = [0, 50, 100, 150, 200];
const points = SPEEDS.flatMap((speed, i) => LIFTS.map((lift, j) => ({ speed, lift, name: `a handle that runs off at ${speed} px/s, the hand lifting ${lift} ms later`, alt: (i + j) % 2 === 1 })));
/** The ms after the commit the hand lifts while the handle still runs: the press, 83 ms later, finds it on screen at 800 to 3000 px/s. */
const EARLY = [0, 20, 40, 60, 80];
const early = SPEEDS.flatMap((speed, i) =>
  EARLY.map((after, j) => ({ speed, after, lift: earlyLift(speed, after), name: `a handle that runs off at ${speed} px/s, the hand lifting ${after} ms after the commit`, alt: (i + j) % 2 === 1 })),
);

/** The regrab rule on a commit page whose handle runs off at `speed`, and the notes it left. */
async function regrab(base: string, speed: number, lift: number, stopPx?: number): Promise<{ lines: string[]; notes: string[] }> {
  const samples = commitInput(speed, lift, stopPx);
  const input = { kind: "pointer" as const, samples };
  const p = await openPage(commitPage(dir, base, speed), { input: samples });
  const notes: string[] = [];
  try {
    const lines = await liveRules.find((r) => r.name === "regrab")!.check(p, { kind: "live", input, cuts: [], notes });
    return { lines, notes };
  } finally {
    await p.close();
  }
}

describe.concurrent("regrab: a commit that leaves the screen", () => {
  // A box wholly outside the viewport, and (every other point) a box of 1 by 1: both are gone.
  it.each(points)("passes with a note: $name", async ({ speed, lift, alt }) => {
    const { lines, notes } = await regrab(alt ? "live-commit-hidden" : "live-commit", speed, lift);
    expect(lines).toEqual([]);
    expect(notes).toEqual([expect.stringMatching(/^regrab: dot, moved by x, is gone 83 ms after the release \(it left at [\d.]+ ms, in a frame where x moved\), so there is no handle to regrab mid-settle$/)]);
  });
});

describe.concurrent("regrab: a commit let go before the handle is gone", () => {
  it.each(early)("passes with a note: $name", async ({ speed, lift, alt }) => {
    const { lines, notes } = await regrab(alt ? "live-commit-hidden" : "live-commit", speed, lift);
    expect(lines).toEqual([]);
    // The press, 83 ms on, finds the handle still running, or (the fastest runs, lifted last) just gone.
    expect(notes).toEqual([
      expect.stringMatching(
        /^regrab: dot, moved by x, (is still running 83 ms after the release and goes at [\d.]+ ms \(in a frame where x moved\), so the press grabs nothing and there is no handle to regrab mid-settle|is gone 83 ms after the release \(it left at [\d.]+ ms, in a frame where x moved\), so there is no handle to regrab mid-settle)$/,
      ),
    ]);
  });
});

describe.concurrent("regrab: what a commit must not excuse", () => {
  const CANNOT = /^regrab: x is at rest 83 ms after the release, so a regrab mid-settle cannot be checked$/;
  // A handle that stops on screen is let go that far along, 200 + STAY_PX px right of its rest; the others run the whole way.
  const faults: [string, string, number | undefined][] = [
    ["a handle that stops on screen, as one let go", "live-commit-stays", 200 + STAY_PX],
    ["a handle reported gone with no move of its value", "live-commit-vanish", 200 + STAY_PX],
    ["a spring-back whose handle rests on screen", "live-commit-springback", undefined],
    ["a commit whose page reports no objects", "live-commit-bare", undefined],
    ["a handle that blinks out at the release and is drawn again at rest", "live-commit-blink", undefined],
  ];
  for (const [label, base, stopPx] of faults) {
    it.each(points)(`${label} fails: $name`, async ({ speed, lift }) => {
      const { lines, notes } = await regrab(base, speed, lift, stopPx);
      expect(lines).toEqual([expect.stringMatching(CANNOT)]);
      expect(notes).toEqual([]);
    });
  }
  // Let go while the handle still runs, the same faults do not pass: the press grabs nothing of a handle that is not gone.
  const NOT_GONE = /^regrab: (x is at rest 83 ms after the release, so a regrab mid-settle cannot be checked|the press at \(-?\d+, -?\d+\), 83 ms after the release grabs nothing: x moves [\d.]+ of its [\d.]+ to rest while the pointer holds still)$/;
  const earlyFaults = faults.filter(([, base]) => base !== "live-commit-blink");
  for (const [label, base, stopPx] of earlyFaults) {
    it.each(early)(`${label} fails when the hand lets go early: $name`, async ({ speed, after }) => {
      const { lines, notes } = await regrab(base, speed, earlyLift(speed, after, stopPx), stopPx);
      expect(lines).toEqual([expect.stringMatching(NOT_GONE)]);
      expect(notes).toEqual([]);
    });
  }
});

const BEATS = [150, 250, 383, 500, 800, 1000, 1500];
const KINDS = ["live", "scroll"] as const;
const RAF = /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/;
const STALLED = /^loopStopsAtRest: the live page comes to rest with n at 0, where its \?seek frames end at 1; the live loop stopped before its sequence ended$/;
const NO_PAUSE = /^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen; the loop pauses off screen$/;

// The beat page is a live page (a drag) or a scroll page (a wheel down and back up); the rule reads both the same way.
describe.concurrent.each(KINDS)("loopStopsAtRest: a %s page with a designed pause", { timeout: 120_000 }, (kind) => {
  it.each(BEATS)("a %i ms blank beat between the fade and the next element passes", async (beatMs) => {
    expect(await atRest(dir, { kind, beatMs })).toEqual([]);
  });
  it.each(BEATS)("a %i ms beat and a loop that runs 1 s past the end fails with the rAF line", async (beatMs) => {
    expect(await atRest(dir, { kind, beatMs, fault: "loop-past", pastMs: 1000 })).toEqual([expect.stringMatching(RAF)]);
  });
  it.each(BEATS)("a %i ms beat and a loop that never stops fails with the rAF line", async (beatMs) => {
    expect(await atRest(dir, { kind, beatMs, fault: "loop-forever" })).toEqual([expect.stringMatching(RAF)]);
  });
  it.each(BEATS)("a %i ms beat and a loop that stops at the start of the beat fails: the second element never arrives", async (beatMs) => {
    expect(await atRest(dir, { kind, beatMs, fault: "stalls" })).toEqual([expect.stringMatching(STALLED)]);
  });
});

// A designed value loop (a breath from load) keeps the page's clock running, so the rAF count does not decide: the loop
// must pause off screen, which the live and scroll gates ask of it through the idle rules (forLoops), as choreo and sim do.
const LOOPS = [
  { periodS: 1, amp: 0.01 },
  { periodS: 1, amp: 0.1 },
  { periodS: 2.5, amp: 0.01 },
  { periodS: 2.5, amp: 0.1 },
  { periodS: 4, amp: 0.01 },
  { periodS: 4, amp: 0.1 },
];
const LOOP_RULES = ["loopStopsAtRest", "pausesOffScreen", "resumes"];

// The loop runs from load, or the input starts it (a breath that begins at the release, on a page that idles its rAF until
// then): the gate plays the input before the off-screen and resume rules look, so both are running when it does.
describe.concurrent.each(KINDS)("a %s page with a value loop that pauses off screen", { timeout: 120_000 }, (kind) => {
  describe.each(["load", "input"] as const)("a loop that starts at %s", (from) => {
    it.each(LOOPS)("a loop of $periodS s and a swing of $amp passes the loop rules, behind a 383 ms beat", async (loop) => {
      expect(await kindRulesOn(dir, { kind, beatMs: 383, loop: { ...loop, from } }, LOOP_RULES)).toEqual([]);
    });
    it.each(LOOPS)("a loop of $periodS s and a swing of $amp that never pauses off screen fails pausesOffScreen", async (loop) => {
      expect(await kindRulesOn(dir, { kind, beatMs: 383, loop: { ...loop, from }, fault: "no-pause" }, LOOP_RULES)).toEqual([expect.stringMatching(NO_PAUSE)]);
    });
  });
});

// A steady drift is a loop on every kind (steadyStep): the gate sorts it by its last 500 ms, so a drag that holds it and a
// release that eases it back do not hide it, at any speed.
const DRIFT_SPEEDS = [20, 95, 400];
const STILL_MOVING = /^loopStopsAtRest: the page is still moving 5 s after the input ends$/;
const DRIFT_FAULTS: [NonNullable<Drift["fault"]>, RegExp][] = [
  ["no-pause", NO_PAUSE],
  ["wobbler", STILL_MOVING],
  ["slows", STILL_MOVING],
  ["wobble-speed", STILL_MOVING],
  ["stops", RAF],
];

// The slowing is judged on the last 500 ms, so a drift that slows with a 4, 6 or 10 s time constant (beside the 3 s one
// above) fails at every speed too: it is no steady speed whatever the length of the read.
const SLOW_TAUS = [4, 6, 10];

describe.concurrent.each(KINDS)("a %s page whose strip drifts at one steady speed", { timeout: 120_000 }, (kind) => {
  describe.each(SLOW_TAUS)("a drift that slows with a %i s time constant", (tauS) => {
    it.each(DRIFT_SPEEDS)("at %i px/s fails loopStopsAtRest, and no other loop rule", async (speed) => {
      expect(await driftRulesOn(dir, { kind, speed, tauS, fault: "slows" }, LOOP_RULES)).toEqual([expect.stringMatching(STILL_MOVING)]);
    });
  });
  it.each(DRIFT_SPEEDS)("a drift of %i px/s that a drag holds and a release eases back to passes the loop rules", async (speed) => {
    expect(await driftRulesOn(dir, { kind, speed }, LOOP_RULES)).toEqual([]);
  });
  describe.each(DRIFT_FAULTS)("a %s drift", (fault, line) => {
    it.each(DRIFT_SPEEDS)("at %i px/s fails with its line, and no other loop rule", async (speed) => {
      expect(await driftRulesOn(dir, { kind, speed, fault }, LOOP_RULES)).toEqual([expect.stringMatching(line)]);
    });
  });
});

// The read's length sorts loops with the input's first sample as its cause, as every rule does: a drift that eases in
// over more than the 2 s lead-in and eases back slowly after a release is still a loop there, so the read does not run
// to its 15 s cap.
const SPAN_CUT = /^span: /;
describe.concurrent.each(KINDS)("a %s page whose drift eases in over 2.4 s and back over 2.2 s after a release", { timeout: 120_000 }, (kind) => {
  it.each(DRIFT_SPEEDS)("at %i px/s gets no span line", async (speed) => {
    const v = await kindGate(driftPage(dir, { kind, speed, introS: 2.4, easeS: 2.2 }));
    expect(v.failures.filter((f) => SPAN_CUT.test(f))).toEqual([]);
  });
});

/**
 * And for the rules that wait until the page stops (rest-pages.ts): the gate reads a live or scroll page until its sequence
 * is over, not for a fixed 3 s, and takes the page off screen only when the sequence is at rest and its loop runs. Honest
 * pages must pass loopStopsAtRest, pausesOffScreen and resumes whatever the sequence is:
 * - a toast that holds 1.2 to 4 s, a pill that holds 1 to 3 s, a blank beat of 1.5 s, two beats one after the other;
 * - the page's clock running through the gaps of its timeline, or asleep in them and woken by a timer;
 * - a loop that pauses while the sequence goes on, whichever way it pauses (the loop's clock alone, or the whole page's).
 * A page that stops in a gap, whether its sequence goes on after the gap or ends where it began, fails (kind-gate.test.ts).
 */
const GAPS = ["tick", "timer"] as const;
const clock = (gaps: (typeof GAPS)[number]) => (gaps === "tick" ? "running" : "woken by a timer");
// Holds either side of what the 3 s span used to cut: a toast that is off screen again by 2.9 s, and ones that are not.
const sequences: [string, RestKind, Tracks][] = [
  ...[1.2, 2.0].flatMap((hold) => GAPS.map((gaps): [string, RestKind, Tracks] => [`a live toast that holds ${hold} s, the clock ${clock(gaps)}`, "live", { tracks: toast(hold), gaps }])),
  ...[1.5, 4].flatMap((hold) => GAPS.map((gaps): [string, RestKind, Tracks] => [`a live toast that holds ${hold} s, the clock ${clock(gaps)}`, "live", { tracks: toast(hold), gaps }])),
  ...[1, 3].flatMap((hold) => GAPS.map((gaps): [string, RestKind, Tracks] => [`a scroll pill that holds ${hold} s, the clock ${clock(gaps)}`, "scroll", { tracks: pill(hold), gaps }])),
  ["a live blank beat of 1.5 s", "live", { tracks: beat(1.5), gaps: "timer" }],
  ["a live blank beat of 2.45 s, the second element at 3.3 s", "live", { tracks: beat(2.45), gaps: "timer" }],
];
const stalled: [string, RestKind, Stalls][] = [
  ["a live page: a card out, a 1.5 s beat, the next card in", "live", { pieces: cards(1.5) }],
  ["a live page: a card out, a 1.55 s beat, the next card in", "live", { pieces: cards(1.55) }],
  ["a live page of two beats, a fade at 1.15 s and a slide at 2.45 s", "live", { pieces: [{ n: "a", unit: "opacity", from: 0, to: 1, at: 1.15, dur: 0.3 }, { n: "b", unit: "px", from: 0, to: 200, at: 2.45, dur: 0.4 }] }],
  ["a scroll page: a card out, a 2.5 s beat, the next card in", "scroll", { pieces: cards(2.5) }],
];

// Not concurrent: each page here is read at the real clock for the rules that wait for it to stop, and one of them (a toast that
// holds 4 s, its clock woken by a timer) failed in a whole run with the sweeps beside it, when its timer came late.
describe("a sequence that runs past 3 s passes the rules that wait for the page to stop", { timeout: 120_000, concurrent: false }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-sweep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each(sequences)("%s", async (_what, kind, motion) => {
    expect(await ruleLines(tracksPage(root, kind, "sequence", motion), REST_RULES)).toEqual([]);
  }, 120000);

  it.each(stalled)("%s", async (_what, kind, motion) => {
    expect(await ruleLines(stallsPage(root, kind, "sequence", motion), REST_RULES)).toEqual([]);
  }, 120000);

  it("the span a page is read for takes in the whole sequence (a toast that holds 4 s, a second element at 3.3 s)", async () => {
    expect((await pageInput(tracksPage(root, "live", "toast-4s", { tracks: toast(4), gaps: "timer" }))).spanMs).toBeGreaterThan(5500);
    expect((await pageInput(tracksPage(root, "live", "late-beat", { tracks: beat(2.45), gaps: "timer" }))).spanMs).toBeGreaterThan(4500);
  });
});

// A loop pauses while the sequence goes on (the loop's clock alone), or with the whole page's clock: either way the page is
// taken off screen only when the sequence is at rest, so the loop is the only thing that could still be running.
const LOOP_OMEGAS: [string, Tracks][] = [
  ["a spring that settles in 0.4 s (omega 18, zeta 0.8)", { omega: 18, zeta: 0.8 }],
  ["a slow, bouncy spring (omega 12, zeta 0.6) that settles about a second after the release", { omega: 12, zeta: 0.6 }],
];
describe.concurrent.each(["all", "loop"] as const)("a live page whose %s clock pauses off screen, with a breathing loop from load", { timeout: 120_000 }, (pause) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-loop-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it.each(LOOP_OMEGAS)(`passes with %s`, async (_what, spring) => {
    expect(await ruleLines(tracksPage(root, "live", "loop-from-load", { loop: breath("load"), pause, ...spring }), REST_RULES)).toEqual([]);
  }, 120000);
});

describe.concurrent("a scroll page whose loop's clock alone pauses off screen passes the rules that wait for the page to stop", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-scroll-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it("with a breathing loop from load, the smoothed scroll still settling when the page could be hidden", async () => {
    expect(await ruleLines(tracksPage(root, "scroll", "loop-only", { loop: breath("load"), pause: "loop" }), REST_RULES)).toEqual([]);
  }, 120000);
});

// A page that pauses by an IntersectionObserver alone is told it left 40 to 75 ms after the body moved (PAUSE_GRACE_MS), so
// frames in that stretch are not counted. 10 runs of 10 must pass.
describe.concurrent("a live page that pauses by an IntersectionObserver alone", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-io-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it("passes pausesOffScreen in 10 of 10 runs", async () => {
    const on = await rulesOn(tracksPage(root, "live", "io-only", { loop: breath("cause", { startS: 0 }), watch: "io" }));
    try {
      const runs: string[][] = [];
      for (let i = 0; i < 10; i++) runs.push(await on.run(["pausesOffScreen"]));
      expect(runs).toEqual(Array.from({ length: 10 }, () => []));
    } finally {
      await on.close();
    }
  }, 300000);
});

/**
 * The seed contract for the rest compare: a page draws its random values from a seeded stream, the same in live play as under
 * `?seek` (reseeded where the sequence starts), so a live run lands where its `?seek` frames end. Honest random pages (a scatter
 * of chips to random distances, a spring that settles at a random tilt, bubbles that fade in after random gaps, a badge that
 * pops after a random delay), written that way, pass loopStopsAtRest at three seeds, whatever the draws are.
 */
const SEEDS = [1, 7, 23];
describe.concurrent("the seed contract: a live or scroll page that draws seeded random values passes loopStopsAtRest", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-seeded-live-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const cases = (["live", "scroll"] as const).flatMap((kind) =>
    (kind === "live" ? (["scatter", "tilt", "gaps", "pop"] as const) : (["scatter", "pop"] as const)).flatMap((scene) => SEEDS.map((seed) => [kind, scene, seed] as const)),
  );
  it.each(cases)("a %s %s page at seed %i", async (kind, scene, seed) => {
    expect(await ruleLines(drawsPage(root, `${scene}-seed-${seed}`, { kind, scene, seed }), ["loopStopsAtRest"])).toEqual([]);
  });
});

/**
 * The loop sort on live and scroll pages: a value at one steady speed is a loop only when it moves the same with no input. A fling that decays to a floor speed and a value a scroll tick kicks that decays to one start
 * from rest, so they are no loop and the page never comes to rest (loopStopsAtRest); the same pages that stop below a small
 * speed rest. A drift that was already moving before the hand (drift-pages.ts) stays a loop, as the tests above show.
 */
describe.concurrent("a live page's fling, and a scroll page's kick, that creep for ever", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-creep-sweep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const STILL_MOVING = /^loopStopsAtRest: the page is still moving 5 s after the input ends$/;
  const RULES = ["loopStopsAtRest"];

  const flings = [4, 8].flatMap((decayPerS) => [15, 30, 95, 300].map((minPxS) => [decayPerS, minPxS] as const));
  it.each(flings)("a fling that decays at %i a second to a floor of %i px/s fails loopStopsAtRest", async (decayPerS, minPxS) => {
    expect(await ruleLines(flingPage(root, `fling-${decayPerS}-${minPxS}`, { decayPerS, minPxS }), RULES)).toEqual([expect.stringMatching(STILL_MOVING)]);
  });
  it.each([4, 8])("a fling that decays at %i a second and stops below 2 px/s passes loopStopsAtRest", async (decayPerS) => {
    expect(await ruleLines(flingPage(root, `fling-stops-${decayPerS}`, { decayPerS, stopPxS: 2 }), RULES)).toEqual([]);
  });

  const kicks = [3, 6].flatMap((decayPerS) => [15, 60, 200].map((minPxS) => [decayPerS, minPxS] as const));
  it.each(kicks)("a scroll kick that decays at %i a second to a floor of %i px/s fails loopStopsAtRest", async (decayPerS, minPxS) => {
    expect(await ruleLines(scrollKickPage(root, `kick-${decayPerS}-${minPxS}`, { decayPerS, minPxS }), RULES)).toEqual([expect.stringMatching(STILL_MOVING)]);
  });
  it.each([3, 6])("a scroll kick that decays at %i a second and stops below 1 px/s passes loopStopsAtRest", async (decayPerS) => {
    expect(await ruleLines(scrollKickPage(root, `kick-stops-${decayPerS}`, { decayPerS, stopPxS: 1 }), RULES)).toEqual([]);
  });
});
