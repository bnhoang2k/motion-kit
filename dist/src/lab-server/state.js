import { resolve } from "../core/merge.js";
/** Starts editing `saved` (the motion.json contents). Throws MotionConfigError if it does not resolve. */
export function createLabState(saved, source = "motion.json") {
    const working = structuredClone(saved);
    resolve(working, source);
    return { working, source };
}
/** The package defaults plus the working overrides. A fresh object on every call. */
export function config(state) {
    return resolve(state.working, state.source);
}
/** A copy of the working overrides: what Save sends. */
export function overrides(state) {
    return structuredClone(state.working);
}
/** Replaces the working overrides with what the server saved. Throws, and keeps the old ones, if they do not resolve. */
export function adopt(state, saved) {
    const next = structuredClone(saved);
    resolve(next, state.source);
    state.working = next;
}
/**
 * Sets one value on one feel. The key goes into that feel's override and nowhere else.
 * When the value equals what the feel would have without the key (the feel it extends, else the package
 * default), the key is removed, so the feel inherits again. `extends`, `use`, `version` and every other key
 * stay as they were. Throws, and changes nothing, for an unknown feel or a value that makes the config invalid.
 */
export function edit(state, feel, path, value) {
    if (!Object.hasOwn(config(state).feels, feel))
        throw new Error(`unknown feel "${feel}"`);
    const next = structuredClone(state.working);
    if (value === baseValue(state, feel, path))
        removeKey(next, feel, path);
    else
        setKey(next, feel, path, value);
    resolve(next, state.source);
    state.working = next;
}
/** What `feel` resolves to at `path` with the key absent from its override. undefined when nothing is inherited. */
function baseValue(state, feel, path) {
    const without = structuredClone(state.working);
    removeKey(without, feel, path);
    let feels;
    try {
        feels = resolve(without, state.source).feels;
    }
    catch {
        // A project feel with no base needs every key, so nothing can be inherited.
        return undefined;
    }
    if (!Object.hasOwn(feels, feel))
        return undefined;
    const f = feels[feel];
    return path[0] === "moves" ? f.moves[path[1]]?.[path[2]] : f[path[0]];
}
function setKey(o, feel, path, value) {
    const feels = (o.feels ??= {});
    const fo = (Object.hasOwn(feels, feel) ? feels[feel] : (feels[feel] = {}));
    if (path[0] !== "moves") {
        fo[path[0]] = value;
        return;
    }
    const moves = (Object.hasOwn(fo, "moves") ? fo.moves : (fo.moves = {}));
    const mo = (Object.hasOwn(moves, path[1]) ? moves[path[1]] : (moves[path[1]] = {}));
    mo[path[2]] = value;
}
/** Deletes the key, then any move, `moves`, feel override or `feels` that the delete left empty. */
function removeKey(o, feel, path) {
    const feels = o.feels;
    if (feels === undefined || !Object.hasOwn(feels, feel))
        return;
    const fo = feels[feel];
    if (path[0] === "moves") {
        const moves = Object.hasOwn(fo, "moves") ? fo.moves : undefined;
        if (moves === undefined || !Object.hasOwn(moves, path[1]))
            return;
        const mo = moves[path[1]];
        if (!Object.hasOwn(mo, path[2]))
            return;
        delete mo[path[2]];
        if (Object.keys(mo).length)
            return;
        delete moves[path[1]];
        if (Object.keys(moves).length)
            return;
        delete fo.moves;
    }
    else {
        if (!Object.hasOwn(fo, path[0]))
            return;
        delete fo[path[0]];
    }
    if (Object.keys(fo).length)
        return;
    delete feels[feel];
    if (!Object.keys(feels).length)
        delete o.feels;
}
