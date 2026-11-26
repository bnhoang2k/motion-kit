/** Finds a feel by its name, or by a surface name listed in `use`. */
export function feelFor(cfg, feelOrSurface) {
    const name = cfg.use && Object.hasOwn(cfg.use, feelOrSurface) ? cfg.use[feelOrSurface] : feelOrSurface;
    const feel = Object.hasOwn(cfg.feels, name) ? cfg.feels[name] : undefined;
    if (!feel)
        throw new Error(`unknown feel or surface "${feelOrSurface}"`);
    return feel;
}
/**
 * The numbers for one move. Bounce only answers a touch: with byTouch false, bounce is 0.
 * byTouch has no default on purpose, so every caller decides.
 */
export function tx(cfg, feel, move, { byTouch }) {
    const m = feelFor(cfg, feel).moves[move];
    return {
        visualDuration: m.visualDuration,
        bounce: byTouch ? m.bounce : 0,
        reduced: m.reduced,
        ...(m.amount !== undefined ? { amount: m.amount } : {}),
    };
}
/** The spring for opacity, color and shadow: this move's visualDuration with bounce 0. Used for the "flat" keys. */
export function flatTx(cfg, feel, move) {
    return { visualDuration: feelFor(cfg, feel).moves[move].visualDuration, bounce: 0 };
}
export const staggerOf = (cfg, feel) => feelFor(cfg, feel).stagger;
