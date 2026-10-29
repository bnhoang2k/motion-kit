import { FRAME_MS, sleep } from "../../src/gate/harness.js";
import { causesOf } from "../../src/gate/causes.js";
import { firstMoveMs } from "../../src/gate/periodic.js";
import { drive, inputSlack, loopScanEnd, loopsIn, rangeOf, reopen, restApart, restFloors, rolesOf, round, sequenceWaitMs, series, spanOf, stillEps, waitForRest } from "../../src/gate/kind-gate.js";
/**
 * The idle rules (kinds/idle/rules.md): the loop pauses off screen, and it resumes within one frame
 * of coming back. The gate takes the page off screen two ways at once, so a page may listen for
 * either: `document.hidden` turns true with a `visibilitychange` event, and the body moves
 * 200vh down, out of the viewport (an IntersectionObserver sees it leave).
 */
/**
 * A page learns it is off screen a frame late, and an IntersectionObserver is told later still: the last rAF callback of a
 * page that pauses by the observer alone ran 36 to 70 ms after the body moved, over 30 runs of a live page in Chromium (40
 * to 75 ms in an earlier review). So frames that run this soon after the page goes off screen do not count; the window
 * starts 25 ms past the slowest delivery seen. The rules let a page pause by the observer alone.
 */
export const PAUSE_GRACE_MS = 100;
const PAUSE_WINDOW_MS = 500;
/** One frame, plus room for timer jitter. */
const RESUME_MS = 50;
/** The page is off screen this long in the resume check. */
const AWAY_MS = 300;
/** After the page comes back, its loop's value is read from this long after... */
const LOOP_READ_FROM_MS = 300;
/** ...for this long, and for the longest it holds still in its `?seek` frames and 200 ms more, the greater: a loop moves by more than its still tolerance somewhere in that stretch. */
const LOOP_READ_FOR_MS = 400;
/** A loop is read for no longer than this after the page comes back (a blink every 7.5 s holds still for most of it). */
const LOOP_READ_MAX_MS = 8000;
/** The page is off screen this long after the input, in the check that hides it mid-sequence. */
const MID_SEQUENCE_MS = 300;
/** A loop the seek frames show running should be running live by this long after the sequence and the loop's start. */
const LOOP_START_WAIT_MS = 1000;
/** How long the gate waits for the sequence to be at rest once it has played to the end of the `?seek` frames' sequence. */
const REST_WAIT_MS = 5000;
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
/** What the off-screen rules know of the page before they play it: its loops, its `?seek` frames and when its sequence ends. */
async function readPage(page, ctx) {
    const loops = loopsIn(await rolesOf(page, ctx));
    const frames = await page.frames(0, spanOf(ctx));
    const { units } = await page.state();
    const sequenceMs = ctx.input ? sequenceWaitMs(frames, loops, ctx) : 0;
    // A stepped value is drawn in poses in `frames`; how long a loop holds still is read from what the page holds.
    const raw = loops.size > 0 ? await page.rawFrames(0, spanOf(ctx)) : [];
    // A loop may start long after `frames` end (a breath five seconds on): its first move is looked for over the whole scan.
    const scan = loops.size > 0 ? await page.rawFrames(0, Math.max(spanOf(ctx), loopScanEnd(ctx.causes ?? causesOf(ctx.input)))) : [];
    const starts = new Map([...loops].map((n) => [n, firstMoveMs(scan, n)]));
    return { loops, frames, raw, scan, units, sequenceMs, starts };
}
/** The page on its live loop, with the input played: `drive` returns when the last sample has played, `t0` is the wall clock at its start. */
async function playInput(page, ctx) {
    const live = await reopen(page, { seek: false });
    const t0 = performance.now();
    try {
        await drive(live, ctx);
    }
    catch (e) {
        await live.close();
        throw e;
    }
    return { live, t0 };
}
/**
 * Waits for the sequence to be over and its loops running, in that order, and reports whether they run. The page is over
 * when the `?seek` frames' sequence has played and every value but the loops is at rest. A loop is running when its value
 * moves on the live page, by more than its still tolerance: the gate reads each loop's value until it has moved, or until
 * the loop's own first move in the `?seek` scan and LOOP_START_WAIT_MS more (never past the end of the scan), so a loop that
 * starts late (a breath five seconds on) is waited for, however long the page's clock has already run for the rest. A loop
 * that has not moved by then is running all the same when the page still draws frames (a blink between two blinks).
 * A page with no loop is waited for until a frame runs.
 */
/**
 * Reads the values after every live frame from now on: each call returns the frames logged since the last, and the values
 * as they stand (a value a CSS or Web Animations timeline moves changes between frames too).
 */
async function logReader(live) {
    let next = (await live.liveLog(Number.MAX_SAFE_INTEGER)).next;
    return async () => {
        const read = await live.liveLog(next);
        next = read.next;
        return [...read.frames.map((f) => f.values), (await live.state()).values];
    };
}
async function untilLoopRuns(live, t0, ctx, read) {
    await sleep(Math.max(0, t0 + read.sequenceMs - performance.now()));
    await waitForRest(live, REST_WAIT_MS, read.loops, restFloors(read.frames, read.units, read.loops));
    const scanEnd = loopScanEnd(ctx.causes ?? causesOf(ctx.input));
    const deadline = (n) => t0 + Math.min(scanEnd, Math.max(read.sequenceMs, read.starts.get(n) ?? 0) + LOOP_START_WAIT_MS);
    const clock = async () => (await live.rafCountAfter(await now(live), 200)) > 0;
    if (read.loops.size === 0) {
        const end = deadline("");
        for (;;) {
            if (await clock())
                return true;
            if (performance.now() >= end)
                return false;
        }
    }
    const seen = new Map([...read.loops].map((n) => [n, []]));
    const moved = (n) => rangeOf(seen.get(n)) > stillEps(rangeOf(series(read.scan, n)));
    const frames = await logReader(live);
    for (;;) {
        for (const values of await frames())
            for (const [n, xs] of seen)
                xs.push(values[n] ?? Number.NaN);
        const waiting = [...seen.keys()].filter((n) => !moved(n));
        if (waiting.length === 0)
            return true;
        const time = performance.now();
        if (waiting.every((n) => time >= deadline(n)))
            return clock();
        await sleep(50);
    }
}
const pausesOffScreen = {
    name: "pausesOffScreen",
    async check(page, ctx) {
        const read = await readPage(page, ctx);
        const { live, t0 } = await playInput(page, ctx);
        try {
            if (!(await untilLoopRuns(live, t0, ctx, read)))
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
/** The longest `name` holds still in `frames` after it first moves, in ms: a blink that fires every 5 s holds still for almost all of it. */
function longestHold(frames, name) {
    const v = series(frames, name);
    const eps = stillEps(rangeOf(v));
    const first = v.findIndex((x, i) => i > 0 && Math.abs(x - v[0]) > eps);
    if (first < 0)
        return 0;
    let best = 0;
    let run = 0;
    for (let i = first; i + 1 < v.length; i++) {
        run = Math.abs(v[i + 1] - v[i]) > eps ? 0 : run + 1;
        best = Math.max(best, run);
    }
    return best * FRAME_MS;
}
/**
 * The page's loops, read live from LOOP_READ_FROM_MS after `from` for LOOP_READ_FOR_MS (a loop that holds still longer in
 * its `?seek` frames is read for that and 200 ms more, and so is a loop whose first move comes late: its lead-in and 200 ms, up to LOOP_READ_MAX_MS): the first loop whose value never moves by
 * more than its still tolerance there, or null when each does (or the page has none).
 */
async function deadLoop(live, from, read) {
    const { raw } = read;
    const waits = new Map([...read.loops].map((n) => [n, Math.min(LOOP_READ_MAX_MS, Math.max(LOOP_READ_FOR_MS, longestHold(raw, n) + 200, (firstMoveMs(raw, n) ?? 0) + 200))]));
    const seen = new Map([...read.loops].map((n) => [n, []]));
    const moved = (n) => rangeOf(seen.get(n)) > stillEps(rangeOf(series(raw, n)));
    const open = () => [...seen.keys()].filter((n) => !moved(n));
    await sleep(Math.max(0, from + LOOP_READ_FROM_MS - performance.now()));
    const frames = await logReader(live);
    for (;;) {
        for (const values of await frames())
            for (const [n, xs] of seen)
                xs.push(values[n] ?? Number.NaN);
        const still = open();
        if (still.length === 0)
            return null;
        const elapsed = performance.now() - from - LOOP_READ_FROM_MS;
        const dead = still.find((n) => elapsed >= waits.get(n));
        if (dead !== undefined)
            return dead;
        await sleep(50);
    }
}
/**
 * Coming back resumes the page, not only its frames: the page leaves in the middle of its sequence and comes back, and the
 * sequence goes on to the rest it reaches without leaving (restApart); once the loop runs, it leaves again, a frame runs
 * within RESUME_MS of its return, and the loop's value is still moving LOOP_READ_FROM_MS after (and a blink's next blink, when it holds
 * still that long), not only for the few frames a restart runs.
 */
const resumes = {
    name: "resumes",
    async check(page, ctx) {
        const read = await readPage(page, ctx);
        const { live, t0 } = await playInput(page, ctx);
        try {
            if (ctx.input) {
                await sleep(MID_SEQUENCE_MS);
                await offScreen(live, true);
                await sleep(AWAY_MS);
                await offScreen(live, false);
                await sleep(Math.max(0, t0 + read.sequenceMs + MID_SEQUENCE_MS + AWAY_MS - performance.now()));
                // A page that never rests is loopStopsAtRest's to report.
                const rest = await waitForRest(live, REST_WAIT_MS, read.loops, restFloors(read.frames, read.units, read.loops));
                const apart = rest === null ? null : restApart((await live.state()).values, read.frames, read.loops, read.units, inputSlack(read.frames, ctx.input));
                if (apart)
                    return [`resumes: after the page leaves mid-sequence and comes back, ${apart.name} ${apart.live === null ? "is never reported" : `rests at ${round(apart.live)}`}, where the page rests without leaving (${round(apart.seek)}); the sequence goes on after the page resumes`];
            }
            await untilLoopRuns(live, t0, ctx, read);
            await offScreen(live, true);
            await sleep(AWAY_MS);
            await offScreen(live, false);
            const back = await now(live);
            const n = await live.rafCountAfter(back, RESUME_MS);
            if (n === 0)
                return [`resumes: no frame ran in the ${RESUME_MS} ms after the page came back on screen; the loop resumes within one frame`];
            const dead = await deadLoop(live, performance.now() - RESUME_MS, read);
            return dead === null ? [] : [`resumes: ${dead} has stopped moving ${LOOP_READ_FROM_MS} ms after the page came back on screen; the loop runs on after it resumes`];
        }
        finally {
            await live.close();
        }
    },
};
export const rules = [pausesOffScreen, resumes];
