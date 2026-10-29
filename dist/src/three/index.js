import { settleTime, springState } from "../core/spring.js";
export function browserScheduler() {
    return {
        now: () => performance.now(),
        frame: (cb) => requestAnimationFrame(cb),
        cancelFrame: (id) => cancelAnimationFrame(id),
        timeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (id) => clearTimeout(id),
        reduced: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
}
/** Landing timer slack, so the timer usually does not beat the last frame. */
const LAND_SLACK_MS = 50;
/**
 * Runs motion-kit's spring on one number in a render loop.
 * A timer lands the end value even when the page is hidden and no frames run.
 */
export function tween(opts, sched = browserScheduler()) {
    let f = springState(opts.spring.visualDuration, opts.spring.bounce);
    let settleMs = settleTime(opts.spring.visualDuration) * 1000;
    let reducedMode = opts.spring.reduced;
    let target = opts.to;
    let e0 = opts.from - opts.to;
    let v0 = opts.velocity ?? 0;
    let t0 = sched.now();
    let done = false;
    let stopped = false;
    let raf;
    let timer;
    /** Position frozen by stop(). Set only while stopped. */
    let held;
    /** Elapsed time is clamped at 0: a frame stamp can predate a retarget made earlier in the same frame. */
    const at = (now) => f(Math.max(0, (now - t0) / 1000), e0, v0);
    const cancel = () => {
        if (raf !== undefined)
            sched.cancelFrame(raf);
        raf = undefined;
        sched.clearTimeout(timer);
    };
    const finish = () => {
        if (done || stopped)
            return;
        done = true;
        cancel();
        opts.onUpdate(target);
        opts.onDone?.();
    };
    const step = (now) => {
        raf = undefined;
        if (done || stopped)
            return;
        if (now - t0 >= settleMs)
            return finish();
        opts.onUpdate(target + at(now).x);
        raf = sched.frame(step);
    };
    const start = () => {
        sched.clearTimeout(timer);
        timer = sched.timeout(finish, settleMs + LAND_SLACK_MS);
        if (raf === undefined)
            raf = sched.frame(step);
    };
    /** Reduced motion: jump to `to`, and ask for a fade when the move says fade. */
    const land = (to) => {
        target = to;
        held = undefined;
        done = false;
        stopped = false;
        if (reducedMode === "fade")
            opts.onReducedFade?.(opts.reducedFade);
        finish();
    };
    const handle = {
        get value() {
            if (done)
                return target;
            if (stopped)
                return held ?? target;
            return target + at(sched.now()).x;
        },
        get velocity() {
            return done || stopped ? 0 : at(sched.now()).v;
        },
        get done() {
            return done;
        },
        retarget(to, spring) {
            const now = sched.now();
            const s = done || stopped ? { x: 0, v: 0 } : at(now);
            const x = stopped && !done ? (held ?? target) : target + s.x;
            if (spring) {
                if ("reduced" in spring)
                    reducedMode = spring.reduced;
                f = springState(spring.visualDuration, spring.bounce);
                settleMs = settleTime(spring.visualDuration) * 1000;
            }
            if (sched.reduced())
                return land(to);
            held = undefined;
            target = to;
            e0 = x - to;
            v0 = s.v;
            t0 = now;
            done = false;
            stopped = false;
            start();
        },
        stop() {
            if (stopped)
                return;
            if (!done)
                held = target + at(sched.now()).x;
            stopped = true;
            cancel();
        },
    };
    if (sched.reduced()) {
        land(target);
        return handle;
    }
    start();
    return handle;
}
