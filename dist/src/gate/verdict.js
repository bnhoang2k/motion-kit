const STD_IO = {
    out: (s) => void process.stdout.write(s),
    err: (s) => void process.stderr.write(s),
};
/** Exit codes: 0 passed, 1 failed or partial. Exit 2 stays free for "cannot start" (usage, Playwright missing). */
const EXIT = { passed: 0, failed: 1, partial: 1 };
/**
 * Prints each failure line to `err`, then exactly one verdict line to `out`: `passed`, `partial`
 * or `failed: n`. Returns the exit code, which is 0 only for `passed`. A verdict marked `passed`
 * that holds failures prints and exits as `failed`.
 */
export function printVerdict(v, io = STD_IO) {
    const status = v.status === "passed" && v.failures.length > 0 ? "failed" : v.status;
    for (const f of v.failures)
        io.err(`${f}\n`);
    io.out(status === "failed" ? `failed: ${v.failures.length}\n` : `${status}\n`);
    return EXIT[status];
}
/**
 * Runs every check in order and collects the failures. A check that throws adds the line
 * `<name>: could not run: <first line of its message>` and makes the run `partial`, whatever
 * the other checks found. A run with no checks is `partial` too: it cannot pass on nothing.
 */
export async function runChecks(checks) {
    const names = Object.keys(checks);
    if (names.length === 0)
        return { status: "partial", failures: ["no checks ran"] };
    const failures = [];
    let partial = false;
    for (const name of names) {
        try {
            failures.push(...(await checks[name]()));
        }
        catch (e) {
            partial = true;
            const message = (e instanceof Error ? e.message : String(e)).split("\n")[0];
            failures.push(`${name}: could not run: ${message}`);
        }
    }
    const status = partial ? "partial" : failures.length > 0 ? "failed" : "passed";
    return { status, failures };
}
