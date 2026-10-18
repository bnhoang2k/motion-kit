import { resolve } from "../core/merge.ts";
import type { Feel, MotionConfig, MoveName, Overrides } from "../core/types.ts";

// Pure functions only: the Lab page imports this file in the browser, so no node: modules here.

export type MoveKey = "visualDuration" | "bounce" | "amount" | "reduced";
/** One value the Lab can edit on a feel. */
export type EditPath = readonly ["describe"] | readonly ["stagger"] | readonly ["moves", MoveName, MoveKey];

/**
 * What the Lab is editing: the project's overrides, not a resolved config.
 * A key is here only because it was in motion.json or the person set it. Every other value is inherited,
 * so a feel that extends an edited feel follows it, and Save writes exactly these overrides.
 */
export interface LabState {
  working: Overrides;
  /** Names the file in error messages. */
  readonly source: string;
}

type Obj = Record<string, unknown>;

/** Starts editing `saved` (the motion.json contents). Throws MotionConfigError if it does not resolve. */
export function createLabState(saved: Overrides, source = "motion.json"): LabState {
  const working = structuredClone(saved);
  resolve(working, source);
  return { working, source };
}

/** The package defaults plus the working overrides. A fresh object on every call. */
export function config(state: LabState): MotionConfig {
  return resolve(state.working, state.source);
}

/** A copy of the working overrides: what Save sends. */
export function overrides(state: LabState): Overrides {
  return structuredClone(state.working);
}

/** Replaces the working overrides with what the server saved. Throws, and keeps the old ones, if they do not resolve. */
export function adopt(state: LabState, saved: Overrides): void {
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
export function edit(state: LabState, feel: string, path: EditPath, value: string | number): void {
  if (!Object.hasOwn(config(state).feels, feel)) throw new Error(`unknown feel "${feel}"`);
  const next = structuredClone(state.working);
  if (value === baseValue(state, feel, path)) removeKey(next, feel, path);
  else setKey(next, feel, path, value);
  resolve(next, state.source);
  state.working = next;
}

/** What `feel` resolves to at `path` with the key absent from its override. undefined when nothing is inherited. */
function baseValue(state: LabState, feel: string, path: EditPath): unknown {
  const without = structuredClone(state.working);
  removeKey(without, feel, path);
  let feels: Record<string, Feel>;
  try {
    feels = resolve(without, state.source).feels;
  } catch {
    // A project feel with no base needs every key, so nothing can be inherited.
    return undefined;
  }
  if (!Object.hasOwn(feels, feel)) return undefined;
  const f = feels[feel]!;
  return path[0] === "moves" ? (f.moves[path[1]] as unknown as Obj | undefined)?.[path[2]] : (f as unknown as Obj)[path[0]];
}

function setKey(o: Overrides, feel: string, path: EditPath, value: unknown): void {
  const feels = (o.feels ??= {});
  const fo = (Object.hasOwn(feels, feel) ? feels[feel] : (feels[feel] = {})) as Obj;
  if (path[0] !== "moves") {
    fo[path[0]] = value;
    return;
  }
  const moves = (Object.hasOwn(fo, "moves") ? fo.moves : (fo.moves = {})) as Obj;
  const mo = (Object.hasOwn(moves, path[1]) ? moves[path[1]] : (moves[path[1]] = {})) as Obj;
  mo[path[2]] = value;
}

/** Deletes the key, then any move, `moves`, feel override or `feels` that the delete left empty. */
function removeKey(o: Overrides, feel: string, path: EditPath): void {
  const feels = o.feels as Obj | undefined;
  if (feels === undefined || !Object.hasOwn(feels, feel)) return;
  const fo = feels[feel] as Obj;
  if (path[0] === "moves") {
    const moves = Object.hasOwn(fo, "moves") ? (fo.moves as Obj) : undefined;
    if (moves === undefined || !Object.hasOwn(moves, path[1])) return;
    const mo = moves[path[1]] as Obj;
    if (!Object.hasOwn(mo, path[2])) return;
    delete mo[path[2]];
    if (Object.keys(mo).length) return;
    delete moves[path[1]];
    if (Object.keys(moves).length) return;
    delete fo.moves;
  } else {
    if (!Object.hasOwn(fo, path[0])) return;
    delete fo[path[0]];
  }
  if (Object.keys(fo).length) return;
  delete feels[feel];
  if (!Object.keys(feels).length) delete o.feels;
}
