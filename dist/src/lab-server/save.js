import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
export function motionPath(cwd) {
    return path.join(cwd, "motion.json");
}
export function readOverrides(cwd) {
    const p = motionPath(cwd);
    if (!existsSync(p))
        return {};
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(p, "utf8"));
    }
    catch (e) {
        throw new Error(`${p} is not valid JSON: ${e.message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${p} must be a JSON object`);
    }
    return parsed;
}
export function writeOverrides(cwd, overrides) {
    const p = motionPath(cwd);
    // Write beside the target, then rename: a crash leaves the old file, never half a new one.
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(overrides, null, 2)}\n`);
    renameSync(tmp, p);
    return p;
}
