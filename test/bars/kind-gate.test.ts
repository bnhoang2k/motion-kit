import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run, type CliIo } from "../../src/cli/run.ts";
import type { KindName } from "../../src/core/types.ts";
import { closeBrowser, FRAME_MS, openPage } from "../../src/gate/harness.ts";
import { drawn, DRAWN_BOUNDARIES, DRAWN_EVEN, DRAWN_SAMPLES, drawnRead } from "../../src/gate/drawn.ts";
import { drawingsOf } from "../../src/gate/poses.ts";
import { series, stillTol } from "../../src/gate/series.ts";
import { inputPastSpan, inputStartAfter, kindGate, pageInput, recordedSpan, SETTLE_MS, SPAN_MS, sweepInput, type KindVerdict } from "../../src/gate/kind-gate.ts";
import { INPUT_START_MS, syntheticInput } from "../../src/gate/synthetic-input.ts";
import { rules as liveRules } from "../../kinds/live/gate.ts";
import { FAULTY, HONEST, NOT_NUMBERS, OTHER_FAULTS, sweepPage, writeSteppedBar, type Drawing } from "./stepped-pages.ts";
import { inputSlug, writeInputBar, type InputPage } from "./input-pages.ts";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages/kinds");
const page = (name: string) => path.join(PAGES, name.endsWith(".html") ? name : `${name}.html`);

/** The names of the checks that report a failure: each line starts with its check's name. */
const failing = (v: KindVerdict) => [...new Set(v.failures.map((f) => f.slice(0, f.indexOf(":"))))].sort();

afterAll(async () => {
  await closeBrowser();
});

describe("the synthetic input", () => {
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

describe("the kind gate", () => {
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
  // shows the hold, then leaves it in one frame.
  // sim-good: a dropped ball bounces to rest, a rolled ball stops past the edge, and a ring loops and pauses off
  // screen; sim-load: the same started on load, with no bounce.
  // scroll-intro: a value that eases in over 1.5 s at load; the input waits for it, so the scroll rules judge only
  // what the scroll moves. scroll-snap05: a 0.05 px rest snap after a still stretch is below the px floor, so no pop.
  // bar-stepped: a lift held in drawings on purpose (trace.json "stepped") is judged at its drawing rate.
  // bar-live-grid: a dot dragged on a 20 px grid, and bar-scroll-flipbook: a flipbook drawn by the scroll. While the
  // input drives them their stepped values read as drawings, so the input rules judge what the hand sees.
  it.each(["bar-stepped/index.html", "bar-live-grid/index.html", "bar-scroll-flipbook/index.html", "idle-good", "live-good", "scroll-good", "scroll-intro", "scroll-snap05", "idle-rise-50ms", "moves-ease600", "moves-spring1s", "moves-back600", "moves-bump-loop", "live-hit-test", "live-slider-x", "bar-cut/index.html", "bar-cut-move/index.html", "scroll-stepped", "choreo-good", "choreo", "choreo-cycle", "choreo-load", "choreo-pause", "choreo-shake", "choreo-toast", "sim-good", "sim-load"])("%s passes every rule", async (name) => {
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
    expect(idle.distances).toEqual(["idle.period 1.6 s, 60% below base (31-breath-pacer: 4.0 s)"]);
  });

  it("reports each scroll KNOBS value's distance from its base, as information", async () => {
    const scroll = await kindGate(page("scroll-good"));
    expect(scroll.distances).toEqual([
      "scroll.smooth 0.167 s, at base (04-scale-as-camera: 0.167 s)",
      "scroll.maxStep 0.05 s, at base (04-scale-as-camera: 0.05 s)",
    ]);
  });

  /** Each fault page, the one rule it fails, and the line that rule prints when the line is worth pinning. */
  const faults: [string, string | string[], RegExp?][] = [
    ["idle-pop", "envelope", /^envelope: y at 600 ms covers 100% of its whole change in the one frame after 600 ms; that is a pop$/],
    ["scroll-pop06", "envelope", /^envelope: q at 83.333 ms covers 100% of its whole change in the one frame after 83.333 ms; that is a pop$/],
    ["bar-uncut/index.html", "envelope", /^envelope: y at 600 ms covers 100% of its whole change in the one frame after 600 ms; that is a pop$/],
    ["bar-cut-move-uncut/index.html", "envelope", /^envelope: x at 850 ms covers \d+% of its whole change in the one frame after 983.333 ms; that is a pop$/],
    // Stepped motion: unmarked, each pose change is a pop; marked, a lift of 1.5 dot lengths set in one pose is still a
    // pop.
    ["bar-stepped-unmarked/index.html", "envelope", /^envelope: y at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["bar-stepped-set/index.html", "envelope", /^envelope: y at [\d.]+ ms jumps 1.5 (of its object's length in 1 drawing, [\d.]+ times the drawings around it; that is a pop|object lengths between two rests; that is a teleport)$/],
    // A pop whose middle frame is NaN or missing: no other rule sees it, so values fails it.
    ["idle-value-nan", "values", /^values: y is NaN at 616.667 ms; a value the page reports is a finite number in every frame once it appears$/],
    ["idle-value-missing", "values", /^values: y is missing at 616.667 ms; a value the page reports is a finite number in every frame once it appears$/],
    ["idle-pulse-short", "envelope", /^envelope: f at 50 ms is a pulse that peaks (1\d|2\d) ms after it starts; a pulse's attack is 40 to 120 ms$/],
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
    ["choreo-one-onset", "interrupt", /^interrupt: every value starts at [\d.]+ ms; one onset is not a sequence$/],
    ["choreo-raf-forever", "loopStopsAtRest", /^loopStopsAtRest: \d+ rAF callbacks ran in the second after the page came to rest$/],
    ["choreo-reduced-ignored", "reducedMotion", /^reducedMotion: b0 rests at 0 after the cause at [\d.]+ ms under reduced motion, and at 200 without it; reduced motion shows the sequence's end state$/],
    // A tap's sequence is judged by envelope, however late a piece starts: a set piece pops, at 233 ms or 4.8 s in.
    ["choreo-set-piece", "envelope", /^envelope: b2 at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["choreo-late-pop", "envelope", /^envelope: b2 at 5050 ms covers 100% of its whole change in the one frame after 5050 ms; that is a pop$/],
    ["choreo-fade-rises", ["envelope", "overshoot"], /^envelope: o rises at [\d.]+ ms, during the fade that starts at [\d.]+ ms; fades only fall$/],
    ["choreo-live-stalls", "loopStopsAtRest", /^loopStopsAtRest: the live page comes to rest with b1 still at its start, 0, where its \?seek frames end at 200; the live loop stopped before its sequence ended$/],
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
    ["sim-glow-pop", "envelope", /^envelope: fade at [\d.]+ ms covers 100% of its whole change in the one frame after [\d.]+ ms; that is a pop$/],
    ["sim-loop-no-pause", "pausesOffScreen", /^pausesOffScreen: \d+ rAF callbacks ran in the 500 ms after the page went off screen/],
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

    // A fault page that lists a cut where it draws only its 40 px dot also fails drawn's cut check: the
    // listed cut is no scene change.
    const CUT_LINE: Record<string, string> = {
      "outlier-at-cut": "drawn: the cut at 2000 ms changes 0.1% of the view; a cut is a scene change",
      "outlier-then-settle": "drawn: the cut at 1000 ms changes 0.1% of the view; a cut is a scene change",
    };

    it.each(Object.keys(FAULTY))("%s fails only its stepped pop", async (slug) => {
      const v = await kindGate(writeSteppedBar(root, slug, FAULTY[slug]!));
      expect(v.status).toBe("failed");
      if (slug === "frozen") {
        expect(v.failures).toEqual(["stepped: y never changes"]);
        return;
      }
      const cut = CUT_LINE[slug];
      expect(failing(v)).toEqual(cut ? ["drawn", "envelope"] : ["envelope"]);
      expect(v.failures).toEqual(expect.arrayContaining([expect.stringMatching(POP), ...(cut ? [cut] : [])]));
      expect(v.failures).toHaveLength(cut ? 2 : 1);
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
      const cut = CUT_LINE[slug];
      expect(failing(v)).toEqual(cut ? ["drawn", rule] : [rule]);
      if (cut) expect(v.failures).toContain(cut);
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

  it("skips the literal check only for the kit's own bar: an adapted copy with a changed MOTION gets it", async () => {
    const BAR = path.resolve(import.meta.dirname, "../../bars/04-scale-as-camera");
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
      expect(v.notes).toEqual(["note: the literal check runs: the page's MOTION block differs from bars/04-scale-as-camera/index.html, so the page is adapted, not a copy"]);
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

describe("drawn: a page's objects cover what changes on screen", () => {
  const STRAY = /^drawn: pixels change outside every object between [\d.]+ and [\d.]+ ms \(\d+ px\); the objects do not cover what the page draws$/;
  const GHOST = /^drawn: dot moves [\d.]+ px between [\d.]+ and [\d.]+ ms but nothing changes on screen there$/;
  const TIGHT = /^drawn: dot's box is bigger than what it draws between [\d.]+ and [\d.]+ ms$/;
  const CUT = /^drawn: the cut at 1000 ms changes [\d.]+% of the view; a cut is a scene change$/;
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
  it.each(["drawn-honest", "drawn-ambient", "drawn-blink", "drawn-nod"])("%s passes every rule", async (name) => {
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
  // that frame only. drawn-cut-weak: a bar whose listed cut at 1 s only moves the dot 120 px, while a slab slides out
  // and back each loop. drawn-parallax: a moon no object reports, moved by the scroll at half its speed, so it changes
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
    ["drawn-cut-weak/index.html", CUT],
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

describe("motion-kit gate", () => {
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
    expect(t.out.join("")).toBe("idle.period 1.6 s, 60% below base (31-breath-pacer: 4.0 s)\npassed\n");
    expect(t.err.join("")).toBe("");
  });

  it("exits 1 and prints failed: n for a fault page", async () => {
    const t = io();
    expect(await run(["gate", "scroll-one-way.html"], t.api)).toBe(1);
    expect(t.out.join("")).toMatch(/(^|\n)failed: 1\n$/);
    expect(t.err.join("")).toMatch(/^reverses: p moves /);
  });
});

describe("the kind gate on pages that once got a wrong verdict", () => {
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
    ["class-review/d4-cut-hides-later-pop/index.html", ["envelope"]],
    ["class-review/d6-short-trace-latepop/index.html", ["envelope"]],
    ["class-review/d8-wild-frame-at-cut/index.html", ["envelope"]],
  ] as const)("%s fails %s", async (name, rules) => {
    const v = await kindGate(page(name));
    expect(failing(v)).toEqual([...rules]);
  });
});
