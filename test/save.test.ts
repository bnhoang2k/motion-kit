import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOverrides, writeOverrides } from "../src/lab-server/save.ts";

describe("readOverrides and writeOverrides", () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), "motion-save-"));

  it("returns {} when motion.json is missing", () => {
    expect(readOverrides(tmp())).toEqual({});
  });

  it("writes motion.json with two-space indent and a trailing newline, and reads it back", () => {
    const dir = tmp();
    const p = writeOverrides(dir, { reducedFade: 0.2 });
    expect(readFileSync(p, "utf8")).toBe('{\n  "reducedFade": 0.2\n}\n');
    expect(readOverrides(dir)).toEqual({ reducedFade: 0.2 });
  });

  it("replaces a read-only motion.json by writing a temp file and renaming it", () => {
    const dir = tmp();
    const file = path.join(dir, "motion.json");
    writeFileSync(file, "{}\n");
    chmodSync(file, 0o444);
    writeOverrides(dir, { reducedFade: 0.3 });
    expect(readOverrides(dir)).toEqual({ reducedFade: 0.3 });
    expect(readdirSync(dir)).toEqual(["motion.json"]);
  });

  it("names the file when motion.json is not valid JSON", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "motion.json"), "{ nope");
    expect(() => readOverrides(dir)).toThrow(/motion\.json is not valid JSON/);
  });

  it("rejects motion.json that is not an object", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "motion.json"), "[1]");
    expect(() => readOverrides(dir)).toThrow(/must be a JSON object/);
  });
});
