// Chips that fly out to random distances (MOTION.minPx to MOTION.maxPx) on a cubic ease-out when the cause starts the burst, and stay.
const chips = () => document.querySelectorAll(".c");
window.SCENE = {
  init(S) { S.d = null; S.at = null; S.c = new Array(MOTION.chips).fill(0); },
  begin(S, t) { reseed(); S.d = S.c.map(() => MOTION.minPx + rand() * (MOTION.maxPx - MOTION.minPx)); S.at = t; },
  step(S, h, end) { if (!S.d) return; const u = prog(end - S.at, MOTION.flyS); S.c = S.d.map((d) => d * (1 - (1 - u) ** 3)); },
  busy(S) { return S.at !== null && S.t - S.at < MOTION.flyS; },
  values(S) { return Object.fromEntries(S.c.map((v, i) => ["c" + i, v])); },
  units: Object.fromEntries(Array.from({ length: MOTION.chips }, (_, i) => ["c" + i, "px"])),
  draw(S) { chips().forEach((e, i) => { e.style.transform = `translateX(${S.c[i]}px)`; }); },
};
