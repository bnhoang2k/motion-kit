import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run, type CliIo } from "../../src/cli/run.ts";
import { closeBrowser, FRAME_MS, openPage } from "../../src/gate/harness.ts";
import { inputPastSpan, inputStartAfter, kindGate, recordedSpan, SETTLE_MS, SPAN_MS, sweepInput, type KindVerdict } from "../../src/gate/kind-gate.ts";
import { INPUT_START_MS, syntheticInput } from "../../src/gate/synthetic-input.ts";
import { rules as liveRules } from "../../kinds/live/gate.ts";

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
  // idle-rise-50ms: a 50 ms eased rise is no pop. moves-*: a 600 ms ease-in-out, a 1 s spring and a
  // 600 ms easeInBack (its dip is not the move) have no attack bound; a 1.2 s loop with a 480 ms bump
  // is a loop, not a pulse. live-hit-test: a press grabs only on the dot, so the regrab must aim at
  // it; live-slider-x does the same for a knob that follows only x. bar-cut: a bar's one-frame jump
  // at a cut in its trace.json is no pop.
  // scroll-intro: a value that eases in over 1.5 s at load; the input waits for it, so the scroll rules judge only
  // what the scroll moves. scroll-snap05: a 0.05 px rest snap after a still stretch is below the px floor, so no pop.
  it.each(["idle-good", "live-good", "scroll-good", "scroll-intro", "scroll-snap05", "idle-rise-50ms", "moves-ease600", "moves-spring1s", "moves-back600", "moves-bump-loop", "live-hit-test", "live-slider-x", "bar-cut/index.html", "scroll-stepped"])("%s passes every rule", async (name) => {
    const v = await kindGate(page(name));
    expect(v.failures).toEqual([]);
    expect(v.status).toBe("passed");
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
    ["idle-pulse-short", "envelope", /^envelope: f at 50 ms is a pulse that peaks (1\d|2\d) ms after it starts; a pulse's attack is 40 to 120 ms$/],
    ["idle-pulse-slow", "envelope", /^envelope: f at 50 ms is a pulse that peaks (19\d|20\d) ms after it starts; a pulse's attack is 40 to 120 ms$/],
    ["idle-fade-rises", "envelope", /^envelope: o rises at [\d.]+ ms, during the fade that starts at 1000 ms; fades only fall$/],
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
    ["scroll-one-way", "reverses", /^reverses: p moves [\d.]+ while the page scrolls down, then [\d.]+ when it scrolls back; scrolling back reverses it$/],
  ];

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
    for (const k of ["choreo", "oneshot"]) {
      const v = await kindGate(page(k));
      expect(v.status).toBe("failed");
      expect(v.failures).toEqual([`kind: ${k} has no kind gate in this version of motion-kit (only live, idle, scroll do), so the page cannot pass`]);
    }
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
