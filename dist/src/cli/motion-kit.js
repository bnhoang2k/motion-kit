#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readTextFile } from "../core/kit-root.js";
import { run } from "./run.js";
process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    read: readTextFile,
    write: (p, d) => {
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, d);
    },
});
