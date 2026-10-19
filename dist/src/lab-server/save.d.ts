import type { Overrides } from "../core/types.ts";
export declare function motionPath(cwd: string): string;
export declare function readOverrides(cwd: string): Overrides;
export declare function writeOverrides(cwd: string, overrides: Overrides): string;
