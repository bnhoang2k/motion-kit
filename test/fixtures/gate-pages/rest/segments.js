// A small fixed-clock runtime for choreo test pages. A page sets window.PAGE = { values, units, press, draw }.
// Every value runs on a list of segments (tweens or springs), each starting from where the value is at its start, so a
// retarget is continuous. Under ?seek, a press is hit tested with document.elementFromPoint against the page as drawn at
// the press's own time, the same way the browser hit tests a pointerdown in the live loop.
(function () {
  const P = window.PAGE;
  const seekMode = new URLSearchParams(location.search).has("seek");
  const ease = {
    out: (p) => 1 - (1 - p) ** 3,
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
    linear: (p) => p,
    // Motion's default easeOut, cubic-bezier(0, 0, 0.58, 1), solved numerically.
    bez: (p) => bezier(0, 0, 0.58, 1, p),
  };
  function bezier(x1, y1, x2, y2, x) {
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 40; i++) {
      u = (lo + hi) / 2;
      const bx = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u * u * x2 + u ** 3;
      if (bx < x) lo = u; else hi = u;
    }
    return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let S;
  function reset() {
    S = { t: 0, down: false, segs: {}, st: P.state ? P.state() : {} };
    for (const n of Object.keys(P.values)) S.segs[n] = [];
  }
  function segVal(seg, t) {
    const d = t - seg.start;
    if (d <= 0) return seg.from;
    if (seg.kind === "spring") {
      const { k, c, v0, from, to } = seg;
      const x0 = from - to;
      const zeta = c / (2 * Math.sqrt(k));
      const w0 = Math.sqrt(k);
      let x;
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        x = Math.exp(-zeta * w0 * d) * (x0 * Math.cos(wd * d) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * d));
      } else {
        x = Math.exp(-w0 * d) * (x0 + (v0 + w0 * x0) * d);
      }
      if (d >= seg.restAt) return to;
      return to + x;
    }
    if (seg.dur <= 0 || d >= seg.dur) return seg.to;
    return seg.from + (seg.to - seg.from) * (ease[seg.ease || "out"])(d / seg.dur);
  }
  function valAt(n, t) {
    const list = S.segs[n];
    let v = P.values[n];
    for (const g of list) if (g.start <= t + 1e-12) v = segVal(g, t);
    return v;
  }
  const endOf = (g) => (g.kind === "spring" ? g.start + g.restAt : g.start + g.dur);
  function add(n, g) {
    const list = S.segs[n].filter((x) => x.start < g.start - 1e-12);
    S.segs[n] = list;
    g.from = valAt(n, g.start);
    if (g.kind === "spring") {
      const h = 1e-4;
      g.v0 = (valAt(n, g.start) - valAt(n, g.start - h)) / h;
      // Settle where Motion would: within restDelta of the target and below restSpeed.
      let d = 0;
      for (; d < 20; d += 1 / 600) {
        const a = segVal({ ...g, restAt: Infinity }, g.start + d), b = segVal({ ...g, restAt: Infinity }, g.start + d + 1e-4);
        if (Math.abs(a - g.to) < (g.restDelta ?? 0.5) && Math.abs((b - a) / 1e-4) < (g.restSpeed ?? 10)) break;
      }
      g.restAt = d;
    }
    list.push(g);
  }
  const ctx = {
    get t() { return S.t; },
    get st() { return S.st; },
    v: (n, t) => valAt(n, t ?? S.t),
    tween(n, to, o = {}) { add(n, { kind: "tween", to, start: S.t + (reduced ? 0 : o.delay || 0), dur: reduced ? 0 : o.dur, ease: o.ease }); },
    spring(n, to, o = {}) {
      if (reduced) return this.tween(n, to, { dur: 0 });
      const vd = o.visualDuration ?? 0.5, bounce = o.bounce ?? 0.2;
      const root = (2 * Math.PI) / (vd * 1.2), k = root * root;
      const c = 2 * Math.min(1, Math.max(0.05, 1 - bounce)) * Math.sqrt(k);
      add(n, { kind: "spring", to, start: S.t + (o.delay || 0), k, c, restDelta: o.restDelta, restSpeed: o.restSpeed });
    },
    playing(t) { const tt = t ?? S.t; return Object.keys(S.segs).some((n) => S.segs[n].some((g) => endOf(g) > tt + 1e-9)); },
  };
  window.MK = { ctx };
  function sampleAt(ms) {
    const s = window.__input || [];
    let p = null;
    for (const q of s) if (q[0] <= ms + 1e-6) p = q;
    return p;
  }
  function downAt(ms) {
    const p = sampleAt(ms), s = window.__input || [];
    return !!p && p[3] !== 0 && ms <= s[s.length - 1][0] + 1e-6;
  }
  const values = (t) => Object.fromEntries(Object.keys(P.values).map((n) => [n, valAt(n, t)]));
  const draw = (t) => P.draw(values(t), S.st, t);
  let queue = [];
  function step(h) {
    const end = S.t + h;
    if (seekMode) {
      const down = downAt(end * 1000);
      if (down && !S.down) {
        const p = sampleAt(end * 1000);
        draw(p[0] / 1000);
        const el = document.elementFromPoint(p[1], p[2]);
        S.t = end;
        P.press(ctx, el, p[1], p[2]);
      }
      S.down = down;
    } else {
      S.t = end;
      for (const q of queue) P.press(ctx, q.el, q.x, q.y);
      queue = [];
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
  window.__state = () => ({ values: values(S.t), events: {}, units: P.units });
  reset();
  draw(0);
  if (!seekMode) {
    let last = null, raf = 0;
    const frame = (now) => {
      const h = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      step(h);
      draw(S.t);
      if (ctx.playing() || queue.length) raf = requestAnimationFrame(frame);
      else { raf = 0; last = null; }
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
    addEventListener("pointerdown", (e) => { queue.push({ el: e.target, x: e.clientX, y: e.clientY }); wake(); });
    wake();
  }
})();
