import os from "node:os";

/**
 * Lowers this worker's priority, and with it the browser it starts later (a child keeps its parent's priority). The
 * sweeps run hundreds of pages side by side and take every core they are given. A bar's gate is one live page at the
 * real clock, so it slows down with the machine, and its 60 s test timeout is only just enough when the machine is
 * free. `pnpm test:bars` runs the bars' gates before the sweeps (vitest.bars.config.ts), so they never share the cores;
 * the lower priority covers a bar's gate run by hand beside a sweep, and other work on the machine. A machine that
 * refuses the change runs the sweeps at the normal priority, as before.
 */
try {
  os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  // Not allowed here: carry on at the normal priority.
}
