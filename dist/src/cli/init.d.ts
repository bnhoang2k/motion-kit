import type { CliIo } from "./run.ts";
/** The line `init` adds to the project's instruction files. Its path is how a second run finds it. */
export declare const INIT_LINE = "For any animation, follow node_modules/motion-kit/AGENTS.md.";
export declare const REPO = "github:bnhoang2k/motion-kit";
export interface InitDeps {
    /** The kit's own version: `init` installs the release tag `v<version>`. */
    kitVersion: string;
    /** Runs one command in `cwd` with its output shown, and says whether it exited 0. Tests replace it. */
    exec(cmd: string, args: string[], cwd: string): boolean | Promise<boolean>;
}
/**
 * `init`: sets a project up in one step. It installs the kit at its own release tag, installs
 * Playwright and Chromium for the gate, and adds the AGENTS.md line to CLAUDE.md (made if missing)
 * and to the project's AGENTS.md when it has one. A step already done is skipped, so a second run
 * changes nothing. Exit 0 when done, 2 outside a project or when a step fails.
 */
export declare function initCommand(io: CliIo, deps: InitDeps): Promise<number>;
