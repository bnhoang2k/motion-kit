/** The line `gate` and `sheet` print when Playwright or its Chromium is missing. */
export declare const playwrightInstall: (cmd: string) => string;
/**
 * True when Playwright imports and its Chromium starts. `playwrightOrNull` replaces the real import in tests. The
 * harness loads only here, so nothing else in the CLI imports Playwright.
 */
export declare function chromiumReady(playwrightOrNull?: () => Promise<unknown>): Promise<boolean>;
export declare const firstLine: (e: unknown) => string | undefined;
/** Closes the harness's shared browser, when the harness was loaded. */
export declare function closeHarness(): Promise<void>;
