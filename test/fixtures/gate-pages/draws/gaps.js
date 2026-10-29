// Bubbles that fade in one after another, each after a random gap (MOTION.gapMinS to MOTION.gapMaxS). Live, a timer starts each
// fade and the frame loop sleeps between them; under ?seek each fade starts at its drawn time.
const bubbles = () => document.querySelectorAll(".c");
window.SCENE = {
  init(S) { S.at = null; S.when = null; S.start = new Array(MOTION.bubbles).fill(null); S.b = new Array(MOTION.bubbles).fill(0); },
  begin(S, t) {
    reseed();
    S.at = t;
    let w = 0;
    S.when = S.b.map(() => (reduced ? 0 : (w += MOTION.gapMinS + rand() * (MOTION.gapMaxS - MOTION.gapMinS))));
    if (live && !reduced) S.when.forEach((w, i) => setTimeout(() => { S.start[i] = S.t; window.__wake(); }, w * 1000)); // motion-kit:clock
  },
  step(S, h, end) {
    if (S.at === null) return;
    if (!live || reduced) S.when.forEach((w, i) => { if (S.start[i] === null && end >= S.at + w - 1e-9) S.start[i] = S.at + w; });
    S.b = S.start.map((s) => (s === null ? 0 : prog(end - s, MOTION.fadeS)));
  },
  busy(S) { return S.start.some((s) => s !== null && S.t - s < MOTION.fadeS); },
  values(S) { return Object.fromEntries(S.b.map((v, i) => ["b" + i, v])); },
  units: Object.fromEntries(Array.from({ length: MOTION.bubbles }, (_, i) => ["b" + i, "opacity"])),
  draw(S) { bubbles().forEach((e, i) => { e.style.opacity = String(S.b[i]); }); },
};
