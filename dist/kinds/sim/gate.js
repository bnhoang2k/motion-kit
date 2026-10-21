import { causesOf } from "../../src/gate/causes.js";
import { forLoops, loopsIn, rangeOf, rolesOf, round, series, spanOf, stillEps, unitFloor, valueNames, REST_FRAMES } from "../../src/gate/kind-gate.js";
import { rules as idleRules } from "../idle/gate.js";
/**
 * The sim rules (kinds/sim/rules.md). A sim page moves bodies by physics after a cause: a tap, a
 * release, a scroll or the page load. From the moment each cause stops, a body (a value in px or
 * deg that is no loop) gains speed only under a steady pull, leaves each turn no faster than it
 * arrived, and does not start again once it rests. Every value but a loop
 * rests within 4 s. A loop on the page gets the idle rules: it pauses off screen.
 */
/** Every value that is not a loop holds still this long after its cause stops, at the latest. */
export const REST_WITHIN_MS = 4000;
/** A flight's first frames are its launch, and the steady-pull check skips them. */
export const LAUNCH_FRAMES = 2;
/** In a flight, one frame's rise in speed may be at most this many times the flight's median change in speed, plus the unit floor. */
export const PULL_MULTIPLE = 4;
/** What the rules judge for one cause: the frames from its stop to the next cause's start, or the end. */
function judged(frames, causes, k) {
    const from = causes[k].stopMs;
    const to = causes[k + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    return frames.filter((f) => f.ms >= from - 1e-6 && f.ms <= to + 1e-6);
}
const floorOf = (units, n, range) => unitFloor(units[n], range);
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** The problems of one body over one cause's judged frames, or null when it never moves there. */
function bodyProblems(fs, n, eps, floor) {
    const v = series(fs, n);
    const step = (i) => v[i + 1] - v[i];
    const moving = (i) => Number.isFinite(step(i)) && Math.abs(step(i)) > eps;
    if (!v.some((_, i) => i + 1 < v.length && moving(i)))
        return null;
    const out = [];
    const rest = v[v.length - 1];
    const flights = [];
    let still = 0;
    let restedAt = null;
    for (let i = 0; i + 1 < v.length; i++) {
        if (!moving(i)) {
            still++;
            if (still >= REST_FRAMES && restedAt === null && flights.length > 0)
                restedAt = fs[i + 1].ms;
            continue;
        }
        if (restedAt !== null) {
            out.push(`energyFalls: ${n} moves again at ${round(fs[i].ms)} ms after resting at ${round(restedAt)} ms, with no new cause`);
            break;
        }
        still = 0;
        const dir = Math.sign(step(i));
        const last = flights[flights.length - 1];
        if (last && last.dir === dir && last.to === i - 1)
            last.to = i;
        else
            flights.push({ from: i, to: i, dir });
    }
    // A steady pull only: after its launch, no frame in a flight gains speed by much more than the flight's typical change.
    for (const f of flights) {
        const speeds = [];
        for (let i = f.from + LAUNCH_FRAMES; i <= f.to; i++)
            speeds.push(Math.abs(step(i)));
        const rises = speeds.slice(1).map((s, j) => s - speeds[j]);
        if (rises.length < 2)
            continue;
        const pull = median(rises.map(Math.abs));
        const j = rises.findIndex((r) => r > PULL_MULTIPLE * pull + floor);
        if (j >= 0) {
            const at = fs[f.from + LAUNCH_FRAMES + j + 1].ms;
            out.push(`energyFalls: ${n} speeds up by ${round(rises[j])} in one frame at ${round(at)} ms, ${Math.round(rises[j] / Math.max(pull, 1e-9))}x its steady pull; only a steady pull adds speed`);
            break;
        }
    }
    // No bounce rises: a body leaves each turn no faster than it arrived (a frame step, plus the unit floor). The
    // arriving speed is the larger of the turn's last two steps, since the frame that meets a floor moves only part way.
    for (let k = 0; k + 1 < flights.length; k++) {
        const [f, g] = [flights[k], flights[k + 1]];
        if (g.dir !== -f.dir || g.from !== f.to + 1)
            continue;
        const arrive = Math.max(Math.abs(step(f.to)), f.to > f.from ? Math.abs(step(f.to - 1)) : 0);
        const leave = Math.abs(step(g.from));
        if (leave > arrive + floor) {
            out.push(`energyFalls: ${n} leaves its turn at ${round(fs[g.from].ms)} ms at ${round(leave)} a frame, faster than it arrived (${round(arrive)}); a bounce never rises`);
            break;
        }
    }
    return out;
}
const energyFalls = {
    name: "energyFalls",
    async check(page, ctx) {
        const frames = await page.frames(0, spanOf(ctx));
        const { units } = await page.state();
        const roles = await rolesOf(page, ctx);
        const bodies = valueNames(frames).filter((n) => roles.get(n) === "position");
        const causes = ctx.causes ?? causesOf(ctx.input);
        const out = [];
        let moved = false;
        for (const n of bodies) {
            const range = rangeOf(series(frames, n));
            for (let k = 0; k < causes.length; k++) {
                const problems = bodyProblems(judged(frames, causes, k), n, stillEps(range), floorOf(units, n, range));
                if (problems === null)
                    continue;
                moved = true;
                if (problems.length > 0) {
                    out.push(...problems);
                    break;
                }
            }
        }
        if (!moved)
            return ["energyFalls: no px or deg value moves after the cause; a sim page needs a body, with its unit in __state().units"];
        return out;
    },
};
const restsInTime = {
    name: "restsInTime",
    async check(page, ctx) {
        const frames = await page.frames(0, spanOf(ctx));
        const loops = loopsIn(await rolesOf(page, ctx));
        const causes = ctx.causes ?? causesOf(ctx.input);
        const out = [];
        for (const n of valueNames(frames).filter((x) => !loops.has(x))) {
            const eps = stillEps(rangeOf(series(frames, n)));
            for (let k = 0; k < causes.length; k++) {
                const fs = judged(frames, causes, k);
                const v = series(fs, n);
                let last = -1;
                for (let i = 0; i + 1 < v.length; i++)
                    if (Math.abs(v[i + 1] - v[i]) > eps)
                        last = i;
                if (last >= 0 && fs[last].ms > causes[k].stopMs + REST_WITHIN_MS + 1e-6) {
                    out.push(`restsInTime: ${n} still moves at ${round(fs[last].ms)} ms, more than ${REST_WITHIN_MS} ms after the cause stopped at ${round(causes[k].stopMs)} ms`);
                    break;
                }
            }
        }
        return out;
    },
};
export const rules = [energyFalls, restsInTime, ...idleRules.map(forLoops)];
