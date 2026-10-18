#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { run } from "./run.ts";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined),
  write: (p, d) => writeFileSync(p, d),
});
