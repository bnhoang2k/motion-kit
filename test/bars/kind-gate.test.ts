import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run, type CliIo } from "../../src/cli/run.ts";
import type { KindName } from "../../src/core/types.ts";
import { closeBrowser, FRAME_MS, openPage, type Frame, type GatePage } from "../../src/gate/harness.ts";
import { drawn, DRAWN_BOUNDARIES, DRAWN_EVEN, DRAWN_SAMPLES, drawnRead } from "../../src/gate/drawn.ts";
import { drawingsOf } from "../../src/gate/poses.ts";
import { realClockGap } from "../../src/gate/self-checks.ts";
import { neverFasterThan, series, steadyStep, stillTol } from "../../src/gate/series.ts";
import { ALL_RULES, BROWSER_NOTE, inputPastSpan, inputStartAfter, kindGate, loopNames, loopScanEnd, loopSet, pageInput, recordedSpan, restApart, SETTLE_MS, SPAN_MS, sweepInput, tweens, waitForRest, type KindVerdict } from "../../src/gate/kind-gate.ts";
import { INPUT_START_MS, syntheticInput } from "../../src/gate/synthetic-input.ts";
import { rules as liveRules } from "../../kinds/live/gate.ts";
import { FAULTY, HONEST, NOT_NUMBERS, OTHER_FAULTS, sweepPage, writeSteppedBar, type Drawing } from "./stepped-pages.ts";
import { inputSlug, writeInputBar, type InputPage } from "./input-pages.ts";
import { base, baseBar } from "../knob-base.ts";
import { bobPage } from "./bob-pages.ts";
import { commitInput, commitPage, earlyLift } from "./commit-pages.ts";
import { atRest, beatPage } from "./beat-pages.ts";
import { breathPage } from "./breath-pages.ts";
import { drawsPage } from "./draw-pages.ts";
import { driftRulesOn } from "./drift-pages.ts";
import { tweenPage } from "./tween-pages.ts";
import { kf, keyframePage, phases, type Keyframes } from "./keyframe-pages.ts";
import { writeJumpPage } from "./jump-pages.ts";
import { flingPage, loadLoopPage, scrollKickPage, type LoadLoop } from "./creep-pages.ts";
import { tapLoopPage, type TapLoop as TapLoopSpec } from "./loop-tap-pages.ts";
import { bob, cards, type Piece, pill, restLines, ruleLines, rulesOn, slowFade, stallsPage, toast, tracksPage, type Track } from "./rest-pages.ts";
import "./sweep-priority.ts";
import { BOTH, bodyPage, ringPage } from "./extent-pages.ts";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
const page = (name: string) => path.join(PAGES, name.endsWith(".html") ? name : `${name}.html`);
const LOOP_PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/loops");

/** The names of the checks that report a failure: each line starts with its check's name. */
const failing = (v: KindVerdict) => [...new Set(v.failures.map((f) => f.slice(0, f.indexOf(":"))))].sort();

afterAll(async () => {
  await closeBrowser();
});

// The GL driver notes come only to the first WebGL context of a fresh browser, so these tests close the shared browser and
// start another. That must happen with no other test running in this file, and a block that is not concurrent runs alone
// only among the blocks at its own level: so it sits at the top of the file, as a sibling of the concurrent blocks, and runs
// first. (Its name is the same as the block it belongs to, so the tests keep their names.) Anything else that closes the
// browser sits up here too.
describe("the kind gate", { concurrent: false, timeout: 120_000 }, () => {
  // Chromium writes up to 4 GL driver notes in the first WebGL context of a fresh browser. The page cannot cause or
  // stop them, so consoleClean leaves out that one note and counts everything else.
  describe("consoleClean and the browser's GL driver notes", () => {
    const note = "warning: [.WebGL-0x12c00517e00]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels";

    it("leaves out the real note, and counts near-misses: an error, a page warning, a driver message that is not Performance", () => {
      expect(BROWSER_NOTE.test(note)).toBe(true);
      expect(BROWSER_NOTE.test(note.replace(/^warning/, "error"))).toBe(false);
      expect(BROWSER_NOTE.test("warning: x")).toBe(false);
      expect(BROWSER_NOTE.test(note.replace("Performance", "Other"))).toBe(false);
    });

    it("a WebGL page that writes nothing itself passes in a fresh browser", async () => {
      await closeBrowser();
      const v = await kindGate(page("live-webgl-clear"));
      expect(failing(v)).toEqual([]);
    });

    it.each([
      ["live-webgl-warn", /^consoleClean: warning: x \(the (\?seek|live) run\)$/],
      ["live-webgl-own-error", /^consoleClean: error: GL error 1280 \(the (\?seek|live) run\)$/],
    ])("%s still fails consoleClean in a fresh browser", async (name, line) => {
      await closeBrowser();
      const v = await kindGate(page(name));
      expect(failing(v)).toContain("consoleClean");
      expect(v.failures.filter((f) => f.startsWith("consoleClean:"))).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
      expect(v.failures.filter((f) => f.includes("GL Driver Message"))).toEqual([]);
    });
  });
});

describe.concurrent("the synthetic input", () => {
  it("live: a 300 px curve over 600 ms from the viewport center, one sample per frame, x and y not in proportion", () => {
    const input = syntheticInput("live");
    expect(input?.kind).toBe("pointer");
    const s = input!.samples as [number, number, number][];
    expect(s).toHaveLength(37);
    const [first, mid, last] = [s[0]!, s[18]!, s[s.length - 1]!];
    expect(first.slice(1)).toEqual([640, 360]);
    expect(last[0] - first[0]).toBeCloseTo(600, 6);
    const length = s.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[1] - s[i]![1], q[2] - s[i]![2]), 0);
    expect(length).toBeCloseTo(300, 6);
    // Right at a steady speed, while the curve dips down and comes back up.
    expect(mid[1] - first[1]).toBeCloseTo((last[1] - first[1]) / 2, 6);
    expect(mid[2]).toBeGreaterThan(first[2] + 50);
    expect(last[2]).toBeCloseTo(first[2], 6);
  });

  it("scroll: 3 ticks of 100 px down 50 ms apart, then 3 up; idle: none", () => {
    const s = syntheticInput("scroll")!.samples as [number, number][];
    const changes = s.filter((q, i) => q[1] !== (i === 0 ? 0 : s[i - 1]![1])).map((q) => q[1]);
    expect(changes).toEqual([100, 200, 300, 200, 100, 0]);
    expect(syntheticInput("idle")).toBeNull();
  });

  it("choreo and sim: a tap at the viewport center, lifted one frame later", () => {
    for (const kind of ["choreo", "sim"] as const) {
      expect(syntheticInput(kind)).toEqual({ kind: "pointer", samples: [[INPUT_START_MS, 640, 360, 1], [INPUT_START_MS + FRAME_MS, 640, 360, 0]] });
    }
  });

  it("starts at a later frame time when asked, with the same shape", () => {
    const at = (kind: "live" | "scroll", start?: number) => syntheticInput(kind, start)!.samples as number[][];
    const later = 120 * FRAME_MS;
    for (const kind of ["live", "scroll"] as const) {
      const [base, moved] = [at(kind), at(kind, later)];
      expect(moved[0]![0]).toBeCloseTo(later, 9);
      expect(moved.map((q) => [q[0]! - later, ...q.slice(1)])).toEqual(base.map((q) => [expect.closeTo(q[0]! - INPUT_START_MS, 9), ...q.slice(1)]));
    }
  });

  /** Frames every 1/60 s to `toMs`, with one value v(ms). */
  const framesOf = (toMs: number, v: (ms: number) => number) => Array.from({ length: Math.round(toMs / FRAME_MS) + 1 }, (_, i) => ({ ms: i * FRAME_MS, values: { v: v(i * FRAME_MS) } }));

  it("waits for the page's load motion: 250 ms in, or 250 ms after the load motion ends when it ends later", () => {
    // No load motion, and a load motion that ends before 250 ms: the input starts 250 ms in.
    expect(inputStartAfter(framesOf(3000, () => 0))).toBeCloseTo(INPUT_START_MS, 9);
    expect(inputStartAfter(framesOf(3000, (ms) => Math.min(ms, 200)))).toBeCloseTo(INPUT_START_MS, 9);
    // A load motion that ends at 600 ms: the input starts 250 ms later, on the frame grid.
    const after = inputStartAfter(framesOf(3000, (ms) => Math.min(ms, 600)));
    expect(after).toBeCloseTo(51 * FRAME_MS, 9);
    // A page still moving at the end of the scan (a loop) never settles, so the input keeps 250 ms.
    expect(inputStartAfter(framesOf(3000, (ms) => Math.sin(ms / 100)))).toBeCloseTo(INPUT_START_MS, 9);
  });

  it("a recorded input's span reaches its last trace row and its last sample plus the settle window", () => {
    const at = (end: number) => ({ kind: "pointer" as const, samples: [[250, 0, 0], [end, 10, 0]] as [number, number, number][] });
    expect(recordedSpan(at(850), [])).toBe(SPAN_MS);
    expect(recordedSpan(at(2933), [])).toBeCloseTo(2933 + SETTLE_MS, 9);
    expect(recordedSpan(at(2933), [0, 4616.666666666667])).toBeCloseTo(Math.max(4616.666666666667, 2933 + SETTLE_MS), 9);
  });

  it("an input that runs past the span is a failure line", () => {
    const input = { kind: "pointer" as const, samples: [[250, 0, 0], [3500, 10, 0]] as [number, number, number][] };
    expect(inputPastSpan(input, 4000)).toEqual([]);
    expect(inputPastSpan(null, 3000)).toEqual([]);
    expect(inputPastSpan(input, 3000)).toEqual(["span: the input runs to 3500 ms, past the 3000 ms the rules read"]);
  });

  it("the reduced-motion sweep scrolls down in 50 px steps to the page's end, holds, and comes back up", () => {
    const s = sweepInput(INPUT_START_MS, 220).samples;
    expect(s[0]![1]).toBe(0);
    const ys = s.map((q) => q[1]);
    expect(Math.max(...ys)).toBe(200);
    expect(ys[ys.length - 1]).toBe(0);
    expect([...new Set(ys)]).toEqual([0, 50, 100, 150, 200]);
    s.forEach((q, i) => expect(q[0]).toBeCloseTo(INPUT_START_MS + i * FRAME_MS, 9));
  });
});

describe.concurrent("the kind gate", { timeout: 120_000 }, () => {
  // idle-rise-50ms: a 50 ms eased rise is no pop. moves-*: a 600 ms ease-in-out, a 1 s spring with no bounce and a
  // 600 ms easeInBack (its dip is not the move) have no attack bound; a 1.2 s loop with a 480 ms bump
  // is a loop, not a pulse. bar-cut-move: a slide that starts before a cut and jumps at it is two moves, the cut's
  // jump no pop. live-hit-test: a press grabs only on the dot, so the regrab must aim at
  // it; live-slider-x does the same for a knob that follows only x. bar-cut: a bar's one-frame jump
  // at a cut in its trace.json is no pop.
  // choreo-good: a second tap turns the bars back; choreo: it is ignored; choreo-cycle: it sends them on to the next of
  // three stops, a rest only a later tap reaches; choreo-load: the sequence starts on load and a tap does nothing, so
  // the gate judges the load sequence. choreo-pause: bars 2.4 s apart, so the sequence holds still between them and
  // runs past 5 s; choreo-shake: a there-and-back shake, which reduced motion may skip, since it ends where it began,
  // and whose 200 ms rise is no flash; choreo-toast: bars slide out, hold 1.5 s and slide back, and reduced motion
  // shows the hold, then leaves it in one frame. choreo-rider: a close button rides a bar and the tap's spot crosses
  // it mid-move, so the repeated tap lands on it and the page docks the bars at a rest no tap reaches; that rest is the
  // one a press on the button at rest also reaches, so the page passes.
  // sim-good: a dropped ball bounces to rest, a rolled ball stops past the edge, and a ring loops and pauses off
  // screen; sim-load: the same started on load, with no bounce; sim-tap-loop: the same, with no live loop until the
  // tap lifts.
  // scroll-intro: a value that eases in over 1.5 s at load; the input waits for it, so the scroll rules judge only
  // what the scroll moves. scroll-snap05: a 0.05 px rest snap after a still stretch is below the px floor, so no pop.
  // bar-stepped: a lift held in drawings on purpose (trace.json "stepped") is judged at its drawing rate.
  // bar-live-grid: a dot dragged on a 20 px grid, and bar-scroll-flipbook: a flipbook drawn by the scroll. While the
  // input drives them their stepped values read as drawings, so the input rules judge what the hand sees.
  it.each(["bar-stepped/index.html", "bar-live-grid/index.html", "bar-scroll-flipbook/index.html", "idle-good", "live-good", "scroll-good", "scroll-intro", "scroll-snap05", "idle-rise-50ms", "moves-ease600", "moves-spring1s", "moves-back600", "moves-bump-loop", "live-hit-test", "live-slider-x", "bar-cut/index.html", "bar-cut-move/index.html", "scroll-stepped", "choreo-good", "choreo", "choreo-cycle", "choreo-load", "choreo-pause", "choreo-shake", "choreo-toast", "choreo-rider", "sim-good", "sim-load", "sim-tap-loop"])("%s passes every rule", async (name) => {
    const v = await kindGate(page(name));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it("choreo: tries every piece start on a short sequence in under 30 s", async () => {
    const t0 = performance.now();
    await kindGate(page("choreo-good"));
    expect(performance.now() - t0).toBeLessThan(30_000);
  });

  it("reports an idle KNOBS value's distance from its base, as information", async () => {
    const idle = await kindGate(page("idle-good"));
    expect(idle.distances).toEqual([`idle.period 1.6 s, 60% below base ${base("idle.period", "4.0 s")}`]);
  });

  it("reports each scroll KNOBS value's distance from its base, as information", async () => {
    const scroll = await kindGate(page("scroll-good"));
    expect(scroll.distances).toEqual([
      `scroll.smooth 0.167 s, at base ${base("scroll.smooth", "0.167 s")}`,
      `scroll.maxStep 0.05 s, at base ${base("scroll.maxStep", "0.05 s")}`,
    ]);
  });

  /** Each fault page, the one rule it fails, and the line that rule prints when the line is worth pinning. */
  const faults: [string, string | string[], RegExp?][] = [
    ["idle-pop", ["envelope", "suddenJumps"], /^envelope: y at 600 ms covers 100% of its whole change in the one frame after 600 ms; that is a pop$/],
    ["scroll-pop06", ["envelope", "suddenJumps"], /^envelope: q at 83.333 ms covers 100% of its whole change in the one frame after 83.333 ms; that is a pop$/],
    ["bar-uncut/index.html", ["envelope", "suddenJumps"], /^envelope: y at 600 ms covers 100% of its whole change in the one frame after 600 ms; that is a pop$/],
    // The slide goes out and comes home, so the jump at the cut is read between frames (suddenJumps), and the envelope has only its pulse attack.
    ["bar-cut-move-uncut/index.html", ["envelope", "suddenJumps"], /^envelope: x at 850 ms is a pulse that peaks \d+ ms after it starts; a pulse's attack is 40 to 120 ms$/],
    // Stepped motion: unmarked, each pose change is a pop; marked, a lift of 1.5 dot lengths set in one pose is still a
    // pop.
    ["bar-stepped-unmarked/index.html", ["envelope", "suddenJumps"], /^envelope: y at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["bar-stepped-set/index.html", "envelope", /^envelope: y at [\d.]+ ms jumps 1.5 (of its object's length in 1 drawing, [\d.]+ times the drawings around it; that is a pop|object lengths between two rests; that is a teleport)$/],
    // A pop whose middle frame is NaN or missing: no other rule sees it, so values fails it.
    ["idle-value-nan", "values", /^values: y is NaN at 616.667 ms; a value the page reports is a finite number in every frame once it appears$/],
    ["idle-value-missing", "values", /^values: y is missing at 616.667 ms; a value the page reports is a finite number in every frame once it appears$/],
    // The attack of 10 to 29 ms is also a snap between frames: an eased leg that short is no square-root cusp.
    ["idle-pulse-short", ["envelope", "suddenJumps"], /^envelope: f at 50 ms is a pulse that peaks (1\d|2\d) ms after it starts; a pulse's attack is 40 to 120 ms$/],
    ["idle-pulse-slow", "envelope", /^envelope: f at 50 ms is a pulse that peaks (19\d|20\d) ms after it starts; a pulse's attack is 40 to 120 ms$/],
    ["idle-fade-rises", ["envelope", "overshoot"], /^envelope: o rises at [\d.]+ ms, during the fade that starts at 1000 ms; fades only fall$/],
    ["scroll-no-cap", "envelope", /^envelope: time step: p moves [\d.]+ in the frame after the 2000 ms gap; its one-frame budget is [\d.]+$/],
    ["live-loop-forever", "loopStopsAtRest", /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/],
    ["scroll-console", "consoleClean", /^consoleClean: error: a console error at load \(the \?seek run\)$/],
    ["live-reduced-slow", "reducedMotion", /^reducedMotion: [xy] still moves at [\d.]+ ms, more than one frame after the input last changed/],
    ["live-reduced-blank", "reducedMotion", /^reducedMotion: the still frame under reduced motion is the blank start state; show the end state instead$/],
    ["scroll-reduced-zoom", "reducedMotion", /^reducedMotion: z takes \d+ still values as the page scrolls \d+ px under reduced motion; a scroll page moves between a few still states \(6 or fewer\), with no continuous scroll-linked change$/],
    ["scroll-reduced-ignored", "reducedMotion", /^reducedMotion: [pzo] answers the input without reduced motion, but not with it; input still answers under reduced motion$/],
    ["idle-no-pause", "pausesOffScreen", /^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen/],
    ["idle-no-resume", "resumes", /^resumes: no frame ran in the 50 ms after the page came back on screen/],
    ["live-no-follow", ["follows", "regrab"], /^follows: no value moves while the pointer drags from 250 to 850 ms$/],
    ["live-zero-release", "releaseSpeed", /^releaseSpeed: at release, [xy] leaves at -?\d+% of its speed in the drag's last frame; a release starts from the hand's speed \(50% or more\)$/],
    ["live-regrab-jump", "regrab", /^regrab: [xy] jumps [\d.]+ in one frame on the press at \(\d+, \d+\), 83 ms after the release/],
    ["live-regrab-ignored", "regrab", /^regrab: the press at \(\d+, \d+\), 83 ms after the release grabs nothing: [xy] moves [\d.]+ of its [\d.]+ to rest while the pointer holds still$/],
    // A two-press bar: the regrab reads the page's rest from the first press alone, not from a second press that ends far away.
    ["bar-two-press/index.html", "regrab", /^regrab: the press at \(\d+, \d+\), 83 ms after the release grabs nothing: x moves [\d.]+ of its [\d.]+ to rest while the pointer holds still$/],
    // A spring the page starts on its own may not bounce; a release may, but its opacity may not.
    ["moves-spring-bounce", "overshoot", /^overshoot: y passes its rest by [\d.]+ at [\d.]+ ms and comes back; only motion a person caused may overshoot$/],
    ["live-opacity-overshoot", "overshoot", /^overshoot: o passes its rest by 0\.0\d+ at [\d.]+ ms and comes back; opacity never overshoots$/],
    ["choreo-snap-back", "interrupt", /^interrupt: b0 jumps [\d.]+ in one frame after the second trigger at [\d.]+ ms; its largest frame step without it is [\d.]+$/],
    ["choreo-freeze", "interrupt", /^interrupt: b0 rests at [\d.]+ after the second trigger at [\d.]+ ms, a state the page never rests at without it; a piece is stuck halfway$/],
    // The same close button that freezes the bars where they are when it is pressed mid-move, though at rest it sends them back to the start:
    // the start is a reference, the frozen halfway is not.
    ["choreo-rider-freeze", "interrupt", /^interrupt: b0 rests at [\d.]+ after the second trigger at [\d.]+ ms, a state the page never rests at without it; a piece is stuck halfway$/],
    ["choreo-one-onset", "interrupt", /^interrupt: every value starts at [\d.]+ ms; one onset is not a sequence$/],
    ["choreo-raf-forever", "loopStopsAtRest", /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/],
    ["choreo-reduced-ignored", "reducedMotion", /^reducedMotion: b0 rests at 0 after the cause at [\d.]+ ms under reduced motion, and at 200 without it; reduced motion shows the sequence's end state$/],
    // A tap's sequence is judged by envelope, however late a piece starts: a set piece pops, at 233 ms or 4.8 s in. A pop
    // is a jump between frames too, so suddenJumps fails it as well (as it does every fault page below that sets a value in one frame).
    ["choreo-set-piece", ["envelope", "suddenJumps"], /^envelope: b2 at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["choreo-late-pop", ["envelope", "suddenJumps"], /^envelope: b2 at 5050 ms covers 100% of its whole change in the one frame after 5050 ms; that is a pop$/],
    ["choreo-fade-rises", ["envelope", "overshoot"], /^envelope: o rises at [\d.]+ ms, during the fade that starts at [\d.]+ ms; fades only fall$/],
    ["choreo-live-stalls", "loopStopsAtRest", /^loopStopsAtRest: the live page comes to rest with b1 at 0, where its \?seek frames end at 200; the live loop stopped before its sequence ended$/],
    ["choreo-creep", ["loopStopsAtRest", "span"], /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/],
    // Under reduced motion a page that shows the tap's end from load, or answers only the first tap, fails on the
    // repeat; one that skips a toast's hold fails the held state.
    ["choreo-reduced-preset", "reducedMotion", /^reducedMotion: b0 rests at 200 after the cause played again at [\d.]+ ms under reduced motion, and at 0 without it; reduced motion shows the sequence's end state$/],
    ["choreo-reduced-once", "reducedMotion", /^reducedMotion: b0 rests at 200 after the cause played again at [\d.]+ ms under reduced motion, and at 0 without it; reduced motion shows the sequence's end state$/],
    ["choreo-reduced-toast-skipped", "reducedMotion", /^reducedMotion: b0 holds at 199\.\d+ from [\d.]+ to [\d.]+ ms after the cause at [\d.]+ ms and comes back, but not under reduced motion; reduced motion shows a held state too$/],
    ["sim-bounce-rises", "energyFalls", /^energyFalls: a leaves its turn at [\d.]+ ms at [\d.]+ a frame, faster than it arrived \([\d.]+\); a bounce never rises$/],
    ["sim-mid-kick", "energyFalls", /^energyFalls: a speeds up by [\d.]+ in one frame at [\d.]+ ms, \d+x its steady pull; only a steady pull adds speed$/],
    ["sim-restart", "energyFalls", /^energyFalls: a moves again at [\d.]+ ms after resting at [\d.]+ ms, with no new cause$/],
    ["sim-slow-damping", "restsInTime", /^restsInTime: a still moves at [\d.]+ ms, more than 4000 ms after the cause stopped at [\d.]+ ms$/],
    ["sim-no-body", "energyFalls", /^energyFalls: no px or deg value moves after the cause; a sim page needs a body, with its unit in __state\(\)\.units$/],
    ["sim-glow-pop", ["envelope", "suddenJumps"], /^envelope: fade at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["sim-loop-no-pause", "pausesOffScreen", /^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen/],
    // A sim loop that starts only when the tap lifts has its first live frame after the input ends: the gap lands in the
    // caused motion, and an uncapped time step fails there.
    ["sim-tap-loop-no-cap", "envelope", /^envelope: time step: [ab] moves [\d.]+ (in the frame after the 2000 ms gap|in live frame \d+); its one-frame budget is [\d.]+$/],
    ["scroll-one-way", "reverses", /^reverses: p moves [\d.]+ while the page scrolls down, then [\d.]+ when it scrolls back; scrolling back reverses it$/],
  ];

  describe("stepped pages (stepped-pages.ts)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-stepped-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const POP = /^envelope: y at [\d.]+ ms (jumps [\d.]+ of its object's length in (1 drawing|[23] drawings), [\d.]+ times the drawings around it; that is a pop|jumps [\d.]+ object lengths (between two rests|and back in one drawing); that is a teleport)$/;

    it.each(Object.keys(HONEST))("%s passes every rule", async (slug) => {
      const v = await kindGate(writeSteppedBar(root, slug, HONEST[slug]!));
      expect(v.failures).toEqual([]);
      expect(v.status).toBe("passed");
    });

    // A fault page that lists a cut where it draws only its 40 px dot passes drawn's cut check: the dot's change lies
    // inside the dot's own boxes. Its pop is what fails.
    it.each(Object.keys(FAULTY))("%s fails only its stepped pop", async (slug) => {
      const v = await kindGate(writeSteppedBar(root, slug, FAULTY[slug]!));
      expect(v.status).toBe("failed");
      if (slug === "frozen") {
        expect(v.failures).toEqual(["stepped: y never changes"]);
        return;
      }
      expect(failing(v)).toEqual(["envelope"]);
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(POP)]));
      expect(v.failures).toHaveLength(1);
    });

    // The spike, the teleport between two rests and the teleport out and back, each named by its own message.
    it("a spike and each kind of teleport print their own line", async () => {
      const spike = await kindGate(writeSteppedBar(root, "twos24-pop", FAULTY["twos24-pop"]!));
      expect(spike.failures).toEqual([expect.stringMatching(/^envelope: y at [\d.]+ ms jumps 0.6 of its object's length in 1 drawing, 12 times the drawings around it; that is a pop$/)]);
      // Twos into a 1 s rest, a 120 px jump to a 500 ms rest, and twos on: 3 lengths between two rests.
      const F = 1000 / 60;
      const holds = { drawings: [[0, 0], [5 * F, -4], [10 * F, -8], [70 * F, -128], [100 * F, -132], [105 * F, -136], [110 * F, -140]] as Drawing[] };
      const between = await kindGate(writeSteppedBar(root, "between-holds", holds));
      expect(between.failures).toEqual(expect.arrayContaining(["envelope: y at 1166.667 ms jumps 3 object lengths between two rests; that is a teleport"]));
      const back = await kindGate(writeSteppedBar(root, "spike", FAULTY.spike!));
      expect(back.failures).toEqual([expect.stringMatching(/^envelope: y at [\d.]+ ms jumps [\d.]+ object lengths and back in one drawing; that is a teleport$/)]);
    });

    // The rule's newer shapes, each failing only envelope with its own line: a run of two big steps among creeps, a
    // jump from rest to rest through a 1-frame in-between, and a short excursion off a slow path.
    it("a spike run, a teleport through a brief in-between and a short excursion print their own lines", async () => {
      const F = 1000 / 60;
      // A rest, then twos creeping 2 px a drawing, two 120 px steps in a row, and the creep on: 6 lengths in 2 drawings.
      const creep = [-2, -4, -6, -126, -246, -248, -250, -252];
      const run = await kindGate(writeSteppedBar(root, "spike-run", { drawings: [[0, 0], ...creep.map((y, k): Drawing => [(30 + 5 * k) * F, y])] }));
      expect(failing(run)).toEqual(["envelope"]);
      expect(run.failures).toEqual(["envelope: y at 750 ms jumps 6 of its object's length in 2 drawings, 60 times the drawings around it; that is a pop"]);
      // A 1 s rest, one 1-frame drawing 100 px on, and a rest 100 px further: 2.5 lengths through a brief in-between.
      const through = await kindGate(writeSteppedBar(root, "brief-in-between", { drawings: [[0, 0], [60 * F, -100], [61 * F, -200]] }));
      expect(failing(through)).toEqual(["envelope"]);
      expect(through.failures).toEqual(["envelope: y at 1000 ms jumps 2.5 object lengths between two rests; that is a teleport"]);
      // Fours creeping 2 px a drawing, one drawing 24 px off the path and back: a short excursion, 0.65 lengths out.
      // Its pose line passes the creep and comes back, so overshoot fails it too; envelope must name it itself.
      const path = [-2, -4, -6, -8, -10, -36, -14, -16, -18, -20, -22];
      const knock = await kindGate(writeSteppedBar(root, "short-excursion", { drawings: [[0, 0], ...path.map((y, k): Drawing => [(30 + 4 * k) * F, y])] }));
      expect(failing(knock)).toEqual(["envelope", "overshoot"]);
      expect(knock.failures.filter((f) => f.startsWith("envelope:"))).toEqual(["envelope: y at 833.333 ms jumps 0.65 of its object's length in 2 drawings, 11 times the drawings around it; that is a pop"]);
    });

    // A run that goes out and comes back right before a key hold, judged against the moving step on its other side;
    // and a size part's teleport between two rests, by the smaller box.
    it("a drawing set the wrong way and back before a key hold, and a 40 px dot that snaps to 400 px, print their own lines", async () => {
      const F = 1000 / 60;
      // The sweep's loop on the 40 px dot at 20 drawings a second: a rest, threes lifting 10 px a drawing; drawing 4 is
      // set 60 px the wrong way and drawing 5 brings it back, into the key hold: 90 and 110 px against the 10 px step
      // before them, 5 lengths in 2 drawings.
      const wrongWay = await kindGate(writeSteppedBar(root, "wrong-way-before-key", sweepPage({ rate: 20, timing: "even", chart: "even", drawings: 6, fault: "spike" })));
      expect(failing(wrongWay)).toEqual(["envelope"]);
      expect(wrongWay.failures).toEqual(["envelope: y at 816.667 ms jumps 5 of its object's length in 2 drawings, 9 times the drawings around it; that is a pop"]);
      // A 40 px dot at rest that snaps to 400 px at 500 ms and rests there: 9 lengths of the smaller box.
      const snap = await kindGate(writeSteppedBar(root, "snap-40-to-400", { drawings: [[0, 1], [30 * F, 10]], unit: "scale" }));
      expect(failing(snap)).toEqual(["envelope"]);
      expect(snap.failures).toEqual(["envelope: y at 500 ms jumps 9 object lengths between two rests; that is a teleport"]);
      // The same snap through one 2-frame drawing at scale 5.5: a size part is judged by its net change from rest to
      // rest, 9 lengths, not by its largest step (4.5).
      const through = await kindGate(writeSteppedBar(root, "snap-40-220-400", { drawings: [[0, 1], [30 * F, 5.5], [32 * F, 10]], unit: "scale" }));
      expect(failing(through)).toEqual(["envelope"]);
      expect(through.failures).toEqual(["envelope: y at 500 ms jumps 9 object lengths between two rests; that is a teleport"]);
    });

    // Two 0.6 s holds at the read's start, where the read cuts the second hold's left side short: that side gives no
    // veto, so the second drawing is still a hold. A 0.8-length pose pop between them passes, as it does in every
    // later period; a release out of the second hold is timed on its own drawing.
    it("two 0.6 s holds at the read's start: a pose pop between them passes, a release out of the second is a spike", async () => {
      const F = 1000 / 60;
      const back = [1, 2, 3, 4, 5, 6].map((k): Drawing => [1200 + 5 * k * F - 5 * F, -32 * (1 - (1 - Math.cos((Math.PI * k) / 6)) / 2)]);
      const pop = await kindGate(writeSteppedBar(root, "pose-pop-at-read-start", { drawings: [[0, 0], [600, -32], ...back], periodMs: 1700 }));
      expect(pop.failures).toEqual([]);
      const release = await kindGate(writeSteppedBar(root, "release-at-read-start", { drawings: [[0, 0], [600, -32], [1200, -172], [1200 + 5 * F, -208], [1200 + 10 * F, -224], [1200 + 15 * F, -232]] }));
      expect(failing(release)).toEqual(["envelope"]);
      expect(release.failures).toEqual(["envelope: y at 1200 ms jumps 3.5 of its object's length in 1 drawing, 3.89 times the drawings around it; that is a pop"]);
    });

    // A value with no slopes measures its own change of the box: what the object's fitted values explain is taken
    // off. y scales the dot once (too few changes to fit) while a stepped x moves it on twos, 60 px a drawing; at
    // 750 ms both change. A 1.25 scale there is a 10 px size change, not x's 1.2-length step; a snap to scale 10 is
    // still 9 lengths between two rests.
    it("a value with no slopes beside a fitted train: a small scale step passes, a snap to 10 times is a teleport", async () => {
      const train: Drawing[] = [[0, 0], ...[1, 2, 3, 4, 5, 6, 7, 8].map((k): Drawing => [500 + (k - 1) * (1000 / 12), 60 * k])];
      const small = await kindGate(writeSteppedBar(root, "scale-beside-train", { drawings: [[0, 1], [750, 1.25]], unit: "scale", x: train }));
      expect(small.failures).toEqual([]);
      const snap = await kindGate(writeSteppedBar(root, "snap-beside-train", { drawings: [[0, 1], [750, 10]], unit: "scale", x: train }));
      expect(failing(snap)).toEqual(["envelope"]);
      expect(snap.failures).toEqual(["envelope: y at 750 ms jumps 9 object lengths between two rests; that is a teleport"]);
    });

    // A stepped value whose page reports no objects has no length to be judged in; a record whose moves is a string
    // moves nothing, and the objects rule names it rather than the gate throwing.
    it("a stepped value that moves no object fails stepped; a malformed record fails objects", async () => {
      const none = await kindGate(writeSteppedBar(root, "record-none", { ...HONEST.twos24!, record: "none" }));
      expect(none.failures).toEqual(["stepped: y moves no object; a stepped value names its object in __state().objects"]);
      const bad = await kindGate(writeSteppedBar(root, "record-malformed", { ...HONEST.twos24!, record: "malformed" }));
      expect(bad.failures).toEqual(["stepped: y moves no object; a stepped value names its object in __state().objects", "objects: dot is not { box: [x, y, w, h], moves: [names] }"]);
    });

    // A decoy owner: the stepped y is listed under a small still box where nothing is drawn, and the dot it moves under
    // no value, so the stepped pop rule would measure y on a box that never moves.
    it("record-decoy: a stepped px value listed under a still box fails only objects", async () => {
      const v = await kindGate(writeSteppedBar(root, "record-decoy", { ...HONEST.twos24!, record: "decoy" }));
      expect(failing(v)).toEqual(["objects"]);
      expect(v.failures).toEqual(["objects: y changes but its object's box does not follow it"]);
    });

    // A move declared as a sprite index: y moves the dot 120 px (3 lengths) between two rests, but its unit says index,
    // which the stepped pop rule does not measure.
    it("record-index: a still-jump-still box whose only changing value is an index fails only objects", async () => {
      const v = await kindGate(writeSteppedBar(root, "record-index", { drawings: [[0, 0], [1000, -120]], periodMs: 2000, record: "index" }));
      expect(failing(v)).toEqual(["objects"]);
      expect(v.failures).toEqual(["objects: dot jumps 3 object lengths at 1000 ms with no value in its moves changing"]);
    });

    // A cause must explain the jump: the square b jumps 200 px sideways every second and holds, while its one value,
    // y2, which fits its centre y, bobs it smoothly up and down. Without y2's change (of02b) it has no cause at all.
    it("of02: a box spike that its one fitted value cannot explain fails only objects", async () => {
      const v = await kindGate(page("object2-review/of02-box-spike-no-cause/index.html"));
      expect(v.failures).toEqual(["objects: b jumps 6.67 object lengths at 1000 ms more than the values in its moves explain"]);
    });

    // Jumps between short holds: af05c, a dot that creeps 2 px a drawing on twos, holds 117 ms, snaps 0.9 of its
    // length and holds 117 ms again, fails as a spike against the creep past the holds; af05e, the same with a 2-length
    // snap, as a teleport between the holds; af07a, a 10-length pop 50 ms after load, as a teleport from the drawing
    // the page opens on.
    it.each([
      ["af05c-forged-holds-oneshot", "envelope: x at 1116.667 ms jumps 0.9 of its object's length in 1 drawing, 5.14 times the drawings around it; that is a pop"],
      ["af05e-forged-holds-2L", "envelope: x at 1116.667 ms jumps 2 object lengths between two rests; that is a teleport"],
      ["af07a-pop-at-load", "envelope: x at 50 ms jumps 10 object lengths between two rests; that is a teleport"],
    ])("%s fails only its pop", async (name, line) => {
      const v = await kindGate(page(`object2-review/${name}/index.html`));
      expect(v.failures).toEqual([line]);
    });

    it.each(Object.entries(OTHER_FAULTS).map(([slug, [, rule]]) => [slug, rule]))("%s fails %s", async (slug, rule) => {
      const v = await kindGate(writeSteppedBar(root, slug, OTHER_FAULTS[slug]![0]));
      expect(failing(v)).toEqual([rule]);
    });

    // A NaN or missing drawing around a 100 px rest-to-rest teleport: the values rule fails it (and the box shows the
    // teleport to the stepped pop rule).
    it.each(Object.keys(NOT_NUMBERS))("%s fails values", async (slug) => {
      const v = await kindGate(writeSteppedBar(root, slug, NOT_NUMBERS[slug]!));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^values: y is (NaN|missing) at 1000 ms; a value the page reports is a finite number in every frame once it appears$/)]));
    });

    it("a stepped name the page never reports fails", async () => {
      const v = await kindGate(writeSteppedBar(root, "unreported", { ...HONEST.twos24!, stepped: ["y", "z"] }));
      expect(v.failures).toEqual(["stepped: z is not a value the page reports"]);
    });
  });

  // Inside the input window a stepped value the input drives is held to the input in its own drawing steps (leads.ts):
  // follows on a live page, scroll on a scroll page. Each page here is a copied bar on the shared fixtures (input-pages.ts).
  // Every fault sits on a base whose honest twin passes in this block (the 40 px grid with a 40 px dot, the 48 px grid
  // with a 12 px handle, the 25 px flipbook with a 40 px bar), and fails only its own line, at the drawing it lands.
  describe("follows and scroll: stepped values the input drives (input-pages.ts)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-leads-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const verdicts = new Map<string, Promise<KindVerdict>>();
    const gate = (p: InputPage) => {
      const slug = inputSlug(p);
      if (!verdicts.has(slug)) verdicts.set(slug, kindGate(writeInputBar(root, p, slug)));
      return verdicts.get(slug)!;
    };
    /** A rule gap on a page: `it.fails` holds the verdict the page must get, and `it` pins what it gets today. */
    const ruleGap = (name: string, p: InputPage, must: string[], today: string[]) => {
      it.fails(`RULE GAP: ${name}`, async () => expect((await gate(p)).failures).toEqual(must));
      it(`RULE GAP: ${name}: today it gets ${today.length === 0 ? "no line" : today.join(" | ")}`, async () => expect((await gate(p)).failures).toEqual(today));
    };
    const AHEAD_OR_OFF = (rule: string, name: string) => new RegExp(`^${rule}: ${name} at [\\d.]+ ms (runs [\\d.]+ of its drawing steps ahead of the input|jumps [\\d.]+ of its drawing steps off the input in one drawing)$`);

    // Honest: the fault bases; a 12 px handle on a 48 px grid, where a grid cell is 4 handle lengths; a slider thumb
    // that rests 120 px right of the press and jumps to it (the press moves the anchor there, and the jump is not
    // judged; the jump goes against the drag, so without the new anchor the thumb would read as behind the hand, which
    // passes too: the page shows the press step is exempt, not that the anchor moves); a badge that hops on twos
    // when the dot is first grabbed, a stepped value that does not follow the hand (no gain), so the envelope rule's
    // stepped pop checks judge it inside the input window.
    it.each(([
      { kind: "live", stepPx: 40, sizePx: 40 },
      { kind: "live", stepPx: 48, sizePx: 12 },
      { kind: "live", stepPx: 40, sizePx: 40, variant: "thumb" },
      { kind: "live", stepPx: 40, sizePx: 40, variant: "badge" },
      { kind: "scroll", stepPx: 25, sizePx: 40 },
    ] satisfies InputPage[]).map((p) => [inputSlug(p), p] as const))("%s passes every rule", async (_, p) => {
      expect((await gate(p)).failures).toEqual([]);
    });

    it.each(([
      // A dot on a 20 px grid jumps 100 px ahead of the hand 300 ms into the drag and stays there: the jump is off.
      [{ kind: "live", stepPx: 20, sizePx: 40, fault: "jump-ahead" }, AHEAD_OR_OFF("follows", "x")],
      // A flipbook jumps 200 px ahead and stays there; glitch: it jumps 200 px ahead for one drawing and comes back.
      [{ kind: "scroll", stepPx: 25, sizePx: 40, fault: "jump-ahead" }, AHEAD_OR_OFF("scroll", "f")],
      [{ kind: "scroll", stepPx: 25, sizePx: 40, fault: "glitch" }, AHEAD_OR_OFF("scroll", "f")],
    ] satisfies [InputPage, RegExp][]).map(([p, line]) => [inputSlug(p), p, line] as const))("%s fails only its input line", async (_, p, line) => {
      expect((await gate(p)).failures).toEqual([expect.stringMatching(line)]);
    });

    it.each(([
      // The 3rd frame after the release draws the dot 100 px off its place: a glitch in the release settle.
      [{ kind: "live", stepPx: 40, sizePx: 40, fault: "settle-glitch" }, "follows: x at 916.667 ms jumps 3 of its drawing steps off the input in one drawing"],
      // The 12 px handle is drawn one 48 px cell further for one frame mid-drag: under the off bound, it is an excursion.
      [{ kind: "live", stepPx: 48, sizePx: 12, fault: "blip" }, "follows: x at 533.333 ms jumps 4 object lengths and back in one drawing; that is a teleport"],
      // The flipbook jumps 200 px once it has rested 200 ms at the far end of the scroll, and sits there until it moves.
      [{ kind: "scroll", stepPx: 25, sizePx: 40, fault: "far-jump" }, "scroll: f at 916.667 ms jumps 8 of its drawing steps off the input in one drawing"],
      // The flipbook skips 12 drawings ahead and stays that far ahead until the page scrolls back.
      [{ kind: "scroll", stepPx: 25, sizePx: 40, fault: "skip" }, "scroll: f at 416.667 ms jumps 13 of its drawing steps off the input in one drawing"],
      // The flipbook jumps 4 drawings back for one drawing.
      [{ kind: "scroll", stepPx: 25, sizePx: 40, fault: "glitch-back" }, "scroll: f at 416.667 ms jumps 3 of its drawing steps off the input in one drawing"],
      // The forward glitch, at the drawing it lands, in the value's drawing steps.
      [{ kind: "scroll", stepPx: 25, sizePx: 40, fault: "glitch" }, "scroll: f at 416.667 ms jumps 9 of its drawing steps off the input in one drawing"],
      // The badge, which follows no input, is drawn 3 of its lengths higher for one drawing: the envelope rule judges it
      // inside the input window, since the follows rule does not.
      [{ kind: "live", stepPx: 40, sizePx: 40, variant: "badge", fault: "badge-pop" }, "envelope: b at 300 ms jumps 6.08 of its object's length in 2 drawings, 37.68 times the drawings around it; that is a pop"],
    ] satisfies [InputPage, string][]).map(([p, line]) => [inputSlug(p), p, line] as const))("%s fails with only its line", async (_, p, line) => {
      expect((await gate(p)).failures).toEqual([line]);
    });

    // The dot is drawn 100 px further down than the hand from 300 ms into the drag, and stays: y's fit over the whole
    // drag no longer tracks the pointer (|r| 0.54 on y, under 0.9; the honest twin's is 0.94), so y has no gain and the
    // follows rule leaves it to the stepped pop checks, where its one 120 px step among 40 px steps is no pop.
    ruleGap("a minor-axis jump that stays fails follows", { kind: "live", stepPx: 40, sizePx: 40, fault: "minor-jump" }, [expect.stringMatching(AHEAD_OR_OFF("follows", "y"))] as unknown as string[], []);
    // A dot that chases the hand through its own spring (2 Hz, damping ratio 0.5), drawn on twos, passes follows. The
    // regrab rule fails it: on twos the frame before the press still shows the drawing before it, so the first drawing
    // after the press shows how far the dot went in between, read as a move while the pointer holds still.
    ruleGap("a springy follower on twos passes every rule", { kind: "live", stepPx: 0, twos: true, sizePx: 40, variant: "springy" }, [], [
      "regrab: the press at (867, 360), 83 ms after the release grabs nothing: x moves 4.17 of its 7.345 to rest while the pointer holds still",
    ]);
  });

  it.each(faults)("%s fails only %s", async (name, rule, line) => {
    const v = await kindGate(page(name));
    expect(v.status).toBe("failed");
    expect(failing(v)).toEqual([rule].flat());
    if (line) expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
  });

  // A page whose loop starts only when the tap lifts, with an input that ends at the lift, has no live frame yet when the
  // drive returns. Late in the page's life (the tap at 2 s, past the 1.5 s the quiet test waits for a first frame) the
  // live run used to read 0 frames and report the loop stopped before the gap. It waits for the first live frame.
  describe("realClockGap on a loop that starts at a tap's lift", () => {
    const tapAt = 120 * FRAME_MS;
    const input = { kind: "pointer" as const, samples: [[tapAt, 640, 360, 1], [tapAt + FRAME_MS, 640, 360, 0]] as [number, number, number, 0 | 1][] };
    const gapOf = async (name: string) => {
      const p = await openPage(page(name), { input: input.samples });
      try {
        return await realClockGap(p, { input });
      } finally {
        await p.close();
      }
    };

    it("puts the gap inside the caused motion, so a capped time step passes", async () => {
      expect(await gapOf("sim-tap-loop")).toEqual([]);
    });

    it("an uncapped time step fails there", async () => {
      expect(await gapOf("sim-tap-loop-no-cap")).toEqual(expect.arrayContaining([expect.stringMatching(/^realClockGap: [ab] moves [\d.]+ in the frame after the 2000 ms gap; its one-frame budget is [\d.]+$/)]));
    });
  });

  // A hand logged less often than once a frame (a pointer at 30 Hz) holds its place between samples, and a 1:1 follower
  // cannot move in a frame where the hand does not: follows counts the steps where the hand moves.
  describe("follows: a hand that moves less often than once a frame", () => {
    /** The synthetic drag with the hand's place held for `every` frames at a time (every 2 is a 30 Hz hand), or its first `frames` frames. */
    const heldHand = (every: number, frames = 36): [number, number, number][] =>
      (syntheticInput("live")!.samples as [number, number, number][]).slice(0, frames + 1).map(([t], k, all) => [t, all[Math.floor(k / every) * every]![1], all[Math.floor(k / every) * every]![2]]);
    const follows = async (name: string, samples: [number, number, number][]) => {
      const p = await openPage(page(name), { input: samples });
      try {
        return await liveRules.find((r) => r.name === "follows")!.check(p, { kind: "live", input: { kind: "pointer", samples }, cuts: [] });
      } finally {
        await p.close();
      }
    };

    it("a 1:1 follower passes under a 30 Hz hand", async () => {
      expect(await follows("live-good", heldHand(2))).toEqual([]);
    });

    it("a page that ignores every second move of a 30 Hz hand fails", async () => {
      expect(await follows("live-skip-moves", heldHand(2))).toEqual([expect.stringMatching(/^follows: the value that follows best, [xy], moves in only 50% of the drag's frames; a live page follows the input in 80% or more$/)]);
    });

    it("a page that follows 100 ms late fails a 12-frame flick", async () => {
      // A 12-frame flick: the 6 frames of lag are half of it.
      expect(await follows("live-lag", heldHand(2, 12))).toEqual([expect.stringMatching(/^follows: the value that follows best, [xy], moves in only \d+% of the drag's frames/)]);
    });

    // RULE GAP: follows counts the steps where a value moves, not when. On the gate's own 36-frame drag, 100 ms of lag is 6
    // frames, so the value still moves in 30 of 36 steps (83%, over the 80% share) and the page passes. it.fails flips
    // when a rule catches the lag on the full drag. The share stays at 0.8: it is not raised for one page.
    it.fails("RULE GAP: a page that follows 100 ms late fails the full drag", async () => {
      expect(await follows("live-lag", heldHand(1))).toEqual([expect.stringMatching(/^follows: /)]);
    });

    // A press held still never changes the hand's place, so no step holds a move of the hand. There is nothing to
    // follow, and every frame of the drag counts: a value that moves on its own under the held hand still passes.
    it("a page whose value moves under a press held still passes", async () => {
      expect(await follows("live-drift", heldHand(100, 12))).toEqual([]);
    });

    it("a page that does not move under a press held still fails as 'no value moves'", async () => {
      expect(await follows("live-good", heldHand(100, 12))).toEqual([expect.stringMatching(/^follows: no value moves while the pointer drags from \d+ to \d+ ms$/)]);
    });

    it("a page that follows no move still fails as pinned under a 30 Hz hand", async () => {
      expect(await follows("live-no-follow", heldHand(2))).toEqual([expect.stringMatching(/^follows: no value moves while the pointer drags from 250 to 850 ms$/)]);
    });
  });

  it("releaseSpeed: a hand that holds still before the release has no speed to keep", async () => {
    // The synthetic drag, then 2 frames where the hand creeps 0.1 px: the spring then pulls back from rest speed.
    const drag = syntheticInput("live")!.samples as [number, number, number][];
    const [t, x, y] = drag[drag.length - 1]!;
    const samples: [number, number, number][] = [...drag, [t + FRAME_MS, x + 0.1, y], [t + 2 * FRAME_MS, x + 0.2, y]];
    const input = { kind: "pointer" as const, samples };
    const releaseSpeed = liveRules.find((r) => r.name === "releaseSpeed")!;
    const p = await openPage(page("live-good"), { input: samples });
    try {
      expect(await releaseSpeed.check(p, { kind: "live", input, cuts: [] })).toEqual([]);
    } finally {
      await p.close();
    }
  });

  it("releaseSpeed: a creep above 5% of the drag's step is a hand still moving, so a zero-speed release still fails", async () => {
    // The synthetic drag moves x about 6 px a frame; 2 more frames of 1 px each are a slow hand, not a held one.
    const drag = syntheticInput("live")!.samples as [number, number, number][];
    const [t, x, y] = drag[drag.length - 1]!;
    const samples: [number, number, number][] = [...drag, [t + FRAME_MS, x + 1, y], [t + 2 * FRAME_MS, x + 2, y]];
    const releaseSpeed = liveRules.find((r) => r.name === "releaseSpeed")!;
    const p = await openPage(page("live-zero-release"), { input: samples });
    try {
      const out = await releaseSpeed.check(p, { kind: "live", input: { kind: "pointer", samples }, cuts: [] });
      expect(out).toEqual([expect.stringMatching(/^releaseSpeed: at release, x leaves at -?\d+% of its speed/)]);
    } finally {
      await p.close();
    }
  });

  it("releaseSpeed: a step with a cut in it does not set the hand's pace", async () => {
    // The synthetic drag with a 200 px jump in x at sample 10, then a 1 px creep for 2 frames, then a zero-speed release.
    // With the jump counted, the creep is under 5% of the peak and reads as a held hand; with the jump at a cut, it does not.
    const drag = (syntheticInput("live")!.samples as [number, number, number][]).map(([t, x, y], i): [number, number, number] => [t, i >= 10 ? x + 200 : x, y]);
    const [t, x, y] = drag[drag.length - 1]!;
    const samples: [number, number, number][] = [...drag, [t + FRAME_MS, x + 1, y], [t + 2 * FRAME_MS, x + 2, y]];
    const input = { kind: "pointer" as const, samples };
    const releaseSpeed = liveRules.find((r) => r.name === "releaseSpeed")!;
    const p = await openPage(page("live-zero-release"), { input: samples });
    try {
      expect(await releaseSpeed.check(p, { kind: "live", input, cuts: [] })).toEqual([]);
      expect(await releaseSpeed.check(p, { kind: "live", input, cuts: [drag[10]![0]] })).toEqual([expect.stringMatching(/^releaseSpeed: at release, x leaves at /)]);
    } finally {
      await p.close();
    }
  });

  it("follows, releaseSpeed and regrab judge the first press of a two-press input", async () => {
    // The synthetic drag, a lift, then a second short drag 650 ms later.
    const drag = syntheticInput("live")!.samples as [number, number, number][];
    const [t, x, y] = drag[drag.length - 1]!;
    const second = Array.from({ length: 12 }, (_, i): [number, number, number, 1] => [t + 650 + i * FRAME_MS, 640 + 8 * i, 360, 1]);
    const samples = [...drag.map(([a, b, c]): [number, number, number, 1] => [a, b, c, 1]), [t + 1, x, y, 0] as [number, number, number, 0], ...second];
    const input = { kind: "pointer" as const, samples };
    const p = await openPage(page("live-good"), { input: samples });
    try {
      for (const name of ["follows", "releaseSpeed", "regrab"]) {
        expect(await liveRules.find((r) => r.name === name)!.check(p, { kind: "live", input, cuts: [] }), name).toEqual([]);
      }
    } finally {
      await p.close();
    }
  });

  it("regrab: a page where no value tracks the pointer cannot be aimed, so the rule fails", async () => {
    const input = syntheticInput("live")!;
    const regrab = liveRules.find((r) => r.name === "regrab")!;
    const p = await openPage(page("live-no-follow"), { input: input.samples });
    try {
      expect(await regrab.check(p, { kind: "live", input, cuts: [] })).toEqual(["regrab: cannot aim a regrab: no value tracks the pointer"]);
    } finally {
      await p.close();
    }
  });

  describe("regrab: a drag that commits and leaves the screen (commit-pages.ts)", () => {
    // A swipe whose handle runs off at 1500 px/s and is gone by the release leaves nothing to settle and nothing to grab. The
    // sweep (live-sweep.test.ts) holds the rule across run-off speeds and lifts; these pin each fault once, through the
    // rule's own line.
    const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-commit-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const regrabOn = async (base: string, stopPx?: number, liftMs = 100) => {
      const samples = commitInput(1500, liftMs, stopPx);
      const p = await openPage(commitPage(root, base, 1500), { input: samples });
      const notes: string[] = [];
      try {
        const lines = await liveRules.find((r) => r.name === "regrab")!.check(p, { kind: "live", input: { kind: "pointer", samples }, cuts: [], notes });
        return { lines, notes };
      } finally {
        await p.close();
      }
    };
    const CANNOT = "regrab: x is at rest 83 ms after the release, so a regrab mid-settle cannot be checked";

    it.each(["live-commit", "live-commit-hidden"])("%s: a handle gone by the press, carried off by its value, passes with a note", async (base) => {
      const { lines, notes } = await regrabOn(base);
      expect(lines).toEqual([]);
      expect(notes).toEqual([expect.stringMatching(/^regrab: dot, moved by x, is gone 83 ms after the release \(it left at [\d.]+ ms, in a frame where x moved\), so there is no handle to regrab mid-settle$/)]);
    });

    it("a swipe let go while the handle still runs, which grabs nothing of it and goes for good, passes with a note", async () => {
      // The hand lifts 40 ms after the commit; the press, 83 ms later, finds the handle at 1500 px/s still on screen.
      const { lines, notes } = await regrabOn("live-commit", undefined, earlyLift(1500, 40));
      expect(lines).toEqual([]);
      expect(notes).toEqual([expect.stringMatching(/^regrab: dot, moved by x, is still running 83 ms after the release and goes at [\d.]+ ms \(in a frame where x moved\), so the press grabs nothing and there is no handle to regrab mid-settle$/)]);
    });

    it("a handle that blinks out at the release and is drawn again at rest still cannot be checked", async () => {
      expect((await regrabOn("live-commit-blink")).lines).toEqual([CANNOT]);
    });

    it("a handle that stops on screen, as one let go, and is let go early, still fails", async () => {
      // Its 120 px run takes 80 ms at 1500 px/s: the press, 83 ms after the release, finds it still running to its stop on screen.
      const { lines, notes } = await regrabOn("live-commit-stays", 320, earlyLift(1500, 0, 320));
      expect(lines).toEqual([expect.stringMatching(/^regrab: the press at \(-?\d+, -?\d+\), 83 ms after the release grabs nothing: x moves [\d.]+ of its [\d.]+ to rest while the pointer holds still$/)]);
      expect(notes).toEqual([]);
    });

    it("a handle that stops on screen, as one let go, still cannot be checked", async () => {
      expect((await regrabOn("live-commit-stays", 320)).lines).toEqual([CANNOT]);
    });

    it("a handle reported gone after its value stopped, with no move of its value, still cannot be checked", async () => {
      expect((await regrabOn("live-commit-vanish", 320)).lines).toEqual([CANNOT]);
    });

    it("a spring-back whose handle rests on screen still cannot be checked", async () => {
      expect((await regrabOn("live-commit-springback")).lines).toEqual([CANNOT]);
    });

    it("a commit whose page reports no objects still cannot be checked", async () => {
      expect((await regrabOn("live-commit-bare")).lines).toEqual([CANNOT]);
    });
  });

  it("fails a page with no marker, an unknown kind, or a kind with no kind gate yet", async () => {
    expect(await kindGate(page("no-marker"))).toMatchObject({
      status: "failed",
      failures: ['kind: the page has no marker; add <meta name="motion-kit-kind" content="<kind>"> (or motion-kit-bar on a copied bar)'],
    });
    expect((await kindGate(page("unknown-kind"))).failures).toEqual(["kind: spin is not a kind; the kinds are live, idle, scroll, choreo, sim, oneshot"]);
    const v = await kindGate(page("oneshot"));
    expect(v.status).toBe("failed");
    expect(v.failures).toEqual(["kind: oneshot has no kind gate in this version of motion-kit (only live, idle, scroll, choreo, sim do), so the page cannot pass"]);
  });

  it("reads a copied bar's main kind from its bar.json; a bar that is not in the kit gets the literal check", async () => {
    const v = await kindGate(page("bar-idle/index.html"));
    expect(v.kind).toBe("idle");
    expect(v.failures).toEqual(["audit: line 16: measuredFadeMs = 193 is a duration typed as a literal outside MOTION and KNOBS"]);
    expect(v.notes).toEqual(["note: the literal check runs: the page names bar bar-idle, and motion-kit has no bars/bar-idle/"]);
    expect((await kindGate(page("bar-missing/index.html"))).failures).toEqual([
      "kind: the page names bar bar-missing, but there is no bar.json next to it",
      "audit: line 15: measuredFadeMs = 193 is a duration typed as a literal outside MOTION and KNOBS",
    ]);
  });

  // A kit bar is needed here: the scroll base bar, whose MOTION holds lambda: 6.0. The case is skipped when that bar has
  // no folder.
  const SCROLL_SLUG = baseBar("scroll.smooth");
  const SCROLL_BAR = path.resolve(import.meta.dirname, "../../bars", SCROLL_SLUG ?? "");
  it.skipIf(SCROLL_SLUG === null || !existsSync(SCROLL_BAR))("skips the literal check only for the kit's own bar: an adapted copy with a changed MOTION gets it", async () => {
    const BAR = SCROLL_BAR;
    const html = readFileSync(path.join(BAR, "index.html"), "utf8");
    const adapted = html.replace("lambda: 6.0,", "lambda: 7.0,");
    expect(adapted).not.toBe(html);
    const copy = mkdtempSync(path.join(os.tmpdir(), "motion-kit-adapted-"));
    try {
      cpSync(BAR, copy, { recursive: true });
      writeFileSync(path.join(copy, "index.html"), adapted);
      const v = await kindGate(path.join(copy, "index.html"));
      expect(v.failures.filter((f) => f.startsWith("audit:"))).toEqual([
        expect.stringMatching(/^audit: line \d+: 48s is a duration typed as a literal outside MOTION and KNOBS$/),
        expect.stringMatching(/^audit: line \d+: 48s is a duration typed as a literal outside MOTION and KNOBS$/),
      ]);
      expect(v.notes).toEqual([`note: the literal check runs: the page's MOTION block differs from bars/${SCROLL_SLUG}/index.html, so the page is adapted, not a copy`]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it("a page with no clock hooks does not pass", async () => {
    const v = await kindGate(path.resolve(PAGES, "../no-hook.html"));
    expect(v.status).not.toBe("passed");
    expect(v.failures).toContain("noHook: the page has no window.__seek");
  });
});

describe.concurrent("drawn: a page's objects cover what changes on screen", () => {
  const STRAY = /^drawn: pixels change outside every object between [\d.]+ and [\d.]+ ms \(\d+ px\); the objects do not cover what the page draws$/;
  const GHOST = /^drawn: dot moves [\d.]+ px between [\d.]+ and [\d.]+ ms but nothing changes on screen there$/;
  const TIGHT = /^drawn: dot's box is bigger than what it draws between [\d.]+ and [\d.]+ ms$/;
  const CUT = /^drawn: the cut at 1000 ms changes [\d.]+% of the view; a cut is a scene change$/;
  const CUT_STRAY = /^drawn: the cut at 1000 ms changes [\d.]+% of the view, \d+ px of it outside every object; a cut that is not a scene change changes only what the objects cover$/;
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-drawn-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  /** drawnRead on a page opened as the kind gate opens it (its input, its span), with no cuts and nothing stepped unless given. */
  const read = async (name: string, kind: KindName, { pixelRatio = 1, stepped = [] as string[], cuts = [] as number[], file = page(name) } = {}) => {
    const { input, spanMs } = await pageInput(file);
    const p = await openPage(file, { ...(input ? { input: input.samples } : {}), stepped, pixelRatio });
    try {
      return { ...(await drawnRead(p, { kind, spanMs, cuts, stepped })), frames: await p.rawFrames(0, spanMs), view: await p.viewport() };
    } finally {
      await p.close();
    }
  };

  // drawn-honest: an anti-aliased dot with a soft shadow inside the default halo. drawn-ambient: a swaying gradient,
  // reported as an object that covers the viewport, behind an honest dot. Objects inside objects: drawn-blink, a lid
  // that closes over an eye inside a still head (every pixel it changes is in the head's and the eye's boxes too);
  // drawn-nod, a head that lifts with its eye inside it. The class pages (shadows, glows, fades) are in the style sweep.
  // drawn-cut-weak: a listed cut at 1 s where only the dot jumps 120 px: a small cut inside its own boxes.
  it.each(["drawn-honest", "drawn-ambient", "drawn-blink", "drawn-nod", "drawn-cut-weak/index.html"])("%s passes every rule", async (name) => {
    const v = await kindGate(page(name));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // drawn-lies: a smooth y and box, drawn as a teleport. drawn-ghost: a box that moves over a dot drawn still.
  // drawn-ambient-hides: a background that covers the viewport cannot cover a square that jumps outside every other
  // box, nor (drawn-ambient-diagonal) one that jumps across most of the viewport. drawn-slow-ghost: a box that drifts
  // 1.3 px a frame at most over a dot drawn still. drawn-box-off: a box reported 30 px off for one frame while the dot
  // rests, and drawn-gone-lie: one reported gone for a frame while the dot is still drawn (drawn-gone-lie-2: for two
  // frames, early in the rest after the settle). drawn-still-card: a card
  // whose value never changes covers nothing, so a square sliding inside it is outside every object.
  // drawn-track: a 600 by 40 box (a track) whose dot slides over its middle half only and teleports back.
  // drawn-fat-jump: an honest dot drawn 60 px ahead for one frame of each lift, its box grown 200 px on every side in
  // that frame only. drawn-cut-glitch: a bar whose listed cut at 1 s moves the dot 120 px and shows a square no object
  // reports beside it, while a slab slides out and back each loop. drawn-cut-unowned: the same cut with only that square
  // appearing, so no object changes there. drawn-cut-none: a listed cut where nothing changes.
  // drawn-parallax: a moon no object reports, moved by the scroll at half its speed, so it changes
  // only across a scroll. On a flat background, where a pixel matches itself across a scroll: sf10, a fixed flipbook
  // whose box steps with the scroll over a dot drawn still; sf11, a card whose box moves at 0.6 times the scroll while
  // the card stays where the document carries it. Inside a mover's boxes a change in the document's frame alone
  // counts, so neither may show a change where its box went. Tightness is measured on what is drawn: cf30, a 40 px dot
  // reported as a 64 px box that claims a 16 px halo with nothing drawn in it, fails, since a halo adds no slack
  // inside the box; cf40, a bar half off the top whose box reaches 20 px below its ink, fails on the edge the viewport
  // leaves on screen.
  it.each([
    ["drawn-lies", STRAY],
    ["drawn-ghost", GHOST],
    ["drawn-ambient-hides", STRAY],
    ["drawn-ambient-diagonal", STRAY],
    ["drawn-slow-ghost", GHOST],
    ["drawn-box-off", GHOST],
    ["drawn-gone-lie", GHOST],
    ["drawn-gone-lie-2", GHOST],
    ["drawn-still-card", STRAY],
    ["drawn-track", TIGHT],
    ["drawn-fat-jump", TIGHT],
    ["drawn-cut-glitch/index.html", CUT_STRAY],
    ["drawn-cut-unowned/index.html", CUT_STRAY],
    ["drawn-cut-none/index.html", CUT],
    ["drawn-parallax", STRAY],
    ["object2-review/sf10-flipbook-ghost-flat/index.html", GHOST],
    ["object2-review/sf11-parallax-ghost-flat/index.html", /^drawn: k1 moves [\d.]+ px between [\d.]+ and [\d.]+ ms but nothing changes on screen there$/],
    ["object2-review/cf30-inflated-with-halo/index.html", TIGHT],
    ["object2-review/cf40-bar-half-off-top-box-too-tall/index.html", /^drawn: bar's box is bigger than what it draws between [\d.]+ and [\d.]+ ms$/],
  ] as const)("%s fails only drawn", async (name, line) => {
    const v = await kindGate(page(name));
    expect(v.status).toBe("failed");
    expect(failing(v)).toEqual(["drawn"]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
  });

  // The slow ghost never moves more than 2 px in one frame: it is caught on a pair stretched to the first frame where
  // its box has moved more.
  it("drawn-slow-ghost is caught on a pair that spans more than one frame", async () => {
    const r = await read("drawn-slow-ghost", "idle");
    const slow = r.pairs.filter((q) => q.event === "slow dot");
    expect(slow).toHaveLength(1);
    expect(slow[0]!.b - slow[0]!.a).toBeGreaterThan(FRAME_MS + 1e-6);
    const [, a, b] = r.lines[0]!.match(/between ([\d.]+) and ([\d.]+) ms/)!;
    expect(Number(b) - Number(a)).toBeGreaterThan(FRAME_MS + 1e-6);
  });

  // The gone lies start in the fixture's second loop (1.6 s), with the record moving less than 30 frames before and
  // after them. A gone gap shorter than HOLD_MS takes no fade reference wherever it sits, so each is caught there, not
  // only where the walk back to a reference meets the start of the frames read.
  it.each(["drawn-gone-lie", "drawn-gone-lie-2"])("%s is caught in its second loop", async (name) => {
    const r = await read(name, "idle");
    const line = r.lines.find((l) => GHOST.test(l));
    expect(line).toBeDefined();
    expect(Number(line!.match(/between ([\d.]+) and/)![1])).toBeGreaterThanOrEqual(1600);
  });

  // drawn-vanish-unread: drawn-vanish with a box of NaN in the third frame of each 31-frame gone gap. That frame cannot
  // be read, so the walk passes over it: the gap is still long and keeps its fade reference, and the fade's all but
  // invisible last step passes. The objects rule is what fails the page.
  it("drawn-vanish-unread: a frame that cannot be read inside a long gone gap does not end it", async () => {
    const r = await read("drawn-vanish-unread", "idle");
    expect(r.pairs.some((q) => q.event === "gone dot")).toBe(true);
    expect(r.lines).toEqual([]);
    const v = await kindGate(page("drawn-vanish-unread"));
    expect(failing(v)).toContain("objects");
    expect(failing(v)).not.toContain("drawn");
  });

  // A stepped page (twos at 24, about 40 drawing boundaries in the span): its pairs hold its largest drawing boundaries,
  // up to 16, and at least 8 pairs spread evenly, 24 at most.
  it("a stepped page's pairs hold its largest drawing boundaries and 8 even pairs, 24 at most", async () => {
    const file = writeSteppedBar(root, "twos24", HONEST.twos24!);
    const r = await read("twos24", "idle", { file, stepped: ["y"] });
    expect(r.lines).toEqual([]);
    expect(r.pairs.length).toBeLessThanOrEqual(DRAWN_SAMPLES);
    expect(r.pairs.filter((q) => q.event === null).length).toBeGreaterThanOrEqual(DRAWN_EVEN);
    const ds = drawingsOf(r.frames, "y", "dot", stillTol(series(r.frames, "y")), r.view, false);
    const move = (a: number[], b: number[]) => Math.max(Math.hypot(a[0]! + a[2]! / 2 - b[0]! - b[2]! / 2, a[1]! + a[3]! / 2 - b[1]! - b[3]! / 2), Math.abs(a[2]! - b[2]!), Math.abs(a[3]! - b[3]!));
    const boundaries = ds.slice(1).map((d, j) => ({ ms: r.frames[d.start - 1]!.ms, px: move(ds[j]!.endBox!, d.box!) }));
    expect(boundaries.length).toBeGreaterThan(DRAWN_BOUNDARIES);
    const chosen = new Set(r.pairs.filter((q) => q.event === "drawing y").map((q) => q.a));
    const others = r.pairs.filter((q) => q.event !== null && q.event !== "drawing y").length;
    expect(chosen.size).toBe(Math.min(DRAWN_BOUNDARIES, DRAWN_SAMPLES - DRAWN_EVEN - others));
    const least = Math.min(...boundaries.filter((b) => chosen.has(b.ms)).map((b) => b.px));
    expect(boundaries.filter((b) => !chosen.has(b.ms)).every((b) => b.px <= least + 1e-9)).toBe(true);
  });

  it("a page with no objects is not read", async () => {
    const r = await read("idle-good", "idle");
    expect({ lines: r.lines, pairs: r.pairs, notes: r.notes }).toEqual({ lines: [], pairs: [], notes: [] });
  });

  // An arm that swings changes only part of its body's box, which holds the body and the arm. The arm's pixels stay
  // more than the halo plus a quarter of the box's shorter side from the body's far edge, so the tightness test fails
  // the box in its first jump pair (a pinned verdict: the honest way is an object for the arm).
  it("drawn-arm: an arm that changes part of its body's box fails tightness", async () => {
    const v = await kindGate(page("drawn-arm"));
    expect(v.failures).toEqual(["drawn: body's box is bigger than what it draws between 666.667 and 683.333 ms"]);
  });

  // drawn-twinkle-lies: the drawn-lies teleport over lights that twinkle everywhere. Every pair has three clusters or more,
  // so the dot is never judged: a note, and no line.
  it("drawn-twinkle-lies: a lie over a background that changes in many patches is a note, not a line", async () => {
    const r = await read("drawn-twinkle-lies", "idle");
    expect(r.lines).toEqual([]);
    expect(r.notes).toEqual(["drawn: dot could not be judged: the background changes around it in every sampled pair"]);
    const v = await kindGate(page("drawn-twinkle-lies"));
    expect(v.failures).toEqual([]);
    expect(v.notes).toContain("drawn: dot could not be judged: the background changes around it in every sampled pair");
  });

  // Each cut's pair is the frame at or before it and the next. drawn-cut: its scene turns dark there, so it passes.
  // drawn-cut-early: its scene turns dark at the cut itself, so the frame at or before the cut already shows the new
  // scene and the cut's pair changes little. The cut is judged by the larger change of the step into that frame and
  // the step out of it, and neither step is judged for stray pixels, so it passes too.
  it.each([["drawn-cut/index.html"], ["drawn-cut-early/index.html"]])("%s: a cut's pair is the frame at or before it and the next frame", async (name) => {
    const file = page(name);
    const { input, spanMs } = await pageInput(file);
    const p = await openPage(file, { ...(input ? { input: input.samples } : {}) });
    try {
      const r = await drawnRead(p, { kind: "idle", spanMs, cuts: [1000, 1010], stepped: [] });
      expect(r.pairs.filter((q) => q.event === "cut").map((q) => [q.a, q.b])).toEqual([[60 * FRAME_MS, 61 * FRAME_MS]]);
      expect(r.lines).toEqual([]);
    } finally {
      await p.close();
    }
  });

  // Boxes are CSS px: at 2 device px per CSS px every honest page still passes, and the lie still fails. A bar is read
  // with the cuts its trace.json lists.
  const HONEST_DRAWN: [string, KindName, number[]?][] = [
    ...["drawn-honest", "drawn-ambient", "drawn-blink", "drawn-nod", "drawn-shadow-14", "drawn-shadow-32", "drawn-shadow-48", "drawn-glow", "drawn-blur", "drawn-text", "drawn-badge", "drawn-cursor", "drawn-fade", "drawn-faint", "drawn-confetti", "drawn-vanish", "drawn-sweep", "drawn-aurora", "drawn-twinkle", "drawn-particles", "drawn-stripes"].map((n): [string, KindName] => [n, "idle"]),
    ["drawn-live", "live"],
    ["drawn-choreo", "choreo"],
    ["drawn-scroll", "scroll"],
    ["drawn-sticky", "scroll"],
    ["drawn-doc-card", "scroll"],
    ["drawn-cut/index.html", "idle", [1000]],
    ["drawn-cut-early/index.html", "idle", [1000]],
    ["drawn-cut-weak/index.html", "idle", [1000]],
  ];
  it.each(HONEST_DRAWN)("%s passes at pixelRatio 2", async (name, kind, cuts = []) => {
    expect((await read(name, kind, { pixelRatio: 2, cuts })).lines).toEqual([]);
  });
  it("drawn-lies fails at pixelRatio 2", async () => {
    const p = await openPage(page("drawn-lies"), { pixelRatio: 2 });
    try {
      expect(await drawn(p, { kind: "idle", spanMs: SPAN_MS, cuts: [] })).toEqual(expect.arrayContaining([expect.stringMatching(STRAY)]));
    } finally {
      await p.close();
    }
  });

  // drawn-scroll scrolls the document under ?seek, so its striped page moves with every scroll tick. Pairs may span a
  // scroll: every scroll tick is an event pair, compared in both frames of reference, and the flipbook bar, drawn
  // where it is reported, passes. drawn-sticky adds a sticky header that holds still over the scrolling page;
  // drawn-doc-card an in-flow card (moves: []) that the document carries into view, which neither moves nor comes back
  // across a scroll.
  it.each(["drawn-scroll", "drawn-sticky", "drawn-doc-card"])("%s: pairs span its scrolls, and it passes", async (name) => {
    const { input, spanMs } = await pageInput(page(name));
    const p = await openPage(page(name), { input: input!.samples });
    try {
      const scrollAt = async (ms: number) => {
        await p.seek(ms);
        return p.page.evaluate(() => window.scrollY);
      };
      const samples = input!.samples as [number, number][];
      const deepest = samples.reduce((a, b) => (b[1] > a[1] ? b : a));
      expect(await scrollAt(0)).toBe(0);
      expect(await scrollAt(deepest[0])).toBe(deepest[1]);
      const read = await drawnRead(p, { kind: "scroll", spanMs, cuts: [], stepped: [] });
      expect(read.lines).toEqual([]);
      expect(read.pairs).toHaveLength(DRAWN_SAMPLES);
      // One pair for each scroll tick in the span. The page opens at the top, so the first sample is a tick too.
      const ticks = samples.filter(([ms, y], i) => y !== (i > 0 ? samples[i - 1]![1] : 0) && ms <= spanMs).length;
      expect(read.pairs.filter((q) => q.event === "scroll")).toHaveLength(ticks);
      expect(read.pairs.some((q) => q.moved.includes("bar"))).toBe(true);
      expect(read.pairs.every((q) => !q.moved.includes("card") && q.event !== "back card" && q.event !== "gone card")).toBe(true);
    } finally {
      await p.close();
    }
    const v = await kindGate(page(name));
    expect(v.failures).toEqual([]);
  });

  it("the flipbook bar passes the whole gate", async () => {
    const flipbook = await kindGate(page("bar-scroll-flipbook/index.html"));
    expect(flipbook.failures).toEqual([]);
  });
});

// `motion-kit gate` closes the shared browser when it ends, as the command should, so it runs alone too.
describe("motion-kit gate", { concurrent: false }, () => {
  function io() {
    const out: string[] = [];
    const err: string[] = [];
    const api: CliIo = {
      cwd: PAGES,
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined),
      write: () => undefined,
    };
    return { api, out, err };
  }

  it("exits 0 and prints passed for a good page, with the distance lines as information", async () => {
    const t = io();
    expect(await run(["gate", "idle-good.html"], t.api)).toBe(0);
    expect(t.out.join("")).toBe(`idle.period 1.6 s, 60% below base ${base("idle.period", "4.0 s")}\npassed\n`);
    expect(t.err.join("")).toBe("");
  });

  it("exits 1 and prints failed: n for a fault page", async () => {
    const t = io();
    expect(await run(["gate", "scroll-one-way.html"], t.api)).toBe(1);
    expect(t.out.join("")).toMatch(/(^|\n)failed: 1\n$/);
    expect(t.err.join("")).toMatch(/^reverses: p moves /);
  });
});

describe.concurrent("the kind gate on pages that once got a wrong verdict", () => {
  // A CSS error shake that grows (-1, 2, -4, 4 px) and comes home is one move, judged as pulses. A value named
  // constructor is a value like any other. A slide cut on action 3 frames after it starts is cut off, so its
  // ease-in is no pop.
  it.each(["class-review/a9-ret-css-shake-linear", "class-review/j1-crash-name-constructor", "class-review/d1-cut-on-action-3f/index.html"])("%s passes every rule", async (name) => {
    const v = await kindGate(page(name));
    expect(v.failures).toEqual([]);
  });

  // A settle that sits 80 ms, then drifts home slowly, stopped there. A spring that sits 80 ms at its rest
  // before going home ends its move there. A still value NaN for one frame 8 s in. A fade with a late rise,
  // played three times, is no designed loop. A cut listed mid-move hides no pop after it. A trace with no cuts
  // does not cap the read. One wild frame at a cut sets no still tolerance.
  it.each([
    ["class-review/a1b-ret-sit80-linear-back", ["overshoot"]],
    ["class-review/a3-ret-wobble-home", ["overshoot"]],
    ["class-review/e2-span-nan-still", ["values"]],
    ["class-review/h3b-op-fade-late-bump-3x", ["envelope", "overshoot"]],
    ["class-review/d4-cut-hides-later-pop/index.html", ["envelope", "suddenJumps"]],
    ["class-review/d6-short-trace-latepop/index.html", ["envelope", "suddenJumps"]],
    ["class-review/d8-wild-frame-at-cut/index.html", ["envelope", "suddenJumps"]],
  ] as const)("%s fails %s", async (name, rules) => {
    const v = await kindGate(page(name));
    expect(failing(v)).toEqual([...rules]);
  });
});

describe.concurrent("a move that comes back to its start is read between its frames, not against its swing", () => {
  // A bob 0, -3, +3, 0 px over 350 ms: the frame through the crossing covers more than half of 3 px, the farthest the
  // value goes from its start, but under half of its 6 px swing. A bob is no pop.
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-bob-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const POP = /^envelope: b1 at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/;
  const JUMP = /^suddenJumps: b1 moves -?[\d.]+ in the frame after [\d.]+ ms, and -?[\d.]+ in its first half; no cut marks it$/;

  it.each(["choreo", "sim"] as const)("%s: a 3 px bob over 350 ms and an 8 px shake over 250 ms pass every rule", async (kind) => {
    for (const bob of [{ px: 3, ms: 350 }, { px: 8, ms: 250, first: 1 as const }]) {
      const v = await kindGate(bobPage(root, kind, kind === "sim" ? { ...bob, ease: "sine" } : bob));
      expect(v.failures).toEqual([]);
      expect(v.status).toBe("passed");
    }
  });

  // The planted faults: a bob with one frame of its swing replaced by a 4 px jump, a value set in one frame, and a move
  // that starts with a 10% dip and goes 55% of the way in one frame. A move that comes home has no pop share: its jump
  // is read between its frames. The set value and the dip move end away from their start, so the envelope reads their
  // pop against their whole change.
  it.each([
    ["set", /^envelope: b1 at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["dip", /^envelope: b1 at [\d.]+ ms covers (5\d|6\d)% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
  ])("choreo: the %s fault fails envelope", async (fault, line) => {
    const v = await kindGate(bobPage(root, "choreo", {}, fault));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
    expect(failing(v)).toContain("envelope");
  });

  it("choreo: the jump fault fails suddenJumps, and the envelope has no pop to read in it", async () => {
    const v = await kindGate(bobPage(root, "choreo", {}, "jump"));
    expect(v.failures).toEqual([expect.stringMatching(JUMP)]);
  });

  it("sim: the jump fault fails suddenJumps", async () => {
    const v = await kindGate(bobPage(root, "sim", { ease: "sine" }, "jump"));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(JUMP)]));
    expect(v.failures.some((f) => POP.test(f))).toBe(false);
  });
});

describe.concurrent("the kind gate reads motion between frames on every page (suddenJumps)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-jumps-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const lineOf = (name: string) => new RegExp(`^suddenJumps: ${name} moves -?[\\d.]+ in the frame after [\\d.]+ ms, and -?[\\d.]+ in its first half; no cut marks it$`);
  const SHAKE = [0, -10, 10, -10, 10, 0];
  const FIFTHS = [0, 0.2, 0.4, 0.6, 0.8, 1];

  // A shake of 10 px either way (a swing of 20 px) with one frame of it replaced by a snap of 37% to 50% of the swing:
  // the snap from an extreme to home, so the frame through it is under half the swing and the envelope reads no pop.
  // Four bars start 70 ms apart, so the snap lands at four phases of a frame; each bar's line names it.
  describe("a snap of 37% to 50% of a shake's swing, at four phases of a frame, fails suddenJumps and nothing else", () => {
    const faults: [string, Keyframes][] = [
      ["an end snap from an extreme (50%)", kf(400, [0, 0.2, 0.4, 0.6, 0.8, 1, 1], [0, -10, 10, -10, 10, 10, 0], "easeInOut")],
      ["an end snap from a lesser extreme (37%)", kf(400, [0, 0.2, 0.4, 0.6, 0.8, 1, 1], [0, -10, 10, -10, 7.4, 7.4, 0], "easeInOut")],
      ["a restart from an extreme (50%)", kf(600, [0, 0.15, 0.3, 0.3, 0.5, 0.7, 1], [0, -10, 10, 0, -10, 10, 0], "easeInOut")],
      ["a flicker home for one frame (50%)", kf(600, [0, 0.25, 0.5, 0.5, 0.5278, 0.5278, 0.75, 1], [0, -10, 10, 0, 0, 10, -10, 0], "easeInOut")],
      ["a teleport across home (50%)", kf(400, [0, 0.25, 0.5, 0.5, 0.75, 1], [0, -10, -5, 5, 10, 0], "easeInOut")],
    ];
    it.each(faults)("%s", async (name, model) => {
      const v = await kindGate(keyframePage(root, name.replace(/\W+/g, "-"), phases(model)));
      expect(failing(v)).toEqual(["suddenJumps"]);
      expect(v.failures).toEqual([0, 1, 2, 3].map((k) => expect.stringMatching(lineOf(`p${k}`))));
    });
  });

  // A flick: 40 px out and back on 20 ms legs, so each leg is one to two frames, a snap that comes home. A move that comes
  // home has no pop share while it swings, but a chain whose every leg is two frames or less is a flick, and the envelope
  // judges its frames against its whole change. A smooth leg that short is no cusp, so an eased leg that also stands out
  // from the steps beside it fails suddenJumps as well; a linear leg, or an ease that starts or ends gently, does not.
  describe("a flick of 40 px on 20 ms legs, with or without a hold between them, fails the pop test at every phase", () => {
    const POP_LINE = /^envelope: p[0-3] at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/;
    const flicks: [string, Keyframes, string[]][] = [
      ["linear legs with an 80 ms hold between them", kf(120, [0, 1 / 6, 5 / 6, 1], [0, 40, 40, 0], "linear"), ["envelope"]],
      ["easeOut out and easeIn back with an 80 ms hold", kf(120, [0, 1 / 6, 5 / 6, 1], [0, 40, 40, 0], ["easeOut", "linear", "easeIn"]), ["envelope"]],
      ["easeIn out and easeOut back with an 80 ms hold", kf(120, [0, 1 / 6, 5 / 6, 1], [0, 40, 40, 0], ["easeIn", "linear", "easeOut"]), ["envelope"]],
      ["easeOut out and easeIn back with no hold", kf(40, [0, 0.5, 1], [0, 40, 0], ["easeOut", "easeIn"]), ["envelope"]],
      ["easeInOut legs with an 80 ms hold between them", kf(120, [0, 1 / 6, 5 / 6, 1], [0, 40, 40, 0], "easeInOut"), ["envelope", "suddenJumps"]],
      ["easeInOut legs with no hold between them", kf(40, [0, 0.5, 1], [0, 40, 0], "easeInOut"), ["envelope", "suddenJumps"]],
    ];
    it.each(flicks)("%s", async (name, model, rules) => {
      const v = await kindGate(keyframePage(root, name.replace(/\W+/g, "-"), phases(model)));
      expect(failing(v)).toEqual(rules);
      expect(v.failures.filter((f) => f.startsWith("envelope:")).length).toBeGreaterThanOrEqual(1);
      for (const f of v.failures.filter((f) => f.startsWith("envelope:"))) expect(f).toMatch(POP_LINE);
      if (rules.includes("suddenJumps")) expect(v.failures.filter((f) => f.startsWith("suddenJumps:"))).toEqual([0, 1, 2, 3].map((k) => expect.stringMatching(lineOf(`p${k}`))));
    });

    // The same flick as a loop on an idle page: the idle rules have no pulse attack to bound it either.
    it("the same flick as an idle loop fails suddenJumps", async () => {
      const body = "const ease = (u) => u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u); function values(ms) { const c = ms % 600; return { y: c < 20 ? 40 * ease(c / 20) : c < 100 ? 40 : c < 120 ? 40 * (1 - ease((c - 100) / 20)) : 0 }; }";
      const v = await kindGate(writeJumpPage(root, "flick-loop", { body, units: { y: "px" } }));
      expect(failing(v)).toContain("suddenJumps");
    });
  });

  // The honest shake with the same four phases passes: the leg through the crossing is part of a swing that goes both ways.
  it("the same shake, with no snap, passes every rule", async () => {
    const v = await kindGate(keyframePage(root, "shake-honest", phases(kf(400, FIFTHS, SHAKE, "easeInOut"))));
    expect(v.failures).toEqual([]);
  });

  // A snap in a long move hides under the 5% share of its range; it stands out from the steps beside it.
  it("a jump of 3% of a long move's range fails, in a value the page reports in px", async () => {
    const body = "function values(ms) { return { x: -1600 + tween(ms, 300, 600, 1600, outCubic) + (ms >= 1800.4 ? 60 : 0) }; }";
    const v = await kindGate(writeJumpPage(root, "layout-pop", { body, units: { x: "px" } }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(lineOf("x"))]));
  });

  // A NaN frame is for `values`: suddenJumps leaves the value out, so the cause is reported once.
  it("a NaN frame is reported by values alone", async () => {
    const v = await kindGate(page("idle-value-nan"));
    expect(failing(v)).toEqual(["values"]);
  });

  // A loop's seam: a sawtooth that restarts every cycle snaps from its crest to its start, in one frame. This page is not
  // sorted as a designed loop, so it also fails the rules a value that never rests fails; the jump is what it plants.
  describe("a loop that snaps", () => {
    const SLIDE = "function valuesAfter(d) { if (d === null) return { y: 0 }; const M = MOTION; if (d < M.upS) { const p = d / M.upS; return { y: M.slidePx * (1 - (1 - p) ** 3) }; } ";
    it("a bob that slides in and then restarts every cycle (a sawtooth) fails suddenJumps", async () => {
      const valuesAfter = `${SLIDE}const u = ((d - M.upS) / M.periodS) % 1; return { y: M.slidePx - M.bobPx * u }; }`;
      const v = await kindGate(tapLoopPage(root, "sawtooth-bob", { restart: false, motion: { upS: 0.5, slidePx: 200, bobPx: 8, periodS: 1.2, reducedAtS: 0.5 }, units: { y: "px" }, valuesAfter }));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(lineOf("y"))]));
    });

    it("the same bob on a sine, which comes back smoothly, passes", async () => {
      const valuesAfter = `${SLIDE}return { y: M.slidePx - M.bobPx * (1 - Math.cos(2 * Math.PI * (d - M.upS) / M.periodS)) / 2 }; }`;
      const v = await kindGate(tapLoopPage(root, "sine-bob", { restart: false, motion: { upS: 0.5, slidePx: 200, bobPx: 8, periodS: 1.2, reducedAtS: 0.5 }, units: { y: "px" }, valuesAfter }));
      expect(v.failures).toEqual([]);
    });

    it("a breath whose scale restarts after its lead-in every cycle fails suddenJumps", async () => {
      const valuesAfter = "function valuesAfter(d) { if (d === null) return { s: 1 }; const M = MOTION; if (d < M.upS) { const p = d / M.upS; return { s: 1 + (M.peak - 1) * (1 - (1 - p) ** 3) }; } const u = ((d - M.upS) / M.periodS) % 1; return { s: M.peak + M.amp * u }; }";
      const v = await kindGate(tapLoopPage(root, "sawtooth-breath", { restart: false, motion: { upS: 0.4, peak: 1.2, amp: 0.05, periodS: 1.5, reducedAtS: 0.4 }, units: { s: "scale" }, valuesAfter }));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(lineOf("s"))]));
    });

    // A second tap that restarts a loop's lead-in or phase snaps it in one frame. The interrupt rule plays that tap.
    const BOB = { restart: true, motion: { reducedAtS: 0 }, units: { v: "px" }, valuesAfter: "function valuesAfter(d) { return d === null ? { v: 0 } : { v: -20 * Math.sin(2 * Math.PI * d / 1) }; }" };
    const BREATH = { restart: true, motion: { upS: 0.4, peak: 1.2, amp: 0.03, periodS: 2.4, reducedAtS: 0.4 }, units: { s: "scale" }, valuesAfter: "function valuesAfter(d) { if (d === null) return { s: 1 }; const M = MOTION; if (d < M.upS) { const p = d / M.upS; return { s: 1 + (M.peak - 1) * (1 - (1 - p) ** 3) }; } return { s: M.peak + M.amp * Math.sin(2 * Math.PI * (d - M.upS) / M.periodS) }; }" };
    it.each([["a bob that restarts its phase", BOB, "v"], ["a breath that restarts its lead-in", BREATH, "s"]] as const)("%s on a second tap fails interrupt", async (name, spec, value) => {
      const v = await kindGate(tapLoopPage(root, name.replace(/\W+/g, "-"), spec));
      expect(failing(v)).toEqual(["interrupt"]);
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^interrupt: ${value} jumps [\\d.]+ in one frame after the second trigger at [\\d.]+ ms; its largest frame step without it is [\\d.]+$`))]));
    });

    it.each([["a bob that keeps its phase", { ...BOB, restart: false }], ["a breath that keeps its lead-in", { ...BREATH, restart: false }]] as const)("%s on a second tap passes", async (name, spec) => {
      const v = await kindGate(tapLoopPage(root, name.replace(/\W+/g, "-"), spec));
      expect(v.failures).toEqual([]);
    });
  });
});

describe.concurrent("a control that acts out its meaning with a keyframe tween (trace.json tweens)", () => {
  // A sim page: ball A drops and bounces to rest, and a tile bobs 0, -a, +a, 0 px beside it on a CSS ease keyframe tween
  // whose turns sit at a third and two thirds (sim.js, "tween" knobs). Each ease leg ends at zero speed and the next
  // starts at 0.4 of its mean speed, so the tile "leaves its turn faster than it arrived", as a bounce that rises does.
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-tween-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const BOB = { px: 6, ms: 350, ease: "ease", legs: "thirds" } as const;
  const RISES = /^energyFalls: t leaves its turn at [\d.]+ ms at [\d.]+ a frame, faster than it arrived \([\d.]+\); a bounce never rises$/;

  it("unnamed, the tween fails energyFalls and nothing else; named in tweens, the page passes every rule", async () => {
    const unnamed = await kindGate(tweenPage(root, BOB));
    expect(unnamed.failures).toEqual([expect.stringMatching(RISES)]);
    const named = await kindGate(tweenPage(root, BOB, "", ["t"]));
    expect(named.failures).toEqual([]);
    expect(named.status).toBe("passed");
  });

  // The guard: each name is a value the page reports, it changes, and after each cause it ends where it was just before
  // that cause and holds there. A body that is thrown and lands elsewhere cannot be named.
  it("a name the page does not report fails tweens", async () => {
    const v = await kindGate(tweenPage(root, BOB, "", ["t", "zz"]));
    expect(v.failures).toEqual(["tweens: zz is not a value the page reports"]);
  });

  it("a named value that never changes fails tweens", async () => {
    const v = await kindGate(tweenPage(root, { ...BOB, px: 0 }, "", ["t"]));
    expect(v.failures).toEqual(["tweens: t never changes"]);
  });

  it.each(["tween-away", "tween-throw"])("%s: a named tween that ends away from its start fails the guard", async (fault) => {
    const v = await kindGate(tweenPage(root, BOB, fault, ["t"]));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^tweens: t ends at -?[\d.]+ after the cause at [\d.]+ ms, not at 0 where it was just before it; a tween comes back to where it started and holds there$/)]));
    expect(failing(v)).toContain("tweens");
  });

  it("a thrown body that lands elsewhere cannot be named: ball A, dropped from 200 px, rests at 0", async () => {
    const v = await kindGate(tweenPage(root, BOB, "", ["t", "a"]));
    expect(v.failures).toEqual([expect.stringMatching(/^tweens: a ends at 0 after the cause at [\d.]+ ms, not at 200 where it was just before it; a tween comes back to where it started and holds there$/)]);
  });

  it("a named tween still moving where the frames end (a 30 s tween, read for 15 s past the tap) fails the guard", async () => {
    const v = await kindGate(tweenPage(root, { ...BOB, ms: 30000, ease: "linear" }, "", ["t"]));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^tweens: t still moves at the end of the frames after the cause at [\d.]+ ms; a tween comes back to where it started and holds there$/)]));
  });

  // Naming a value hides it from energyFalls only. Every other rule still reads it.
  it("a body with a rising bounce still fails energyFalls while another value is named", async () => {
    const v = await kindGate(tweenPage(root, BOB, "bounce-rises", ["t"]));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^energyFalls: a leaves its turn at [\d.]+ ms at [\d.]+ a frame, faster than it arrived \([\d.]+\); a bounce never rises$/)]));
    expect(v.failures.some((f) => f.startsWith("energyFalls: t "))).toBe(false);
  });

  it("tween-grows: a named tween whose second swing goes twice as far as its first fails the guard", async () => {
    const v = await kindGate(tweenPage(root, BOB, "tween-grows", ["t"]));
    expect(v.failures).toEqual([expect.stringMatching(/^tweens: t swings further from home at [\d.]+ ms \(12 after 6\); a tween's swings never grow$/)]);
  });

  // Naming a tween turns energyFalls off for it, so a pop is read by the rules that remain: it comes home, so
  // suddenJumps reads it between its frames. A snap from the far turn to home at the end is half its swing.
  it.each(["tween-pop", "tween-snap"])("a named tween with the %s fault still fails suddenJumps", async (fault) => {
    const v = await kindGate(tweenPage(root, { ...BOB, ease: "linear", legs: "quarters" }, fault, ["t"]));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^suddenJumps: t moves -?[\d.]+ in the frame after [\d.]+ ms, and -?[\d.]+ in its first half; no cut marks it$/)]));
    expect(failing(v)).not.toContain("energyFalls");
  });

  it("a page whose only px value is named still fails: a sim page needs a body", async () => {
    // "no-body" leaves the tile t as the only px value; named, it is no body.
    const open = await kindGate(tweenPage(root, BOB, "no-body"));
    expect(open.failures.some((f) => f.startsWith("energyFalls: no px or deg value moves"))).toBe(false);
    const v = await kindGate(tweenPage(root, BOB, "no-body", ["t"]));
    expect(v.failures).toEqual(["energyFalls: no px or deg value moves after the cause; a sim page needs a body, with its unit in __state().units"]);
  });
});

// The guard over several causes, on frames written by hand (no browser): each cause's window runs to the next cause, and
// a window a later cause cuts off while the value still moves is not read at its end.
describe.concurrent("tweens: the guard over several causes", () => {
  /** t at 0 for 10 frames, then `legs`: each [frames, value] holds the value for that many frames. */
  const run = async (legs: [number, number][], causes: number[], unit = "px") => {
    const vs = [0, ...legs.flatMap(([n, v]) => Array<number>(n).fill(v))];
    const frames: Frame[] = vs.map((t, i) => ({ ms: i * FRAME_MS, values: { t } }));
    const page = { frames: async () => frames, state: async () => ({ units: { t: unit } }) } as unknown as GatePage;
    const ctx = { kind: "sim" as const, input: null, cuts: [], tweens: ["t"], causes: causes.map((c) => ({ kind: "press" as const, startMs: c * FRAME_MS, stopMs: c * FRAME_MS })) };
    return tweens.check(page, ctx);
  };

  it("each cause's tween comes home and holds: passes", async () => {
    expect(await run([[5, 4], [10, 0], [5, 4], [10, 0]], [0, 15])).toEqual([]);
  });

  it("a second cause that cuts the first tween off: the value must still come home to where it left", async () => {
    // Cause 1 at frame 0, cause 2 at frame 3 while t is at 4; t then returns to 0, where it was before cause 1.
    expect(await run([[5, 4], [20, 0]], [0, 3])).toEqual([]);
    // It settles at 4, away from the 0 it left.
    expect(await run([[5, 4], [20, 4]], [0, 3])).toEqual([expect.stringMatching(/^tweens: t ends at 4 after the cause at 50 ms, not at 0 where it was just before it/)]);
  });

  it("the second cause's tween that ends away from where it was just before that cause fails, naming that cause", async () => {
    expect(await run([[5, 4], [10, 0], [5, 4], [10, 3]], [0, 15])).toEqual([expect.stringMatching(/^tweens: t ends at 3 after the cause at 250 ms, not at 0 where it was just before it/)]);
  });

  // A ball on the floor that hops 10, 20, then 40 px and lands at 0 each time comes home and holds after the cause, so
  // only its peaks tell it from a bob: they grow. Naming it would hide the rising bounce from energyFalls.
  it("a body that returns home but hops 10, 20, then 40 px fails: a tween's swings never grow", async () => {
    const hops = await run([[3, 10], [3, 0], [3, 20], [3, 0], [3, 40], [10, 0]], [0]);
    expect(hops).toEqual([expect.stringMatching(/^tweens: t swings further from home at [\d.]+ ms \(20 after 10\); a tween's swings never grow$/)]);
  });

  it("peaks that are equal (a bob) or fall (a shake) pass, and a rise within the floor passes", async () => {
    expect(await run([[3, -6], [3, 6], [3, 0], [10, 0]], [0])).toEqual([]);
    expect(await run([[3, 8], [3, -6], [3, 4], [3, -2], [3, 0], [10, 0]], [0])).toEqual([]);
    expect(await run([[3, 6], [3, -6.4], [3, 0], [10, 0]], [0])).toEqual([]);
  });

  it("a blip near home within the floor is noise, not a peak: a bob after it passes", async () => {
    expect(await run([[1, 1e-6], [2, 0], [3, -6], [3, 6], [3, 0], [10, 0]], [0])).toEqual([]);
    expect(await run([[1, 0.1], [2, 0], [3, -6], [3, 6], [3, 0], [10, 0]], [0])).toEqual([]);
  });

  // Left out of the class: a small dip before a larger swing reads as a swing that grows, the same as a body that gains
  // energy in its second half-swing.
  it("an anticipation (a 2 px dip before a 10 px swing) fails as a swing that grows", async () => {
    expect(await run([[3, -2], [1, 0], [3, 10], [3, 0], [10, 0]], [0])).toEqual([expect.stringMatching(/^tweens: t swings further from home at [\d.]+ ms \(10 after 2\); a tween's swings never grow$/)]);
  });

  it("the peaks are read inside each cause's window: a second cause's hops start again from its own home", async () => {
    expect(await run([[3, 4], [3, 0], [3, 4], [10, 0], [3, 40], [3, 0], [3, 40], [10, 0]], [0, 20])).toEqual([]);
  });

  it("a tween named on a page that is not a sim page fails: only a sim page may name tweens", async () => {
    const page = {} as unknown as GatePage;
    for (const kind of ["idle", "live", "scroll", "choreo"] as const) {
      expect(await tweens.check(page, { kind, input: null, cuts: [], tweens: ["t"] })).toEqual(["tweens: only a sim page may name tweens"]);
    }
    expect(await tweens.check(page, { kind: "idle", input: null, cuts: [], tweens: [] })).toEqual([]);
  });

  it("a rest within the unit's floor of the start is home; one frame short of resting is not read", async () => {
    expect(await run([[5, 4], [10, 0.4]], [0])).toEqual([]);
    expect(await run([[5, 4], [10, 0.6]], [0])).toEqual([expect.stringMatching(/^tweens: t ends at 0.6 /)]);
    expect(await run([[5, 4], [2, 0]], [0])).toEqual([expect.stringMatching(/^tweens: t still moves at the end of the frames after the cause at 0 ms/)]);
  });
});

describe.concurrent("loops: one sort (loopSet): what periodicOf finds, a run of equal onsets, or one steady speed", () => {
  const F = 1000 / 60;
  const frames = (endMs: number, f: (s: number) => number): Frame[] => Array.from({ length: Math.round(endMs / F) + 1 }, (_, i) => ({ ms: i * F, values: { v: f((i * F) / 1000) } }));
  /** A page whose value is `f` of the time in seconds, in `unit`: the seek frames and the exact seeks periodicOf asks for. */
  const fakePage = (f: (s: number) => number, unit?: string) => {
    const at = (ms: number): Frame => ({ ms, values: { v: f(ms / 1000) } });
    return {
      frames: async (from: number, to: number) => Array.from({ length: Math.floor((to - from) / F + 1e-6) + 1 }, (_, i) => at(from + i * F)),
      framesAt: async (times: number[]) => times.map(at),
      state: async () => ({ values: {}, events: {}, units: unit ? { v: unit } : {}, objects: {} }),
    } as unknown as GatePage;
  };
  const loops = async (endMs: number, f: (s: number) => number, unit?: string) => [...(await loopSet(fakePage(f, unit), frames(endMs, f), [], undefined))];
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const sine = (periodS: number, amp: number, startS = 0, fadeS = 0) => (s: number) => {
    const d = s - startS;
    const fade = fadeS > 0 ? Math.min(1, Math.max(0, d / fadeS)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, d / fadeS))) : 1;
    return d < 0 ? 1 : 1 + amp * Math.sin((2 * Math.PI * d) / periodS) * fade;
  };

  // Off the frame grid a sine's top frame rises by less than the still threshold at some peaks, and a crest half way
  // between two frames is a tie of float noise: a sort that reads crests on frames misses them. periodicOf reads the
  // value one period later by an exact seek, so it finds the loop at any phase.
  it("a sine is a loop at any period off the frame grid, however small its swing and wherever it starts", async () => {
    for (const [periodS, amp, startS] of [[3.33, 0.005, 0], [3.33, 0.05, 1.1], [Math.PI, 0.005, 0], [Math.PI, 0.05, 2.3]] as const) {
      expect(await loops(15000, (s) => 1 + amp * Math.sin((2 * Math.PI * (s - startS)) / periodS), "scale"), `${periodS} s, ${amp}, ${startS}`).toEqual(["v"]);
    }
  });

  it("a sine is a loop at every period from 0.3 to 7.5 s and every phase against the frame grid, crests half way between frames included", async () => {
    for (const periodS of [0.3, 0.5, 0.625, 0.875, 1.1, 1.5, 2, 3, 4.4, 5.5, 7, 7.5]) {
      for (const startS of [0, F / 2000, 0.25, 0.25 + F / 2000, 0.6, 1.3]) {
        expect(await loops(15000 + startS * 1000, (s) => 1 + 0.03 * Math.sin((2 * Math.PI * (s - startS)) / periodS), "scale"), `${periodS} s from ${startS} s`).toEqual(["v"]);
      }
    }
  });

  it("a breath a tap starts, faded in over 0.5 s, is a loop from its tap at any time, over the read that ends past the cause", async () => {
    for (const [periodS, startS] of [[2.9, 0.5], [Math.PI, 3.25], [3.33, 6], [4.1, 6]] as const) {
      expect(await loops(loopScanEnd([{ kind: "press", startMs: startS * 1000, stopMs: startS * 1000 + F }]), sine(periodS, 0.02, startS, 0.5), "scale"), `${periodS} s from ${startS} s`).toEqual(["v"]);
    }
  });

  // A tap scales the item up, then it breathes on top of the new size. The lead-in is counted from when the value first
  // moves, so a loop a late tap starts has the lead-in a loop at load has.
  it("a breath on top of a lead-in move is a loop: a scale-up to 1.05, or a 200 px slide, then a small breath", async () => {
    for (const [periodS, amp] of [[2.5, 0.01], [3, 0.01], [2.5, 0.005], [3, 0.02], [4.1, 0.005]] as const) {
      const scale = (s: number) => 1 + 0.05 * smooth((s - 1) / 0.4) + amp * Math.sin((2 * Math.PI * (s - 1.4)) / periodS) * smooth((s - 1.4) / 0.5);
      expect(await loops(16000, scale, "scale"), `scale ${periodS} s, ${amp}`).toEqual(["v"]);
    }
    for (const [periodS, px] of [[2.5, 1], [3.33, 2], [Math.PI, 0.6]] as const) {
      const slide = (s: number) => 200 * smooth((s - 1) / 0.4) + px * Math.sin((2 * Math.PI * (s - 1.4)) / periodS) * smooth((s - 1.4) / 0.5);
      expect(await loops(16000, slide, "px"), `slide ${periodS} s, ${px} px`).toEqual(["v"]);
    }
  });

  it("a breath whose swing ramps in over 2 s, or after a spring that overshoots, is a loop", async () => {
    const ramp = (s: number) => 1 + 0.03 * Math.min(1, s / 2) * Math.sin((2 * Math.PI * s) / 4);
    const spring = (s: number) => 1 - 0.4 * Math.exp(-6 * s) * Math.cos((2 * Math.PI * s) / 0.5) + 0.02 * Math.sin((2 * Math.PI * s) / 4.4);
    expect(await loops(16000, ramp, "scale")).toEqual(["v"]);
    expect(await loops(16000, spring, "scale")).toEqual(["v"]);
  });

  it("a keyframe heartbeat with two highs a cycle and no hold is a loop; so is a bounce reported with up as negative", async () => {
    const keys: [number, number][] = [[0, 1], [0.2, 1.2], [0.4, 1.05], [0.6, 1.15], [1, 1]];
    const heartbeat = (s: number) => {
      const u = (s / 1.2) % 1;
      const k = keys.findIndex((_, i) => i + 1 < keys.length && u < keys[i + 1]![0]);
      const p = (u - keys[k]![0]) / (keys[k + 1]![0] - keys[k]![0]);
      return keys[k]![1] + (keys[k + 1]![1] - keys[k]![1]) * smooth(p);
    };
    expect(await loops(15000, heartbeat, "scale")).toEqual(["v"]);
    for (const sign of [1, -1]) expect(await loops(15000, (s) => sign * 40 * Math.abs(Math.sin((Math.PI * s) / 0.875)), "px"), `up is ${sign}`).toEqual(["v"]);
  });

  // The fundamental of a loop is LOOP_BEAT_MS (250 ms) or more: a pair of equal beats makes the 500 ms period. A value
  // whose cycle is shorter repeats at 500 ms too, as every multiple of its cycle does, but it is a buzz.
  it("a buzz of 2 frames, 4 frames or 8 frames a cycle after a slide is no loop; a 250 ms cycle is", async () => {
    const slide = (s: number) => 200 * smooth((s - 0.4) / 0.4);
    const buzz = (frames: number, px: number) => (s: number) => slide(s) + (s > 0.8 ? px * Math.sin((2 * Math.PI * (s - 0.8)) / ((frames * F) / 1000)) : 0);
    expect(await loops(16000, (s) => slide(s) + (s > 0.8 ? Math.round(s * 60) % 2 : 0), "px"), "flip-flop 1 px every frame").toEqual([]);
    expect(await loops(16000, buzz(4, 3), "px"), "4 frames a cycle").toEqual([]);
    expect(await loops(16000, buzz(8, 3), "px"), "8 frames a cycle").toEqual([]);
    expect(await loops(16000, buzz(15, 3), "px"), "15 frames a cycle").toEqual(["v"]);
  });

  it("crests pinned at the top while the troughs deepen without end is no loop", async () => {
    expect(await loops(16000, (s) => -4 * s * (1 - Math.cos((2 * Math.PI * s) / 1.2)) / 2, "px")).toEqual([]);
  });

  // The onset branch: a value that starts the same way every period, with holds between (a ticking hand, pulses).
  describe("a run of equal onsets", () => {
    /** A pulse of height `peak(k)` every `everyS`, 0.3 s up and back, held at `base(k)` between. */
    const pulses = (everyS: number, peak: (k: number) => number, base: (k: number) => number = () => 0) => (s: number) => {
      const k = Math.floor((s - 0.5) / everyS);
      if (k < 0) return 0;
      const u = s - 0.5 - k * everyS;
      return base(k) + (u < 0.3 ? peak(k) * Math.sin((Math.PI * u) / 0.3) : 0);
    };
    const bare = (endMs: number, f: (s: number) => number, units: Record<string, string> = {}) => [...loopNames(frames(endMs, f), [], [], undefined, units)];

    it("pulses of one height every period are a loop, at 500 ms or more; at 400 ms they are not", () => {
      expect(bare(15000, pulses(1, () => 20), { v: "px" })).toEqual(["v"]);
      expect(bare(15000, pulses(0.5, () => 20), { v: "px" })).toEqual(["v"]);
      expect(bare(15000, pulses(0.4, () => 20), { v: "px" })).toEqual([]);
    });

    it("pulses that grow 6 px each beat are no loop", () => {
      expect(bare(15000, pulses(1, (k) => 6 * (k + 1)), { v: "px" })).toEqual([]);
    });

    it("a px staircase with no wrap is no loop; a hand that ticks round in deg is, with the same steps", () => {
      const stairs = pulses(1.2, () => 3, (k) => 20 * k);
      expect(bare(15000, stairs, { v: "px" })).toEqual([]);
      expect(bare(15000, stairs, { v: "deg" })).toEqual(["v"]);
    });

    it("a staircase whose steps shrink, or whose pulses fall each period, is no loop in deg either", () => {
      expect(bare(15000, pulses(1.2, (k) => 20 / (k + 1)), { v: "deg" })).toEqual([]);
    });
  });

  // The same-height test is the unit's floor: over a slide, a breath that decays by less than the floor each period is a
  // loop, and one that decays faster is not.
  it("a lead-in move and a damped breath: a loop when the decay each period is under the unit floor, no loop above it", async () => {
    for (const tau of [3, 4]) {
      const slide = (s: number) => 200 * smooth((s - 1) / 0.4) + (s < 1.4 ? 0 : 2 * Math.sin((2 * Math.PI * (s - 1.4)) / 2.5) * smooth((s - 1.4) / 0.5) * Math.exp(-(s - 1.4) / tau));
      expect(await loops(16000, slide, "px"), `slide, tau ${tau} s`).toEqual([]);
    }
    for (const tau of [3, 4]) {
      const scale = (s: number) => 1 + 0.05 * smooth((s - 1) / 0.4) + (s < 1.4 ? 0 : 0.01 * Math.sin((2 * Math.PI * (s - 1.4)) / 2.5) * smooth((s - 1.4) / 0.5) * Math.exp(-(s - 1.4) / tau));
      expect(await loops(16000, scale, "scale"), `scale, tau ${tau} s`).toEqual([]);
    }
  });

  it("a lead-in move and a breath that stops after three cycles is no loop", async () => {
    expect(await loops(16000, (s) => 1 + 0.05 * smooth((s - 1) / 0.4) + (s > 6 ? 0 : 0.01 * Math.sin((2 * Math.PI * (s - 1.4)) / 1.5) * smooth((s - 1.4) / 0.5)), "scale")).toEqual([]);
  });

  it("a piece that steps three times at a fixed period and then holds is no loop, smooth or instant; one that keeps stepping is a loop only in deg", async () => {
    const stairs = (steps: number, riseS: number) => (s: number) => {
      let y = 0;
      for (let k = 0; k < steps; k++) y += 10 * (riseS === 0 ? (s >= 1 + k ? 1 : 0) : smooth((s - 1 - k) / riseS));
      return y;
    };
    for (const riseS of [0, 0.3]) {
      expect(await loops(15000, stairs(3, riseS), "px"), `3 steps, rise ${riseS} s`).toEqual([]);
      expect(await loops(15000, stairs(14, riseS), "px"), `14 steps in px, rise ${riseS} s`).toEqual([]);
      expect(await loops(15000, stairs(14, riseS), "deg"), `14 steps in deg, rise ${riseS} s`).toEqual(["v"]);
    }
  });

  it("a slow breath is a loop: 5.5 s a cycle shows 3 peaks in a read that ends 6 s past the tap's lift", async () => {
    expect(await loops(21000, sine(5.5, 0.02, 6, 0.5), "scale")).toEqual(["v"]);
  });

  it("a flat-topped repeat is a loop", async () => {
    expect(await loops(15000, (s) => 1 + Math.min(0.01, 0.02 * Math.sin((2 * Math.PI * s) / 3.33)), "scale")).toEqual(["v"]);
  });

  it("the read reaches 15 s past the last cause's stop, or 15 s from load", () => {
    expect(loopScanEnd([])).toBe(15000);
    expect(loopScanEnd([{ kind: "press", startMs: 5000, stopMs: 5017 }])).toBe(20017);
  });

  it("a damped spring (peaks shrink) is no loop", async () => {
    expect(await loops(15000, (s) => 1 + 0.02 * Math.sin((2 * Math.PI * s) / 3) * Math.exp(-s / 1.5), "scale")).toEqual([]);
  });

  it("a value whose period grows each cycle has no fixed period: no loop", async () => {
    const drift = (s: number) => {
      let [start, P] = [0, 3];
      while (start + P <= s) [start, P] = [start + P, P * 1.2];
      return 1 + 0.02 * Math.sin((2 * Math.PI * (s - start)) / P);
    };
    expect(await loops(15000, drift, "scale")).toEqual([]);
  });

  it("a piece that breathes three cycles after a tap and then holds is no loop", async () => {
    expect(await loops(15000, (s) => (s < 1 || s > 1 + 3 * 1.5 ? 1 : 1 + 0.02 * Math.sin((2 * Math.PI * (s - 1)) / 1.5)), "scale")).toEqual([]);
  });

  it("a value that rises with ripples of uneven height is no loop", async () => {
    expect(await loops(15000, (s) => 0.1 * s + 0.01 * Math.sin(5 * s) * (1 + Math.sin(0.7 * s)))).toEqual([]);
  });
});

// What is no loop, as a page: each value below moves for ever or steps on for ever, so it is a move that never stops, and
// the rules that read a sequence (span, rest, reduced motion) must see it. Each page is a tap that slides two bars and
// starts the value (fixtures/gate-pages/loops/).
describe.concurrent("a value that is no loop is judged as a move that never stops (fixtures/gate-pages/loops/)", () => {
  const SPAN = /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/;
  const REST = /^loopStopsAtRest: (the page is still moving 5 s after the input ends|\d+ rAF callbacks ran in the second after the page came to rest)$/;
  it.each([
    ["sim-buzz-2-frames-after-slide.html", "a 1 px flip-flop every frame after a slide is a buzz", SPAN],
    ["sim-buzz-4-frames-after-slide.html", "a 3 px buzz of 4 frames a cycle after a slide is a buzz", SPAN],
    ["choreo-crests-pinned-troughs-deepen.html", "crests pinned at 0 while the troughs deepen are no steady swing", SPAN],
    ["choreo-pulses-grow-each-beat.html", "pulses that grow 6 px each beat do not keep their range", SPAN],
    ["choreo-px-staircase.html", "a px staircase with no wrap steps on for ever", REST],
  ])("%s: %s", async (file, _, line) => {
    const v = await kindGate(path.join(LOOP_PAGES, file));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
  });

  it("the buzz pages also fail restsInTime: a sim body that still moves 4 s after the cause is no loop", async () => {
    for (const file of ["sim-buzz-2-frames-after-slide.html", "sim-buzz-4-frames-after-slide.html"]) {
      const v = await kindGate(path.join(LOOP_PAGES, file));
      expect(failing(v), file).toContain("restsInTime");
    }
  });
});

describe.concurrent("a loop is left out of a check only as far as it explains the motion (fixtures/gate-pages/loops/)", () => {
  const BLANK = /^reducedMotion: the still frame under reduced motion is the blank start state; show the end state instead$/;
  const IGNORED = /^reducedMotion: x answers the input without reduced motion, but not with it; input still answers under reduced motion$/;
  const LEAD = /^overshoot: s passes its rest by [\d.]+ at [\d.]+ ms and comes back, before its loop starts; only motion a person caused may overshoot$/;

  // A value that fades in from 0 and then glows is an entrance, though its lead-in is under 2 s: its start state, 0, lies
  // outside the glow's swing, so the loop never comes back to it and the blank start state is judged.
  it("a bar that fades in and then glows, left blank under reduced motion, fails (choreo)", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "choreo-fade-in-then-glow-blank-reduced.html"));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(BLANK)]));
  });

  it("the same bar shown in its end state under reduced motion passes (choreo)", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "choreo-fade-in-then-glow-shown-reduced.html"));
    expect(v.failures).toEqual([]);
  });

  // A dragged value that also bobs from load is sorted as a loop (the drag ends inside the lead-in), but a loop is left out
  // of "answers the input" only as far as it explains the motion: here the drag moves x, and a page without the drag does not.
  it("a dot that follows the drag and bobs, but ignores the drag under reduced motion, fails (live)", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "live-drag-with-bob-deaf-reduced.html"));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(IGNORED)]));
  });

  it("the same dot that follows the drag under reduced motion too passes (live)", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "live-drag-with-bob.html"));
    expect(v.failures).toEqual([]);
  });

  // A loop that begins at the release differs from the same page with no input by its own swing, because the no-input page
  // never starts it. That is the loop, not the input, and a loop holds still under reduced motion by rule: it is not asked
  // to answer. A dragged value much larger than a loop's swing still is (the deaf page above).
  it("a breath that begins at the release of a drag, still under reduced motion, passes every rule (live)", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "live-breath-begins-at-release.html"));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // A loop a tap starts may pass its rest in its lead-in, as a spring does. One that starts on load is the page's own motion:
  // a tap in its lead-in does not make its overshoot the tap's.
  it("a spring that starts on load and overshoots while a tap lands in its lead-in still fails overshoot (choreo)", async () => {
    const v = await kindGate(path.join(LOOP_PAGES, "choreo-load-spring-then-breath-tapped.html"));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(LEAD)]));
  });
});

describe.concurrent("a loop a tap starts, on a choreo page (breath-pages.ts)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-breath-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("a breath of 1.5% every pi s, faded in over 0.5 s, passes every rule", async () => {
    const v = await kindGate(breathPage(root, { periodS: Math.PI, amp: 0.015 }));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it.each([
    ["damped", "loopStopsAtRest", /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/],
    ["drift", "span", /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/],
    ["pops", "envelope", /^envelope: breath at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["burst-freeze", "interrupt", /^interrupt: x rests at [\d.]+ after the second trigger at [\d.]+ ms, a state the page never rests at without it; a piece is stuck halfway$/],
  ])("%s fails %s", async (fault, rule, line) => {
    const v = await kindGate(breathPage(root, { periodS: Math.PI, amp: 0.015 }, fault));
    expect(failing(v)).toContain(rule);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(line)]));
  });
});

describe.concurrent("loopStopsAtRest: a live page with a pause waits for the sequence's end (beat-pages.ts)", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-beat-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  // A fade-out, a 383 ms blank beat, then the second element: the live rest is the one after it arrives, not the beat's.
  it("a page whose second element arrives and whose loop then stops passes", async () => {
    expect(await atRest(root, { beatMs: 383 })).toEqual([]);
  });

  it("a loop that never stops after the second element is in fails with the rAF line", async () => {
    expect(await atRest(root, { beatMs: 383, fault: "loop-forever" })).toEqual([expect.stringMatching(/^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/)]);
  });

  it("a loop that stops at the start of the beat, so the second element never arrives live, fails through liveEndsShort", async () => {
    expect(await atRest(root, { beatMs: 383, fault: "stalls" })).toEqual(["loopStopsAtRest: the live page comes to rest with n at 0, where its ?seek frames end at 1; the live loop stopped before its sequence ended"]);
  });
});

describe.concurrent.each(["live", "scroll"] as const)("a %s page with a value loop pauses off screen (beat-pages.ts)", { timeout: 120_000 }, (kind) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-loop-pause-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const loop = { periodS: Math.PI, amp: 0.015 };
  // The beat page is a fixture for the loop rules: it does not meet the page contract (the audit's MOTION const, reduced
  // motion), so only the loop rules' verdicts are read.
  const LOOP_RULES = ["loopStopsAtRest", "pausesOffScreen", "resumes"];

  // The idle rules reach a live or scroll page through its kind's rules (forLoops), as they reach a choreo or sim page.
  it("a breath that pauses off screen fails none of the loop rules", async () => {
    const v = await kindGate(beatPage(root, { kind, beatMs: 383, loop }));
    expect(failing(v).filter((r) => LOOP_RULES.includes(r))).toEqual([]);
  });

  it("a breath that keeps running off screen fails pausesOffScreen, and no other loop rule", async () => {
    const v = await kindGate(beatPage(root, { kind, beatMs: 383, loop, fault: "no-pause" }));
    expect(failing(v).filter((r) => LOOP_RULES.includes(r))).toEqual(["pausesOffScreen"]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen; the loop pauses off screen$/)]));
  });
});

describe.concurrent("a steady drift is a loop on every kind (series.ts steadyStep, drift-pages.ts)", () => {
  const F = 1000 / 60;
  const frames = (endMs: number, f: (s: number) => number): Frame[] => Array.from({ length: Math.round(endMs / F) + 1 }, (_, i) => ({ ms: i * F, values: { v: f((i * F) / 1000) } }));
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // The position of a value whose speed eases in over easeS (smoothstep) and then holds at pxPerS.
  const drift = (pxPerS: number, easeS = 0) => (s: number) => (easeS > 0 && s < easeS ? pxPerS * easeS * ((s / easeS) ** 3 - (s / easeS) ** 4 / 2) : pxPerS * (s - easeS / 2));

  describe("steadyStep: the frame step when the last 500 ms move at one steady speed", () => {
    it("a drift of 20, 95 and 400 px/s has its frame step, with or without an ease-in that has ended", () => {
      for (const px of [20, 95, 400]) {
        expect(steadyStep(frames(15000, drift(px)), "v"), `${px} px/s`).toBeCloseTo(px / 60, 6);
        expect(steadyStep(frames(15000, (s) => -px * s), "v"), `${px} px/s leftward`).toBeCloseTo(px / 60, 6);
        expect(steadyStep(frames(15000, (s) => (s < 1.5 ? (px * s * s) / 3 : px * (s - 0.75))), "v"), `${px} px/s after a 1.5 s ramp`).toBeCloseTo(px / 60, 6);
      }
    });

    it("only the last 500 ms are read: a move before them does not matter, and a speed that changes inside them does", () => {
      expect(steadyStep(frames(5000, (s) => (s < 4.4 ? 300 * s : 1320 + 40 * (s - 4.4))), "v")).toBeCloseTo(40 / 60, 6);
      expect(steadyStep(frames(5000, (s) => (s < 4.6 ? 40 * s : 184 + 400 * (s - 4.6))), "v")).toBeNull();
    });

    it("a speed that slows with a 3 s time constant, or wobbles by 20%, or stops, has none", () => {
      expect(steadyStep(frames(15000, (s) => 95 * 3 * (1 - Math.exp(-s / 3))), "v")).toBeNull();
      expect(steadyStep(frames(5000, (s) => 95 * 3 * (1 - Math.exp(-s / 3))), "v")).toBeNull();
      expect(steadyStep(frames(15000, (s) => 95 * s + (95 * 0.2 * 1.1 * (1 - Math.cos((2 * Math.PI * s) / 1.1))) / (2 * Math.PI)), "v")).toBeNull();
      expect(steadyStep(frames(15000, (s) => 95 * Math.min(s, 2)), "v")).toBeNull();
      expect(steadyStep(frames(15000, () => 7), "v")).toBeNull();
    });

    // The slowing is judged on the last 500 ms alone. A value that slows with a time constant of tau loses 0.5/tau of
    // its speed across the window, so every tau up to about 25 s is seen; the whole-series range, which grows with tau,
    // does not give it room.
    it("a speed that slows with a time constant of 4, 6, 10 or 15 s has none, however long the read", () => {
      for (const tau of [3, 4, 6, 10, 15]) {
        for (const endMs of [5000, 15000, 17000, 30000]) {
          expect(steadyStep(frames(endMs, (s) => 95 * tau * (1 - Math.exp(-s / tau))), "v"), `tau ${tau} s, ${endMs} ms read`).toBeNull();
        }
      }
    });

    it("the room a step has does not grow with the length of the read: a speed that wobbles by 3% is none at 5, 15 or 30 s", () => {
      const wobble = (share: number) => (s: number) => 95 * s + (95 * share * 1.1 * (1 - Math.cos((2 * Math.PI * s) / 1.1))) / (2 * Math.PI);
      for (const endMs of [5000, 15000, 17000, 30000]) expect(steadyStep(frames(endMs, wobble(0.03)), "v"), `${endMs} ms read`).toBeNull();
    });

    // A step may differ from the median by 1% of the median (or stillEps of the last 500 ms' own range, when that is more).
    it("a speed that wobbles by 0.5% is steady; one that wobbles by 3%, 5% or 20% is not", () => {
      const wobble = (share: number) => (s: number) => 95 * s + (95 * share * 1.1 * (1 - Math.cos((2 * Math.PI * s) / 1.1))) / (2 * Math.PI);
      expect(steadyStep(frames(15000, wobble(0.005)), "v")).not.toBeNull();
      for (const share of [0.03, 0.05, 0.2]) expect(steadyStep(frames(15000, wobble(share)), "v"), `${share}`).toBeNull();
    });
  });

  describe("neverFasterThan: a value that came to its speed from rest", () => {
    it("a ramp-in to the drift and a hold that lets go never move faster than the drift; a slide-on does", () => {
      const px = 30;
      expect(neverFasterThan(frames(15000, (s) => (s < 1.5 ? (px * s * s) / 3 : px * (s - 0.75))), "v", px / 60)).toBe(true);
      expect(neverFasterThan(frames(15000, drift(px, 1.5)), "v", px / 60)).toBe(true);
      expect(neverFasterThan(frames(15000, (s) => -px * s), "v", px / 60)).toBe(true);
      // Slides on from -800 px over 1 s (smoothstep), then drifts at 30 px/s.
      expect(neverFasterThan(frames(15000, (s) => -800 * (1 - smooth(s)) + px * s), "v", px / 60)).toBe(false);
    });
  });

  describe("loopNames sorts a steady value as a loop", () => {
    const loops = (endMs: number, f: (s: number) => number) => [...loopNames(frames(endMs, f), [], [])];
    it("a drift of 20, 95 and 400 px/s is a loop, after a hold and an ease back", () => {
      for (const px of [20, 95, 400]) {
        // Held until 1 s (a hand), then the speed eases back over 0.8 s (cubic out).
        const held = (s: number) => {
          const p = Math.min(1, Math.max(0, (s - 1) / 0.8));
          return s < 1 ? 0 : px * (0.8 * (p - (1 - (1 - p) ** 4) / 4) + Math.max(0, s - 1.8));
        };
        expect(loops(15000, drift(px)), `${px} px/s`).toEqual(["v"]);
        expect(loops(15000, drift(px, 1.5)), `${px} px/s eased in`).toEqual(["v"]);
        expect(loops(15000, held), `${px} px/s held then released`).toEqual(["v"]);
      }
    });
    it("a drift that slows with a 3 s time constant, wobbles by 20%, or stops is no loop", () => {
      expect(loops(15000, (s) => 95 * 3 * (1 - Math.exp(-s / 3)))).toEqual([]);
      expect(loops(15000, (s) => 95 * s + (95 * 0.2 * 1.1 * (1 - Math.cos((2 * Math.PI * s) / 1.1))) / (2 * Math.PI))).toEqual([]);
      expect(loops(15000, (s) => 95 * Math.min(s, 3))).toEqual([]);
    });
    it("a drift that slows with a time constant of 4, 6 or 10 s is no loop, at 15 s and 17 s reads", () => {
      for (const tau of [4, 6, 10]) for (const endMs of [15000, 17000]) expect(loops(endMs, (s) => 95 * tau * (1 - Math.exp(-s / tau))), `tau ${tau} s, ${endMs} ms`).toEqual([]);
    });
  });

  // With a first cause (a tap on a choreo or sim page, the first input sample on a live or scroll page) a steady value is a
  // loop only when it moves the same with no input (a marquee that starts a little after load is one). A
  // value that starts at a cause and never stops looks the same at the end of the read: a tween with no clamp (300 px/s
  // from a tap at 250 ms, read 15.25 s) and a body thrown with too little friction (800 px/s, a 6 s time constant, read 16 s).
  describe("loopNames, with a first cause: a steady value that a cause starts is no loop", () => {
    const runaway = (pxPerS: number, atS: number) => (s: number) => (s < atS ? 0 : pxPerS * (s - atS));
    const glide = (v0: number, tau: number, atS: number) => (s: number) => (s < atS ? 0 : v0 * tau * (1 - Math.exp(-(s - atS) / tau)));
    const loopsAfter = (endMs: number, f: (s: number) => number, causeMs?: number) => [...loopNames(frames(endMs, f), [], [], causeMs)];
    it("a tween that runs on from a tap at 250 ms, and a body thrown with a 6 s friction, are no loop", () => {
      expect(loopsAfter(15250, runaway(300, 0.25), 250)).toEqual([]);
      expect(loopsAfter(16000, glide(800, 6, 0.25), 250)).toEqual([]);
      expect(loopsAfter(16000, glide(800, 60, 0.25), 250), "a friction of 60 s").toEqual([]);
    });
    it("the same values are a loop where no cause is named (an idle page, or a page that starts on load): the creep begins within the lead-in", () => {
      expect(loopsAfter(15250, runaway(300, 0.25))).toEqual(["v"]);
    });
    it("a drift that was moving before the first cause stays a loop, and so does one on a page that starts on load", () => {
      expect(loopsAfter(15000, drift(95, 0.5), 2000)).toEqual(["v"]);
      expect(loopsAfter(15000, drift(95, 1.5), 3000)).toEqual(["v"]);
      expect(loopsAfter(15000, drift(95), 0)).toEqual(["v"]);
    });
  });
});

// A loop that moves on a little each period is no loop, and a value at one steady speed is a loop only if it moves the same
// with no input (or, with no cause, holds that speed from the end of its lead-in). Frames written by hand, no browser.
describe.concurrent("loop sort: drift under the floor each period adds up, and a creep the input starts is no loop", () => {
  const F = 1000 / 60;
  const frames = (endMs: number, f: (s: number) => number): Frame[] => Array.from({ length: Math.round(endMs / F) + 1 }, (_, i) => ({ ms: i * F, values: { v: f((i * F) / 1000) } }));
  const fakePage = (f: (s: number) => number, unit?: string) => {
    const at = (ms: number): Frame => ({ ms, values: { v: f(ms / 1000) } });
    return {
      frames: async (from: number, to: number) => Array.from({ length: Math.floor((to - from) / F + 1e-6) + 1 }, (_, i) => at(from + i * F)),
      framesAt: async (times: number[]) => times.map(at),
      state: async () => ({ values: {}, events: {}, units: unit ? { v: unit } : {}, objects: {} }),
    } as unknown as GatePage;
  };
  const loops = async (endMs: number, f: (s: number) => number, unit: string) => [...(await loopSet(fakePage(f, unit), frames(endMs, f), [], undefined))];
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const cos = (s: number, periodS: number) => (1 - Math.cos((2 * Math.PI * s) / periodS)) / 2;

  describe("loopSet: the same shape that drifts by less than the floor each period", () => {
    it("a bob that sinks 0.2, 0.4 or 0.5 px a cycle is no loop, at periods from 0.5 to 3 s", async () => {
      for (const periodS of [0.5, 0.6, 1.2, 3]) {
        for (const sink of [0.2, 0.4, 0.5]) {
          expect(await loops(17000, (s) => -12 * cos(s, periodS) + (sink * s) / periodS, "px"), `${sink} px a ${periodS} s cycle`).toEqual([]);
        }
      }
    });

    it("a pulse that grows by 1% of its swing a beat is no loop; one that shrinks by 1% a beat is none either", async () => {
      for (const periodS of [0.6, 0.8, 1.5]) {
        for (const grow of [0.01, -0.01]) {
          expect(await loops(17000, (s) => 1 + 0.04 * (1 + (grow * s) / periodS) * cos(s, periodS), "scale"), `${grow} a ${periodS} s beat`).toEqual([]);
        }
      }
    });

    it("an opacity loop that fades 0.002 a cycle is no loop", async () => {
      for (const periodS of [0.5, 0.8, 2]) {
        expect(await loops(17000, (s) => 0.7 + 0.3 * Math.cos((2 * Math.PI * s) / periodS) - (0.002 * s) / periodS, "opacity"), `${periodS} s`).toEqual([]);
      }
    });

    it("a loop that keeps its crest and sinks its trough by 0.4 px a hop is no loop", async () => {
      expect(await loops(17000, (s) => -20 * cos(s, 1.2) * (1 + (0.4 / 20) * (s / 1.2)), "px")).toEqual([]);
    });

    it("the same shapes that hold their level are loops: float jitter of 1e-5, a sub-frame phase, the whole 15 s read", async () => {
      for (const [periodS, phaseS] of [[0.6, 0], [0.7103, F / 2000], [1.237, 0.0041], [3.33, 0.25 + F / 4000]] as const) {
        const jitter = (s: number) => 1e-5 * Math.sin(s * 977.3);
        expect(await loops(17000, (s) => -12 * cos(s - phaseS, periodS) + jitter(s), "px"), `bob ${periodS} s`).toEqual(["v"]);
        expect(await loops(17000, (s) => 1 + 0.04 * cos(s - phaseS, periodS) + jitter(s), "scale"), `breath ${periodS} s`).toEqual(["v"]);
        expect(await loops(17000, (s) => 0.6 + 0.3 * Math.cos((2 * Math.PI * (s - phaseS)) / periodS) + jitter(s), "opacity"), `shimmer ${periodS} s`).toEqual(["v"]);
      }
    });

    it("a drift of 0.005 px a cycle (0.1 px over the read) is under the floor: a loop", async () => {
      expect(await loops(17000, (s) => -12 * cos(s, 0.6) + (0.005 * s) / 0.6, "px")).toEqual(["v"]);
    });

    it("a hand that ticks round in deg keeps its step each period, and a px value with that step is no loop", async () => {
      const tick = (s: number) => 6 * Math.floor(s) + 6 * smooth((s % 1) / 0.1);
      expect(await loops(17000, tick, "deg")).toEqual(["v"]);
      expect(await loops(17000, tick, "px")).toEqual([]);
    });
  });

  describe("loopNames, the onset branch: pulses whose dip deepens each beat", () => {
    /** A dip of `depth(k)` px every `everyS`, 0.15 s down and back (a sine squared), held at 0 between. */
    const dips = (everyS: number, depth: (k: number) => number) => (s: number) => {
      const k = Math.floor((s - 0.4) / everyS);
      const u = s - 0.4 - k * everyS;
      return k < 0 || u >= 0.15 ? 0 : depth(k) * Math.sin((Math.PI * u) / 0.15) ** 2;
    };
    const bare = (endMs: number, f: (s: number) => number, unit: string) => [...loopNames(frames(endMs, f), [], [], undefined, { v: unit })];
    // A crest known to a frame is off by up to 22 px here (a 0.15 s dip is 9 frames), so the onset branch tells a deepening
    // of 52 px over the read from the frames alone; the periodic branch, which seeks exact times, tells the finer ones.
    it("a 200 px dip that deepens by 4 or 6 px a beat is no loop; a dip that holds its depth is", () => {
      for (const grow of [4, 6]) expect(bare(15000, dips(1, (k) => 200 + grow * k), "px"), `${grow} px a beat`).toEqual([]);
      expect(bare(15000, dips(1, () => 200), "px")).toEqual(["v"]);
    });
    it("a dip that deepens by 0.01 px a beat (0.15 px over the read) is under the floor: a loop", () => {
      expect(bare(15000, dips(1, (k) => 200 + 0.01 * k), "px")).toEqual(["v"]);
    });
  });

  describe("loopNames: a value at one steady speed, with no cause named (an idle page, or a page that starts on load)", () => {
    /** A drift of `pxPerS` whose speed eases in over `easeS` (smoothstep), after `startS` of stillness. */
    const marquee = (pxPerS: number, easeS = 0, startS = 0) => (s: number) => {
      const t = s - startS;
      if (t <= 0) return 0;
      return easeS > 0 && t < easeS ? pxPerS * easeS * ((t / easeS) ** 3 - (t / easeS) ** 4 / 2) : pxPerS * (t - easeS / 2);
    };
    const breathThenCreep = (breathS: number, creepPxS: number) => (s: number) => -6 * cos(Math.min(s, breathS), 1.2) + (s > breathS ? creepPxS * (s - breathS) : 0);
    const bare = (endMs: number, f: (s: number) => number, causeMs?: number) => [...loopNames(frames(endMs, f), [], [], causeMs, { v: "px" })];

    it("a marquee that eases in over 1 s on load is a loop, at 20, 95 and 400 px/s", () => {
      for (const px of [20, 95, 400]) expect(bare(15000, marquee(px, 1)), `${px} px/s`).toEqual(["v"]);
    });

    it("a drift that starts late, within the lead-in, is a loop", () => {
      expect(bare(15250, marquee(300, 0, 0.25))).toEqual(["v"]);
      expect(bare(15000, marquee(95, 0.5, 1.5))).toEqual(["v"]);
    });

    it("a breath that runs for 3 s and then turns into a creep is no loop: the speed must hold from the end of the lead-in", () => {
      for (const px of [12, 25, 95]) expect(bare(15000, breathThenCreep(3, px)), `${px} px/s`).toEqual([]);
    });

    it("a value that moves at load, holds, and creeps from 2.5 s (past its lead-in) is no loop; one that first moves at 2.5 s is", () => {
      expect(bare(15000, (s) => (s < 0.3 ? 4 * s : 1.2) + marquee(95, 0, 2.5)(s))).toEqual([]);
      expect(bare(15000, marquee(95, 0, 2.5))).toEqual(["v"]);
    });
  });

  describe("loopNames: a value at one steady speed, with a first cause at causeMs (a tap, or the first input sample)", () => {
    const marquee = (pxPerS: number, easeS = 0, startS = 0) => (s: number) => {
      const t = s - startS;
      if (t <= 0) return 0;
      return easeS > 0 && t < easeS ? pxPerS * easeS * ((t / easeS) ** 3 - (t / easeS) ** 4 / 2) : pxPerS * (t - easeS / 2);
    };
    /** At rest until `atS`, then a fling of `v0` px/s that decays at 4 a second to a floor of `minPxS`, and creeps on at it. */
    const fling = (v0: number, minPxS: number, atS: number) => (s: number) => {
      const t = s - atS;
      if (t <= 0) return 0;
      const tFloor = Math.log(v0 / minPxS) / 4;
      return t < tFloor ? (v0 / 4) * (1 - Math.exp(-4 * t)) : (v0 / 4) * (1 - minPxS / v0) + minPxS * (t - tFloor);
    };
    const breath = (s: number) => -6 * cos(Math.min(s, 1.2), 1.2);
    const breathThenCreep = (creepPxS: number, atS: number) => (s: number) => -6 * cos(s, 1.2) + (s > atS ? creepPxS * (s - atS) : 0);
    /** `f` read with the cause, and `quiet` (the page read with no input; none: loopNames' own fallback). */
    const withCause = (endMs: number, f: (s: number) => number, causeMs: number, quiet?: (s: number) => number) => [...loopNames(frames(endMs, f), [], [], causeMs, { v: "px" }, quiet ? frames(endMs, quiet) : undefined)];
    const atRest = () => 0;

    it("a fling that decays to a floor speed and creeps on, from a value that was at rest, is no loop (a live page)", () => {
      for (const minPxS of [15, 30, 95]) {
        expect(withCause(16000, fling(600, minPxS, 0.25), 250, atRest), `${minPxS} px/s`).toEqual([]);
        expect(withCause(16000, fling(600, minPxS, 0.25), 250), `${minPxS} px/s, no quiet read`).toEqual([]);
      }
    });

    it("an unclamped creep after a breath is no loop, whichever way the breath was going when the cause came", () => {
      // The breath goes down (a negative step) for its first 600 ms, so at 250 ms a creep of -px/s goes the way the breath goes.
      for (const px of [12, 25, 95, -12, -25, -95]) {
        expect(withCause(15250, breathThenCreep(px, 0.25), 250, (s) => -6 * cos(s, 1.2)), `${px} px/s`).toEqual([]);
        expect(withCause(15250, breathThenCreep(px, 0.25), 250), `${px} px/s, no quiet read`).toEqual([]);
      }
    });

    it("a drift that moves the same with no input is a loop: it was moving, easing in, or not yet started when the cause came", () => {
      for (const px of [20, 95, 400]) {
        for (const [easeS, startS] of [[0, 0], [0.5, 0], [1, 0], [0, 0.2], [0, 0.3], [0, 0.6], [0.5, 1], [0, 2.5]]) {
          const f = marquee(px, easeS, startS);
          expect(withCause(15000, f, 250, f), `${px} px/s, eased in over ${easeS} s, from ${startS} s`).toEqual(["v"]);
        }
        expect(withCause(15000, marquee(px, 1), 3000, marquee(px, 1)), `${px} px/s, cause after the ease`).toEqual(["v"]);
      }
    });

    it("with no quiet read, a value must itself be moving at the steady speed in the frame before the cause", () => {
      for (const px of [20, 95, 400]) {
        expect(withCause(15000, marquee(px), 250), `${px} px/s`).toEqual(["v"]);
        expect(withCause(15000, marquee(px, 0.5), 250), `${px} px/s, still easing in`).toEqual([]);
        expect(withCause(15000, marquee(px, 1), 3000), `${px} px/s, cause after the ease`).toEqual(["v"]);
      }
    });

    it("a value the input turns to another speed, or another way, than it had alone is no loop", () => {
      // Alone it drifts back at 40 px/s; with the input it ends going on at 95 px/s the other way.
      const alone = (s: number) => -40 * s;
      expect(withCause(15250, (s) => (s < 0.25 ? -40 * s : -10 + 95 * (s - 0.25)), 250, alone)).toEqual([]);
      expect(withCause(15250, (s) => (s < 0.25 ? 400 * s : 100 + 20 * (s - 0.25)), 250, (s) => 400 * s)).toEqual([]);
      // Alone it drifts at 20 px/s; with the input it ends going on at 95.
      expect(withCause(15250, (s) => (s < 0.25 ? 20 * s : 5 + 95 * (s - 0.25)), 250, (s) => 20 * s)).toEqual([]);
    });

    it("a breath that turns into a creep from load is no loop on a page that also answers a tap, with or without a quiet read", () => {
      // The page's own value starts on load and does the same with no input, so the quiet read is the frames themselves.
      for (const px of [12, 25, 95, -25]) {
        // One breath of 1.2 s from load, then rest, then a creep from 3 s.
        const f = (t: number) => breath(t) + (t > 3 ? px * (t - 3) : 0);
        expect(withCause(15250, f, 250, f), `${px} px/s, quiet read`).toEqual([]);
        expect(withCause(15250, f, 250), `${px} px/s, no quiet read`).toEqual([]);
        expect(withCause(15250, f, 0), `${px} px/s, no cause`).toEqual([]);
      }
    });

    it("a marquee that starts on load and eases in is still a loop on a page that also answers a tap", () => {
      const f = marquee(95, 1);
      expect(withCause(15250, f, 250, f)).toEqual(["v"]);
    });

    it("a value that breathes alone and then creeps with the input is no loop", () => {
      expect(withCause(15250, breathThenCreep(25, 0.25), 250, breath)).toEqual([]);
    });

    it("a cause at 0 is a page that starts on load: the lead-in rule applies", () => {
      expect(withCause(15000, breathThenCreep(25, 3), 0)).toEqual([]);
      expect(withCause(15000, marquee(95, 1), 0)).toEqual(["v"]);
    });
  });
});

// The same two guards on pages: a loop that drifts a little each period, and a creep that nothing was moving at before the
// input, fail the rules a value that never rests fails (span on a choreo page, loopStopsAtRest on a live or scroll page).
describe.concurrent("loop sort on pages: a drifting loop and a creep the input starts are no loop", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-creep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const STILL_MOVING = /^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/;
  const STILL_AFTER_INPUT = /^loopStopsAtRest: the page is still moving 5 s after the input ends$/;
  const LOOP = { restart: false, motion: { reducedAtS: 0 } };
  const slug = (s: string) => s.replace(/\W+/g, "-");

  describe("a tap starts a loop that moves on each period (choreo)", () => {
    const COS = "(1 - Math.cos(2 * Math.PI * d / MOTION.periodS)) / 2";
    const faults: [string, TapLoopSpec][] = [
      ["a bob that sinks 0.5 px a cycle, 0.5 s a cycle", { ...LOOP, motion: { ...LOOP.motion, periodS: 0.5, ampPx: 12, sinkPx: 0.5 }, units: { y: "px" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.ampPx * ${COS} + MOTION.sinkPx * d / MOTION.periodS }; }` }],
      ["a bob that sinks 0.45 px a cycle, 0.8 s a cycle", { ...LOOP, motion: { ...LOOP.motion, periodS: 0.8, ampPx: 12, sinkPx: 0.45 }, units: { y: "px" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.ampPx * ${COS} + MOTION.sinkPx * d / MOTION.periodS }; }` }],
      ["a pulse that grows by 1% of its swing a beat", { ...LOOP, motion: { ...LOOP.motion, periodS: 0.6, amp: 0.04, grow: 0.01 }, units: { s: "scale" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { s: 1 }; return { s: 1 + MOTION.amp * (1 + MOTION.grow * d / MOTION.periodS) * ${COS} }; }` }],
      ["an opacity loop that fades 0.002 a cycle", { ...LOOP, motion: { ...LOOP.motion, periodS: 0.8 }, units: { o: "opacity" }, valuesAfter: "function valuesAfter(d) { if (d === null) return { o: 1 }; return { o: 0.7 + 0.3 * Math.cos(2 * Math.PI * d / MOTION.periodS) - 0.002 * d / MOTION.periodS }; }" }],
      ["a loop that holds its crest while its trough sinks 0.4 px a hop", { ...LOOP, motion: { ...LOOP.motion, periodS: 1.2, ampPx: 20, sinkPx: 0.4 }, units: { y: "px" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.ampPx * ${COS} * (1 + MOTION.sinkPx / MOTION.ampPx * d / MOTION.periodS) }; }` }],
    ];
    it.each(faults)("%s fails span", async (name, spec) => {
      const v = await kindGate(tapLoopPage(root, slug(name), spec));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(STILL_MOVING)]));
    });

    // The same loops that hold their level, with float jitter of 1e-5 and a period off the frame grid, pass every rule.
    const honest: [string, TapLoopSpec][] = [
      ["a bob with a sub-frame period and jitter of 1e-5 px", { ...LOOP, motion: { ...LOOP.motion, periodS: 0.7103, ampPx: 12 }, units: { y: "px" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.ampPx * ${COS} + 1e-5 * Math.sin(d * 977.3) }; }` }],
      ["a breath with a sub-frame period and jitter of 1e-5", { ...LOOP, motion: { ...LOOP.motion, periodS: 1.9371, amp: 0.03 }, units: { s: "scale" }, valuesAfter: `function valuesAfter(d) { if (d === null) return { s: 1 }; return { s: 1 + MOTION.amp * ${COS} + 1e-5 * Math.sin(d * 977.3) }; }` }],
    ];
    it.each(honest)("%s passes", async (name, spec) => {
      const v = await kindGate(tapLoopPage(root, slug(name), spec));
      expect(v.failures).toEqual([]);
    });
  });

  describe("an unclamped creep after a breath (choreo)", () => {
    // The breath runs from load. A tap starts a linear tween with no clamp that creeps on; the breath does not move at the creep's speed.
    const creep = (px: number) => ({ ...LOOP, motion: { ...LOOP.motion, breathS: 1.2, breathPx: 6, creepPxS: px }, units: { y: "px" }, valuesAfter: "const breath = (t) => -MOTION.breathPx * (1 - Math.cos(2 * Math.PI * t / MOTION.breathS)) / 2;\nfunction valuesAfter(d) { if (d === null) return { y: breath(S.t) }; return { y: breath(S.vtap) + MOTION.creepPxS * d }; }" });
    // The breath goes down for its first 0.6 s, so at the gate's tap, 250 ms in, a creep of a negative speed goes the way the breath goes.
    it.each([12, 25, 95, -12, -25, -95])("a tween that creeps on at %i px/s fails span", async (px) => {
      const v = await kindGate(tapLoopPage(root, `breath-then-creep-${px}`, creep(px)));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(STILL_MOVING)]));
    });
  });

  describe("a creep that starts on load, after a breath (a choreo page with no tap)", () => {
    const after = (breathS: number, px: number): LoadLoop => ({
      motion: { breathS: 1.2, breathPx: 6, creepFromS: breathS, creepPxS: px },
      units: { y: "px" },
      valuesAfter: "function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.breathPx * (1 - Math.cos(2 * Math.PI * Math.min(d, MOTION.creepFromS) / MOTION.breathS)) / 2 + MOTION.creepPxS * Math.max(0, d - MOTION.creepFromS) }; }",
    });
    it.each([[3, 25], [4.5, 95]])("a breath for %d s that turns into a creep of %i px/s fails the rules that wait for rest", async (breathS, px) => {
      const v = await kindGate(loadLoopPage(root, `load-breath-then-creep-${breathS}`, after(breathS, px)));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^(span|loopStopsAtRest): /)]));
    });
  });

  describe("a breath that turns into a creep from load, on a page that also answers a tap (choreo)", () => {
    // The creep starts on load; a tap only slides two bars in. The creep moves the same with the tap or without it, so a read with no input sees it too.
    const withTap = (breathS: number, px: number): LoadLoop => ({ ...after(breathS, px), tapSeq: true });
    const after = (breathS: number, px: number): LoadLoop => ({
      motion: { breathS: 1.2, breathPx: 6, creepFromS: breathS, creepPxS: px },
      units: { y: "px" },
      valuesAfter: "function valuesAfter(d) { if (d === null) return { y: 0 }; return { y: -MOTION.breathPx * (1 - Math.cos(2 * Math.PI * Math.min(d, MOTION.creepFromS) / MOTION.breathS)) / 2 + MOTION.creepPxS * Math.max(0, d - MOTION.creepFromS) }; }",
    });
    it.each([[3, 12], [3, 25], [4.5, 95]])("a breath for %d s that turns into a creep of %i px/s fails the rules that wait for rest", async (breathS, px) => {
      const v = await kindGate(loadLoopPage(root, `load-breath-creep-tap-${breathS}-${px}`, withTap(breathS, px)));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^(span|loopStopsAtRest): /)]));
    });
    it("a marquee that eases in over 1 s from load, beside a tap sequence, passes the loop rules", async () => {
      const marquee: LoadLoop = {
        motion: { easeS: 1, creepPxS: 40 },
        units: { y: "px" },
        valuesAfter: "function valuesAfter(d) { if (d === null) return { y: 0 }; const e = MOTION.easeS, t = Math.min(d, e) / e; return { y: MOTION.creepPxS * (d < e ? e * (t ** 3 - t ** 4 / 2) : d - e / 2) }; }",
        tapSeq: true,
      };
      const v = await kindGate(loadLoopPage(root, "load-marquee-tap", marquee));
      expect(failing(v)).not.toContain("span");
      expect(failing(v)).not.toContain("loopStopsAtRest");
    });
  });

  describe("a dot's fling that never falls below a minimum speed (live)", () => {
    it.each([15, 30, 95])("a floor of %i px/s fails loopStopsAtRest", async (minPxS) => {
      const v = await kindGate(flingPage(root, `fling-floor-${minPxS}`, { minPxS }));
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(STILL_AFTER_INPUT)]));
    });
    it("a fling that stops below 2 px/s passes the loop rules", async () => {
      const v = await kindGate(flingPage(root, "fling-stops", { stopPxS: 2 }));
      expect(failing(v)).not.toContain("loopStopsAtRest");
    });
  });

  describe("a value a scroll tick kicks that never falls below a minimum speed (scroll)", () => {
    it.each([15, 60])("a floor of %i px/s fails loopStopsAtRest or span", async (minPxS) => {
      const v = await kindGate(scrollKickPage(root, `scroll-floor-${minPxS}`, { minPxS }));
      expect(v.failures.some((f) => /^(loopStopsAtRest|span): /.test(f))).toBe(true);
    });
    it("a kick that stops below 1 px/s passes the loop rules", async () => {
      const v = await kindGate(scrollKickPage(root, "scroll-kick-stops", { stopPxS: 1 }));
      expect(failing(v)).not.toContain("loopStopsAtRest");
      expect(failing(v)).not.toContain("span");
    });
  });
});

describe.concurrent.each(["live", "scroll"] as const)("a %s page whose strip drifts at one steady speed (drift-pages.ts)", { timeout: 120_000 }, (kind) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-drift-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  // The drift page is a fixture for the loop rules: it does not meet the page contract (the audit's MOTION const, reduced
  // motion), so only the loop rules' verdicts are read.
  const LOOP_RULES = ["loopStopsAtRest", "pausesOffScreen", "resumes"];
  const STILL_MOVING = /^loopStopsAtRest: the page is still moving 5 s after the input ends$/;
  const RAF = /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/;
  const NO_PAUSE = /^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen; the loop pauses off screen$/;

  it("a drift that a drag holds and a release eases back to passes the loop rules", async () => {
    expect(await driftRulesOn(root, { kind, speed: 95 }, LOOP_RULES)).toEqual([]);
  });

  // The page drifts the same with no hand on it, whenever it starts, so the input did not start the drift.
  it.each([0.3, 0.6, 1, 2.5])("a drift that starts %d s after load passes the loop rules", async (startS) => {
    expect(await driftRulesOn(root, { kind, speed: 95, startS }, LOOP_RULES)).toEqual([]);
  });

  it("a drift that keeps running off screen fails pausesOffScreen, and no other loop rule", async () => {
    expect(await driftRulesOn(root, { kind, speed: 95, fault: "no-pause" }, LOOP_RULES)).toEqual([expect.stringMatching(NO_PAUSE)]);
  });

  // The slow is judged on the last 500 ms, so a slower slowing (time constants of 4, 6 and 10 s) is seen too.
  it.each([3, 4, 6, 10])("slows with a %i s time constant fails loopStopsAtRest", async (tauS) => {
    expect(await driftRulesOn(root, { kind, speed: 95, fault: "slows", tauS }, LOOP_RULES)).toEqual([expect.stringMatching(STILL_MOVING)]);
  });

  it.each([
    ["wobbler", "a second value that wobbles forever with no period", STILL_MOVING],
    ["slows", "a drift that slows with a 3 s time constant", STILL_MOVING],
    ["wobble-speed", "a drift whose speed wobbles by 20%", STILL_MOVING],
    ["stops", "a drift that stops after the input while the clock runs on", RAF],
  ] as const)("%s (%s) fails loopStopsAtRest", async (fault, _what, line) => {
    expect(await driftRulesOn(root, { kind, speed: 95, fault }, LOOP_RULES)).toEqual([expect.stringMatching(line)]);
  });
});

describe.concurrent("wait until the page stops, not a fixed window (rest-pages.ts)", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-rest-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** The lines of the rest rules (REST_RULES) a gate run of `file` prints. */
  const lines = (file: string) => restLines(file);
  const APART = (value: string, end: string) => new RegExp(`^loopStopsAtRest: the live page comes to rest with ${value}, where its \\?seek frames end at ${end}; the live loop stopped before its sequence ended$`);

  describe("restApart: a value rests where its ?seek frames end, within its unit's floor or its input slack, from either side", () => {
    const F = 1000 / 60;
    const frames = (f: (ms: number) => Record<string, number>): Frame[] => Array.from({ length: 121 }, (_, i) => ({ ms: i * F, values: f(i * F) }));
    // A toast that is on screen to 0.5 s and slides out at 1.5 s ends where it started; a fade that ends at 1.
    const seek = frames((ms) => ({ toast: ms < 500 ? 0 : ms < 1500 ? 0 : 80, fade: Math.min(1, ms / 1000) }));
    const units = { toast: "px", fade: "opacity", loop: "scale" };

    it("a live page at the ?seek rest has none apart", () => {
      expect(restApart({ toast: 80, fade: 1 }, seek, new Set(), units)).toBeNull();
      expect(restApart({ toast: 80.3, fade: 1.005 }, seek, new Set(), units)).toBeNull();
    });
    it("a toast that never leaves, or leaves and stops halfway, is apart", () => {
      expect(restApart({ toast: 0, fade: 1 }, seek, new Set(), units)).toEqual({ name: "toast", live: 0, seek: 80 });
      expect(restApart({ toast: 40, fade: 1 }, seek, new Set(), units)).toEqual({ name: "toast", live: 40, seek: 80 });
    });
    it("a fade that stops partway is apart", () => {
      expect(restApart({ toast: 80, fade: 0.6 }, seek, new Set(), units)).toEqual({ name: "fade", live: 0.6, seek: 1 });
    });
    it("a value the ?seek frames report and the live page never reports is apart", () => {
      expect(restApart({ toast: 80 }, seek, new Set(), units)).toEqual({ name: "fade", live: null, seek: 1 });
      expect(restApart({ toast: 80, fade: Number.NaN }, seek, new Set(), units)).toEqual({ name: "fade", live: null, seek: 1 });
    });
    it("a value that goes further than its ?seek frames is apart, as one that stops short: a panel that overruns its slot, a badge that grows to 3", () => {
      expect(restApart({ toast: 80, fade: 1.3 }, seek, new Set(), units)).toEqual({ name: "fade", live: 1.3, seek: 1 });
      expect(restApart({ toast: 107, fade: 1 }, seek, new Set(), units)).toEqual({ name: "toast", live: 107, seek: 80 });
      const burst = frames((ms) => ({ rise: Math.min(545, ms / 2) }));
      expect(restApart({ rise: 545 }, burst, new Set(), { rise: "px" })).toBeNull();
      expect(restApart({ rise: 578 }, burst, new Set(), { rise: "px" })).toEqual({ name: "rise", live: 578, seek: 545 });
      expect(restApart({ rise: 500 }, burst, new Set(), { rise: "px" })).toEqual({ name: "rise", live: 500, seek: 545 });
      const down = frames((ms) => ({ drop: Math.max(-300, -ms / 2) }));
      expect(restApart({ drop: -340 }, down, new Set(), { drop: "px" })).toEqual({ name: "drop", live: -340, seek: -300 });
      expect(restApart({ drop: -250 }, down, new Set(), { drop: "px" })).toEqual({ name: "drop", live: -250, seek: -300 });
      // A panel that slides from -300 px to its slot at 0 and, live, flies on 500 px past it and holds.
      const slot = frames((ms) => ({ panel: 300 * (Math.min(1, ms / 400) - 1) }));
      expect(restApart({ panel: 0 }, slot, new Set(), { panel: "px" })).toBeNull();
      expect(restApart({ panel: 500 }, slot, new Set(), { panel: "px" })).toEqual({ name: "panel", live: 500, seek: 0 });
      // A badge that pops from 0 to 1 and, live, rests at 3.
      const badge = frames((ms) => ({ badge: Math.min(1, ms / 300) }));
      expect(restApart({ badge: 1 }, badge, new Set(), { badge: "scale" })).toBeNull();
      expect(restApart({ badge: 3 }, badge, new Set(), { badge: "scale" })).toEqual({ name: "badge", live: 3, seek: 1 });
    });
    it("the tolerance is the input slack when that is greater than the floor, on either side", () => {
      const slid = frames((ms) => ({ x: Math.min(300, ms / 2) }));
      expect(restApart({ x: 310 }, slid, new Set(), { x: "px" })).toMatchObject({ name: "x", live: 310 });
      expect(restApart({ x: 310 }, slid, new Set(), { x: "px" }, { x: 12 })).toBeNull();
      expect(restApart({ x: 290 }, slid, new Set(), { x: "px" }, { x: 12 })).toBeNull();
      expect(restApart({ x: 320 }, slid, new Set(), { x: "px" }, { x: 12 })).toMatchObject({ name: "x", live: 320 });
    });
    it("a value that turns back (an overshoot, a pop that backs out, a bouncing spring) must land at its ?seek rest, from either side: a stall at a peak is apart", () => {
      const leg = (a: number, b: number, from: number, to: number) => (ms: number) => (ms <= from ? a : ms >= to ? b : a + ((b - a) * (ms - from)) / (to - from));
      // A scale that goes 1 to 1.2 by 600 ms, then back to 1.1 by 1500 ms.
      const scaleSeek = frames((ms) => ({ s: ms < 600 ? leg(1, 1.2, 0, 600)(ms) : leg(1.2, 1.1, 600, 1500)(ms) }));
      expect(restApart({ s: 1.1 }, scaleSeek, new Set(), { s: "scale" })).toBeNull();
      expect(restApart({ s: 1.2 }, scaleSeek, new Set(), { s: "scale" })).toEqual({ name: "s", live: 1.2, seek: 1.1 });
      expect(restApart({ s: 1.15 }, scaleSeek, new Set(), { s: "scale" })).toMatchObject({ name: "s", live: 1.15 });
      expect(restApart({ s: 1.05 }, scaleSeek, new Set(), { s: "scale" })).toMatchObject({ name: "s", live: 1.05 });
      // A distance that goes 0 to 400 px, then back to 300 px.
      const px = frames((ms) => ({ x: ms < 600 ? leg(0, 400, 0, 600)(ms) : leg(400, 300, 600, 1500)(ms) }));
      expect(restApart({ x: 300 }, px, new Set(), { x: "px" })).toBeNull();
      expect(restApart({ x: 400 }, px, new Set(), { x: "px" })).toEqual({ name: "x", live: 400, seek: 300 });
      expect(restApart({ x: 350 }, px, new Set(), { x: "px" })).toMatchObject({ name: "x", live: 350 });
      expect(restApart({ x: 250 }, px, new Set(), { x: "px" })).toMatchObject({ name: "x", live: 250 });
      // A pop entrance that backs out: 0 to 1.1 to 1.
      const pop = frames((ms) => ({ p: ms < 400 ? leg(0, 1.1, 0, 400)(ms) : leg(1.1, 1, 400, 900)(ms) }));
      expect(restApart({ p: 1 }, pop, new Set(), { p: "scale" })).toBeNull();
      expect(restApart({ p: 1.1 }, pop, new Set(), { p: "scale" })).toEqual({ name: "p", live: 1.1, seek: 1 });
      // A value that dips, then rises to rest.
      const dip = frames((ms) => ({ d: ms < 400 ? leg(100, 60, 0, 400)(ms) : leg(60, 90, 400, 900)(ms) }));
      expect(restApart({ d: 90 }, dip, new Set(), { d: "px" })).toBeNull();
      expect(restApart({ d: 96 }, dip, new Set(), { d: "px" })).toMatchObject({ name: "d", live: 96 });
      expect(restApart({ d: 70 }, dip, new Set(), { d: "px" })).toMatchObject({ name: "d", live: 70 });
    });
    it.each([0.4, 0.5, 0.6, 0.7, 0.75])("a spring pop that bounces (damping ratio %s) and stalls at its first peak is apart", (zeta) => {
      const w = 12, wd = w * Math.sqrt(1 - zeta * zeta);
      const spring = frames((ms) => { const t = ms / 1000; return { p: 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t)) }; });
      const peak = Math.max(...spring.map((f) => f.values.p!));
      const end = spring[spring.length - 1]!.values.p!;
      expect(restApart({ p: end }, spring, new Set(), { p: "scale" })).toBeNull();
      expect(restApart({ p: peak }, spring, new Set(), { p: "scale" })).toMatchObject({ name: "p", live: peak });
    });
    it("a value that ends where it started must land there, from either side", () => {
      const there = frames((ms) => ({ toast: ms < 500 ? (80 * ms) / 500 : ms < 1000 ? 80 * (1 - (ms - 500) / 500) : 0 }));
      expect(restApart({ toast: 0.2 }, there, new Set(), { toast: "px" })).toBeNull();
      expect(restApart({ toast: 40 }, there, new Set(), { toast: "px" })).toMatchObject({ name: "toast", live: 40 });
      expect(restApart({ toast: -40 }, there, new Set(), { toast: "px" })).toMatchObject({ name: "toast", live: -40 });
    });
    it("a loop may be anywhere", () => {
      const withLoop = frames((ms) => ({ toast: 80, fade: 1, loop: 1 + 0.05 * Math.sin(ms / 100) }));
      expect(restApart({ toast: 80, fade: 1, loop: 1.04 }, withLoop, new Set(["loop"]), units)).toBeNull();
      expect(restApart({ toast: 80, fade: 1, loop: 1.04 }, withLoop, new Set(), units)).toMatchObject({ name: "loop" });
    });
  });

  describe("waitForRest: the total change over the last second is within the floor, on every value that is no loop", () => {
    /** A page whose state is `values(n)` on its n-th read. */
    const fake = (values: (n: number) => Record<string, number>) => {
      let n = 0;
      return { state: async () => ({ values: values(n++), events: {}, units: {} }), page: { evaluate: async () => performance.now() } } as unknown as GatePage;
    };
    it("a page that holds still is at rest after a second", async () => {
      const t = performance.now();
      expect(await waitForRest(fake(() => ({ a: 1 })), 3000, new Set(), { a: 0.01 })).not.toBeNull();
      expect(performance.now() - t).toBeGreaterThanOrEqual(1000);
    });
    it("a creep of 0.001 in 50 ms (no more than a read may move) is not rest: it is 0.02 a second, over a 0.002 floor", async () => {
      expect(await waitForRest(fake((n) => ({ k: 1 + 0.001 * n })), 2500, new Set(), { k: 0.002 })).toBeNull();
    });
    it("the same creep is rest when it is the loop's, and a drift inside the floor is rest", async () => {
      expect(await waitForRest(fake((n) => ({ k: 1 + 0.001 * n })), 3000, new Set(["k"]), {})).not.toBeNull();
      expect(await waitForRest(fake((n) => ({ k: 1 + 0.00002 * n })), 3000, new Set(), { k: 0.002 })).not.toBeNull();
    });
    it("a value that appears late is moving until it has held a second", async () => {
      expect(await waitForRest(fake((n) => (n < 12 ? {} : { b: 1 })), 1500, new Set(), { b: 0.01 })).toBeNull();
    });
  });

  describe("how far the rules read a live or scroll page: until its sequence stops, not 3 s", () => {
    it("a toast that holds 4 s is read to its end and a second past it", async () => {
      const { spanMs } = await pageInput(tracksPage(root, "live", "toast-4s", { tracks: toast(4), gaps: "tick" }));
      // The release is at about 0.85 s, the toast leaves 0.55 + 4 s on and takes 0.3 s.
      expect(spanMs).toBeGreaterThan(5500);
      expect(spanMs).toBeLessThan(8000);
    });
    it("a page that is over in a second keeps the 3 s floor", async () => {
      const { spanMs } = await pageInput(tracksPage(root, "scroll", "short-pill", { tracks: pill(0.1), gaps: "tick" }));
      expect(spanMs).toBeGreaterThanOrEqual(SPAN_MS);
      expect(spanMs).toBeLessThan(SPAN_MS + 2000);
    });
    it("a sequence still moving 15 s past the input fails span, as on a choreo page", async () => {
      const file = stallsPage(root, "live", "creep-forever", { pieces: cards(), creep: { n: "k", unit: "scale", rate: 0.006, accel: 0.0007, at: 1.2, base: 1 } });
      const v = await kindGate(file);
      expect(v.failures.filter((f) => f.startsWith("span:"))).toEqual([expect.stringMatching(/^span: a value still moves 15000 ms after the last cause stops at [\d.]+ ms; the rules read a sequence for 15 s at most$/)]);
    });
  });

  describe("planted faults: the live page stops before its sequence does", () => {
    it.each(["live", "choreo", "sim"] as const)("a %s page that stops in the middle of a fade fails loopStopsAtRest", async (kind) => {
      expect(await lines(stallsPage(root, kind, "stall-mid-fade", { pieces: slowFade(), stop: "first" }))).toEqual([expect.stringMatching(APART("o at [\\d.]+", "1"))]);
    });
    // A scroll page's smoothing keeps its clock running for about 1.2 s past the last wheel tick, so its beat is longer.
    it.each([["live", 1.5], ["scroll", 2.5]] as const)("a %s page that stops in a %d s beat, so the second element never arrives, fails loopStopsAtRest", async (kind, beatS) => {
      expect(await lines(stallsPage(root, kind, "stall-long-beat", { pieces: cards(beatS), stop: "flight" }))).toEqual([expect.stringMatching(APART("b at 0", "200"))]);
    });
    it.each(["live", "choreo"] as const)("a %s page whose toast never leaves, though it ends where it started, fails loopStopsAtRest", async (kind) => {
      expect(await lines(tracksPage(root, kind, "toast-stall", { tracks: toast(2.5), gaps: "stall" }))).toEqual([expect.stringMatching(APART("toast at 0", "80"))]);
    });
    it("a scroll page whose pill never leaves fails loopStopsAtRest", async () => {
      expect(await lines(tracksPage(root, "scroll", "pill-stall", { tracks: pill(4), gaps: "stall" }))).toEqual([expect.stringMatching(APART("pill at 0", "60"))]);
    });
    it.each(["live", "choreo"] as const)("a %s page that stops between two legs of a slide fails loopStopsAtRest", async (kind) => {
      const legs: Track[] = [["a", "px", [[0, 0.4, 0, 200, "out"], [1.4, 0.4, 200, 400, "out"]]]];
      expect(await lines(tracksPage(root, kind, "stall-between-legs", { tracks: legs, gaps: "stall" }))).toEqual([expect.stringMatching(APART("a at 200", "400"))]);
    });
    it.each(["live", "choreo"] as const)("a %s page whose late value never mounts fails loopStopsAtRest", async (kind) => {
      const tracks: Track[] = [["a", "px", [[0, 0.4, 0, 200, "out"]]], ["b", "opacity", [[1.4, 0.4, 0, 1, "inout"]]]];
      expect(await lines(tracksPage(root, kind, "mount-stall", { tracks, mount: { b: 1.4 }, gaps: "stall" }))).toEqual([expect.stringMatching(APART("b never reported", "1"))]);
    });
    // The compare goes both ways: a live run that lands past its ?seek frames' end is as far from it as one that stops short.
    it.each(["live", "choreo", "sim"] as const)("a %s page whose live slide goes 30 percent further than its ?seek frames fails loopStopsAtRest", async (kind) => {
      const slide: Piece[] = [{ n: "a", unit: "px", from: 0, to: 200, at: 0, dur: 0.4 }];
      expect(await lines(stallsPage(root, kind, "live-goes-further", { pieces: slide, liveFurther: 0.3 }))).toEqual([expect.stringMatching(APART("a at 260", "200"))]);
    });
    it.each(["live", "choreo", "sim"] as const)("a %s page whose live values stop 20%% short of its ?seek frames fails loopStopsAtRest", async (kind) => {
      const v = await lines(stallsPage(root, kind, "live-draws-short", { pieces: cards(), liveFurther: -0.2 }));
      expect(v).toEqual([expect.stringMatching(APART("a at 160", "200"))]);
    });
    it.each(["live", "choreo"] as const)("a %s panel that slides to its slot and, live, flies 500 px past it and holds fails loopStopsAtRest", async (kind) => {
      const panel: Piece[] = [{ n: "panel", unit: "px", from: -300, to: 0, at: 0, dur: 0.4 }];
      expect(await lines(stallsPage(root, kind, "panel-overruns-slot", { pieces: panel, liveFurther: 5 / 3 }))).toEqual([expect.stringMatching(APART("panel at 500", "0"))]);
    });
    it.each(["live", "choreo"] as const)("a %s badge that scales to 3 and holds where ?seek ends at 1 fails loopStopsAtRest", async (kind) => {
      const badge: Piece[] = [{ n: "badge", unit: "scale", from: 0, to: 1, at: 0, dur: 0.3 }];
      expect(await lines(stallsPage(root, kind, "badge-scales-to-3", { pieces: badge, liveFurther: 2 }))).toEqual([expect.stringMatching(APART("badge at 3", "1"))]);
    });
    // The seed contract: a random burst is judged by the same draws live as under ?seek. A live run that draws from another
    // seed lands elsewhere, and a page that draws from Math.random live lands elsewhere on every run (the known limit).
    it.each(["live", "choreo", "scroll"] as const)("a %s scatter whose live run draws from another seed than ?seek fails loopStopsAtRest", async (kind) => {
      const file = drawsPage(root, "scatter-other-seed", { kind, scene: "scatter", seed: 3, stream: "other-seed", liveSeed: 8 });
      expect(await ruleLines(file, ["loopStopsAtRest"])).toEqual([expect.stringMatching(APART("c\\d at [\\d.]+", "[\\d.]+"))]);
    });
    it("a scatter that draws unseeded random values live fails loopStopsAtRest: the known limit of the seed contract", async () => {
      const file = drawsPage(root, "scatter-unseeded", { kind: "live", scene: "scatter", seed: 3, stream: "unseeded" });
      expect(await ruleLines(file, ["loopStopsAtRest"])).toEqual([expect.stringMatching(APART("c\\d at [\\d.]+", "[\\d.]+"))]);
    });
    it("and the same pages, whose clock wakes in the gap, pass", async () => {
      expect(await lines(tracksPage(root, "live", "toast-timer", { tracks: toast(2.5), gaps: "timer" }))).toEqual([]);
      const tracks: Track[] = [["a", "px", [[0, 0.4, 0, 200, "out"]]], ["b", "opacity", [[1.4, 0.4, 0, 1, "inout"]]]];
      expect(await lines(tracksPage(root, "choreo", "mount-timer", { tracks, mount: { b: 1.4 }, gaps: "timer" }))).toEqual([]);
    });
  });

  describe("planted faults: leaving and coming back", () => {
    it.each(["live", "choreo"] as const)("a %s page whose return restarts only the loop, with the sequence frozen, fails resumes", async (kind) => {
      const v = await lines(stallsPage(root, kind, "resume-loop-only", { pieces: cards(), loops: [bob(kind === "live" ? "cause" : "load")], resume: "loop-only" }));
      expect(v).toEqual([expect.stringMatching(/^resumes: after the page leaves mid-sequence and comes back, \w+ rests at [\d.]+, where the page rests without leaving \([\d.]+\); the sequence goes on after the page resumes$/)]);
    });
    it.each(["live", "choreo"] as const)("a %s page whose return runs 6 frames and goes no further fails resumes", async (kind) => {
      const v = await lines(stallsPage(root, kind, "resume-6-frames", { pieces: cards(), loops: [bob(kind === "live" ? "cause" : "load")], resume: "once", resumeFrames: 6 }));
      expect(v).toEqual([expect.stringMatching(/^resumes: after the page leaves mid-sequence and comes back, \w+ rests at [\d.]+, where the page rests without leaving \([\d.]+\); the sequence goes on after the page resumes$/)]);
    });
    it.each(["live", "choreo"] as const)("a %s page whose sequence is over and whose return runs 6 frames, leaving the loop dead, fails resumes", async (kind) => {
      const quick: Piece[] = [{ n: "a", unit: "px", from: 0, to: 200, at: 0, dur: 0.2 }];
      // The live page's drag settles back fast, so nothing but the loop is moving by the time the page leaves.
      const v = await lines(stallsPage(root, kind, "resume-6-frames-loop-dead", { pieces: quick, loops: [bob(kind === "live" ? "cause" : "load")], resume: "once", resumeFrames: 6, omega: 60 }));
      expect(v).toEqual([expect.stringMatching(/^resumes: g has stopped moving 300 ms after the page came back on screen; the loop runs on after it resumes$/)]);
    });
    it.each([
      ["choreo", bob("cause", 2)],
      ["live", bob("cause", 1)],
      // The page's clock has long run by the time this loop starts: the gate waits for the loop's own value to move.
      ["choreo", bob("cause", 5)],
      ["live", bob("cause", 5)],
    ] as const)("a %s page whose late loop ignores the page being hidden fails pausesOffScreen", async (kind, late) => {
      const v = await lines(stallsPage(root, kind, "late-loop-ignores-hidden", { pieces: cards(), loops: [late], lateLoopIgnoresHidden: true }));
      expect(v).toEqual([expect.stringMatching(/^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen; the loop pauses off screen$/)]);
    });
    it("and the same pages that pause and resume honestly pass", async () => {
      expect(await lines(stallsPage(root, "live", "late-loop-pauses", { pieces: cards(), loops: [bob("cause", 1)] }))).toEqual([]);
      expect(await lines(stallsPage(root, "choreo", "load-loop-resumes", { pieces: cards(), loops: [bob("load")] }))).toEqual([]);
      expect(await lines(stallsPage(root, "live", "very-late-loop-pauses", { pieces: cards(), loops: [bob("cause", 5)] }))).toEqual([]);
      expect(await lines(stallsPage(root, "choreo", "very-late-loop-pauses", { pieces: cards(), loops: [bob("cause", 5)] }))).toEqual([]);
    });
    // A loop that holds still and moves for two frames a period (a smear between two holds) can move between two reads 50 ms
    // apart: after the page comes back, the gate reads every frame it draws, not a sample.
    it("an idle loop that moves for two frames between holds of 1.2 s passes resumes in 10 of 10 runs", async () => {
      const src = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds/object2-review");
      const dir = path.join(root, "smear-two-frames");
      cpSync(path.join(src, "a05-smear-between-holds"), dir, { recursive: true });
      cpSync(path.join(src, "mk.js"), path.join(root, "mk.js"));
      const file = path.join(dir, "index.html");
      const html = readFileSync(file, "utf8").replaceAll("a05-smear-between-holds", "smear-two-frames");
      writeFileSync(file, html);
      const on = await rulesOn(file);
      try {
        const runs: string[][] = [];
        for (let i = 0; i < 10; i++) runs.push(await on.run(["resumes"]));
        expect(runs.flat()).toEqual([]);
      } finally {
        await on.close();
      }
    }, 300000);
  });

  describe("planted faults: a creep beside a loop", () => {
    // A value that moves at one steady speed is a drift, and a drift is a loop (series.ts steadyStep): it may run on if it pauses off
    // screen. A creep that speeds up by a hair a second moves 0.02 a second or less (under what two reads 50 ms apart can tell),
    // is no drift, and has to come to rest like any value.
    it.each([
      ["a scale that creeps up from 1", { n: "k", unit: "scale", rate: 0.006, accel: 0.0007, at: 1.2, base: 1 }],
      ["an opacity that creeps up from 0.3", { n: "k", unit: "opacity", rate: 0.006, accel: 0.0007, at: 1.2, base: 0.3 }],
    ] as const)("%s beside a loop fails loopStopsAtRest", async (_what, creep) => {
      // The seek frames never rest either, so the gate waits out the whole 15 s read before it looks. An opacity creeps
      // under its 0.01 floor for the first seconds: the live page then reads as at rest, and ends far from the seek frames' end.
      const v = await ruleLines(stallsPage(root, "live", "creep-beside-loop", { pieces: cards(), loops: [bob("cause", 1)], creep }), ["loopStopsAtRest"]);
      expect(v).toEqual([expect.stringMatching(/^loopStopsAtRest: (the page is still moving 5 s after the input ends|the live page comes to rest with k at [\d.]+, where its \?seek frames end at [\d.]+; the live loop stopped before its sequence ended)$/)]);
    }, 120000);
  });
});

// A plain CSS ease with a cube-root cusp at its middle, cubic-bezier(1,0,0,1), stands out from the sub-steps beside it
// by 4 to 5: more than a square-root cusp's 2.6 to 2.9, so no fixed cap on that ratio passes it. It is no jump, since its
// largest sub-step shrinks as the sub-steps get finer. The same page with a snap on the ease still fails.
describe.concurrent("the kind gate: a steep ease is no jump (suddenJumps)", () => {
  const dir = path.join(PAGES, "choreo-steep-ease");
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-steep-ease-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("a choreo page with a cubic-bezier(1,0,0,1) move beside a gentle one passes every rule", async () => {
    const v = await kindGate(path.join(dir, "index.html"));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // 15 px added to the 300 px move at 100 ms (before its middle, in a frame that moves 4 px) and at 330 ms (after it).
  it.each([100, 330])("the same page with a 15 px snap at %s ms fails suddenJumps", async (at) => {
    cpSync(dir, path.join(root, `snap-${at}`), { recursive: true });
    const file = path.join(root, `snap-${at}`, "index.html");
    writeFileSync(file, readFileSync(file, "utf8").replace("f:tw(0,300,400,bez(1,0,0,1))", `f:((e) => (d) => e(d) + (d * 1000 >= ${at}.3 ? 15 : 0))(tw(0,300,400,bez(1,0,0,1)))`));
    const v = await kindGate(file);
    expect(v.failures.filter((f) => f.startsWith("suddenJumps:"))).toEqual([expect.stringMatching(/^suddenJumps: x moves -?[\d.]+ in the frame after [\d.]+ ms, and -?[\d.]+ in its first half; no cut marks it$/)]);
  });

  /** A copy of the page with its cubic-bezier(1,0,0,1) move replaced by `move`. */
  const variant = (name: string, move: string) => {
    cpSync(dir, path.join(root, name), { recursive: true });
    const file = path.join(root, name, "index.html");
    writeFileSync(file, readFileSync(file, "utf8").replace("f:tw(0,300,400,bez(1,0,0,1))", move));
    return file;
  };

  // A steep ease whose speed is bounded: its straight middle is far narrower than a frame, and the frame steps beside it
  // fall away as the steps of one bell do.
  it.each([0.96, 0.98, 0.99, 0.995])("the same page on cubic-bezier(x1,0,1-x1,1) at x1 = %s passes every rule", async (x1) => {
    const v = await kindGate(variant(`bounded-${x1}`, `f:tw(0,300,400,bez(${x1},0,${+(1 - x1).toFixed(3)},1))`));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // A recoil: 40 px out in 10 ms, back over 400 ms. The frame before it holds still, so it is no ease's middle.
  it.each(["E.linear", "bez(0.9,0,0.1,1)"])("the same page with a recoil out on %s in 10 ms fails suddenJumps", async (ease) => {
    const v = await kindGate(variant(`recoil-${ease.replace(/\W+/g, "-")}`, `f:((e) => (d) => { const t = d * 1000; return t <= 0 ? 0 : t < 10 ? 40 * e(t / 10) : 40 * (1 - bez(0,0,0.2,1)(Math.min(1, (t - 10) / 400))); })(${ease})`));
    expect(v.failures.filter((f) => f.startsWith("suddenJumps:"))).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
  });

  // An 80 px tween of 2 ms on the top of cubic-bezier(0.98,0,0.02,1): the steps beside it fall away, but its change holds
  // its size as the window narrows past the tween.
  it("the same page with an 80 px tween of 2 ms on the top of cubic-bezier(0.98,0,0.02,1) fails suddenJumps", async () => {
    const v = await kindGate(variant("tween-on-top", "f:((e) => (d) => e(d) + 80 * clamp01((d * 1000 - 210) / 2))(tw(0,300,400,bez(0.98,0,0.02,1)))"));
    expect(v.failures.filter((f) => f.startsWith("suddenJumps:"))).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
  });

  // The jump sweep's moved rows on a real page (test/jump-sweep.test.ts reads them at 64 start phases). A steep ease on a
  // range of a few unit floors moves its flanks under the unit floor, and they still fall away as a bell's do.
  it.each([4, 8])("the same page on cubic-bezier(0.98,0,0.02,1) over %s px passes every rule", async (by) => {
    const v = await kindGate(variant(`small-${by}`, `f:tw(0,${by},400,bez(0.98,0,0.02,1))`));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // An ease-out that leaves its hold at a vertical tangent late in a frame, and an ease-in that reaches its hold early in
  // one: the cusp is read across the frame's edge.
  it.each([["bez(0,1,0,1)", 15.8], ["bez(1,0,1,0)", 0.8]])("the same page on %s started %s ms in passes every rule", async (curve, delay) => {
    const v = await kindGate(variant(`edge-${curve.replace(/\W+/g, "-")}`, `f:tw(0,300,400,${curve},${delay})`));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // A one-way flick of 40 px in 5 ms inside the gentle move, on an ease whose middle is a true cusp or nearly one: the
  // frame steps beside it move as much as the steps beyond them, so it is no ease's middle.
  it.each(["E.circInOut", "bez(1,0,0,1)", "bez(0.98,0,0.02,1)"])("the same page with a one-way flick on %s in 5 ms inside a move fails suddenJumps", async (ease) => {
    const v = await kindGate(variant(`in-move-${ease.replace(/\W+/g, "-")}`, `f:((m, k) => (d) => m(d) + k(d))(tw(0,300,400,bez(0.25,0.1,0.25,1)), tw(0,40,5,${ease},200))`));
    expect(v.failures.filter((f) => f.startsWith("suddenJumps:"))).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
  });

  // A recoil out on a true cusp: the frame before it holds still.
  it("the same page with a recoil out on circInOut in 10 ms fails suddenJumps", async () => {
    const v = await kindGate(variant("recoil-circ", "f:((e) => (d) => { const t = d * 1000; return t <= 0 ? 0 : t < 10 ? 40 * e(t / 10) : 40 * (1 - bez(0,0,0.2,1)(Math.min(1, (t - 10) / 400))); })(E.circInOut)"));
    expect(v.failures.filter((f) => f.startsWith("suddenJumps:"))).toEqual([expect.stringMatching(/^suddenJumps: x moves /)]);
  });
});

describe.concurrent("a value that is an edge of many moving parts (trace.json extents)", () => {
  // A ring of 24 cards that spins on an ease-out and tips out as it turns (extent-pages.ts). Its `top` and `height` are
  // the box around all the cards. When another card becomes the extreme one the value turns by up to a pixel or two, as
  // an overshoot or a pulse with a slow attack, though no body passes its rest.
  const root = mkdtempSync(path.join(os.tmpdir(), "motion-kit-extents-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const WOBBLE = /^overshoot: (top|height) passes its rest by [\d.]+ at [\d.]+ ms and comes back; only motion a person caused may overshoot$/;

  it("undeclared, the ring's box fails overshoot and nothing else; declared as extents of its cards, the page passes every rule", async () => {
    const unnamed = await kindGate(ringPage(root, { extents: "none" }));
    expect(unnamed.failures).toEqual(expect.arrayContaining([expect.stringMatching(WOBBLE)]));
    expect(failing(unnamed)).toEqual(["overshoot"]);
    const named = await kindGate(ringPage(root));
    expect(named.failures).toEqual([]);
    expect(named.status).toBe("passed");
  });

  // The guard: in every frame the value is that edge of the union of its parts' boxes, and the parts are a group.
  it("a value that is not the union's edge fails the guard: 22 of the 24 cards summed, or 3 px high", async () => {
    for (const report of ["fewer", "inflated"] as const) {
      const v = await kindGate(ringPage(root, { report }));
      expect(v.failures, report).toEqual(expect.arrayContaining([expect.stringMatching(/^extents: top is not the top of its parts at [\d.]+ ms$/)]));
      expect(failing(v), report).toContain("extents");
    }
  });

  it("the two cards at the ring's top left out of the list leave the union short of the value", async () => {
    const parts = BOTH.top!.parts.filter((p) => p !== "c11" && p !== "c12");
    const v = await kindGate(ringPage(root, { extents: { top: { edge: "top", parts } } }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^extents: top is not the top of its parts at [\d.]+ ms$/)]));
  });

  it("a single body cannot be named: its value with a 10% overshoot fails the guard, and its overshoot still fails", async () => {
    // One part: no group. Two, with the second never drawn: still no group.
    const one = await kindGate(bodyPage(root, { x: { edge: "left", parts: ["dot"] } }));
    expect(one.failures.filter((f) => f.startsWith("extents:"))).toEqual(["extents: x names 1 part; an extent is the edge of 2 or more parts, and a single body cannot be named"]);
    const ghost = await kindGate(bodyPage(root, { x: { edge: "left", parts: ["dot", "ghost"] } }));
    expect(ghost.failures.filter((f) => f.startsWith("extents:"))).toEqual([expect.stringMatching(/^extents: x has 2 parts drawn in 0 of \d+ frames where any is; an extent is the edge of parts drawn together$/)]);
    for (const v of [one, ghost]) expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^overshoot: x passes its rest by [\d.]+ at [\d.]+ ms and comes back; /)]));
  });

  // A second part that sits beside the body and never holds the edge is no group: the extreme part must change hands.
  const HELD_BY_ONE = /^extents: x is held by dot throughout; an extent is an edge that passes from one part to another$/;
  const TURNS_ROUND = /^extents: x has dot turn round at [\d.]+ ms while it holds the edge and then comes to rest; a body that passes its rest is no handover$/;
  const X_OVERSHOOT = /^overshoot: x passes its rest by [\d.]+ at [\d.]+ ms and comes back; /;
  const LEFT = { x: { edge: "left", parts: ["dot", "decoy"] } };

  it("a drawn decoy that never holds the edge does not make a body a group: its 10% overshoot still fails", async () => {
    const v = await kindGate(bodyPage(root, LEFT, { decoy: "static" }));
    expect(v.failures.filter((f) => f.startsWith("extents:"))).toEqual([expect.stringMatching(HELD_BY_ONE)]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(X_OVERSHOOT)]));
  });

  it("a drawn decoy that never holds the edge does not excuse a 4 px pulse with a 200 ms attack either", async () => {
    const v = await kindGate(bodyPage(root, LEFT, { decoy: "static", move: "pulse" }));
    expect(v.failures.filter((f) => f.startsWith("extents:"))).toEqual([expect.stringMatching(HELD_BY_ONE)]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: x at [\d.]+ ms is a pulse that peaks 1\d\d ms after it starts; a pulse's attack is 40 to 120 ms$/)]));
  });

  // The edge changes hands once, early; the body then holds it alone and springs past its rest: that turn is the body's.
  it("an edge that changes hands once and then belongs to a body that turns round is no extent", async () => {
    const v = await kindGate(bodyPage(root, LEFT, { decoy: "crosses" }));
    expect(v.failures.filter((f) => f.startsWith("extents:"))).toEqual([expect.stringMatching(TURNS_ROUND)]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(X_OVERSHOOT)]));
  });

  // A decoy that holds the edge with the dot (a tie goes to the first listed), runs past and goes gone at 400 ms is drawn with it in
  // 24 frames of some 400: the edge changes hands, but the two are no group. A 4 px pulse of a 300 ms attack turns too slowly for the
  // turn-round test, so the group condition alone fails it (the page passes every rule when GROUP_SHARE is 0).
  it("a slow pulse beside a decoy drawn with it for only a short while is no extent: the group guard fails, and envelope", async () => {
    const v = await kindGate(bodyPage(root, { x: { edge: "left", parts: ["decoy", "dot"] } }, { decoy: "brief", move: "pulse", attackMs: 300, startMs: 500 }));
    expect(v.failures.filter((f) => f.startsWith("extents:"))).toEqual([expect.stringMatching(/^extents: x has 2 parts drawn in \d+ of \d+ frames where any is; an extent is the edge of parts drawn together$/)]);
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: x at 500 ms is a pulse that peaks \d+ ms after it starts; a pulse's attack is 40 to 120 ms$/)]));
  });

  // The dot also drifts down while it slides, so the whole of its box never turns back, though its left edge does.
  it("a body that springs past its rest while it drifts across the edge, beside a decoy that holds the edge first and runs past, is still no extent", async () => {
    for (const drift of [3, 8]) {
      const v = await kindGate(bodyPage(root, LEFT, { decoy: "crosses", drift }));
      expect(v.failures.filter((f) => f.startsWith("extents:")), `drift ${drift}`).toEqual([expect.stringMatching(TURNS_ROUND)]);
      expect(v.failures, `drift ${drift}`).toEqual(expect.arrayContaining([expect.stringMatching(X_OVERSHOOT)]));
    }
  });

  it("names the declaration's own faults: a value the page does not report, one not in px, a part not in the record", async () => {
    const lines = async (extents: Parameters<typeof ringPage>[1]) => (await kindGate(ringPage(root, extents))).failures.filter((f) => f.startsWith("extents:"));
    expect(await lines({ extents: { zz: { edge: "top", parts: ["c0", "c1"] } } })).toEqual(["extents: zz is not a value the page reports"]);
    expect(await lines({ extents: { top: { edge: "top", parts: ["c0", "zz"] } } })).toEqual(["extents: top names zz, which is not an object the page reports"]);
    expect(await lines({ extents: { top: { edge: "top", parts: ["c0"] } } })).toEqual(["extents: top names 1 part; an extent is the edge of 2 or more parts, and a single body cannot be named"]);
  });

  // Naming the ring's box excuses the ring's box and nothing beside it: each rule still reads every other value.
  it("a 600 px slide beside the ring that springs 3% past its rest still fails overshoot, and the ring's box does not", async () => {
    const v = await kindGate(ringPage(root, { extra: "slide" }));
    expect(v.failures).toEqual([expect.stringMatching(/^overshoot: slide passes its rest by [\d.]+ at [\d.]+ ms and comes back; only motion a person caused may overshoot$/)]);
  });

  it("a 4 px badge pulse with a 200 ms attack beside the ring still fails envelope", async () => {
    const v = await kindGate(ringPage(root, { extra: "badge" }));
    expect(v.failures).toEqual([expect.stringMatching(/^envelope: badge at [\d.]+ ms is a pulse that peaks 1\d\d ms after it starts; a pulse's attack is 40 to 120 ms$/)]);
  });

  // A part that comes back or goes gone changes who is in the union, so the edge jumps with no body moving: no pop.
  it("cards that fade in one after another at their places are no pops in the box around them", async () => {
    const v = await kindGate(ringPage(root, { fade: true }));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  // With no card drawn the page reports the bottom of the viewport, so the first card to come back swings `top` by 123 px and
  // `height` by 62 px in one frame, with no body moving: suddenJumps leaves that step out and reads the cards in both frames.
  it("cards that fade in from a box at the bottom of the viewport are no jump in the box around them", async () => {
    const v = await kindGate(ringPage(root, { fade: true, idle: "bottom" }));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
  });

  it("a card that jumps 100 px up in the step in which another comes back is a jump in the box, with the box starting at the bottom of the viewport", async () => {
    const v = await kindGate(ringPage(root, { fade: true, idle: "bottom", popAtArrival: true }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^suddenJumps: top moves -?[\d.]+ in the frame after 983\.333 ms, and -?[\d.]+ in its first half; no cut marks it$/)]));
  });

  it("a card that jumps once all the cards have faded in is still a pop", async () => {
    const v = await kindGate(ringPage(root, { fade: true, pop: true }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: top at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/)]));
  });

  // The step in which a card comes back is judged on the cards drawn in both frames: a card that jumps in that very step is a pop.
  it("a card that jumps 100 px up in the very frame step in which another card comes back is still a pop", async () => {
    const v = await kindGate(ringPage(root, { fade: true, popAtArrival: true }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: top at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/)]));
    expect(failing(v)).not.toContain("extents");
  });

  it("a card that jumps 100 px up in one frame is a pop in the named top, which still fails envelope", async () => {
    const v = await kindGate(ringPage(root, { pop: true }));
    expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^envelope: top at [\d.]+ ms covers \d+% of its whole change in the one frame after [\d.]+ ms; that is a pop$/)]));
    expect(failing(v)).not.toContain("extents");
  });
});
