// Shared scroll helper for the scroll review pages.
// s.y is the scroll the page draws from: direct, smoothed, or (reduced motion) stepped.
(function () {
  function scrollStep(s, dt, inp, M) {
    s.prevTarget = s.target;
    s.target = inp.scrollY || 0;
    if (MK.REDUCED) {
      s.y = M.redStep * Math.floor(s.target / M.redStep);
      return;
    }
    if (M.smooth > 0) {
      s.y += (s.target - s.y) * (1 - Math.exp(-dt / M.smooth));
      if (Math.abs(s.target - s.y) < 0.3) s.y = s.target;
    } else s.y = s.target;
  }
  window.RIG = { H: innerHeight, W: innerWidth, scrollStep };
})();
