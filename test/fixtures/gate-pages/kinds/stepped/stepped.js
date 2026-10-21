// An idle page drawn pose to pose, as cel, stop-motion or a sprite is. The page's MOTION block lists each drawing
// as [ms, value] in `drawings`: the value y holds from that time until the next drawing starts. With `periodMs` set,
// the drawings repeat every periodMs. `unit` names y's unit. A drawing whose value is null reports y as NaN, and one
// whose value is "missing" leaves y out of the state. `sizePx` is the dot's size (40 unless set). `unit` also says
// what y does to the dot: px translates it, scale scales it, deg rotates it, opacity fades it, and index changes
// nothing visible. A dot that rotates is square, so the turn shows and its box is the box of what is drawn. State is a
// pure function of the page clock T, so ?seek only sets T. The live loop pauses while the page is hidden. It reports
// the dot as an object that y moves; `record` "none" leaves the objects out, and "malformed" names y in a string, not a
// list (fault pages). "decoy" lists y under a small still box where nothing is drawn, and the dot under no value;
// "index" reports y's unit as index while y still moves the dot as its own unit says. `halo`, when set, is reported
// in the dot's record as it is. `x`, when set, is a second value's drawings ([ms, px] each, on the same period): it
// moves the dot along x, and the record lists it beside y.
const DRAWINGS = MOTION.drawings;
const XS = MOTION.x || null;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const dot = document.getElementById("dot");
const unit = MOTION.unit || "px";
dot.style.width = dot.style.height = `${MOTION.sizePx || 40}px`;
if (unit === "deg") dot.style.borderRadius = "0";
function at(ds, ms) {
  const t = MOTION.periodMs ? ms % MOTION.periodMs : ms;
  let y = ds[0][1];
  for (const d of ds) if (d[0] <= t + 1e-6) y = d[1];
  return y;
}
// Under reduced motion the still frame is the drawing farthest from the first one with a number.
function still(ds) {
  const shown = ds.filter((d) => typeof d[1] === "number");
  let y = shown[0][1];
  for (const d of shown) if (Math.abs(d[1] - shown[0][1]) > Math.abs(y - shown[0][1])) y = d[1];
  return y;
}
let T = 0;
const valuesAt = () => {
  const y = reduced ? still(DRAWINGS) : at(DRAWINGS, T * 1000);
  const out = y === "missing" ? {} : { y: y === null ? NaN : y };
  if (XS) out.x = reduced ? still(XS) : at(XS, T * 1000);
  return out;
};
// A y that is not a number leaves the dot where it was.
function draw() {
  const v = valuesAt();
  const y = v.y;
  if (!Number.isFinite(y)) return;
  const tx = XS ? `translateX(${v.x}px) ` : "";
  if (unit === "px") dot.style.transform = `${tx}translateY(${y}px)`;
  else if (unit === "scale") dot.style.transform = `${tx}scale(${y})`;
  else if (unit === "deg") dot.style.transform = `${tx}rotate(${y}deg)`;
  else if (unit === "opacity") dot.style.opacity = String(y);
  if (XS && (unit === "opacity" || unit === "index")) dot.style.transform = tx.trim();
}
window.__seek = (ms) => { T = ms / 1000; draw(); };
// The dot's box is read from the DOM after draw(), so it is the box of the frame just drawn.
// A dot that is scaled to nothing or faded out is not drawn, and reports a box of 1 by 1.
const boxOf = () => {
  const r = dot.getBoundingClientRect();
  return Number(dot.style.opacity || 1) <= 0 || r.width <= 0 ? [r.x, r.y, 1, 1] : [r.x, r.y, r.width, r.height];
};
const objects = () => {
  if (MOTION.record === "none") return {};
  if (MOTION.record === "decoy") return { objects: { dot: { box: boxOf(), moves: [] }, decoy: { box: [100, 100, 20, 20], moves: ["y"] } } };
  return { objects: { dot: { box: boxOf(), moves: MOTION.record === "malformed" ? "y" : XS ? ["y", "x"] : ["y"], ...("halo" in MOTION ? { halo: MOTION.halo } : {}) } } };
};
window.__state = () => ({ values: valuesAt(), events: {}, units: { y: MOTION.record === "index" ? "index" : unit, ...(XS ? { x: "px" } : {}) }, ...objects() });
draw();
if (!seekMode && !reduced) {
  let last = null, raf = 0;
  const frame = (now) => {
    const h = last === null ? 0 : Math.min((now - last) / 1000, MOTION.maxStepS);
    last = now;
    T += h;
    draw();
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else start();
  });
  start();
}
