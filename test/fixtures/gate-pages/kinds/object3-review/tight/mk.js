// Shared page runner for review pages. A page calls MK.run(spec):
//   spec.kind   idle | live | scroll | choreo | sim
//   spec.init() -> state object (plain data, cloneable)
//   spec.step(s, dtSec, inp, tMs)  advances one step; inp = { x, y, down, scrollY }
//   spec.render(s, tMs)            draws the state
//   spec.report(s)                 -> { values, units, objects }
//   spec.busy(s)                   optional: true while a sequence still plays (keeps the live loop on)
//   spec.cap                       longest time step on the live loop, in page ms
(function () {
  const FRAME = 1000 / 60;
  const SEEK = new URLSearchParams(location.search).has("seek");
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clone = (o) => structuredClone(o);

  function sampleAt(samples, t) {
    let cur = null;
    for (const s of samples) {
      if (s[0] <= t + 1e-6) cur = s;
      else break;
    }
    if (!cur) return { x: NaN, y: NaN, down: false, scrollY: 0 };
    if (cur.length === 2) return { x: NaN, y: NaN, down: false, scrollY: cur[1] };
    const last = samples[samples.length - 1];
    const after = t > last[0] + 1e-6;
    return { x: cur[1], y: cur[2], down: !after && cur[3] !== 0, scrollY: 0 };
  }

  function run(spec) {
    const samples = Array.isArray(window.__input) ? window.__input : [];
    const live = { x: NaN, y: NaN, down: false };
    const inputAt = (t) => (SEEK ? sampleAt(samples, t) : { x: live.x, y: live.y, down: live.down, scrollY: window.scrollY });
    let cur = spec.init();
    let curT = 0;
    window.__state = () => spec.report(cur, curT);
    const scrollTo = (t) => {
      if (spec.kind === "scroll" && SEEK) window.scrollTo(0, inputAt(t).scrollY || 0);
    };
    if (SEEK) {
      let cache = null;
      window.__seek = (ms) => {
        const K = Math.floor(ms / FRAME + 1e-9);
        let k0 = 0;
        let st;
        if (cache && cache.k <= K) {
          k0 = cache.k;
          st = clone(cache.state);
        } else st = spec.init();
        for (let k = k0; k < K; k++) {
          const tEnd = (k + 1) * FRAME;
          spec.step(st, FRAME / 1000, inputAt(tEnd), tEnd);
        }
        cache = { k: K, state: clone(st) };
        const rem = ms - K * FRAME;
        if (rem > 1e-9) spec.step(st, rem / 1000, inputAt(ms), ms);
        cur = st;
        curT = ms;
        scrollTo(ms);
        spec.render(st, ms);
      };
      spec.render(cur, 0);
      return;
    }
    // Live loop.
    let t = 0;
    let last = null;
    let raf = 0;
    let still = 0;
    let prev = null;
    const snapshot = () => {
      const v = spec.report(cur, t).values;
      return Object.keys(v).map((k) => v[k]);
    };
    const tick = (ts) => {
      raf = 0;
      if (last === null) last = ts;
      let dt = Math.min(ts - last, spec.cap);
      last = ts;
      while (dt > 1e-9) {
        const h = Math.min(dt, FRAME);
        t += h;
        spec.step(cur, h / 1000, inputAt(t), t);
        dt -= h;
      }
      curT = t;
      spec.render(cur, t);
      const now = snapshot();
      const moved = !prev || now.some((v, i) => Math.abs(v - prev[i]) > 0.001);
      prev = now;
      still = moved ? 0 : still + 1;
      if (document.hidden) return;
      const caused = spec.kind === "choreo" || spec.kind === "sim";
      const keep = spec.kind === "idle" ? !REDUCED : still < 8 || (caused && spec.busy ? spec.busy(cur) : false) || live.down;
      if (keep) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      still = 0;
      if (!raf && !document.hidden) {
        last = null;
        raf = requestAnimationFrame(tick);
      }
    };
    addEventListener("pointerdown", (e) => {
      live.x = e.clientX;
      live.y = e.clientY;
      live.down = true;
      wake();
    });
    addEventListener("pointermove", (e) => {
      live.x = e.clientX;
      live.y = e.clientY;
      wake();
    });
    addEventListener("pointerup", (e) => {
      live.x = e.clientX;
      live.y = e.clientY;
      live.down = false;
      wake();
    });
    addEventListener("scroll", wake, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    });
    spec.render(cur, 0);
    wake();
  }

  // Helpers.
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, Math.max(1, r.width), Math.max(1, r.height)];
  };
  const frameOf = (t) => Math.floor(t / FRAME + 1e-6);
  // A page that is a pure function of time (and, for choreo or sim, of the first press's time).
  // spec.draw(tMs, inp, s) sets the DOM and returns the record; s.tap is the first press time or null.
  function pure(spec) {
    let rec = null;
    run({
      kind: spec.kind,
      cap: spec.cap,
      init: () => ({ t: 0, tap: null, inp: null }),
      step: (s, dt, inp, t) => {
        s.t = t;
        s.inp = inp;
        if (inp.down && s.tap === null) s.tap = t;
        if (spec.step) spec.step(s, inp, t);
        s.was = inp.down;
      },
      render: (s) => {
        rec = spec.draw(s.t, s.inp || { x: NaN, y: NaN, down: false, scrollY: 0 }, s);
      },
      report: () => rec,
      busy: (s) => (spec.busy ? spec.busy(s) : false),
    });
  }
  const place = (el, x, y, w, h) => {
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";
  };
  window.MK = { run, pure, place, SEEK, REDUCED, FRAME, boxOf, frameOf, clone };
})();
