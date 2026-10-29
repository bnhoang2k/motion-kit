// An idle page for the drawn check: a dot loops on its own clock, lifting 120 px and settling back, and the page
// reports it as an object that y moves. Its state is a pure function of the page clock T, so ?seek only sets T. The
// live loop pauses while the page is hidden. The page's own CSS says how the dot is drawn (a card with a shadow, a
// glow, a blur, a line of text), and window.HALO, when set, is the halo its record reports. window.VARIANT picks what
// else the page draws:
// - "" (honest): the dot as the CSS draws it.
// - "lies": reports a smooth y and the box that goes with it, but draws the dot at the rest or at the top, a teleport
//   halfway through each move.
// - "ghost": reports the same smooth y and box, but draws the dot still at its rest.
// - "ambient": the honest dot over a background whose gradient sways, a value g, reported as an object of its own that
//   covers the viewport.
// - "ambient-hides": the honest dot over a background reported the same way, whose gradient drifts too little to see,
//   and a square that no object covers, which jumps 200 px back and forth every frame.
// - "ambient-diagonal": the same, with the square jumping 1000 px right and 500 px down and back, across most of the
//   viewport.
// - "badge": the dot, and a still icon (an object with moves: []) with a badge on its corner, half outside it. The
//   badge pops in (its scale s from 0 to 1) and out again each loop, and is gone (1 by 1) while it is not drawn.
// - "cursor": the dot is a card, and a drawn cursor (an object with moves: []) slides back and forth inside it.
// - "fade": the dot fades to 2% opacity (o), lifts and settles back while faint, then fades in again.
// - "vanish": the dot fades out (o) on a curve whose last drawn frame is all but invisible, is gone (1 by 1) for 30
//   frames in the middle of each loop, and fades in again on the same curve.
// - "vanish-unread": the same, with the box not finite numbers (NaN by NaN) in the third frame of each gone gap: a
//   frame the objects rule reports, which the drawn check cannot read.
// - "slow": the dot lifts and settles in a sine of 1.6 s, never more than 1.3 px a frame (the CSS draws it faint).
// - "confetti": the dot, and a field (an object with moves: []) of specks that move every frame.
// - "arm": the dot, and a body with an arm that swings up 60° and back (a, in deg). The body's box holds the body and
//   the arm where it is, so the arm changes only part of it.
// - "sweep": the dot, and a soft band of light (an object of its own, moved by bx) that sweeps across a dark panel and
//   back.
// - "aurora", "twinkle", "particles", "stripes": the dot over a sky that covers the viewport, reported as one object:
//   an aurora that shimmers everywhere (moves: []), lights that twinkle (moves: []), eight particles that drift across
//   it and wrap (moves: []), or sinusoidal stripes that sway (sp) and slow at each turn.
// - "cut": the dot, and a slab (sx) that slides out and back each loop. At 1 s the scene changes: the background turns
//   dark. A bar page lists that cut.
// - "cut-early": the "cut" page, but the background turns dark from 1 s on, so the frame at the cut already shows the
//   new scene and the frame after it changes little.
// Faults:
// - "slow-ghost": reports the slow sine (1.3 px a frame at most), but draws the dot still at its rest.
// - "box-off": draws and reports the honest dot, but for one frame of each loop, while the dot rests, its box is
//   reported 30 px lower than it is drawn.
// - "gone-lie": the same, with the box reported gone (1 by 1) for that frame while the dot is still drawn, from the
//   second loop on: the record moves less than 30 frames before the lie (the settle) and after it (the next lift).
// - "gone-lie-2": the box reported gone for two frames in a row early in the rest after the settle, from the second loop
//   on, while the dot is still drawn.
// - "still-card": the dot, and a card whose value cardY never changes, with a square no object reports sliding inside
//   it.
// - "twinkle-lies": the lights, under the "lies" dot: a smooth y and box, drawn as a teleport.
// - "track": the dot's box is a 600 by 40 track and its value a ratio p that sways along it, but the dot slides over the
//   middle half of the track only, and teleports back each time.
// - "fat-jump": the honest dot, drawn 60 px ahead for one frame of each lift (its fastest step), with its box for that
//   frame grown 200 px on every side.
// - "cut-glitch": the "cut-weak" page, and at the cut a 24 px square no object reports appears beside it.
// - "cut-unowned": at 1 s only that square appears; the dot, the only object that could cover it, does not move.
// - "cut-none": a bar that lists a cut at 1 s where nothing changes, while a slab slides out and back each loop.
// "cut-weak" is not a fault: the dot's jump lies inside its own boxes, so the cut is a small cut within the objects.
const VARIANT = window.VARIANT || "";
const SLOW = VARIANT === "slow" || VARIANT === "slow-ghost";
const VANISH = VARIANT === "vanish" || VARIANT === "vanish-unread";
const CUT = VARIANT.startsWith("cut");
const MOTION = {
  periodS: 1.6,     // the loop
  riseAtS: 0.6,     // each cycle: the lift starts
  riseS: 0.2,
  liftPx: 120,
  backAtS: VARIANT === "fade" ? 1.0 : 1.4, // the lift settles back
  backS: 0.2,
  fadeOutAtS: 0.35, // "fade": the dot fades out
  fadeInAtS: 1.25,  // and in again
  fadeS: 0.2,
  vanishOutAtS: 0.35, // "vanish": the dot fades out, gone at the end of vanishS
  vanishInAtS: 1.05,  // and fades in from gone
  vanishS: 0.2,
  unreadFrame: 35,  // "vanish-unread": the frame of each loop (of 96) whose box is NaN, the third of its gone gap (33 to 63)
  faint: 0.02,      // to this opacity
  slowPx: 1.3,      // "slow": the most the dot moves in one frame
  popAtS: 0.3,      // "badge": the badge pops in
  unpopAtS: 1.2,    // and out
  popS: 0.2,
  armDeg: 60,       // "arm": how far the arm swings up
  lieFrame: 18,     // "box-off", "gone-lie": the frame of each loop (of 96) whose box lies, while the dot rests
  lie2Frames: [8, 9], // "gone-lie-2": the frames of each loop whose box lies
  offPx: 30,        // "box-off": how far
  specks: 24,       // "confetti"
  swayPx: VARIANT.startsWith("ambient-") ? 0.5 : 40, // the gradient sways this far either way, once a loop
  hop: VARIANT === "ambient-diagonal" ? [1000, 500] : [200, 0], // the square's jump, in px right and down
  sweepPx: 760,     // "sweep": how far the band travels across the panel
  sway: 120,        // "stripes": how far the stripes sway either way, once a loop
  stripePx: 96,     // and their period
  particles: 8,     // "particles"
  lights: 80,       // "twinkle"
  slidePx: 300,     // "track": the dot slides this far over the middle of the track...
  slideS: 0.8,      // ...in this long, then teleports back
  trackPx: 600,     // the track's width
  fatFrame: 42,     // "fat-jump": the frame of each loop (of 96) whose drawing jumps and whose box is grown
  aheadPx: 60,      // how far ahead it is drawn
  fatPx: 200,       // how far its box is grown
  cutS: 1.0,        // "cut", "cut-weak", "cut-early": the cut
  slabPx: 200,      // the slab slides this far...
  slabAtS: 0.2,     // ...from here...
  slabS: 0.25,      // ...in this long, and back
  jumpPx: 120,      // "cut-weak": the dot's jump at the cut
  maxStepS: 0.05,   // the live loop caps one time step
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const seekMode = new URLSearchParams(location.search).has("seek");
const $ = (id) => document.getElementById(id);
const [dot, bg, square, icon, badge, cursor, field, body, arm, card, mover, band, sky, slab, glitch] = ["dot", "bg", "square", "icon", "badge", "cursor", "field", "body", "arm", "card", "mover", "band", "sky", "slab", "glitch"].map($);
// A fixed sequence of numbers in [0, 1), so the sky is the same on every load.
const rand = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const eis = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
const frameOf = (T) => Math.round(T * 60);
// Out and back over one loop: 0, up to 1 halfway, and 0 again.
const swing = (T) => {
  const p = (T % MOTION.periodS) / MOTION.periodS;
  return eis(2 * p) - eis(2 * p - 1);
};
function valuesAt(T) {
  const ph = T % MOTION.periodS;
  const v = {};
  if (SLOW) {
    // A sine whose top speed is slowPx a frame: amplitude A over period P moves at most A·π/P per second.
    const A = (MOTION.slowPx * 60 * MOTION.periodS) / Math.PI;
    v.y = reduced ? 0 : (-A * (1 - Math.cos((2 * Math.PI * T) / MOTION.periodS))) / 2;
  } else v.y = reduced ? 0 : -MOTION.liftPx * (eis((ph - MOTION.riseAtS) / MOTION.riseS) - eis((ph - MOTION.backAtS) / MOTION.backS));
  if (bg) v.g = reduced ? 0 : MOTION.swayPx * Math.sin((2 * Math.PI * T) / MOTION.periodS);
  if (VANISH) v.o = reduced ? 1 : (1 - eis((ph - MOTION.vanishOutAtS) / MOTION.vanishS)) ** 3 + eis((ph - MOTION.vanishInAtS) / MOTION.vanishS) ** 3;
  if (VARIANT === "fade") v.o = reduced ? 1 : 1 - (1 - MOTION.faint) * (eis((ph - MOTION.fadeOutAtS) / MOTION.fadeS) - eis((ph - MOTION.fadeInAtS) / MOTION.fadeS));
  if (badge) v.s = reduced ? 1 : eis((ph - MOTION.popAtS) / MOTION.popS) - eis((ph - MOTION.unpopAtS) / MOTION.popS);
  if (arm) v.a = reduced ? 0 : -MOTION.armDeg * (eis((ph - MOTION.riseAtS) / MOTION.riseS) - eis((ph - MOTION.backAtS) / MOTION.backS));
  if (card) v.cardY = 0;
  if (band) v.bx = reduced ? 0 : MOTION.sweepPx * swing(T);
  if (VARIANT === "stripes") v.sp = reduced ? 0 : MOTION.sway * Math.sin((2 * Math.PI * T) / MOTION.periodS);
  if (VARIANT === "track") {
    v.y = 0;
    v.p = reduced ? 0.5 : 0.5 + 0.25 * Math.sin((2 * Math.PI * T) / MOTION.periodS);
  }
  if (slab) v.sx = reduced ? 0 : MOTION.slabPx * (eis((ph - MOTION.slabAtS) / MOTION.slabS) - eis((ph - MOTION.slabAtS - 2 * MOTION.slabS) / MOTION.slabS));
  if (VARIANT === "cut-weak" || VARIANT === "cut-glitch") v.x = reduced || T > MOTION.cutS + 0.001 ? MOTION.jumpPx : 0;
  return v;
}
const frac = (x) => x - Math.floor(x);
// "track": where the dot is drawn, right of its rest: over the middle half of the track, back to its start each slide.
const trackX = (T) => rest.width / 2 - MOTION.trackPx / 2 + (MOTION.trackPx - MOTION.slidePx) / 2 + MOTION.slidePx * frac(T / MOTION.slideS);
// The sky's own drawing, at T.
function drawSky(T) {
  if (VARIANT === "twinkle" || VARIANT === "twinkle-lies") {
    if (sky.children.length === 0) for (let i = 0; i < MOTION.lights; i++) {
      const el = document.createElement("i");
      el.style.left = `${Math.round(20 + rand(i) * (innerWidth - 40))}px`;
      el.style.top = `${Math.round(20 + rand(i + 500) * (innerHeight - 40))}px`;
      sky.appendChild(el);
    }
    [...sky.children].forEach((el, i) => { el.style.opacity = String(0.5 + 0.5 * Math.sin(2 * Math.PI * ((1 + 2 * rand(i + 900)) * T + rand(i + 1300)))); });
  } else if (VARIANT === "particles") {
    if (sky.children.length === 0) for (let i = 0; i < MOTION.particles; i++) sky.appendChild(document.createElement("i"));
    [...sky.children].forEach((el, i) => {
      const [vx, vy] = [(rand(i + 40) - 0.5) * 240, (rand(i + 80) - 0.5) * 160];
      const x = frac(rand(i + 120) + (vx * T) / innerWidth) * innerWidth, y = frac(rand(i + 160) + (vy * T) / innerHeight) * innerHeight;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
  } else if (VARIANT === "aurora" || VARIANT === "stripes") {
    const g = sky.getContext("2d");
    const [w, h] = [sky.width, sky.height];
    const img = g.createImageData(w, h);
    const sp = valuesAt(T).sp;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (VARIANT === "stripes") {
        const l = 128 + 100 * Math.sin((2 * Math.PI * ((x * innerWidth) / w - sp)) / MOTION.stripePx);
        img.data[o] = img.data[o + 1] = img.data[o + 2] = l;
      } else {
        // A shimmer that moves everywhere at once: phase that runs with time, bent by a slower wave down the sky.
        const [u, t] = [(x * innerWidth) / w, (y * innerHeight) / h];
        const i = 0.5 + 0.5 * Math.sin(u / 90 + 1.3 * Math.sin(t / 130 + T * 6.3) + T * 5.1);
        img.data[o] = 20 + 40 * i; img.data[o + 1] = 40 + 180 * i; img.data[o + 2] = 60 + 120 * i;
      }
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
}
// Where the dot is drawn: at y, except on the fault pages.
function drawnY(y) {
  if (VARIANT === "lies" || VARIANT === "twinkle-lies") return y < -MOTION.liftPx / 2 ? -MOTION.liftPx : 0;
  if (VARIANT === "fat-jump" && !reduced && frameOf(T) % Math.round(MOTION.periodS * 60) === MOTION.fatFrame) return y - MOTION.aheadPx;
  if (VARIANT === "ghost" || VARIANT === "slow-ghost") return 0;
  return y;
}
let T = 0;
function draw() {
  const v = valuesAt(T);
  dot.style.transform = `translate(${VARIANT === "track" ? trackX(T) : v.x || 0}px, ${drawnY(v.y)}px)`;
  if (v.o !== undefined) dot.style.opacity = String(v.o);
  if (bg) bg.style.backgroundPositionX = `${v.g}px`;
  const on = frameOf(T) % 2;
  if (square) square.style.transform = `translate(${on * MOTION.hop[0]}px, ${on * MOTION.hop[1]}px)`;
  if (badge) badge.style.transform = `scale(${v.s})`;
  if (cursor) cursor.style.transform = `translate(${100 * swing(T)}px, ${v.y}px)`;
  if (arm) arm.style.transform = `rotate(${v.a}deg)`;
  if (mover) mover.style.transform = `translateX(${200 * swing(T)}px)`;
  if (band) band.style.transform = `translateX(${v.bx}px)`;
  if (slab) slab.style.transform = `translateX(${v.sx}px)`;
  if (CUT) document.documentElement.classList.toggle("after", (VARIANT === "cut" && T > MOTION.cutS + 0.001) || (VARIANT === "cut-early" && T >= MOTION.cutS - 0.001));
  if (glitch) glitch.style.display = T > MOTION.cutS + 0.001 ? "block" : "none";
  if (sky) drawSky(T);
  if (field) {
    if (field.children.length === 0) for (let i = 0; i < MOTION.specks; i++) field.appendChild(document.createElement("i"));
    const [w, h] = [field.clientWidth - 8, field.clientHeight - 8];
    [...field.children].forEach((el, i) => {
      // Each speck circles on its own radius and speed, so the field changes every frame.
      const t = T * (1 + (i % 5) * 0.37) + i;
      el.style.transform = `translate(${(w / 2) * (1 + 0.9 * Math.cos(t * 2.1))}px, ${(h / 2) * (1 + 0.9 * Math.sin(t * 2.9))}px)`;
    });
  }
}
window.__seek = (ms) => { T = ms / 1000; draw(); };
// The dot's box is where y puts it: the dot's rest box, moved by y. Other boxes are read from the DOM after draw().
const rest = dot.getBoundingClientRect();
const rectOf = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
const hull = (a, b) => {
  const [x0, y0] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
};
const units = { y: "px", g: "px", o: "opacity", s: "scale", a: "deg", cardY: "px", bx: "px", sp: "px", p: "ratio", sx: "px", x: "px" };
window.__state = () => {
  const v = valuesAt(T);
  let dotBox = [rest.x + (v.x || 0), rest.y + v.y, rest.width, rest.height];
  const [f, loop] = [frameOf(T), Math.round(MOTION.periodS * 60)];
  const lie = !reduced && f % loop === MOTION.lieFrame;
  if (VARIANT === "box-off" && lie) dotBox = [dotBox[0], dotBox[1] + MOTION.offPx, dotBox[2], dotBox[3]];
  if (VARIANT === "gone-lie" && lie && f >= loop) dotBox = [dotBox[0], dotBox[1], 1, 1];
  if (VARIANT === "gone-lie-2" && !reduced && f >= loop && MOTION.lie2Frames.includes(f % loop)) dotBox = [dotBox[0], dotBox[1], 1, 1];
  if (VANISH && v.o === 0) dotBox = [dotBox[0], dotBox[1], 1, 1];
  if (VARIANT === "vanish-unread" && v.o === 0 && f % loop === MOTION.unreadFrame) dotBox = [dotBox[0], dotBox[1], Number.NaN, Number.NaN];
  if (VARIANT === "fat-jump" && !reduced && f % loop === MOTION.fatFrame) dotBox = [dotBox[0] - MOTION.fatPx, dotBox[1] - MOTION.fatPx, dotBox[2] + 2 * MOTION.fatPx, dotBox[3] + 2 * MOTION.fatPx];
  if (VARIANT === "track") dotBox = [rest.x + rest.width / 2 - MOTION.trackPx / 2, rest.y, MOTION.trackPx, rest.height];
  const halo = window.HALO !== undefined ? { halo: window.HALO } : {};
  const moves = VARIANT === "track" ? ["p"] : ["y", ...(v.o !== undefined ? ["o"] : []), ...(v.x !== undefined ? ["x"] : [])];
  const objects = { dot: { box: dotBox, moves, ...halo } };
  if (bg) objects.bg = { box: rectOf(bg), moves: ["g"] };
  if (icon) objects.icon = { box: rectOf(icon), moves: [] };
  if (badge) {
    const b = rectOf(badge);
    objects.badge = { box: b[2] < 1 ? [b[0], b[1], 1, 1] : b, moves: ["s"] };
  }
  if (cursor) objects.cursor = { box: rectOf(cursor), moves: [] };
  if (field) objects.field = { box: rectOf(field), moves: [] };
  if (arm) objects.body = { box: hull(rectOf(body), rectOf(arm)), moves: ["a"] };
  if (card) objects.card = { box: rectOf(card), moves: ["cardY"] };
  if (band) objects.band = { box: rectOf(band), moves: ["bx"] };
  if (sky) objects.sky = { box: rectOf(sky), moves: VARIANT === "stripes" ? ["sp"] : [] };
  if (slab) objects.slab = { box: rectOf(slab), moves: ["sx"] };
  return { values: v, events: {}, units: Object.fromEntries(Object.keys(v).map((k) => [k, units[k]])), objects };
};
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
