// Live harness: the page defines MOTION, UNITS, init(reduced), step(S, h, p, reduced) and vals(S). p is the hand { down, x, y }.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const els = {};
Object.keys(UNITS).forEach((n, k) => {
  const d = document.createElement("div");
  d.className = "b";
  d.style.left = `${560 + 60 * k}px`;
  d.style.top = "320px";
  document.body.appendChild(d);
  els[n] = d;
});
const hand = { down: false, x: 0, y: 0 };
function pointerAt(ms) {
  if (!seekMode) return hand;
  const s = window.__input || [];
  let p = null;
  for (const q of s) if (q[0] <= ms + 1e-6) p = q;
  if (!p) return { down: false, x: 0, y: 0 };
  return { down: p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6, x: p[1], y: p[2] };
}
let S;
const reset = () => { S = init(reduced); S.t = 0; };
function adv(h) { const end = S.t + h; step(S, h, pointerAt(end * 1000), reduced); S.t = end; }
function draw() {
  const v = vals(S);
  for (const n of Object.keys(els)) {
    const u = UNITS[n];
    if (u === "opacity") els[n].style.opacity = String(v[n]);
    else if (u === "px") els[n].style.transform = `translateX(${v[n]}px)`;
    else if (u === "deg") els[n].style.transform = `rotate(${v[n]}deg)`;
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
  addEventListener("pointerdown", (e) => { hand.down = true; hand.x = e.clientX; hand.y = e.clientY; wake(); });
  addEventListener("pointermove", (e) => { hand.x = e.clientX; hand.y = e.clientY; if (hand.down) wake(); });
  addEventListener("pointerup", () => { hand.down = false; wake(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = null; } else wake(); });
  wake();
}
