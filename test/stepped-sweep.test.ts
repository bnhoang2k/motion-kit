import { describe, expect, it } from "vitest";
import { atSize, GRID_EDGES, GRID_FAULTY, GRID_HONEST, PAGE_CASES, REVIEW_FAULTS, REVIEW_HONEST, RULING_CASES, sweepRead, type SweepCase } from "./stepped-cases.ts";

/**
 * The stepped sweep: the stepped pop rule (stepPops) must hold across the whole class of stepped motion, not only the
 * pages that prompted it. Each case is a motion as a page plays it, read as the envelope rule reads a stepped value
 * (span plus read-ahead, slopes fitted on the span), with no browser: the rule's table of pages, every
 * stepped wrong verdict of the object record's pages rebuilt by behaviour, the style sweep's grid in full and
 * its planted faults, and the stepped fixture pages. A px motion runs at objects of 12, 40 and 120 px, so a verdict
 * must not change with the object's size. Honest cases give no pop; a faulty case's first pop (the one the gate
 * prints) has its kind.
 */

const SIZES = [12, 40, 120];
const at = (name: string, sizes = SIZES) => sizes.map((s) => `${name}, ${s} px`);

/**
 * Rows the rule gets wrong today. Each keeps its case and what it must give, and runs as `it.fails`: when the rule is
 * fixed, its row turns red and comes off its list. Names are exact, so any other row that goes wrong stays red. There
 * are two lists, so a reader can tell a code bug from a question the rules have not settled.
 */

/**
 * Rows of the rule's table that the code fails: bugs against the rules, each waiting for its fix. It is empty: the pose
 * pop, the contact squash and the smear rows came off it when their fixes landed. A row here is a fix that has not.
 */
const SPEC_TABLE_GAPS = new Set<string>([]);

/**
 * Faults that the rules, read by their own words, pass. They are parked: no code change closes them without a
 * decision on the rule, and each comment names the decision it needs.
 */
const PARKED_GAPS = new Set([
  // Needs a decision on rule 5 (look values get the spike only): a look value has no excursion
  // test. A fade drawing dropped early comes back less than 3 times the fade (steps 4.46 and 2.61 times, 1.7 times
  // alone against the way back), so it passes, though it failed under the old rule.
  "a fade on twos with one drawing dropped to its end early, and back",
  // Needs a decision on a constant (SPIKE_RATIO, or a rest line for threes): the step is 1.9 times the one
  // before it, under SPIKE_RATIO, and 125 ms drawings are no rests, so there is no teleport. The twos version of this
  // page is unsure.
  ...at("one in-between missing from a move on threes, so one step covers two"),
  // Needs a decision on rule 3's spike line for a short excursion: the 0.74-length swap comes back
  // exactly half way, an excursion at the boundary, but it is only 1.05 times the step after it. The same swap on a
  // 40 px and a 16 px object is longer than the object and fails as an out and back.
  ...at("drawings 5 and 6 of a slow in and out swapped, on a 100 px object (0.74 lengths)"),
  // Needs a decision on rule 3 ("with no moving step outside, only the teleport line applies"):
  // the knock is in a second value (y) whose own steps are a long rest, the 83 ms knock and a long rest, so it has no
  // moving step to compare with while x moves the train, and 0.75 lengths is under the teleport line. The 1.5-length
  // twin fails as a teleport.
  ...at("a drawing knocked 0.75 lengths across a train's path and back"),
  ...at("a drawing knocked 0.75 lengths across a slow train's path and back"),
]);

const RULE_GAPS = new Set([...SPEC_TABLE_GAPS, ...PARKED_GAPS]);

type Row = [name: string, c: SweepCase, size: number | undefined];
const rows = (cases: SweepCase[]): Row[] =>
  cases.flatMap((c): Row[] => (!c.fixed && (c.motion.unit ?? "px") === "px" ? SIZES.map((s): Row => [`${c.name}, ${s} px`, c, s]) : [[c.name, c, undefined]]));

function check(c: SweepCase, size: number | undefined) {
  const m = size === undefined ? c.motion : atSize(c.motion, size);
  const { pops, drawings } = sweepRead(m);
  // A drawing gone by accident (the box left the viewport) would make a pass vacuous.
  if (!m.gone && !c.offView) expect(drawings.some((d) => d.gone)).toBe(false);
  const got = pops[0]?.kind ?? "pass";
  const said = pops[0] ? `${pops[0].kind} at frame ${pops[0].atFrame}, ${pops[0].lengths.toFixed(2)} lengths, ratio ${pops[0].ratio.toFixed(2)}, ${pops[0].drawings} drawing(s)` : "pass";
  if (c.expect === "fail") expect(got, said).not.toBe("pass");
  else if (Array.isArray(c.expect)) expect(c.expect, said).toContain(got);
  else expect(got, said).toBe(c.expect);
}

/** The rows of `cases`, each a test: `it`, or `it.fails` for a row on RULE_GAPS. */
function sweep(cases: SweepCase[], suffix = "") {
  const all = rows(cases);
  const [open, gaps] = [all.filter(([n]) => !RULE_GAPS.has(n)), all.filter(([n]) => RULE_GAPS.has(n))];
  if (open.length > 0) it.each(open)(`%s${suffix}`, (_, c, size) => check(c, size));
  if (gaps.length > 0) it.fails.each(gaps)(`%s${suffix} (a rule gap)`, (_, c, size) => check(c, size));
}

describe("the stepped sweep: the rule's table and the pages judged wrongly", () => {
  sweep(REVIEW_FAULTS, " fails");
  sweep(REVIEW_HONEST, " passes");
  sweep(RULING_CASES);
  it("every rule gap names a row", () => {
    const names = new Set(rows([...REVIEW_FAULTS, ...REVIEW_HONEST, ...RULING_CASES]).map(([n]) => n));
    expect([...RULE_GAPS].filter((n) => !names.has(n))).toEqual([]);
  });
});

describe("the stepped sweep: the stepped fixture pages", () => {
  sweep(PAGE_CASES);
});

describe("the stepped sweep: the style sweep's grid", () => {
  sweep(GRID_HONEST, " passes");
  sweep(GRID_FAULTY, " fails");
  sweep(GRID_EDGES);
});
