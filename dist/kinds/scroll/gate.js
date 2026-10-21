import { FRAME_MS } from "../../src/gate/harness.js";
import { rangeOf, round, series, spanOf, stillEps, valueNames } from "../../src/gate/kind-gate.js";
import { leadWindow, restGains, steppedLeads } from "../../src/gate/leads.js";
import { inputSpan } from "../../src/gate/synthetic-input.js";
/**
 * The scroll rules (kinds/scroll/rules.md): scrolling back reverses it, and a stepped drawing never runs ahead of the
 * scroll. The input scrolls down, waits, then scrolls back to the top. Reduced motion on a scroll page (stepped
 * states) is the shared reducedMotion rule in src/gate/kind-gate.ts, so the bar gate judges it the same way.
 */
/** Scrolling back undoes at least this share of what scrolling down did. */
const REVERSE_SHARE = 0.5;
const reverses = {
    name: "reverses",
    async check(page, ctx) {
        if (ctx.input?.kind !== "scroll")
            throw new Error("the scroll rule needs scroll input");
        const s = ctx.input.samples;
        const back = s.find((q, i) => i > 0 && q[1] < s[i - 1][1]);
        if (!back)
            throw new Error("the scroll input never scrolls back");
        const { start } = inputSpan(ctx.input);
        const frames = await page.frames(0, spanOf(ctx));
        const last = (ms) => [...frames].reverse().find((f) => f.ms < ms - 1e-6) ?? frames[0];
        const [a, b, c] = [last(start - FRAME_MS / 2), last(back[0]), frames[frames.length - 1]];
        const out = [];
        let moved = false;
        for (const n of valueNames(frames)) {
            const down = (b.values[n] ?? Number.NaN) - (a.values[n] ?? Number.NaN);
            if (!(Math.abs(down) > stillEps(rangeOf(series(frames, n)))))
                continue;
            moved = true;
            const up = (c.values[n] ?? Number.NaN) - (b.values[n] ?? Number.NaN);
            if (!(up * down < 0 && Math.abs(up) >= REVERSE_SHARE * Math.abs(down))) {
                out.push(`reverses: ${n} moves ${round(down)} while the page scrolls down, then ${round(up)} when it scrolls back; scrolling back reverses it`);
            }
        }
        if (!moved)
            out.push("reverses: no value moves while the page scrolls down");
        return out;
    },
};
/**
 * Inside the input window a stepped value reads raw (a flipbook drawn by the scroll): its drawings may not run more
 * than 1.5 of its own drawing steps ahead of where the scroll puts it, by the value's rest-to-rest gain, nor jump off
 * it (leads.ts). The rule is named for its line, `scroll:`; `reverses` judges scrolling back.
 */
const scroll = {
    name: "scroll",
    async check(page, ctx) {
        if (ctx.input?.kind !== "scroll")
            throw new Error("the scroll rule needs scroll input");
        return ctx.stepped?.length ? steppedLeads(page, ctx, ctx.input, "scroll", restGains) : [];
    },
};
export const rules = [reverses, scroll];
/** The stepped values `scroll` judges inside the input window, which the envelope rule leaves to it. */
export const inputLeads = (page, ctx) => leadWindow(page, ctx, ctx.input, restGains);
