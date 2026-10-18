import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Overrides } from "../core/types.ts";

export function motionPath(cwd: string): string {
  return path.join(cwd, "motion.json");
}

export function readOverrides(cwd: string): Overrides {
  const p = motionPath(cwd);
  if (!existsSync(p)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`${p} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${p} must be a JSON object`);
  }
  return parsed as Overrides;
}

export function writeOverrides(cwd: string, overrides: Overrides): string {
  const p = motionPath(cwd);
  // Write beside the target, then rename: a crash leaves the old file, never half a new one.
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(overrides, null, 2)}\n`);
  renameSync(tmp, p);
  return p;
}
