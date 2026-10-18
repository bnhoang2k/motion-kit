import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The kit's own folder: the nearest folder above this file whose package.json is named
 * motion-kit. It is the same from src/ and from dist/, and in an installed copy. The CLI and the
 * kind gate read the kit's files (bars/, kinds/) from here, never from the working folder.
 */
export function kitRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown }).name === "motion-kit") return dir;
      } catch {
        // Not the kit's package.json: keep looking up.
      }
    }
    const up = path.dirname(dir);
    if (up === dir) throw new Error("cannot find the motion-kit package folder");
    dir = up;
  }
}

/** The text of a file, or undefined when the path is missing or is not a file (a folder). */
export function readTextFile(p: string): string | undefined {
  try {
    return statSync(p).isFile() ? readFileSync(p, "utf8") : undefined;
  } catch {
    return undefined;
  }
}
