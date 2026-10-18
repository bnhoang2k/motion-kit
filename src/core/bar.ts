import { runInNewContext } from "node:vm";
import { KINDS, KNOB_FIELDS } from "./kinds.ts";
import { checkTrace, TOLERANCE_FLOORS } from "./trace.ts";

export { TOLERANCE_FLOORS };

/** One dial in bar.json: a single MOTION path and its raw page value. */
export interface BarDial {
  path: string;
  value: number;
  unit: string;
  /** "<kind>.<field>", a key of KNOB_FIELDS. */
  knob: string;
  /** The notes.md row the value belongs to. */
  row: string;
}

/** How the page draws one asset slot, so a copy can swap the asset. */
export interface AssetSlot {
  draw: string;
  aspect: string;
  view: string;
  facing: string;
  background: "cutout" | "full-bleed";
}

/** The public contract of a bar folder. */
export interface BarJson {
  slug: string;
  title: string;
  /** Main kind first. */
  kinds: string[];
  /** Names from bars/moments.json. */
  moments: string[];
  /** 1 quiet, 2 expressive, 3 immersive, 4 playable; or [lo, hi] for a page that spans two. */
  rung: number | [number, number];
  fits: string;
  wrongFor: string;
  /** 1 to 3 sentences on what the motion does in time. */
  feel: string;
  dials: BarDial[];
  assetContract: Record<string, AssetSlot>;
  /** The fixed-clock hook the page exposes. */
  clock: string;
  /** The trace.json channels, in order, with the tolerance of each. */
  trace: { name: string; tolerance: number }[];
  /** The page's own planted faults, as find-and-replace pairs on index.html. */
  faults: { name: string; find: string; replace: string }[];
  /** The slug of the bar that replaced this one. */
  superseded?: string;
  /** Selectors of moving elements that no trace channel reads. */
  cover?: string[];
}

const MAX_FEEL = 300;
const FIELDS = ["slug", "title", "kinds", "moments", "rung", "fits", "wrongFor", "feel", "dials", "assetContract", "clock", "trace", "faults", "superseded", "cover"];
const OPTIONAL = new Set(["superseded", "cover"]);
const DIAL_KEYS = ["path", "value", "unit", "knob", "row"];
const SLOT_KEYS = ["draw", "aspect", "view", "facing", "background"];

/** A home path: a public bar file names no file on one machine. */
const ABSOLUTE_PATH = /\/Users\/|~\//g;

/** Every home path in `text`, as "<file>:<line>: absolute path: "<match>"". */
export function absolutePathProblems(file: string, text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(ABSOLUTE_PATH)) out.push(`${file}:${i + 1}: absolute path: "${m[0]}"`);
  });
  return out;
}

/**
 * When `text[i]` opens a string, a template or a comment, the index of its last character; else `i`.
 * Template literals end at the next backtick: a `${...}` inside one is not followed.
 */
export function skipStringOrComment(text: string, i: number): number {
  const c = text[i];
  if (c === '"' || c === "'" || c === "`") {
    for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    return i;
  }
  if (c === "/" && text[i + 1] === "/") {
    while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    return i;
  }
  if (c === "/" && text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 1;
  }
  return i;
}

/** Where the object literal after `const MOTION =` sits in the page: `start` at its `{`, `end` just past its `}`. Skips braces inside strings and comments. */
export function motionRange(html: string): { start: number; end: number } | undefined {
  const found = /\bconst\s+MOTION\s*=\s*\{/.exec(html);
  if (!found) return undefined;
  const open = found.index + found[0].length - 1;
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    const skipped = skipStringOrComment(html, i);
    if (skipped !== i) i = skipped;
    else if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return { start: open, end: i + 1 };
  }
  return undefined;
}

/** The source of the MOTION object literal, or undefined. */
function motionSource(html: string): string | undefined {
  const r = motionRange(html);
  return r && html.slice(r.start, r.end);
}

/** Evaluates a MOTION object literal's source in an empty context. Throws when it does not evaluate. */
export function evaluateMotion(src: string): unknown {
  return runInNewContext(`(${src})`, Object.create(null), { timeout: 1000 });
}

/** The value at a dotted key path, or undefined when a step is missing. */
export function valueAtPath(obj: unknown, keyPath: string): unknown {
  let cur = obj;
  for (const key of keyPath.split(".")) {
    if (typeof cur !== "object" || cur === null || !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const same = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isRung = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4;
const show = (v: unknown): string => (typeof v === "number" ? String(v) : JSON.stringify(v));

interface DialsEntry { knob?: unknown; bar?: unknown; path?: unknown; value?: unknown; from?: unknown }


/** The four files every bar folder holds. */
const BAR_FILES = ["index.html", "bar.json", "notes.md", "trace.json"] as const;

interface BarFiles {
  html: string | undefined;
  bar: string | undefined;
  notes: string | undefined;
  trace: string | undefined;
  barValue: unknown;
  traceValue: unknown;
  /** A missing file, or bar.json or trace.json that is not valid JSON. */
  errors: string[];
}

function loadBarFiles(base: string, read: (p: string) => string | undefined): BarFiles {
  const texts = BAR_FILES.map((f) => read(`${base}/${f}`));
  const errors = BAR_FILES.filter((_, i) => texts[i] === undefined).map((f) => `${f}: missing`);
  const [html, bar, notes, trace] = texts;
  const parse = (name: string, text: string | undefined): unknown => {
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch (e) {
      errors.push(`${name}: not valid JSON: ${(e as Error).message}`);
      return undefined;
    }
  };
  return { html, bar, notes, trace, barValue: parse("bar.json", bar), traceValue: parse("trace.json", trace), errors };
}

/**
 * The file errors in a bar folder: each missing bar file, and bar.json or trace.json that is not
 * valid JSON. validateBar lists these too; the CLI uses them to tell a file error from a contract problem.
 */
export function barFileErrors(dir: string, read: (p: string) => string | undefined): string[] {
  return loadBarFiles(dir.replace(/\/+$/, ""), read).errors;
}

/**
 * Checks a bar folder against the bar.json contract and returns every problem (empty when it passes).
 * `dir` and every path given to `read` are repo-relative (for example `bars/x/bar.json` or
 * `kinds/idle/dials.json`); `read` returns undefined for a missing file. It reads the four bar files and the kit
 * files (bars/moments.json, kinds/<kind>/dials.json), and nothing else. `readKit` reads the kit files when they
 * live apart from the bar folder (the CLI reads them from the kit's own folder); it defaults to `read`.
 */
export function validateBar(dir: string, read: (p: string) => string | undefined, readKit: (p: string) => string | undefined = read): string[] {
  const base = dir.replace(/\/+$/, "");
  const folder = base.split("/").pop() ?? base;
  const files = loadBarFiles(base, read);
  const { barValue, traceValue } = files;
  const problems: string[] = [...files.errors];
  const bar = isObj(barValue) ? barValue : undefined;
  if (barValue !== undefined && !bar) problems.push("bar.json: must be an object");
  const slug = bar && isText(bar.slug) ? bar.slug : folder;

  // The page: its marker and its MOTION block.
  let motion: unknown;
  if (files.html !== undefined) {
    const marker = /<meta\s+name="motion-kit-bar"\s+content="([^"]*)"|<meta\s+content="([^"]*)"\s+name="motion-kit-bar"/.exec(files.html);
    if (!marker) problems.push("index.html: no motion-kit-bar marker");
    else if ((marker[1] ?? marker[2]) !== slug) problems.push(`index.html: the motion-kit-bar marker names "${marker[1] ?? marker[2]}", expected "${slug}"`);
    const src = motionSource(files.html);
    if (src === undefined) problems.push("index.html: no `const MOTION = {` block");
    else {
      try {
        motion = evaluateMotion(src);
      } catch (e) {
        problems.push(`index.html: the MOTION block does not evaluate: ${(e as Error).message}`);
      }
    }
  }

  if (bar) {
    const p = (field: string, msg: string) => problems.push(`bar.json ${field}: ${msg}`);
    for (const k of Object.keys(bar)) if (!FIELDS.includes(k)) p(k, "unknown field");
    for (const k of FIELDS) if (!OPTIONAL.has(k) && bar[k] === undefined) p(k, "missing");
    const text = (field: string, oneLine = false) => {
      const v = bar[field];
      if (v === undefined) return;
      if (!isText(v)) p(field, "must be a non-empty string");
      else if (oneLine && v.includes("\n")) p(field, "must be one line");
    };

    text("slug");
    if (isText(bar.slug) && bar.slug !== folder) p("slug", `"${bar.slug}" does not match the folder name "${folder}"`);
    text("title");

    if (bar.kinds !== undefined) {
      if (!Array.isArray(bar.kinds)) p("kinds", "must be a list of kinds");
      else if (bar.kinds.length === 0) p("kinds", "needs at least one kind");
      else bar.kinds.forEach((k, i) => {
        if (!(KINDS as readonly unknown[]).includes(k)) p(`kinds[${i}]`, `unknown kind ${show(k)}`);
      });
    }

    if (bar.moments !== undefined) {
      let known: unknown[] | undefined;
      try {
        const list: unknown = JSON.parse(readKit("bars/moments.json") ?? "null");
        known = Array.isArray(list) ? list.map((m) => (isObj(m) ? m.name : undefined)) : undefined;
      } catch {
        known = undefined;
      }
      if (!Array.isArray(bar.moments)) p("moments", "must be a list of moment names");
      else if (bar.moments.length === 0) p("moments", "needs at least one moment");
      else if (!known) p("moments", "cannot read bars/moments.json");
      else bar.moments.forEach((m, i) => {
        if (!known.includes(m)) p(`moments[${i}]`, `${show(m)} is not in bars/moments.json`);
      });
    }

    if (bar.rung !== undefined) {
      const r = bar.rung;
      const ok = isRung(r) || (Array.isArray(r) && r.length === 2 && isRung(r[0]) && isRung(r[1]) && r[0] < r[1]);
      if (!ok) p("rung", "must be a whole number from 1 to 4, or [lo, hi] with lo below hi");
    }

    text("fits", true);
    text("wrongFor", true);

    if (bar.feel !== undefined) {
      if (!isText(bar.feel)) p("feel", "must be a non-empty string");
      else if (bar.feel.length > MAX_FEEL) p("feel", `at most ${MAX_FEEL} characters, got ${bar.feel.length}`);
      else {
        const sentences = bar.feel.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;
        if (sentences > 3) p("feel", `needs 1 to 3 sentences, got ${sentences}`);
      }
    }

    if (bar.dials !== undefined) {
      if (!Array.isArray(bar.dials)) p("dials", "must be a list");
      else {
        if (bar.dials.length < 1 || bar.dials.length > 5) p("dials", `needs 1 to 5 entries, got ${bar.dials.length}`);
        const dialsFiles = new Map<string, DialsEntry[] | undefined>();
        const dialsList = (file: string): DialsEntry[] | undefined => {
          if (!dialsFiles.has(file)) {
            let list: unknown;
            try {
              list = JSON.parse(readKit(file) ?? "null");
            } catch {
              list = undefined;
            }
            dialsFiles.set(file, Array.isArray(list) ? (list as DialsEntry[]) : undefined);
          }
          return dialsFiles.get(file);
        };
        const checkDial = (d: unknown, where: string): void => {
          if (!isObj(d)) return void p(where, "must be an object");
          const before = problems.length;
          for (const k of Object.keys(d)) if (!DIAL_KEYS.includes(k)) p(`${where}.${k}`, "unknown key");
          for (const k of ["path", "unit", "knob", "row"]) if (!isText(d[k])) p(`${where}.${k}`, "must be a non-empty string");
          if (typeof d.value !== "number" || !Number.isFinite(d.value)) p(`${where}.value`, "must be a finite number");
          if (problems.length > before) return;
          const { path, value, knob } = d as unknown as BarDial;
          if (motion !== undefined) {
            const onPage = valueAtPath(motion, path);
            if (onPage === undefined) p(`${where}.path`, `${path} is not in the MOTION block`);
            else if (typeof onPage !== "number") p(`${where}.path`, `${path} holds ${show(onPage)} in the MOTION block, not a number`);
            else if (!same(onPage, value)) p(`${where}.value`, `${value}, but the MOTION block holds ${onPage}`);
          }
          if (!Object.hasOwn(KNOB_FIELDS, knob)) return void p(`${where}.knob`, `unknown knob "${knob}"`);
          // The dials.json entry with the same bar and knob. A `from` map holds the raw page value per path.
          const file = `kinds/${knob.split(".")[0]}/dials.json`;
          const list = dialsList(file);
          if (!list) return void p(where, `cannot read ${file}`);
          const entry = list.find((e) => e.bar === slug && e.knob === knob);
          if (!entry) return void p(where, `${file} has no ${knob} entry for ${slug}`);
          if (isObj(entry.from)) {
            const raw = entry.from[path];
            if (raw === undefined) p(`${where}.path`, `${path} is not in the from map of ${file}`);
            else if (typeof raw !== "number" || !same(raw, value)) p(`${where}.value`, `${value}, but ${file} holds ${show(raw)}`);
            return;
          }
          const entryPath = Array.isArray(entry.path) && entry.path.length === 1 ? entry.path[0] : entry.path;
          if (entryPath !== path) p(`${where}.path`, `${path}, but ${file} holds ${Array.isArray(entryPath) ? entryPath.join(", ") : String(entryPath)}`);
          if (typeof entry.value !== "number" || !same(entry.value, value)) p(`${where}.value`, `${value}, but ${file} holds ${show(entry.value)}`);
        };
        bar.dials.forEach((d: unknown, i) => checkDial(d, `dials[${i}]`));
      }
    }

    if (bar.assetContract !== undefined) {
      if (!isObj(bar.assetContract)) p("assetContract", "must be an object keyed by asset slot");
      else for (const [slot, s] of Object.entries(bar.assetContract)) {
        const where = `assetContract.${slot}`;
        if (!isObj(s)) {
          p(where, "must be an object");
          continue;
        }
        for (const k of Object.keys(s)) if (!SLOT_KEYS.includes(k)) p(`${where}.${k}`, "unknown key");
        for (const k of ["draw", "aspect", "view", "facing"]) if (!isText(s[k])) p(`${where}.${k}`, "must be a non-empty string");
        if (s.background !== "cutout" && s.background !== "full-bleed") p(`${where}.background`, 'must be "cutout" or "full-bleed"');
      }
    }

    text("clock");

    let traceNames: string[] | undefined;
    if (bar.trace !== undefined) {
      if (!Array.isArray(bar.trace)) p("trace", "must be a list of 2 to 5 channels");
      else {
        if (bar.trace.length < 2 || bar.trace.length > 5) p("trace", `needs 2 to 5 entries, got ${bar.trace.length}`);
        bar.trace.forEach((t: unknown, i) => {
          if (!isObj(t) || !isText(t.name)) p(`trace[${i}].name`, "must be a non-empty string");
          if (!isObj(t) || typeof t.tolerance !== "number" || !(t.tolerance > 0)) p(`trace[${i}].tolerance`, "must be a number above 0");
        });
        if (bar.trace.length > 0) traceNames = bar.trace.map((t: unknown) => (isObj(t) ? String(t.name) : ""));
      }
    }

    if (bar.faults !== undefined) {
      if (!Array.isArray(bar.faults) || bar.faults.length === 0) p("faults", "must be a non-empty list");
      else bar.faults.forEach((f: unknown, i) => {
        const where = `faults[${i}]`;
        if (!isObj(f)) return void p(where, "must be an object");
        for (const k of ["name", "find"]) if (!isText(f[k])) p(`${where}.${k}`, "must be a non-empty string");
        if (typeof f.replace !== "string") p(`${where}.replace`, "must be a string");
        else if (f.replace === f.find) p(`${where}.replace`, "must differ from find");
        if (isText(f.find) && files.html !== undefined) {
          // The fault must change one known place, so `find` occurs exactly once.
          const n = files.html.split(f.find).length - 1;
          if (n === 0) p(`${where}.find`, "not found in index.html");
          else if (n > 1) p(`${where}.find`, `found ${n} times in index.html, needs exactly once`);
        }
      });
    }

    if (bar.superseded !== undefined) text("superseded");
    if (bar.cover !== undefined && (!Array.isArray(bar.cover) || !bar.cover.every(isText))) p("cover", "must be a list of selectors");

    // trace.json channels must equal the bar.json trace names, in order. A channel's own tolerance must
    // equal the bar.json one, and a channel unit with a floor sets the lowest allowed tolerance.
    if (traceNames && traceValue !== undefined) {
      const channels = isObj(traceValue) && Array.isArray(traceValue.channels) ? traceValue.channels : undefined;
      if (!channels) problems.push("trace.json channels: must be a list");
      else {
        const names = channels.map((c: unknown) => (isObj(c) ? String(c.name) : ""));
        if (names.join("\n") !== traceNames.join("\n")) p("trace", `names ${traceNames.join(", ")}, but trace.json channels are ${names.join(", ")}`);
        const trace = bar.trace as unknown[];
        channels.forEach((c: unknown, ci) => {
          if (!isObj(c)) return;
          const ti = traceNames.indexOf(String(c.name));
          const t = ti < 0 ? undefined : trace[ti];
          const tol = isObj(t) && typeof t.tolerance === "number" && t.tolerance > 0 ? t.tolerance : undefined;
          if (tol === undefined) return;
          if (c.tolerance !== undefined && (typeof c.tolerance !== "number" || !same(c.tolerance, tol))) {
            problems.push(`trace.json channels[${ci}].tolerance: ${show(c.tolerance)}, but bar.json trace holds ${tol}`);
          }
          const floor = typeof c.unit === "string" && Object.hasOwn(TOLERANCE_FLOORS, c.unit) ? TOLERANCE_FLOORS[c.unit] : undefined;
          if (floor !== undefined && tol < floor) p(`trace[${ti}].tolerance`, `${tol} is below the ${c.unit} floor ${floor}`);
        });
      }
    }
  }

  // The bar gate's own trace check: a trace it cannot play, or a tolerance it refuses, is a contract problem here too.
  if (traceValue !== undefined) {
    const checked = checkTrace(traceValue);
    problems.push(...checked.shape, ...checked.tolerance);
  }

  if (files.bar !== undefined) problems.push(...absolutePathProblems("bar.json", files.bar));
  if (files.notes !== undefined) problems.push(...absolutePathProblems("notes.md", files.notes));
  return problems;
}
