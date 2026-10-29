// A deck of MOTION.tiles tiles that a tap cuts by a random 1 to tiles-1 slots: every tile eases to its new slot, one after the other.
const tiles = () => document.querySelectorAll(".c");
const eo = (p) => 1 - (1 - p) ** 3;
window.SCENE = {
  init(S) { S.y = Array.from({ length: MOTION.tiles }, (_, i) => i * MOTION.slotPx); S.from = S.y.slice(); S.to = S.y.slice(); S.at = null; },
  begin(S, t) {
    reseed();
    const k = 1 + Math.floor(rand() * (MOTION.tiles - 1));
    S.from = S.y.slice();
    S.to = S.y.map((_, i) => ((i + k) % MOTION.tiles) * MOTION.slotPx);
    S.at = t;
  },
  step(S, h, end) { if (S.at === null) return; S.y = S.to.map((to, i) => S.from[i] + (to - S.from[i]) * eo(prog(end - S.at - (reduced ? 0 : i * MOTION.staggerS), MOTION.moveS))); },
  busy(S) { return S.at !== null && !reduced && S.t - S.at < MOTION.moveS + (MOTION.tiles - 1) * MOTION.staggerS; },
  values(S) { return Object.fromEntries(S.y.map((v, i) => ["y" + i, v])); },
  units: Object.fromEntries(Array.from({ length: MOTION.tiles }, (_, i) => ["y" + i, "px"])),
  draw(S) { tiles().forEach((e, i) => { e.style.transform = `translateY(${S.y[i]}px)`; }); },
};
