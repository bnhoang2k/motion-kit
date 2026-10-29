// Shared engine for the panel pages. window.PAGE = {
//   names: [...], units: {...}, start: {name: v},
//   init(S), onPress(S, t, target, x, y), render(v, S), hit(x, y)? (custom hit test; default document.elementFromPoint),
//   hitAt: "press" (default: hit-test the state drawn at the press's own time) | "floor" (the last frame drawn before it) }
// Every value is a segment list: S.segs[name] = {from, to, start, dur, ease}. tween(S, name, to, start, dur) starts a
// segment from wherever the value is at `start`. ?seek steps from 0 at 1/60 s; presses come from window.__input.
(function () {
  const P = window.PAGE;
  const seekMode = new URLSearchParams(location.search).has("seek");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const easeOut = (p) => 1 - (1 - p) ** 3;
  const val = (g, t) => {
    if (t <= g.start || g.dur <= 0 && t < g.start) return g.from;
    if (g.dur <= 0 || t >= g.start + g.dur) return g.to;
    return g.from + (g.to - g.from) * (g.ease || easeOut)((t - g.start) / g.dur);
  };
  let S;
  const api = {
    reduced,
    valueAt: (n, t) => val(S.segs[n], t),
    tween(S_, n, to, start, dur, ease) {
      const x = val(S_.segs[n], start);
      S_.segs[n] = { from: x, to, start, dur: reduced ? 0 : dur, ease };
    },
    playing: (t) => P.names.some((n) => t < S.segs[n].start + S.segs[n].dur - 1e-9 && val(S.segs[n], t) !== S.segs[n].to) || (P.busy ? P.busy(S, t) : false),
    values: (t) => Object.fromEntries(P.names.map((n) => [n, val(S.segs[n], t)])),
  };
  window.PANELS = api;
  function reset() {
    S = { t: 0, down: false, segs: {}, n: 0 };
    for (const n of P.names) S.segs[n] = { from: P.start?.[n] ?? 0, to: P.start?.[n] ?? 0, start: 0, dur: 0 };
    P.init?.(S, api);
  }
  function draw(t) { P.render(api.values(t), S, t); }
  function press(t, x, y) {
    const drawnAt = P.hitAt === "floor" ? Math.floor(t * 60 + 1e-6) / 60 : t;
    draw(drawnAt);
    const target = P.hit ? P.hit(x, y) : document.elementFromPoint(x, y);
    P.onPress(S, t, target, x, y, api);
  }
  function step(h) {
    const end = S.t + h;
    if (seekMode) {
      const s = window.__input || [];
      for (let i = 0; i < s.length; i++) {
        const q = s[i], ms = q[0] / 1000;
        const isDown = q[3] !== 0, wasDown = i > 0 && s[i - 1][3] !== 0;
        if (isDown && !wasDown && ms > S.t + 1e-9 && ms <= end + 1e-9) press(ms, q[1], q[2]);
      }
    }
    S.t = end;
  }
  window.__seek = (ms) => {
    reset();
    const n = Math.floor((ms * 60) / 1000 + 1e-6);
    for (let i = 0; i < n; i++) step(1 / 60);
    const rest = ms / 1000 - n / 60;
    if (rest > 1e-9) step(rest);
    draw(S.t);
  };
  window.__state = () => ({ values: api.values(S.t), events: {}, units: P.units });
  reset();
  draw(0);
  if (!seekMode) {
    let last = null, raf = 0;
    const queue = [];
    const frame = (now) => {
      const h = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      S.t += h;
      while (queue.length) { const q = queue.shift(); press(S.t, q[0], q[1]); }
      draw(S.t);
      if (api.playing(S.t)) raf = requestAnimationFrame(frame);
      else { raf = 0; last = null; }
    };
    addEventListener("pointerdown", (e) => { queue.push([e.clientX, e.clientY]); if (!raf) raf = requestAnimationFrame(frame); });
  }
})();
