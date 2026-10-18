import path from "node:path";
import { parseArgs } from "node:util";
import { MotionConfigError, resolve } from "../core/merge.js";
const USAGE = "Usage: motion-kit <resolve|validate> [--in motion.json] [--out file]\n";
/** Exit codes: 0 ok, 1 invalid config, 2 usage or file error. */
export function run(args, io) {
    const [cmd, ...rest] = args;
    if (cmd !== "resolve" && cmd !== "validate") {
        io.err(USAGE);
        return 2;
    }
    let values;
    try {
        ({ values } = parseArgs({ args: rest, options: { in: { type: "string" }, out: { type: "string" } } }));
    }
    catch (e) {
        io.err(`${USAGE}${e.message}\n`);
        return 2;
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
