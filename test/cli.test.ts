import { describe, expect, it } from "vitest";
import { run, type CliIo } from "../src/cli/run.ts";

function io(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const api: CliIo = {
    cwd: "/proj",
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    read: (p) => files[p],
    write: (p, d) => (written[p] = d),
  };
  return { api, out, err, written };
}

describe("motion-kit CLI", () => {
  it("resolve with no motion.json prints the defaults", () => {
    const t = io();
    expect(run(["resolve"], t.api)).toBe(0);
    expect(JSON.parse(t.out.join(""))).toHaveProperty("feels.calm");
    expect(t.err.join("")).toMatch("No /proj/motion.json; using the defaults.");
  });

  it("resolve --out writes the merged config", () => {
    const t = io({ "/proj/motion.json": JSON.stringify({ use: { station: "calm" } }) });
    expect(run(["resolve", "--out", "motion.resolved.json"], t.api)).toBe(0);
    expect(JSON.parse(t.written["/proj/motion.resolved.json"]!).use).toEqual({ station: "calm" });
  });

  it("names the file when JSON is broken", () => {
    const t = io({ "/proj/motion.json": "{ nope" });
    expect(run(["validate"], t.api)).toBe(2);
    expect(t.err.join("")).toMatch(/^\/proj\/motion\.json is not valid JSON: /);
  });

  it("fails when --in points at a missing file", () => {
    const t = io();
    expect(run(["validate", "--in", "other.json"], t.api)).toBe(2);
    expect(t.err.join("")).toBe("Cannot read /proj/other.json.\n");
  });

  it("lists every problem and exits 1 when invalid", () => {
    const t = io({ "/proj/motion.json": JSON.stringify({ feels: { calm: { moves: { tap: { bounce: 0.9 } } } } }) });
    expect(run(["validate"], t.api)).toBe(1);
    expect(t.err.join("")).toMatch("feels.calm.moves.tap.bounce: must be a number from 0 to 0.4, got 0.9");
  });

  it("prints usage for an unknown command", () => {
    const t = io();
    expect(run(["frobnicate"], t.api)).toBe(2);
    expect(t.err.join("")).toMatch(/^Usage: motion-kit <resolve\|validate>/);
  });

  it("exits 2 with usage for an unknown option", () => {
    const t = io();
    expect(run(["validate", "--bogus"], t.api)).toBe(2);
    expect(t.err.join("")).toMatch(/^Usage: motion-kit <resolve\|validate>/);
    expect(t.err.join("")).toMatch(/--bogus/);
  });

  it("exits 2 with usage for an extra argument and for a missing option value", () => {
    const a = io();
    expect(run(["validate", "extra"], a.api)).toBe(2);
    expect(a.err.join("")).toMatch(/^Usage: /);
    const b = io();
    expect(run(["validate", "--in"], b.api)).toBe(2);
    expect(b.err.join("")).toMatch(/^Usage: /);
  });

  it("treats a file holding null as an invalid config, exit 1", () => {
    const t = io({ "/proj/motion.json": "null" });
    expect(run(["validate"], t.api)).toBe(1);
    expect(t.err.join("")).toMatch("config: must be an object");
  });

  it("reports a misspelled key in the file, exit 1", () => {
    const t = io({ "/proj/motion.json": JSON.stringify({ feels: { calm: { stager: 0.1 } } }) });
    expect(run(["validate"], t.api)).toBe(1);
    expect(t.err.join("")).toMatch("feels.calm.stager: unknown key");
  });
});
