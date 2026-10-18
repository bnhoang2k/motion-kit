import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Finds the Blender binary for the bake script and the Blender curve test. Order: the BLENDER
// environment variable, then the standard install path for this platform, then `blender` on PATH.

/** Folder names in `dir`, or none when it cannot be read. */
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The standard install paths for a platform, most likely first. */
export function standardPaths(platform = process.platform, env = process.env, list = listDir) {
  if (platform === "darwin") return ["/Applications/Blender.app/Contents/MacOS/Blender"];
  if (platform === "linux") return ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/opt/blender/blender"];
  if (platform === "win32") {
    // The installer puts each version in its own folder: Blender Foundation\Blender 4.2\blender.exe.
    const root = path.win32.join(env.ProgramFiles ?? "C:\\Program Files", "Blender Foundation");
    const versions = list(root)
      .filter((name) => /^Blender \d+(\.\d+)*$/.test(name))
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    return versions.map((name) => path.win32.join(root, name, "blender.exe"));
  }
  return [];
}

/**
 * The Blender binary: BLENDER when it is set (as given, so a caller can say it is missing), else the
 * first standard install path that exists, else `blender` on PATH. Undefined when none is found.
 */
export function findBlender({ env = process.env, platform = process.platform, exists = existsSync, list = listDir } = {}) {
  if (env.BLENDER) return env.BLENDER;
  const installed = standardPaths(platform, env, list).find((p) => exists(p));
  if (installed) return installed;
  const p = platform === "win32" ? path.win32 : path.posix;
  const name = platform === "win32" ? "blender.exe" : "blender";
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  return dirs.map((dir) => p.join(dir, name)).find((candidate) => exists(candidate));
}
