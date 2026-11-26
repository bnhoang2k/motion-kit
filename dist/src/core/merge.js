import { DEFAULTS } from "./defaults.js";
import { validate, validateOverrides } from "./validate.js";
export class MotionConfigError extends Error {
    problems;
    constructor(problems, source) {
        super(`${source} is not a valid motion config:\n- ${problems.join("\n- ")}`);
        this.name = "MotionConfigError";
        this.problems = problems;
    }
}
/**
 * Package defaults plus a project's overrides. Project values win.
 * Takes `unknown` because the overrides usually come from JSON.parse. Throws MotionConfigError, with every problem,
 * if the overrides have the wrong shape or the merged result is invalid.
 */
export function resolve(input = {}, source = "motion.json") {
    const shape = validateOverrides(input);
    if (shape.length)
        throw new MotionConfigError(shape, source);
    const overrides = input;
    const feels = structuredClone(DEFAULTS.feels);
    const problems = [];
    const overrideFeels = overrides.feels ?? {};
    const names = Object.keys(overrideFeels);
    const applied = new Set();
    const failed = new Set();
    const build = (name, fo, base) => {
        const moves = structuredClone(base?.moves ?? {});
        for (const [m, mo] of Object.entries(fo.moves ?? {}))
            moves[m] = { ...(moves[m] ?? {}), ...mo };
        feels[name] = {
            // A feel with no base and no value gets undefined here; validate() reports it as missing.
            describe: fo.describe ?? base?.describe,
            stagger: fo.stagger ?? base?.stagger,
            moves: moves,
        };
        applied.add(name);
    };
    // Pass 1: overrides without `extends` change a default or add a new feel. Order cannot matter.
    for (const name of names) {
        const fo = overrideFeels[name];
        if (fo.extends === undefined)
            build(name, fo, Object.hasOwn(feels, name) ? feels[name] : undefined);
    }
    // Pass 2: feels with `extends`, each built after the feel it extends.
    const visit = (name, stack) => {
        if (applied.has(name) || failed.has(name))
            return;
        const fo = overrideFeels[name];
        const target = fo.extends;
        const cycleAt = stack.indexOf(name);
        if (cycleAt !== -1) {
            const cycle = stack.slice(cycleAt);
            const first = cycle.reduce((lo, n) => (names.indexOf(n) < names.indexOf(lo) ? n : lo));
            const at = cycle.indexOf(first);
            const ring = [...cycle.slice(at), ...cycle.slice(0, at)];
            problems.push(`feels.${first}.extends: cycle ${[...ring, first].join(" -> ")}`);
            for (const n of cycle)
                failed.add(n);
            return;
        }
        if (Object.hasOwn(overrideFeels, target)) {
            if (overrideFeels[target].extends !== undefined)
                visit(target, [...stack, name]);
            if (failed.has(target) || failed.has(name)) {
                failed.add(name);
                return;
            }
        }
        else if (!Object.hasOwn(feels, target)) {
            problems.push(`feels.${name}.extends: unknown feel "${target}"`);
            failed.add(name);
            return;
        }
        build(name, fo, Object.hasOwn(feels, target) ? feels[target] : undefined);
    };
    for (const name of names)
        if (overrideFeels[name].extends !== undefined)
            visit(name, []);
    const out = {
        version: overrides.version ?? 1,
        reducedFade: overrides.reducedFade ?? DEFAULTS.reducedFade,
        feels,
        ...(overrides.use ? { use: { ...overrides.use } } : {}),
        // Overrides only: a knob reader falls back to the base for any knob not named here.
        ...(overrides.kinds ? { kinds: structuredClone(overrides.kinds) } : {}),
    };
    problems.push(...validate(out));
    if (problems.length)
        throw new MotionConfigError(problems, source);
    return out;
}
