import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { barFileErrors, validateBar } from "../core/bar.js";
import { kitRoot } from "../core/kit-root.js";
import { KINDS, KNOB_FIELDS } from "../core/kinds.js";
import { knob, knobDistance } from "../core/knob.js";
import { MotionConfigError, resolve } from "../core/merge.js";
import { printVerdict } from "../gate/verdict.js";
import { initCommand } from "./init.js";
import { chromiumReady, closeHarness, firstLine, playwrightInstall } from "./playwright.js";
import { parseSamples, parseTo, sheetCommand } from "./sheet.js";
const USAGE = [
    "Usage: motion-kit init                 (set this project up: install, Playwright, CLAUDE.md line)",
    "       motion-kit <resolve|validate> [--in motion.json] [--out file]",
    "       motion-kit knobs <kind>... [--in motion.json]",
    "       motion-kit validate-bar <dir>",
    "       motion-kit gate <page.html>     (the kind gate: needs Playwright)",
    "       motion-kit sheet <page.html> [--out sheet.png] [--samples 8] [--to ms] [--full]",
    "                                       (one PNG of the page at evenly spaced times: needs Playwright)",
    "",
].join("\n");
/**
 * `validate-bar <dir>`, with the exit codes of `validate`: 0 when the folder meets the bar.json contract,
 * 1 with every contract problem, 2 when a bar file is missing or bar.json or trace.json is not valid JSON.
 */
function validateBarCommand(dir, io) {
    // The folder as a full path, so "." and "../x" still end in the folder's own name.
    const abs = path.resolve(io.cwd, dir).split(path.sep).join("/");
    const read = (p) => io.read(path.resolve(io.cwd, p));
    // bars/moments.json and kinds/<kind>/dials.json come from the kit's own folder, wherever it runs.
    const root = kitRoot();
    const readKit = (p) => io.read(path.join(root, p));
    const fileErrors = barFileErrors(abs, read);
    if (fileErrors.length === 4 && fileErrors.every((l) => l.endsWith(": missing"))) {
        io.err(`Cannot read ${dir}.\n`);
        return 2;
    }
    if (fileErrors.length > 0) {
        io.err(fileErrors.map((l) => `${dir}/${l}\n`).join(""));
        return 2;
    }
    const problems = validateBar(abs, read, readKit);
    if (problems.length > 0) {
        io.err(problems.map((l) => `${l}\n`).join(""));
        return 1;
    }
    io.out(`${dir} is valid.\n`);
    return 0;
}
/** The `knobs` output: a marker line, then the resolved knob values nested by kind. */
function knobsSource(cfg, kinds) {
    const out = {};
    for (const kind of kinds) {
        const fields = {};
        for (const key of Object.keys(KNOB_FIELDS)) {
            const [k, field] = key.split(".");
            if (k === kind)
                fields[field] = knob(cfg, kind, field);
        }
        out[kind] = fields;
    }
    return `/* motion-kit:knobs */\nconst KNOBS = ${JSON.stringify(out, null, 2)};\n`;
}
export const PLAYWRIGHT_INSTALL = playwrightInstall("gate");
/** `init`'s real commands: output shown as it runs, a shell on Windows so `npm.cmd` resolves. */
function realInitDeps() {
    const pkg = JSON.parse(readFileSync(path.join(kitRoot(), "package.json"), "utf8"));
    return {
        kitVersion: pkg.version,
        exec: (cmd, args, cwd) => {
            process.stdout.write(`> ${[cmd, ...args].join(" ")}\n`);
            return spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" }).status === 0;
        },
    };
}
/**
 * `gate <page.html>`: Gate B on one page. Exit 0 `passed`, 1 `failed: n` or `partial`, 2 when the
 * page cannot be read, Playwright or its Chromium is missing, or the gate cannot start. The note
 * lines (why the literal check runs on a page that names a bar) and the distance lines print first,
 * as information: they never change the exit code. The gate loads
 * only after Playwright is found, so nothing else in the CLI imports it.
 */
async function gateCommand(file, io, deps) {
    const target = path.resolve(io.cwd, file);
    if (io.read(target) === undefined) {
        io.err(`Cannot read ${file}.\n`);
        return 2;
    }
    if (!(await chromiumReady(deps.playwrightOrNull))) {
        io.err(`${PLAYWRIGHT_INSTALL}\n`);
        return 2;
    }
    try {
        const kindGate = deps.kindGate ?? (await import("../gate/kind-gate.js")).kindGate;
        const v = await kindGate(target);
        for (const line of [...(v.notes ?? []), ...v.distances])
            io.out(`${line}\n`);
        return printVerdict(v, io);
    }
    catch (e) {
        io.err(`motion-kit gate could not run: ${firstLine(e)}\n`);
        return 2;
    }
    finally {
        if (!deps.kindGate)
            await closeHarness();
    }
}
/** Exit codes: 0 ok, 1 invalid config, bar folder or gated page, 2 usage or file error. Only `gate`, `sheet` and `init` return a promise. */
export function run(args, io, deps = {}) {
    const [cmd, ...rest] = args;
    if (cmd === "init") {
        if (rest.length > 0) {
            io.err(`${USAGE}init takes no arguments.\n`);
            return 2;
        }
        return initCommand(io, deps.init ?? realInitDeps());
    }
    if (cmd === "gate") {
        let positionals;
        try {
            ({ positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} }));
            if (positionals.length !== 1)
                throw new Error("gate takes one page.");
        }
        catch (e) {
            io.err(`${USAGE}${e.message}\n`);
            return 2;
        }
        return gateCommand(positionals[0], io, deps);
    }
    if (cmd === "sheet") {
        let parsed;
        try {
            const { values, positionals } = parseArgs({
                args: rest,
                allowPositionals: true,
                options: { out: { type: "string" }, samples: { type: "string" }, to: { type: "string" }, full: { type: "boolean" } },
            });
            if (positionals.length !== 1)
                throw new Error("sheet takes one page.");
            const to = parseTo(values.to);
            const options = { samples: parseSamples(values.samples), full: values.full ?? false, ...(to === undefined ? {} : { toMs: to }) };
            parsed = { out: values.out ?? "sheet.png", options, page: positionals[0] };
        }
        catch (e) {
            io.err(`${USAGE}${e.message}\n`);
            return 2;
        }
        return sheetCommand(parsed.page, parsed.out, parsed.options, io, deps);
    }
    if (cmd !== "resolve" && cmd !== "validate" && cmd !== "knobs" && cmd !== "validate-bar") {
        io.err(USAGE);
        return 2;
    }
    let values;
    let positionals;
    try {
        ({ values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { in: { type: "string" }, out: { type: "string" } } }));
        if (cmd === "validate-bar") {
            if (values.in !== undefined || values.out !== undefined)
                throw new Error("validate-bar takes no --in or --out.");
            if (positionals.length !== 1)
                throw new Error("validate-bar takes one folder.");
        }
        else if (cmd !== "knobs" && positionals.length > 0)
            throw new Error(`Unexpected argument '${positionals[0]}'.`);
        if (cmd === "knobs" && values.out !== undefined)
            throw new Error("knobs prints to stdout and takes no --out.");
    }
    catch (e) {
        io.err(`${USAGE}${e.message}\n`);
        return 2;
    }
    if (cmd === "validate-bar")
        return validateBarCommand(positionals[0], io);
    if (cmd === "knobs") {
        const unknown = positionals.filter((k) => !KINDS.includes(k));
        if (positionals.length === 0 || unknown.length > 0) {
            io.err(`${positionals.length === 0 ? "Name at least one kind." : `Unknown kind: ${unknown.join(", ")}.`} Kinds: ${KINDS.join(", ")}.\n`);
            return 2;
        }
    }
    const inPath = path.resolve(io.cwd, values.in ?? "motion.json");
    const text = io.read(inPath);
    let overrides = {};
    if (text === undefined) {
        if (values.in !== undefined) {
            io.err(`Cannot read ${inPath}.\n`);
            return 2;
        }
        io.err(`No ${inPath}; using the defaults.\n`);
    }
    else {
        try {
            overrides = JSON.parse(text);
        }
        catch (e) {
            io.err(`${inPath} is not valid JSON: ${e.message}\n`);
            return 2;
        }
    }
    try {
        const cfg = resolve(overrides, inPath);
        if (cmd === "validate") {
            io.out(`${inPath} is valid.\n`);
            if (cfg.version === 2) {
                for (const kind of KINDS) {
                    for (const [field, value] of Object.entries(cfg.kinds?.[kind] ?? {})) {
                        for (const l of knobDistance(`${kind}.${field}`, value))
                            io.out(`${l}\n`);
                    }
                }
            }
            return 0;
        }
        if (cmd === "knobs") {
            io.out(knobsSource(cfg, positionals));
            return 0;
        }
        const json = `${JSON.stringify(cfg, null, 2)}\n`;
        if (values.out)
            io.write(path.resolve(io.cwd, values.out), json);
        else
            io.out(json);
        return 0;
    }
    catch (e) {
        if (e instanceof MotionConfigError) {
            io.err(`${e.message}\n`);
            return 1;
        }
        throw e;
    }
}
