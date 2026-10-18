var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { MOVES, flatTx, staggerOf, tx } from "../src/core/index.js";
import { adopt, config, createLabState, edit, overrides } from "../src/lab-server/state.js";
import { CANDIDATES } from "./candidates.js";
import { mountEditor } from "./editor.js";
import { mountEngines } from "./engines.js";
import { genericMoments } from "./moments/generic.js";
const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
    const el = $("status");
    el.textContent = text;
    el.classList.toggle("error", error);
};
const project = (await (await fetch("/api/project")).json());
/** The source of truth: motion.json's overrides plus the person's edits. cfg is always config(state). */
let state;
let cfg;
try {
    state = createLabState(project.overrides, project.motionPath);
    cfg = config(state);
}
catch (e) {
    status(e.message, true);
    throw e;
}
const moments = new Map(genericMoments.map((m) => [m.move, m]));
if (project.momentsUrl) {
    try {
        const mod = (await import(__rewriteRelativeImportExtension(/* @vite-ignore */ project.momentsUrl)));
        const rejected = [];
        for (const m of mod.moments ?? []) {
            if (MOVES.includes(m?.move) && typeof m.mount === "function")
                moments.set(m.move, m);
            else
                rejected.push(JSON.stringify(m?.move ?? m?.label ?? "an entry"));
        }
        if (rejected.length)
            status(`Ignored ${rejected.length} bad entr${rejected.length === 1 ? "y" : "ies"} in ${project.momentsUrl} (needs a move name and a mount function): ${rejected.join(", ")}`, true);
    }
    catch (e) {
        status(`Could not load ${project.momentsUrl}: ${e.message}`, true);
    }
}
let move = "tap";
let selected = Object.keys(cfg.feels)[0];
let dirty = false;
const players = new Map();
$("project").textContent = project.name;
const allFeels = () => [
    ...Object.entries(cfg.feels).map(([n, f]) => [n, f, true]),
    ...Object.entries(CANDIDATES)
        .filter(([n]) => !Object.hasOwn(cfg.feels, n))
        .map(([n, f]) => [n, f, false]),
];
/** The config with the Lab-only candidates added, so tx() can find them. `use` is dropped so a feel name is never read as a surface. */
function labCfg() {
    const { use: _use, ...rest } = cfg;
    return { ...rest, feels: { ...CANDIDATES, ...cfg.feels } };
}
/** Copies `src` into `dst` field by field, so objects the editor and lanes hold stay the live ones. */
function syncInto(dst, src) {
    dst.reducedFade = src.reducedFade;
    for (const [name, f] of Object.entries(src.feels)) {
        const d = Object.hasOwn(dst.feels, name) ? dst.feels[name] : (dst.feels[name] = structuredClone(f));
        d.describe = f.describe;
        d.stagger = f.stagger;
        for (const mv of MOVES) {
            for (const k of ["visualDuration", "bounce", "reduced"])
                d.moves[mv][k] = f.moves[mv][k];
            const amount = f.moves[mv].amount;
            if (amount === undefined)
                delete d.moves[mv].amount;
            else
                d.moves[mv].amount = amount;
        }
    }
}
/** Copies config(state) into cfg in place, so a feel that extends an edited feel follows it at once. */
function refresh() {
    syncInto(cfg, config(state));
}
function ctxFor(name, _feel, byTouch) {
    const c = labCfg();
    const spec = tx(c, name, move, { byTouch });
    const reducedOn = $("reduced").checked;
    const candidateFade = Object.hasOwn(CANDIDATES, name) && !Object.hasOwn(cfg.feels, name);
    return {
        spring: { visualDuration: spec.visualDuration, bounce: spec.bounce },
        flat: flatTx(c, name, move),
        amount: spec.amount ?? 1,
        stagger: staggerOf(c, name),
        reduced: reducedOn ? spec.reduced : false,
        reducedFade: candidateFade && !reducedOn ? spec.visualDuration : cfg.reducedFade,
        fadeTravel: candidateFade && !reducedOn,
    };
}
function renderMoments() {
    const nav = $("moments");
    nav.replaceChildren(...MOVES.map((m) => {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: moments.get(m)?.label ?? m });
        b.setAttribute("aria-pressed", String(m === move));
        b.addEventListener("click", () => {
            move = m;
            render();
        });
        return b;
    }));
}
function renderLanes() {
    players.clear();
    $("lanes").replaceChildren(...allFeels().map(([name, feel, editable]) => {
        const lane = document.createElement("div");
        lane.className = "lane";
        lane.dataset.selected = String(name === selected);
        const label = document.createElement("div");
        label.className = "name";
        label.dataset.uiAlignItem = "";
        label.textContent = name;
        label.append(Object.assign(document.createElement("small"), { textContent: editable ? feel.describe : "preview only — not yet a saved feel" }));
        const stage = document.createElement("div");
        stage.className = "stage";
        const player = moments.get(move).mount(stage);
        players.set(name, player);
        stage.addEventListener("pointerdown", () => {
            if (selected !== name) {
                selected = name;
                lane.parentElement?.querySelectorAll(".lane").forEach((l) => (l.dataset.selected = String(l === lane)));
                renderEditor();
            }
            player.play(ctxFor(name, feel, true));
            if (move === "move")
                engines.play(true);
        });
        lane.append(label, stage);
        return lane;
    }));
}
function renderEditor() {
    const entry = allFeels().find(([n]) => n === selected);
    mountEditor($("editor"), { feelName: entry[0], feel: entry[1], move, editable: entry[2], motionPath: project.motionPath }, (path, value) => {
        try {
            edit(state, entry[0], path, value);
        }
        catch (e) {
            // The edit was refused and nothing changed; the editor redraws the old value.
            status(e.message, true);
            return;
        }
        refresh();
        dirty = true;
        status("Unsaved changes.");
    }, (text) => {
        void navigator.clipboard.writeText(text).then(() => status(`Copied: ${text}`));
    });
}
function render() {
    renderMoments();
    renderLanes();
    renderEditor();
}
$("server").addEventListener("click", () => {
    for (const [name, feel] of allFeels())
        players.get(name)?.play(ctxFor(name, feel, false));
    engines.play(false);
});
$("save").addEventListener("click", async () => {
    const sent = overrides(state);
    const res = await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides: sent }) });
    const out = (await res.json());
    if (!out.ok)
        return status(out.problems?.join(" · ") ?? "Save failed.", true);
    // An edit made while the request was out is newer than what was saved: keep it, and stay unsaved.
    if (JSON.stringify(overrides(state)) !== JSON.stringify(sent))
        return status(`Saved ${out.path}. Newer edits are not saved yet.`);
    if (out.overrides) {
        adopt(state, out.overrides);
        refresh();
    }
    dirty = false;
    status(`Saved ${out.path}. Commit it when you are happy.`);
});
addEventListener("beforeunload", (e) => {
    if (dirty)
        e.preventDefault();
});
const engines = mountEngines($("engines"), {
    cfg,
    feel: () => selected,
    reduced: () => $("reduced").checked,
});
render();
