import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULTS } from "../dist/src/core/index.js";
import { findBlender } from "./blender-path.mjs";

// Bakes one GLB per default feel for the Lab's Blender lane. Run after `pnpm build`.
const BLENDER = findBlender();
if (!BLENDER || !existsSync(BLENDER)) {
  console.error(`Blender not found${BLENDER ? ` at ${BLENDER}` : ""}. Set BLENDER to its path.`);
  process.exit(2);
}
const dir = mkdtempSync(path.join(tmpdir(), "motion-kit-sample-"));
try {
  const resolved = path.join(dir, "motion.resolved.json");
  writeFileSync(resolved, JSON.stringify(DEFAULTS));
  mkdirSync("lab/assets", { recursive: true });
  for (const feel of Object.keys(DEFAULTS.feels)) {
    // A touch clip keeps the feel's bounce. A no-touch clip is for a server event: bounce 0.
    for (const [suffix, mode] of [["", "touch"], ["-notouch", "notouch"]]) {
      const out = path.resolve(`lab/assets/sample-${feel}${suffix}.glb`);
      rmSync(out, { force: true }); // a stale file must not pass the check below
      // Blender exits 0 when a Python script raises, so --python-exit-code makes a script error fail loudly.
      execFileSync(BLENDER, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", "blender/bake_probe.py", "--", resolved, out, feel, "move", mode], { stdio: "inherit" });
      if (!existsSync(out)) throw new Error(`Blender wrote no file for "${feel}" (${mode}): ${out}`);
      console.log(`Wrote ${out}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
