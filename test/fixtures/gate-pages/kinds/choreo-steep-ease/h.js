// Generic harness. window.MODE: "choreo" (values start at the first press) or "idle" (values run from load).
// window.TRACKS = [{ name, unit, prop, f: (d seconds) => value }], window.DUR_S: the sequence length (choreo).
const MODE = window.MODE || "choreo";
const TRACKS = window.TRACKS;
const DUR_S = window.DUR_S || 1;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = TRACKS.map((tr, i) => {
  let el = document.getElementById(tr.name);
  if (!el) { el = document.createElement("div"); el.id = tr.name; el.className = "box"; el.style.top = (160 + i * 70) + "px"; document.body.appendChild(el); }
  return el;
});
let T = 0, start = null;
function firstPress(ms) {
  const s = window.__input || [];
  for (const q of s) if (q[3] === 1 && q[0] <= ms + 1e-6) return q[0] / 1000;
  return null;
}
function vals() {
  return Object.fromEntries(TRACKS.map((tr) => {
    let d;
    if (MODE === "idle") d = reduced ? 0 : T;
    else d = start === null ? 0 : reduced ? DUR_S : T - start;
    return [tr.name, tr.f(Math.max(0, d))];
  }));
}
function draw() {
  const v = vals();
  TRACKS.forEach((tr, i) => {
    const x = v[tr.name], p = tr.prop || "translateX", el = els[i];
    if (tr.unit === "opacity") el.style.opacity = String(x);
    else el.style.transform = p === "scale" ? `scale(${x})` : p === "rotate" ? `rotate(${x}deg)` : `${p}(${x}px)`;
  });
}
window.__seek = (ms) => { T = ms / 1000; if (MODE !== "idle") start = firstPress(ms); draw(); };
window.__state = () => ({ values: vals(), events: {}, units: Object.fromEntries(TRACKS.map((tr) => [tr.name, tr.unit || "px"])) });
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now; T += h; draw();
    if (MODE === "idle" || (start !== null && T - start < DUR_S)) raf = requestAnimationFrame(frame);
    else { raf = 0; last = null; }
  };
  const wake = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
  addEventListener("pointerdown", () => { if (start === null || T - start >= DUR_S) start = T; wake(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (MODE === "idle") wake(); });
  if (MODE === "idle") wake();
}
