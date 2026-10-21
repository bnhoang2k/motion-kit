/** The line `gate` and `sheet` print when Playwright or its Chromium is missing. */
export const playwrightInstall = (cmd: string) => `motion-kit ${cmd} needs Playwright: pnpm add -D playwright && pnpm exec playwright install chromium`;

type Launcher = { chromium: { launch(o: { headless: boolean }): Promise<{ close(): Promise<unknown> }> } };

/**
 * True when Playwright imports and its Chromium starts. `playwrightOrNull` replaces the real import in tests. The
 * harness loads only here, so nothing else in the CLI imports Playwright.
 */
export async function chromiumReady(playwrightOrNull?: () => Promise<unknown>): Promise<boolean> {
  const load = playwrightOrNull ?? (await import("../gate/harness.ts")).playwrightOrNull;
  const pw = (await load()) as Launcher | null;
  if (pw === null) return false;
  try {
    await (await pw.chromium.launch({ headless: true })).close();
    return true;
  } catch {
    return false;
  }
}

export const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

/** Closes the harness's shared browser, when the harness was loaded. */
export async function closeHarness(): Promise<void> {
  await (await import("../gate/harness.ts")).closeBrowser();
}
