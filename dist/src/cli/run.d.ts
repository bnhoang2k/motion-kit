import { type Verdict } from "../gate/verdict.ts";
import type { FrameSheet, SheetOptions } from "../gate/sheet.ts";
import { type InitDeps } from "./init.ts";
export interface CliIo {
    cwd: string;
    out(s: string): void;
    err(s: string): void;
    /** Returns undefined when the file does not exist. */
    read(path: string): string | undefined;
    write(path: string, data: string | Uint8Array): void;
}
export declare const PLAYWRIGHT_INSTALL: string;
export interface GateDeps {
    /** Resolves to Playwright, or null when it cannot be imported. Tests replace it. */
    playwrightOrNull?: () => Promise<unknown>;
    /** The frame sheet. Tests replace it. */
    frameSheet?: (file: string, options: SheetOptions) => Promise<FrameSheet>;
    /** The gate itself. Tests replace it. */
    kindGate?: (file: string) => Promise<Verdict & {
        distances: string[];
        notes?: string[];
    }>;
    /** What `init` runs commands with, and the version it installs. Tests replace it. */
    init?: InitDeps;
}
/** Exit codes: 0 ok, 1 invalid config, bar folder or gated page, 2 usage or file error. Only `gate`, `sheet` and `init` return a promise. */
export declare function run(args: string[], io: CliIo, deps?: GateDeps): number | Promise<number>;
