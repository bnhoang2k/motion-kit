// Scroll harness: the page defines MOTION, UNITS, init(reduced), step(S, h, y, reduced), vals(S), busy(S). y is the scroll position.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = {};
Object.keys(UNITS).forEach((n, k) => {
  const d = document.createElement("div");
  d.className = "b";
  d.style.left = `${100 + 120 * k}px`;
  d.style.top = "300px";
  document.body.appendChild(d);
  els[n] = d;
});
function scrollAt(ms) {
  if (!seekMode) return window.scrollY;
  let y = 0;
  for (const [t, v] of window.__input || []) if (t <= ms + 1e-6) y = v;
  return y;
}
let S;
const reset = () => { S = init(reduced); S.t = 0; };
function adv(h) { const end = S.t + h; step(S, h, scrollAt(end * 1000), reduced); S.t = end; }
function draw() {
  const v = vals(S);
  for (const n of Object.keys(els)) {
    const u = UNITS[n];
    if (u === "opacity") els[n].style.opacity = String(v[n]);
    else if (u === "px") els[n].style.transform = `translateY(${v[n]}px)`;
    else els[n].style.transform = `scale(${v[n]})`;
  }
}
window.__seek = (ms) => {
  reset();
  const n = Math.floor((ms * 60) / 1000 + 1e-6);
  for (let i = 0; i < n; i++) adv(1 / 60);
  const rest = ms / 1000 - n / 60;
  if (rest > 1e-9) adv(rest);
  draw();
};
window.__state = () => ({ values: vals(S), events: {}, units: UNITS });
reset();
draw();
if (!seekMode) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now;
    adv(h);
    draw();
    raf = !document.hidden && busy(S) ? requestAnimationFrame(frame) : 0;
    if (!raf) last = null;
  };
  const wake = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
  addEventListener("scroll", wake);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = null; } else wake(); });
  wake();
}
