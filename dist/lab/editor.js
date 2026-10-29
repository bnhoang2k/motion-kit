import { LIMITS } from "../src/core/validate.js";
import { peakOvershoot } from "../src/core/spring.js";
/** Sliders for one feel and move. After every edit it redraws from `s.feel`, so a control never shows a value the config does not hold. */
export function mountEditor(root, s, onEdit, onCopy) {
    const m = s.feel.moves[s.move];
    root.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = `${s.feelName} · ${s.move}`;
    root.append(h);
    const redraws = [];
    const redraw = () => {
        for (const r of redraws)
            r();
    };
    const slider = (label, get, [lo, hi], path, fmt, step = 0.01) => {
        const row = document.createElement("label");
        row.className = "field";
        const out = document.createElement("span");
        out.className = "num";
        const input = document.createElement("input");
        Object.assign(input, { type: "range", min: String(lo), max: String(hi), step: String(step), disabled: !s.editable });
        input.addEventListener("input", () => {
            onEdit(path, Number(input.value));
            redraw();
        });
        redraws.push(() => {
            input.value = String(get());
            out.textContent = fmt(get());
        });
        row.append(Object.assign(document.createElement("span"), { textContent: label }), input, out);
        root.append(row);
    };
    const mp = (k) => ["moves", s.move, k];
    slider("Duration", () => m.visualDuration, LIMITS.visualDuration, mp("visualDuration"), (v) => `${v.toFixed(2)} s`);
    slider("Bounce", () => m.bounce, LIMITS.bounce, mp("bounce"), (v) => v.toFixed(2));
    if (m.amount !== undefined)
        slider("Amount", () => m.amount, LIMITS.amount, mp("amount"), (v) => v.toFixed(2));
    slider("Stagger", () => s.feel.stagger, LIMITS.stagger, ["stagger"], (v) => `${Math.round(v * 1000)} ms`, 0.005);
    const over = document.createElement("div");
    over.className = "field";
    const overshoot = Object.assign(document.createElement("span"), { className: "num" });
    redraws.push(() => (overshoot.textContent = `${(peakOvershoot(m.visualDuration, m.bounce) * 100).toFixed(1)} %`));
    over.append(Object.assign(document.createElement("span"), { textContent: "Overshoot" }), document.createElement("span"), overshoot);
    root.append(over);
    const reduced = document.createElement("div");
    reduced.className = "seg";
    reduced.style.padding = "0";
    for (const r of ["instant", "fade"]) {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: r === "instant" ? "Jump" : "Fade", disabled: !s.editable });
        b.addEventListener("click", () => {
            onEdit(mp("reduced"), r);
            redraw();
        });
        redraws.push(() => b.setAttribute("aria-pressed", String(m.reduced === r)));
        reduced.append(b);
    }
    root.append(Object.assign(document.createElement("div"), { className: "meta", textContent: "Reduced motion" }), reduced);
    redraw();
    if (s.editable) {
        // A reference to this feel in its motion.json, for pasting into a note or a prompt.
        const copy = Object.assign(document.createElement("button"), { type: "button", textContent: "Copy reference" });
        copy.style.marginTop = "12px";
        copy.addEventListener("click", () => onCopy(`${s.motionPath}#${s.feelName}`));
        root.append(copy);
    }
}
