import { type Verdict } from "../gate/verdict.ts";
import { type InitDeps } from "./init.ts";
export interface CliIo {
    cwd: string;
    out(s: string): void;
    err(s: string): void;
    /** Returns undefined when the file does not exist. */
    read(path: string): string | undefined;
    write(path: string, data: string): void;
}
export declare const PLAYWRIGHT_INSTALL = "motion-kit gate needs Playwright: pnpm add -D playwright && pnpm exec playwright install chromium";
export interface GateDeps {
    /** Resolves to Playwright, or null when it cannot be imported. Tests replace it. */
    playwrightOrNull?: () => Promise<unknown>;
    /** The gate itself. Tests replace it. */
    kindGate?: (file: string) => Promise<Verdict & {
        distances: string[];
        notes?: string[];
    }>;
    /** What `init` runs commands with, and the version it installs. Tests replace it. */
    init?: InitDeps;
}
/** Exit codes: 0 ok, 1 invalid config, bar folder or gated page, 2 usage or file error. Only `gate` and `init` return a promise. */
export declare function run(args: string[], io: CliIo, deps?: GateDeps): number | Promise<number>;
