/** The line `gate` and `sheet` print when Playwright or its Chromium is missing. */
export const playwrightInstall = (cmd) => `motion-kit ${cmd} needs Playwright: pnpm add -D playwright && pnpm exec playwright install chromium`;
/**
 * True when Playwright imports and its Chromium starts. `playwrightOrNull` replaces the real import in tests. The
 * harness loads only here, so nothing else in the CLI imports Playwright.
 */
export async function chromiumReady(playwrightOrNull) {
    const load = playwrightOrNull ?? (await import("../gate/harness.js")).playwrightOrNull;
    const pw = (await load());
    if (pw === null)
        return false;
    try {
        await (await pw.chromium.launch({ headless: true })).close();
        return true;
    }
    catch {
        return false;
    }
}
export const firstLine = (e) => (e instanceof Error ? e.message : String(e)).split("\n")[0];
/** Closes the harness's shared browser, when the harness was loaded. */
export async function closeHarness() {
    await (await import("../gate/harness.js")).closeBrowser();
}
