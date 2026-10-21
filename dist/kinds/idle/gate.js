import { sleep } from "../../src/gate/harness.js";
import { reopen } from "../../src/gate/kind-gate.js";
/**
 * The idle rules (kinds/idle/rules.md): the loop pauses off screen, and it resumes within one frame
 * of coming back. The gate takes the page off screen two ways at once, so a page may listen for
 * either: `document.hidden` turns true with a `visibilitychange` event, and the body moves
 * 200vh down, out of the viewport (an IntersectionObserver sees it leave).
 */
/** Frames that run this soon after the page goes off screen do not count: the page learns of it a frame late. */
const PAUSE_GRACE_MS = 50;
const PAUSE_WINDOW_MS = 500;
/** One frame, plus room for timer jitter. */
const RESUME_MS = 50;
async function offScreen(live, off) {
    await live.page.evaluate((hide) => {
        const w = window;
        if (hide) {
            Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
            Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
            w.__gateTranslate = document.body.style.translate;
            document.body.style.translate = "0 200vh";
        }
        else {
            Reflect.deleteProperty(document, "hidden");
            Reflect.deleteProperty(document, "visibilityState");
            document.body.style.translate = w.__gateTranslate ?? "";
        }
        document.dispatchEvent(new Event("visibilitychange"));
    }, off);
}
const now = (live) => live.page.evaluate(() => performance.now());
const pausesOffScreen = {
    name: "pausesOffScreen",
    async check(page) {
        const live = await reopen(page, { seek: false });
        try {
            await sleep(300);
            if ((await live.rafCountAfter(await now(live), 200)) === 0)
                return ["pausesOffScreen: the loop is not running on screen, so a pause cannot be checked"];
            await offScreen(live, true);
            const n = await live.rafCountAfter((await now(live)) + PAUSE_GRACE_MS, PAUSE_WINDOW_MS);
            return n === 0 ? [] : [`pausesOffScreen: ${n} rAF callbacks ran in the ${PAUSE_WINDOW_MS} ms after the page went off screen; the loop pauses off screen`];
        }
        finally {
            await live.close();
        }
    },
};
const resumes = {
    name: "resumes",
    async check(page) {
        const live = await reopen(page, { seek: false });
        try {
            await sleep(300);
            await offScreen(live, true);
            await sleep(300);
            await offScreen(live, false);
            const n = await live.rafCountAfter(await now(live), RESUME_MS);
            return n > 0 ? [] : [`resumes: no frame ran in the ${RESUME_MS} ms after the page came back on screen; the loop resumes within one frame`];
        }
        finally {
            await live.close();
        }
    },
};
export const rules = [pausesOffScreen, resumes];
