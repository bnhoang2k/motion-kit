/**
 * The fixed verdict every gate check ends with. `passed` means every check ran and none failed.
 * `failed` means a check reported a failure. `partial` means a check could not run, so the run
 * cannot vouch for the page. A partial run never passes.
 */
export type Verdict = {
    status: "passed" | "partial" | "failed";
    failures: string[];
};
/** One check: it returns its failures, one line each, and an empty list when it passes. */
export type Check = () => string[] | Promise<string[]>;
export interface VerdictIo {
    out(s: string): void;
    err(s: string): void;
}
/**
 * Prints each failure line to `err`, then exactly one verdict line to `out`: `passed`, `partial`
 * or `failed: n`. Returns the exit code, which is 0 only for `passed`. A verdict marked `passed`
 * that holds failures prints and exits as `failed`.
 */
export declare function printVerdict(v: Verdict, io?: VerdictIo): number;
/**
 * Runs every check in order and collects the failures. A check that throws adds the line
 * `<name>: could not run: <first line of its message>` and makes the run `partial`, whatever
 * the other checks found. A run with no checks is `partial` too: it cannot pass on nothing.
 */
export declare function runChecks(checks: Record<string, Check>): Promise<Verdict>;
