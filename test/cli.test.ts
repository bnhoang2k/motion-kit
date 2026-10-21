import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run, type CliIo } from "../src/cli/run.ts";
import type { SheetOptions } from "../src/gate/sheet.ts";

function io(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string | Uint8Array> = {};
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
    const t = io({ "/proj/motion.json": JSON.stringify({ use: { sidebar: "calm" } }) });
    expect(run(["resolve", "--out", "motion.resolved.json"], t.api)).toBe(0);
    expect(JSON.parse(t.written["/proj/motion.resolved.json"] as string).use).toEqual({ sidebar: "calm" });
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
    expect(t.err.join("")).toMatch(/^Usage: motion-kit init/);
  });

  it("exits 2 with usage for an unknown option", () => {
    const t = io();
    expect(run(["validate", "--bogus"], t.api)).toBe(2);
    expect(t.err.join("")).toMatch(/^Usage: motion-kit init/);
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

  describe("v2 knobs", () => {
    const v2 = (kinds: unknown) => io({ "/proj/motion.json": JSON.stringify({ version: 2, kinds }) });

    it("validate prints one distance line per overridden knob and exits 0", () => {
      const t = v2({ idle: { period: 60 }, live: { release: { visualDuration: 0.5, bounce: 0.2 } } });
      expect(run(["validate"], t.api)).toBe(0);
      const text = t.out.join("");
      expect(text).toContain("idle.period 60.0 s, 1400% above base");
      expect(text).toContain("live.release.visualDuration");
      expect(text).toContain("live.release.bounce");
    });

    it("validate on a file with no kinds prints only the valid line", () => {
      const t = io({ "/proj/motion.json": JSON.stringify({ version: 2 }) });
      expect(run(["validate"], t.api)).toBe(0);
      expect(t.out.join("")).toBe("/proj/motion.json is valid.\n");
    });

    it("knobs prints the marker and a block that evals to the bases", () => {
      const t = io();
      expect(run(["knobs", "idle", "scroll"], t.api)).toBe(0);
      const text = t.out.join("");
      expect(text.split("\n")[0]).toBe("/* motion-kit:knobs */");
      expect(new Function(`${text}\nreturn KNOBS;`)()).toEqual({ idle: { period: 4 }, scroll: { smooth: expect.closeTo(1 / 6, 9), maxStep: 0.05 } });
    });

    it("knobs reads the file named by --in, not ./motion.json", () => {
      const t = io({
        "/proj/motion.json": JSON.stringify({ version: 2, kinds: { idle: { period: 9 } } }),
        "/proj/custom.json": JSON.stringify({ version: 2, kinds: { idle: { period: 60 } } }),
      });
      expect(run(["knobs", "idle", "--in", "custom.json"], t.api)).toBe(0);
      expect(new Function(`${t.out.join("")}\nreturn KNOBS;`)()).toEqual({ idle: { period: 60 } });
    });

    it("knobs with no --in reads ./motion.json when it exists", () => {
      const t = v2({ idle: { period: 9 } });
      expect(run(["knobs", "idle"], t.api)).toBe(0);
      expect(new Function(`${t.out.join("")}\nreturn KNOBS;`)()).toEqual({ idle: { period: 9 } });
    });

    it("knobs prints a spring knob as an object", () => {
      const t = io();
      expect(run(["knobs", "live"], t.api)).toBe(0);
      const live = new Function(`${t.out.join("")}\nreturn KNOBS;`)().live;
      expect(Object.keys(live)).toEqual(["release"]);
      expect(live.release).toHaveProperty("visualDuration");
      expect(live.release).toHaveProperty("bounce");
    });

    it("knobs prints a known kind with no fields as {}, exit 0", () => {
      const t = io();
      expect(run(["knobs", "choreo", "sim"], t.api)).toBe(0);
      expect(new Function(`${t.out.join("")}\nreturn KNOBS;`)()).toEqual({ choreo: {}, sim: {} });
    });

    it("knobs exits 2 on an unknown kind and on no kind", () => {
      const a = io();
      expect(run(["knobs", "oneshot"], a.api)).toBe(2);
      expect(a.err.join("")).toMatch(/Unknown kind: oneshot\. Kinds: live, idle/);
      const b = io();
      expect(run(["knobs"], b.api)).toBe(2);
      expect(b.err.join("")).toMatch(/Name at least one kind/);
    });

    it("usage lists the knobs command", () => {
      const t = io();
      run(["frobnicate"], t.api);
      expect(t.err.join("")).toMatch(/motion-kit knobs <kind>\.\.\./);
    });
  });

  describe("gate", () => {
    const PAGE = '<!doctype html><meta name="motion-kit-kind" content="idle">';

    it("exits 2 with the install line when Playwright is missing", async () => {
      const t = io({ "/proj/page.html": PAGE });
      let asked = 0;
      const missing = async () => {
        asked++;
        return null;
      };
      expect(await run(["gate", "page.html"], t.api, { playwrightOrNull: missing })).toBe(2);
      expect(asked).toBe(1);
      expect(t.err.join("")).toBe("motion-kit gate needs Playwright: pnpm add -D playwright && pnpm exec playwright install chromium\n");
      expect(t.out.join("")).toBe("");
    });

    const launches = (launch: () => Promise<{ close(): Promise<void> }>) => async () => ({ chromium: { launch } });
    const opens = launches(async () => ({ close: async () => undefined }));

    it("exits 2 with the install line when Playwright is there but its Chromium is not", async () => {
      const t = io({ "/proj/page.html": PAGE });
      const noChromium = launches(async () => {
        throw new Error("browserType.launch: Executable doesn't exist\nlong install hint");
      });
      expect(await run(["gate", "page.html"], t.api, { playwrightOrNull: noChromium })).toBe(2);
      expect(t.err.join("")).toBe("motion-kit gate needs Playwright: pnpm add -D playwright && pnpm exec playwright install chromium\n");
    });

    it("prints one line and exits 2 when the gate throws, never a stack trace", async () => {
      const t = io({ "/proj/page.html": PAGE });
      const broken = async () => {
        throw new Error("Cannot find module kinds/live/gate.js\n    at import (node:internal)");
      };
      expect(await run(["gate", "page.html"], t.api, { playwrightOrNull: opens, kindGate: broken })).toBe(2);
      expect(t.err.join("")).toBe("motion-kit gate could not run: Cannot find module kinds/live/gate.js\n");
      expect(t.out.join("")).toBe("");
    });

    it("prints the distance lines, then the verdict, and exits by the verdict", async () => {
      const t = io({ "/proj/page.html": PAGE });
      const gate = async () => ({ status: "failed" as const, failures: ["reverses: p stays"], distances: ["idle.period 6.0 s, 50% above base (31-breath-pacer: 4.0 s)"] });
      expect(await run(["gate", "page.html"], t.api, { playwrightOrNull: opens, kindGate: gate })).toBe(1);
      expect(t.out.join("")).toBe("idle.period 6.0 s, 50% above base (31-breath-pacer: 4.0 s)\nfailed: 1\n");
      expect(t.err.join("")).toBe("reverses: p stays\n");
    });

    it("exits 2 on a page it cannot read, before it looks for Playwright", async () => {
      const t = io();
      const never = async () => {
        throw new Error("not reached");
      };
      expect(await run(["gate", "nope.html"], t.api, { playwrightOrNull: never })).toBe(2);
      expect(t.err.join("")).toBe("Cannot read nope.html.\n");
    });

    it("exits 2 with the usage unless it gets exactly one page", async () => {
      for (const args of [["gate"], ["gate", "a.html", "b.html"], ["gate", "--in", "x", "a.html"]]) {
        const t = io();
        expect(await run(args, t.api)).toBe(2);
        expect(t.err.join("")).toMatch(/motion-kit gate <page\.html>/);
      }
    });
  });

  describe("sheet", () => {
    const PAGE = '<!doctype html><meta name="motion-kit-kind" content="idle">';
    const opens = async () => ({ chromium: { launch: async () => ({ close: async () => undefined }) } });
    const PNG = new Uint8Array([137, 80, 78, 71]);

    it("writes the sheet to sheet.png and prints its path and frame times", async () => {
      const t = io({ "/proj/page.html": PAGE });
      let asked: [string, SheetOptions] | undefined;
      const frameSheet = async (file: string, options: SheetOptions) => {
        asked = [file, options];
        return { png: PNG, times: [0, 1500, 3000], note: "no input", view: "whole page" };
      };
      expect(await run(["sheet", "page.html", "--samples", "3"], t.api, { playwrightOrNull: opens, frameSheet })).toBe(0);
      expect(asked).toEqual(["/proj/page.html", { samples: 3, full: false }]);
      expect(t.written["/proj/sheet.png"]).toEqual(PNG);
      expect(t.out.join("")).toBe("Wrote sheet.png: 3 frames at 0.00 s, 1.50 s, 3.00 s, no input, whole page.\n");
    });

    it("takes 8 samples by default, passes --to and --full, and writes where --out says", async () => {
      const t = io({ "/proj/page.html": PAGE });
      let asked: SheetOptions | undefined;
      const frameSheet = async (_: string, options: SheetOptions) => {
        asked = options;
        return { png: PNG, times: [0], note: "no input", view: "whole page" };
      };
      expect(await run(["sheet", "page.html", "--out", "out/a.png", "--to", "8000", "--full"], t.api, { playwrightOrNull: opens, frameSheet })).toBe(0);
      expect(asked).toEqual({ samples: 8, toMs: 8000, full: true });
      expect(t.written["/proj/out/a.png"]).toEqual(PNG);
    });

    it("exits 2 with the usage on a bad --samples or no page", async () => {
      for (const args of [["sheet"], ["sheet", "page.html", "--samples", "1"], ["sheet", "page.html", "--samples", "25"], ["sheet", "page.html", "--samples", "x"], ["sheet", "page.html", "--to", "0"], ["sheet", "page.html", "--to", "soon"], ["sheet", "page.html", "--to", "60001"]]) {
        const t = io({ "/proj/page.html": PAGE });
        expect(await run(args, t.api)).toBe(2);
        expect(t.err.join("")).toMatch(/motion-kit sheet <page\.html>/);
      }
    });

    it("exits 2 with the install line when Playwright is missing", async () => {
      const t = io({ "/proj/page.html": PAGE });
      expect(await run(["sheet", "page.html"], t.api, { playwrightOrNull: async () => null })).toBe(2);
      expect(t.err.join("")).toBe("motion-kit sheet needs Playwright: pnpm add -D playwright && pnpm exec playwright install chromium\n");
    });

    it("prints one line and exits 2 when the sheet cannot be drawn", async () => {
      const t = io({ "/proj/page.html": PAGE });
      const frameSheet = async () => {
        throw new Error("the page has no window.__seek\n    at seek");
      };
      expect(await run(["sheet", "page.html"], t.api, { playwrightOrNull: opens, frameSheet })).toBe(2);
      expect(t.err.join("")).toBe("motion-kit sheet could not run: the page has no window.__seek\n");
    });

    it("exits 2 on a page it cannot read", async () => {
      const t = io();
      expect(await run(["sheet", "nope.html"], t.api)).toBe(2);
      expect(t.err.join("")).toBe("Cannot read nope.html.\n");
    });
  });
});

describe("the motion-kit command on disk", () => {
  const ROOT = path.resolve(import.meta.dirname, "..");
  /** Runs src/cli/motion-kit.ts in `cwd` and returns its exit code and output. */
  const cli = (args: string[], cwd = ROOT) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "src/cli/motion-kit.ts"), ...args], { cwd, encoding: "utf8", timeout: 30_000 });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  it("exits 2 with one line when gate or validate --in names a folder", () => {
    expect(cli(["gate", "test/fixtures"])).toEqual({ code: 2, out: "", err: "Cannot read test/fixtures.\n" });
    expect(cli(["validate", "--in", "test/fixtures"])).toEqual({ code: 2, out: "", err: `Cannot read ${path.join(ROOT, "test/fixtures")}.\n` });
  });

  it("validate-bar reads the folder from the working folder and the kit files from the kit", () => {
    const real = path.join(ROOT, "bars/31-breath-pacer");
    expect(cli(["validate-bar", "."], real)).toEqual({ code: 0, out: ". is valid.\n", err: "" });
    expect(cli(["validate-bar", "31-breath-pacer"], path.join(ROOT, "bars"))).toEqual({ code: 0, out: "31-breath-pacer is valid.\n", err: "" });
  });
});
