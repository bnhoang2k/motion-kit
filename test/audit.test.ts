import { describe, expect, it } from "vitest";
import { audit, literalExemption } from "../src/gate/audit.ts";
import { base } from "./knob-base.ts";

const KIND = '<meta name="motion-kit-kind" content="idle">';
const BAR = '<meta name="motion-kit-bar" content="99-fake-loop">';
const page = (head: string, script: string, extra = "") => `<!doctype html><html><head>${head}${extra}</head><body><div id="dot"></div><script>\n${script}\n</script></body></html>`;

const KNOBS = `/* motion-kit:knobs */
const KNOBS = {
  "idle": {
    "period": 6
  }
};`;

describe("the static audit", () => {
  it("passes a page whose motion numbers sit in MOTION", () => {
    const html = page(KIND, "const MOTION = { fadeMs: 300, ease: [0.4, 0, 0.2, 1], stiffness: 200 };\nconst h = 1 / 60;");
    expect(audit(html)).toEqual({ failures: [], distances: [] });
  });

  it("fails one literal duration outside MOTION, and names its line", () => {
    const html = page(KIND, "const MOTION = { ease: [0.4, 0, 0.2, 1] };\nconst fadeMs = 300;");
    expect(audit(html).failures).toEqual(["audit: line 3: fadeMs = 300 is a duration typed as a literal outside MOTION and KNOBS"]);
  });

  it("fails easings, springs, loop periods and CSS times typed as literals", () => {
    const html = page(
      KIND,
      [
        "el.animate([{ opacity: 0 }, { opacity: 1 }], { easing: 'ease-out' });",
        "const spring = { stiffness: 300 };",
        "const loopPeriod = 4;",
        "const motionOpts = { duration: 0.3 };",
      ].join("\n"),
      "<style>#dot { transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1) }</style>",
    );
    const lines = audit(html).failures;
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^audit: line \d+: 0\.3s is a duration/),
      expect.stringMatching(/^audit: line \d+: cubic-bezier\( is an easing/),
      expect.stringMatching(/^audit: line \d+: ease-out is an easing/),
      expect.stringMatching(/^audit: line \d+: easing = '\.\.\. is an easing/),
      expect.stringMatching(/^audit: line \d+: stiffness = 300 is a spring value/),
      expect.stringMatching(/^audit: line \d+: loopPeriod = 4 is a loop period/),
      expect.stringMatching(/^audit: line \d+: duration = 0\.3 is a duration/),
    ]));
    expect(lines).toHaveLength(7);
  });

  it("does not count literals in comments, a zero, a number inside an expression, or numbers with no motion name", () => {
    const html = page(KIND, "// fadeMs = 300, transition 0.3s\n/* stiffness: 200 */\nlet elapsedMs = 0;\nconst size = 40, half = 0.5;\nconst zeta = 1 - MOTION.bounce;");
    expect(audit(html).failures).toEqual([]);
  });

  it("fails a literal inside an expression, unless it combines with a MOTION or KNOBS value", () => {
    const html = page(KIND, "const fadeMs = 300 * k;\nconst opts = { duration: 300 + extra };\nconst holdMs = 2 * MOTION.fadeMs;\nconst loopS = 1 + KNOBS.idle.period;");
    expect(audit(html).failures).toEqual([
      "audit: line 2: fadeMs = 300 is a duration typed as a literal outside MOTION and KNOBS",
      "audit: line 3: duration = 300 is a duration typed as a literal outside MOTION and KNOBS",
    ]);
  });

  it("passes the same literal inside MOTION or KNOBS", () => {
    const html = page(KIND, `const MOTION = {\n  fadeMs: 300,\n  nested: { delayMs: 120 },\n};\n${KNOBS}`);
    expect(audit(html).failures).toEqual([]);
  });

  const CLOCK = (name: string) =>
    `${name} runs on the wall clock, which the fixed clock cannot see; time motion on the page clock, or mark the line with a motion-kit:clock comment (the page clock's own time read) or motion-kit:not-motion (it times no motion)`;

  it("fails a setTimeout that drives an opacity change", () => {
    const html = page(KIND, "const MOTION = {};\nsetTimeout(() => { document.getElementById('dot').style.opacity = '0'; }, 500);");
    expect(audit(html).failures).toEqual([`audit: line 3: ${CLOCK("setTimeout")}`]);
  });

  // Each of these times motion with no style write in the callback, so only a fail-closed check sees it.
  it.each([
    ["a timer that sets a motion target", "let target = 0;\nsetTimeout(() => { target = 200; }, 300);", "setTimeout"],
    ["a timer that names a function", "function go() { state.open = true; }\nsetTimeout(go, 500);", "setTimeout"],
    ["a promise wait", "const wait = (n) => new Promise((done) => setTimeout(done, n));\nawait wait(300); dot.dataset.on = '1';", "setTimeout"],
    ["a timer that changes a dataset", "setInterval(() => { dot.dataset.state = 'open'; }, 300);\nconst x = 1;", "setInterval"],
  ])("fails %s", (_, script, name) => {
    const html = page(KIND, script);
    expect(audit(html).failures).toEqual([expect.stringMatching(new RegExp(`^audit: line [23]: ${name} runs on the wall clock`))]);
  });

  it("fails an opacity timed by a performance.now() delta, and Date.now()", () => {
    const html = page(KIND, "const t0 = performance.now();\nfunction frame() { dot.style.opacity = String(Math.min(1, (performance.now() - t0) / MOTION.fadeMs)); }\nconst MOTION = { fadeMs: 300 };\nconst stamp = Date.now();");
    expect(audit(html).failures).toEqual([
      `audit: line 2: ${CLOCK("performance.now()")}`,
      `audit: line 3: ${CLOCK("performance.now()")}`,
      `audit: line 5: ${CLOCK("Date.now()")}`,
    ]);
  });

  // A page can wait on the wall clock without a timer or a now(): an idle callback, or the document timeline's time.
  it("fails requestIdleCallback, document.timeline.currentTime and new Date()", () => {
    const html = page(KIND, "const wait = () => (document.timeline.currentTime > 3500 ? go() : requestIdleCallback(wait));\nconst stamp = new Date().getTime();\nconst fixed = new Date(0);");
    expect(audit(html).failures).toEqual([
      `audit: line 2: ${CLOCK("document.timeline.currentTime")}`,
      `audit: line 2: ${CLOCK("requestIdleCallback")}`,
      `audit: line 3: ${CLOCK("new Date()")}`,
    ]);
  });

  it("passes a wall-clock use whose line carries a clock marker", () => {
    const html = page(
      KIND,
      [
        "let last = performance.now(); // motion-kit:clock",
        "while (jobs.length && performance.now() - t0 < 7) jobs.shift()(); // motion-kit:not-motion",
        "setTimeout(() => console.log('saved'), 500); /* motion-kit:not-motion */",
      ].join("\n"),
    );
    expect(audit(html).failures).toEqual([]);
  });

  it("skips the literal check when asked: a copied bar keeps its numbers", () => {
    const html = page(BAR, "const fadeMs = 300;\nconst spring = { stiffness: 300 };", "<style>#dot { transition: opacity 0.3s ease-out }</style>");
    expect(audit(html, [], { literals: false })).toEqual({ failures: [], distances: [] });
    expect(audit(html).failures).toHaveLength(4);
  });

  it("fails a timer on a copied bar too", () => {
    const html = page(BAR, "setTimeout(() => dot.classList.add('on'), 200);");
    expect(audit(html, [], { literals: false }).failures).toEqual([`audit: line 2: ${CLOCK("setTimeout")}`]);
  });

  describe("literalExemption", () => {
    const MOTION = "const MOTION = { loopS: 4 };";
    const kit = (bars: Record<string, string>) => (slug: string) => bars[slug];
    const bar31 = page(BAR, MOTION);

    it("exempts a copy of a kit bar: its slug, and the same MOTION block byte for byte", () => {
      expect(literalExemption(bar31, kit({ "99-fake-loop": bar31 }))).toEqual({ exempt: true });
    });

    it("runs the check, with a note, on a page whose MOTION block differs", () => {
      const adapted = page(BAR, "const MOTION = { loopS: 5 };");
      expect(literalExemption(adapted, kit({ "99-fake-loop": bar31 }))).toEqual({
        exempt: false,
        note: "note: the literal check runs: the page's MOTION block differs from bars/99-fake-loop/index.html, so the page is adapted, not a copy",
      });
    });

    it("runs the check, with a note, on a page that names a bar the kit does not have", () => {
      expect(literalExemption(bar31, kit({}))).toEqual({ exempt: false, note: "note: the literal check runs: the page names bar 99-fake-loop, and motion-kit has no bars/99-fake-loop/" });
      const odd = page('<meta name="motion-kit-bar" content="../x">', MOTION);
      const seen: string[] = [];
      expect(literalExemption(odd, (s) => (seen.push(s), bar31)).exempt).toBe(false);
      expect(seen).toEqual([]);
    });

    it("runs the check with no note on a page with no bar marker", () => {
      expect(literalExemption(page(KIND, MOTION), kit({ "99-fake-loop": bar31 }))).toEqual({ exempt: false });
    });
  });

  it("reports each KNOBS value's distance from its base, as information", () => {
    const html = page(KIND, KNOBS);
    expect(audit(html)).toEqual({ failures: [], distances: [`idle.period 6.0 s, 50% above base ${base("idle.period", "4.0 s")}`] });
  });

  it("reads a hand-edited KNOBS block, and fails one that holds an unknown knob", () => {
    const edited = page(KIND, "const KNOBS = { idle: { period: 4, }, };");
    expect(audit(edited)).toEqual({ failures: [], distances: [`idle.period 4.0 s, at base ${base("idle.period", "4.0 s")}`] });
    const unknown = page(KIND, 'const KNOBS = { "idle": { "speed": 2 } };');
    expect(audit(unknown).failures).toEqual(["audit: line 2: KNOBS.idle.speed: unknown knob: idle.speed"]);
  });

  it("audits the local scripts a page loads, and names the file", () => {
    const html = page(KIND, "");
    const r = audit(html, [{ src: "motion.js", text: "const MOTION = {};\nconst fadeMs = 300;\nsetTimeout(() => render(), 10);" }]);
    expect(r.failures).toEqual([
      "audit: motion.js line 2: fadeMs = 300 is a duration typed as a literal outside MOTION and KNOBS",
      `audit: motion.js line 3: ${CLOCK("setTimeout")}`,
    ]);
  });

  it("fails a duration set in a style attribute or an SVG animation", () => {
    const html = page(KIND, "", "").replace('<div id="dot"></div>', '<div id="dot" style="transition: transform 200ms"></div><svg><animate dur="2s"/></svg>');
    expect(audit(html).failures).toEqual([
      "audit: line 1: 200ms is a duration typed as a literal outside MOTION and KNOBS",
      "audit: line 1: the SVG dur attribute is a duration typed as a literal outside MOTION and KNOBS",
    ]);
  });
});
