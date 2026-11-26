import path from "node:path";
/** The line `init` adds to the project's instruction files. Its path is how a second run finds it. */
export const INIT_LINE = "For any animation, follow node_modules/motion-kit/AGENTS.md.";
const MARK = "node_modules/motion-kit/AGENTS.md";
export const REPO = "github:bnhoang2k/motion-kit";
/** The packageManager field first, then the lockfile, then npm. */
function packageManager(pkg, has) {
    const named = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
    if (named === "pnpm" || named === "yarn" || named === "bun" || named === "npm")
        return named;
    if (has("pnpm-lock.yaml"))
        return "pnpm";
    if (has("yarn.lock"))
        return "yarn";
    if (has("bun.lock") || has("bun.lockb"))
        return "bun";
    return "npm";
}
const add = (pm, dev, spec) => [pm, [pm === "npm" ? "install" : "add", ...(dev ? ["-D"] : []), spec]];
const runner = (pm) => pm === "pnpm" ? ["pnpm", ["exec"]] : pm === "yarn" ? ["yarn", []] : pm === "bun" ? ["bunx", []] : ["npx", []];
/**
 * `init`: sets a project up in one step. It installs the kit at its own release tag, installs
 * Playwright and Chromium for the gate, and adds the AGENTS.md line to CLAUDE.md (made if missing)
 * and to the project's AGENTS.md when it has one. A step already done is skipped, so a second run
 * changes nothing. Exit 0 when done, 2 outside a project or when a step fails.
 */
export async function initCommand(io, deps) {
    const at = (f) => path.join(io.cwd, f);
    const pkgPath = at("package.json");
    const text = io.read(pkgPath);
    if (text === undefined) {
        io.err(`No package.json in ${io.cwd}. Run motion-kit init in your project's folder.\n`);
        return 2;
    }
    let pkg;
    try {
        pkg = JSON.parse(text);
    }
    catch (e) {
        io.err(`${pkgPath} is not valid JSON: ${e.message}\n`);
        return 2;
    }
    const pm = packageManager(pkg, (f) => io.read(at(f)) !== undefined);
    const installed = (name) => Object.hasOwn(pkg.dependencies ?? {}, name) || Object.hasOwn(pkg.devDependencies ?? {}, name);
    const steps = [];
    if (installed("motion-kit"))
        io.out("motion-kit is already installed.\n");
    else
        steps.push(add(pm, false, `${REPO}#v${deps.kitVersion}`));
    if (installed("playwright"))
        io.out("Playwright is already installed.\n");
    else {
        const [cmd, pre] = runner(pm);
        steps.push(add(pm, true, "playwright"), [cmd, [...pre, "playwright", "install", "chromium"]]);
    }
    for (const [cmd, args] of steps) {
        if (!(await deps.exec(cmd, args, io.cwd))) {
            io.err(`This step failed: ${[cmd, ...args].join(" ")}\nFix it, then run motion-kit init again.\n`);
            return 2;
        }
    }
    if (steps.length > 0)
        io.out(`Installed with ${pm}.\n`);
    // Claude Code reads CLAUDE.md, so it always gets the line; other tools read AGENTS.md when it exists.
    for (const f of io.read(at("AGENTS.md")) === undefined ? ["CLAUDE.md"] : ["CLAUDE.md", "AGENTS.md"]) {
        const now = io.read(at(f)) ?? "";
        if (now.includes(MARK)) {
            io.out(`${f} already has the motion-kit line.\n`);
            continue;
        }
        const body = now.trimEnd();
        io.write(at(f), body === "" ? `${INIT_LINE}\n` : `${body}\n\n${INIT_LINE}\n`);
        io.out(`Added the motion-kit line to ${f}.\n`);
    }
    io.out("Done. Ask your AI coding tool for any animation.\n");
    return 0;
}
