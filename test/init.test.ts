import { describe, expect, it } from "vitest";
import { INIT_LINE, initCommand, REPO, type InitDeps } from "../src/cli/init.ts";
import { run, type CliIo } from "../src/cli/run.ts";

function project(files: Record<string, string>, failOn?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const api: CliIo = {
    cwd: "/proj",
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    read: (p) => files[p],
    write: (p, d) => (files[p] = String(d)),
  };
  const deps: InitDeps = {
    kitVersion: "0.3.0",
    exec: (cmd, args) => {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      return line !== failOn;
    },
  };
  return { api, deps, files, out, err, calls };
}

const SPEC = `${REPO}#v0.3.0`;
const pkg = (deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", dependencies: deps, ...extra });

describe("motion-kit init", () => {
  it("installs the kit and Playwright with the project's package manager, then adds the line", async () => {
    const t = project({ "/proj/package.json": pkg(), "/proj/pnpm-lock.yaml": "" });
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.calls).toEqual([`pnpm add ${SPEC}`, "pnpm add -D playwright", "pnpm exec playwright install chromium"]);
    expect(t.files["/proj/CLAUDE.md"]).toBe(`${INIT_LINE}\n`);
    expect(t.out.join("")).toMatch(/Done\. Ask your AI coding tool for any animation\.\n$/);
  });

  it("uses npm install and npx when the project has no other lockfile", async () => {
    const t = project({ "/proj/package.json": pkg() });
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.calls).toEqual([`npm install ${SPEC}`, "npm install -D playwright", "npx playwright install chromium"]);
  });

  it("follows the packageManager field before any lockfile", async () => {
    const t = project({ "/proj/package.json": pkg({}, { packageManager: "yarn@4.5.0" }), "/proj/package-lock.json": "" });
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.calls[0]).toBe(`yarn add ${SPEC}`);
  });

  it("knows bun by either lockfile", async () => {
    for (const lock of ["/proj/bun.lock", "/proj/bun.lockb"]) {
      const t = project({ "/proj/package.json": pkg(), [lock]: "" });
      expect(await initCommand(t.api, t.deps)).toBe(0);
      expect(t.calls).toEqual([`bun add ${SPEC}`, "bun add -D playwright", "bunx playwright install chromium"]);
    }
  });

  it("always gives CLAUDE.md the line, and AGENTS.md only when it exists", async () => {
    const t = project({ "/proj/package.json": pkg(), "/proj/AGENTS.md": "# Agents\n" });
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.files["/proj/CLAUDE.md"]).toBe(`${INIT_LINE}\n`);
    expect(t.files["/proj/AGENTS.md"]).toBe(`# Agents\n\n${INIT_LINE}\n`);
  });

  it("appends the line after existing text in both files", async () => {
    const t = project({
      "/proj/package.json": pkg(),
      "/proj/CLAUDE.md": "# App\n\nUse tabs.",
      "/proj/AGENTS.md": "# Agents\n",
    });
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.files["/proj/CLAUDE.md"]).toBe(`# App\n\nUse tabs.\n\n${INIT_LINE}\n`);
    expect(t.files["/proj/AGENTS.md"]).toBe(`# Agents\n\n${INIT_LINE}\n`);
  });

  it("changes nothing on a second run", async () => {
    const t = project({ "/proj/package.json": pkg(), "/proj/pnpm-lock.yaml": "" });
    await initCommand(t.api, t.deps);
    t.files["/proj/package.json"] = pkg({ "motion-kit": SPEC }, { devDependencies: { playwright: "^1.64.0" } });
    const before = { ...t.files };
    t.calls.length = 0;
    t.out.length = 0;
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.calls).toEqual([]);
    expect(t.files).toEqual(before);
    expect(t.out.join("")).toMatch("motion-kit is already installed.");
    expect(t.out.join("")).toMatch("CLAUDE.md already has the motion-kit line.");
  });

  it("leaves Chromium alone when Playwright was already there", async () => {
    const t = project({ "/proj/package.json": pkg({}, { devDependencies: { playwright: "1.64.1" } }) });
    expect(await initCommand(t.api, t.deps)).toBe(0);
    expect(t.calls).toEqual([`npm install ${SPEC}`]);
  });

  it("exits 2 outside a project", async () => {
    const t = project({});
    expect(await initCommand(t.api, t.deps)).toBe(2);
    expect(t.err.join("")).toBe("No package.json in /proj. Run motion-kit init in your project's folder.\n");
    expect(t.calls).toEqual([]);
  });

  it("exits 2 when package.json is not valid JSON", async () => {
    const t = project({ "/proj/package.json": "{ nope" });
    expect(await initCommand(t.api, t.deps)).toBe(2);
    expect(t.err.join("")).toMatch(/^\/proj\/package\.json is not valid JSON: /);
  });

  it("stops at the first failed step, names it, and writes nothing", async () => {
    const t = project({ "/proj/package.json": pkg() }, "npm install -D playwright");
    expect(await initCommand(t.api, t.deps)).toBe(2);
    expect(t.err.join("")).toBe("This step failed: npm install -D playwright\nFix it, then run motion-kit init again.\n");
    expect(t.files["/proj/CLAUDE.md"]).toBeUndefined();
  });

  it("runs from the CLI and rejects arguments", async () => {
    const t = project({ "/proj/package.json": pkg() });
    expect(await run(["init"], t.api, { init: t.deps })).toBe(0);
    const u = project({ "/proj/package.json": pkg() });
    expect(await run(["init", "extra"], u.api, { init: u.deps })).toBe(2);
    expect(u.err.join("")).toMatch("init takes no arguments.");
  });
});
