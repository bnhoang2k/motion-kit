// A badge that pops after a random delay (MOTION.delayMinS to MOTION.delayMaxS): it springs from 0 past 1 and settles at 1.
const badge = () => document.querySelector(".c");
function pop(u) { const w = 2 * Math.PI * MOTION.popHz, z = MOTION.popZeta, wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + ((z * w) / wd) * Math.sin(wd * u)); }
window.SCENE = {
  init(S) { S.at = null; S.delay = 0; S.s = 0; S.done = false; },
  begin(S, t) { reseed(); S.at = t; S.delay = MOTION.delayMinS + rand() * (MOTION.delayMaxS - MOTION.delayMinS); },
  step(S, h, end) {
    if (S.at === null || S.done) return;
    const u = end - S.at - S.delay;
    if (reduced) { S.s = 1; S.done = true; return; }
    if (u < 0) return;
    if (Math.exp(-MOTION.popZeta * 2 * Math.PI * MOTION.popHz * u) < 0.002) { S.s = 1; S.done = true; return; }
    S.s = pop(u);
  },
  busy(S) { return S.at !== null && !S.done; },
  values(S) { return { s: S.s }; },
  units: { s: "scale" },
  draw(S) { badge().style.transform = `scale(${S.s})`; },
};
