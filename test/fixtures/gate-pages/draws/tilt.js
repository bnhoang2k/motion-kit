// A card tossed onto a pile: it springs MOTION.outPx out (an underdamped spring, so it overshoots) and settles at a random tilt
// in plus or minus MOTION.tiltDeg, whose spring overshoots as well.
const card = () => document.querySelector(".c");
const hz = () => 2 * Math.PI * MOTION.cardHz;
function sp(u, target) { const w = hz(), z = MOTION.cardZeta, wd = w * Math.sqrt(1 - z * z); return target * (1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + ((z * w) / wd) * Math.sin(wd * u))); }
function left(u, target) { return (Math.abs(target) * Math.exp(-MOTION.cardZeta * hz() * u)) / Math.sqrt(1 - MOTION.cardZeta ** 2); }
window.SCENE = {
  init(S) { S.at = null; S.cx = 0; S.cr = 0; S.tilt = 0; S.done = false; },
  begin(S, t) { reseed(); S.at = t; S.tilt = (rand() * 2 - 1) * MOTION.tiltDeg; },
  step(S, h, end) {
    if (S.at === null || S.done) return;
    const u = end - S.at;
    if (reduced || Math.max(left(u, MOTION.outPx), left(u, S.tilt)) < MOTION.cardRest) { S.cx = MOTION.outPx; S.cr = S.tilt; S.done = true; return; }
    S.cx = sp(u, MOTION.outPx); S.cr = sp(u, S.tilt);
  },
  busy(S) { return S.at !== null && !S.done; },
  values(S) { return { cx: S.cx, cr: S.cr }; },
  units: { cx: "px", cr: "deg" },
  draw(S) { card().style.transform = `translateX(${S.cx}px) rotate(${S.cr}deg)`; },
};
