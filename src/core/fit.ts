import { springProgress } from "./spring.ts";

export interface Sample {
  /** Seconds. Must strictly increase. */
  t: number;
  /** Position, any unit. */
  x: number;
}

export interface Fit {
  visualDuration: number;
  bounce: number;
  /** Root-mean-square error, as a fraction of the distance moved. */
  rms: number;
  /** True when the spring matches the move, the recording ends at rest, and it has enough frames to trust. */
  ok: boolean;
  /**
   * Why `ok` is false; absent when `ok` is true.
   * "poor-fit": the spring does not match the move. Check the recording: if it is clean, the motion is not a spring;
   * a very noisy recording of a real spring can also land here, and so can a short move with a glitched frame.
   * "too-few-frames": the move lasts only a few frames, so several springs fit it equally well (record at a higher frame rate).
   * "cut-short": the recording stops before the element is at rest (record longer).
   */
  reason?: "poor-fit" | "too-few-frames" | "cut-short";
}

export const FIT_OK_RMS = 0.03;

const MIN_VD = 0.04;
const MAX_VD = 2.5;
const MAX_BOUNCE = 0.6;
/** A sample counts as "still" or "settled" when it is this close to its rest value, as a fraction of the distance. */
const STILL_BAND = 0.03;
/** A move has started when a sample is this far from the start, as a fraction of the distance. */
const MOVE_BAND = 0.02;
/**
 * The fitted target may lie between these multiples of the first-guess distance (last sample minus start value).
 * A range limit, so that the closed-form amplitude cannot run away on a recording that is not a spring.
 */
const MIN_AMP = 0.5;
const MAX_AMP = 2;
/**
 * The robust start trims the worst TRIM of the moving samples (those from the first one out of the start band on),
 * so up to a quarter of them may be glitches. Idle samples before the move do not count: any late enough start fits
 * them exactly, so trimming against them would let a spring that misses the move fit the rest exactly. Not the median
 * either (half): on a short move, a spring that misses the move can still fit the idle and settled samples exactly.
 * KEEP_Z converts the kept quantile of |residual| to a standard deviation for Gaussian noise (1.15 is the 87.5 % point
 * of the normal distribution, right for a quarter trimmed; fewer trimmed samples make the scale come out a little high).
 */
const TRIM = 0.25;
const KEEP_Z = 1.15;
/** Bisquare reweightings of each grid candidate's amplitude. */
const AMP_ROUNDS = 2;
/**
 * Tukey bisquare loss: a residual's weight falls smoothly from 1 to 0 at TUKEY_C robust scales, so a sample that far
 * off the fit has no pull at all. 4.685 is the textbook value (95 % as efficient as least squares on Gaussian noise).
 */
const TUKEY_C = 4.685;
/** Floor on the robust scale, as a fraction of the distance, so that a perfect fit does not divide by zero. */
const SCALE_FLOOR = 1e-4;
/**
 * Floor on the scale that sets the bisquare weights, as a fraction of the distance (0.3 px on a 300 px move). Below it,
 * a fit that is still a little off would give zero weight to the very samples that could pull it right.
 */
const WEIGHT_FLOOR = 0.001;
/** Limits on concentration steps per start and on bisquare rounds for the final fit, so that no input loops for long. */
const MAX_START_ROUNDS = 4;
const MAX_IRLS = 8;
/**
 * A sample is a glitch when it is this many robust scales off the fit: the settled check skips it, and on a short move
 * the backstop refuses the fit. Here the scale counts as at least GLITCH_FLOOR of the distance, so that a clean fit
 * does not call small residuals glitches. 4 rather than 6: at 6, 8 more glitched short springs of 38,400 came back
 * ok:true outside the bar, and 3 more noisy ones of 20,736.
 */
const GLITCH_SCALES = 4;
const GLITCH_FLOOR = 0.003;
/**
 * A fit is trusted only when the fitted visualDuration spans at least this many frames; MIN_FRAMES_NOISY when the
 * robust residual scale is above NOISY_SCALE. Measured on this fit with no frame limit, on 2,916 clean and 30,720 noisy
 * synthetic Motion springs (30 to 120 fps, noise 0.3 to 2 px on a 300 px move): clean recordings fit wrong only below
 * 1.6 frames, 0.3 and 0.5 px noise below 2.1, 1 px up to 2.73. A noisy move recorded in a few frames fits its own
 * noise, so its residual scale looks clean, hence 2.5 for all; recordings measured as noisy need 4. With both limits
 * on, 2 of the 1 px recordings (2.5 to 2.8 frames) and 29 of the 2 px ones (up to 6.5 frames) still fit wrong.
 */
const MIN_FRAMES = 2.5;
const MIN_FRAMES_NOISY = 4;
/** Robust residual scale above this fraction of the distance counts as noisy (0.3 px on a 300 px move). */
const NOISY_SCALE = 0.001;
/**
 * Below this many frames per fitted visualDuration a wrong spring can bend through a glitch, so the backstop checks
 * the fit. Measured with the backstop off: one glitched frame, or the last two, gave ok:true outside the bar up to
 * 8.28 frames per fitted visualDuration (and noise alone up to 7.1).
 */
const ROBUST_FRAMES = 8.5;
/** The leave-out check refits without each of at most this many samples from the start of the move. */
const MAX_LEAVE_OUT = 64;
/**
 * The leave-out check refuses when a refit moves by more than this share of the bar. Measured: at 1 (the whole bar)
 * 27 glitched short springs of 38,400 still came back ok:true outside the bar; at 0.5, 4.
 */
const LEAVE_OUT_SHARE = 0.5;
/** A recording must run at least this many visualDurations past the start, or it was cut before the spring settled. */
const MIN_SPAN = 1.5;
/** Limit on one refine pass, so that no input can make it loop for long. */
const MAX_LM_ITERS = 60;
/** Limit on one refine pass inside a concentration step: those only need to find the right valley. */
const START_LM_ITERS = 15;
/** Refine this many of the best coarse cells by trimmed sum, and LS_SEEDS by plain sum of squares. */
const SEEDS = 6;
const LS_SEEDS = 3;

/** Solves the 3x3 system M x = y by Gaussian elimination; null when M is singular. */
function solve3(M: number[][], y: number[]): number[] | null {
  const a = M.map((row, i) => [...row, y[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (Math.abs(a[p]![c]!) < 1e-300) return null;
    [a[c], a[p]] = [a[p]!, a[c]!];
    for (let r = c + 1; r < 3; r++) {
      const k = a[r]![c]! / a[c]![c]!;
      for (let j = c; j < 4; j++) a[r]![j]! -= k * a[c]![j]!;
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) x[r] = (a[r]![3]! - [r + 1, r + 2].reduce((sum, j) => sum + (j < 3 ? a[r]![j]! * x[j]! : 0), 0)) / a[r]![r]!;
  return x.every(Number.isFinite) ? x : null;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The k-th smallest of a[0..len) (0-based), in linear time on average. Reorders a. */
function select(a: Float64Array, len: number, k: number): number {
  let lo = 0;
  let hi = len - 1;
  while (hi > lo) {
    const pivot = a[(lo + hi) >> 1]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i <= j) {
        const tmp = a[i]!;
        a[i] = a[j]!;
        a[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k]!;
}

/** Bisquare weight of residual r at scale s: 1 at 0, falling to 0 at TUKEY_C scales and staying 0 past it. */
function bisquare(r: number, s: number): number {
  const u = r / (TUKEY_C * s);
  return u * u < 1 ? (1 - u * u) ** 2 : 0;
}

/**
 * Fits Motion's spring (visualDuration, bounce) to a recorded move.
 *
 * The recording must run until the element is at rest. The target is fitted from every sample (not read from the
 * tail). The fit is robust (an MM-estimator: a least-trimmed-squares start, then Tukey bisquare loss), so a glitched
 * frame or two, such as a tracker error, has no pull on it. On a move of under 8.5 frames per visualDuration a wrong
 * spring can still bend through a glitch, so there a fit is refused ("poor-fit") when a sample sits far off it, or
 * when one sample (or the last two) decides it. Measured remaining band: at about 3.6 frames per visualDuration, a
 * glitch on the first moving frame can still give ok:true outside the bar (4 of 38,400 glitched short springs).
 * Bad data does not throw once it is well formed: the numbers come back with `ok: false` and a `reason`
 * (a recording cut short, a move of only a few frames, or a motion that is not a spring).
 * Still frames before the move are fine, and the move may start between two frames.
 * Bounce is searched up to 0.6, so examples above motion-kit's 0.4 cap still report honestly.
 *
 * Throws when there are fewer than 4 samples, when any `t` or `x` is not a finite number,
 * when `t` does not strictly increase, or when the element did not move.
 */
export function fitSpring(samples: Sample[]): Fit {
  const n = samples.length;
  if (n < 4) throw new Error("fitSpring needs at least 4 samples");
  for (const s of samples) {
    if (!Number.isFinite(s.t) || !Number.isFinite(s.x)) throw new Error("fitSpring: every t and x must be a finite number");
  }
  for (let i = 1; i < n; i++) {
    if (!(samples[i]!.t > samples[i - 1]!.t)) throw new Error("fitSpring: t must strictly increase");
  }

  const dt = median(samples.slice(1).map((s, i) => s.t - samples[i]!.t));
  const first = samples[0]!.x;
  const lastX = samples[n - 1]!.x;
  if (lastX - first === 0) throw new Error("fitSpring: the element did not move");

  // The start value is the median of the leading still frames. Only the first half of that run counts,
  // because the last frames of the run may already be the slow start of the move.
  const d0 = Math.abs(lastX - first);
  let run = 0;
  while (run < n && Math.abs(samples[run]!.x - first) <= STILL_BAND * d0) run++;
  const idle = samples.slice(0, Math.max(1, run >> 1)).map((s) => s.x);
  const x0 = median(idle);
  const noise = idle.reduce((m, x) => Math.max(m, Math.abs(x - x0)), 0);

  // The distance moved is only a first guess here (the last sample may be a glitch). It scales the data and sets the
  // bands. The target itself is fitted below, as an amplitude on the spring.
  const d = lastX - x0;
  if (d === 0) throw new Error("fitSpring: the element did not move");

  const moveBand = Math.max(MOVE_BAND * Math.abs(d), 4 * noise);
  const firstMove = samples.findIndex((s) => Math.abs(s.x - x0) > moveBand);
  if (firstMove < 0) throw new Error("fitSpring: the element did not move");

  // The move began somewhere before the first sample that left the start band, so the start time is searched too.
  // A slow spring needs a long head start to climb out of the band; a fast one needs only a frame or two.
  const tMove = samples[firstMove]!.t;
  const last = samples[n - 1]!.t;
  const headStart = Math.max(3 * dt, 0.15 * (last - tMove));
  const tauHi = tMove;
  const tauLo = firstMove === 0 ? tMove : Math.max(samples[0]!.t, tMove - headStart);
  const from = Math.max(0, firstMove - 6);
  const pts = samples.slice(from).map((s) => ({ t: s.t, p: (s.x - x0) / d }));
  const m = pts.length;
  const T = Float64Array.from(pts, (q) => q.t);
  const P = Float64Array.from(pts, (q) => q.p);

  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

  // For a spring that starts at time tau, the model is x0 + amp * d * progress(t - tau). It is linear in amp, so the
  // best amp has a closed form: that is how the target is fitted, from every sample and not from the tail.
  // Every sum is weighted by w, the robust weight of each sample (all 1 until the reweighting below).
  const w = new Float64Array(pts.length).fill(1);
  const g = new Float64Array(pts.length);
  const fitAmp = (vd: number, b: number, tau: number): { sse: number; amp: number } => {
    const f = springProgress(vd, b);
    let gp = 0;
    let gg = 0;
    let pp = 0;
    for (let i = 0; i < m; i++) {
      const v = T[i]! <= tau ? 0 : f(T[i]! - tau);
      g[i] = v;
      gp += w[i]! * v * P[i]!;
      gg += w[i]! * v * v;
      pp += w[i]! * P[i]! * P[i]!;
    }
    const amp = gg > 1e-12 ? clamp(gp / gg, MIN_AMP, MAX_AMP) : 1;
    return { sse: pp - 2 * amp * gp + amp * amp * gg, amp };
  };

  type Cand = { lv: number; b: number; tau: number; sse: number; amp: number };
  const score = (lv: number, b: number, tau: number): Cand => {
    const c = { lv: clamp(lv, Math.log(MIN_VD), Math.log(MAX_VD)), b: clamp(b, 0, MAX_BOUNCE), tau: clamp(tau, tauLo, tauHi), sse: 0, amp: 1 };
    const fa = fitAmp(Math.exp(c.lv), c.b, c.tau);
    c.sse = Math.max(0, fa.sse);
    c.amp = fa.amp;
    return c;
  };

  // High-breakdown start: least trimmed squares (LTS). A candidate is scored by the sum of its `keep` smallest squared
  // residuals, so the worst quarter of the moving samples (a glitch or two) cannot move the score, and the candidate that
  // matches most samples wins, even where a wrong spring could bend through a glitch. Each candidate first gets a robust
  // amplitude (below), so that one or two bad samples do not shift the target.
  const keep = pts.length - Math.floor(TRIM * (pts.length - (firstMove - from)));
  const abs = new Float64Array(pts.length);
  /** Trimmed sum of squares, and the kept quantile of |residual| as a scale, at amplitude amp (g must be filled). */
  const trimmed = (amp: number): { lts: number; scale: number } => {
    for (let i = 0; i < m; i++) abs[i] = Math.abs(amp * g[i]! - P[i]!);
    const q = select(abs, m, keep - 1);
    let lts = 0;
    for (let i = 0; i < keep; i++) lts += abs[i]! * abs[i]!;
    return { lts, scale: q / KEEP_Z };
  };
  // The robust amplitude for one candidate: the median of data / progress over the samples past half the move (a
  // glitch or two cannot move a median), then AMP_ROUNDS bisquare reweightings at the trimmed scale.
  const robustAmp = (ampLs: number): number => {
    let k = 0;
    for (let i = 0; i < m; i++) if (g[i]! > 0.5) abs[k++] = P[i]! / g[i]!;
    let amp = k > 0 ? clamp(select(abs, k, k >> 1), MIN_AMP, MAX_AMP) : ampLs;
    for (let round = 0; round < AMP_ROUNDS; round++) {
      const s = Math.max(trimmed(amp).scale, WEIGHT_FLOOR);
      let gp = 0;
      let gg = 0;
      for (let i = 0; i < m; i++) {
        const wi = bisquare(amp * g[i]! - P[i]!, s);
        gp += wi * g[i]! * P[i]!;
        gg += wi * g[i]! * g[i]!;
      }
      if (gg > 1e-12) amp = clamp(gp / gg, MIN_AMP, MAX_AMP);
    }
    return amp;
  };
  type Start = Cand & { lts: number };
  const ltsScore = (lv: number, b: number, tau: number): Start => {
    const c = score(lv, b, tau);
    const amp = robustAmp(c.amp);
    return { ...c, amp, lts: trimmed(amp).lts };
  };

  // Coarse grid. The start time matters as much as the other two (a short spring has only a few moving frames),
  // so tau gets a fine grid of its own, and the best cell for each tau value becomes a candidate seed.
  const tauStep = Math.max(dt / 4, (tauHi - tauLo) / 12);
  const taus: number[] = [];
  for (let tau = tauLo; tau < tauHi - 1e-9; tau += tauStep) taus.push(tau);
  taus.push(tauHi);
  // Each tau keeps two cells: the best by trimmed sum (robust) and the best by plain sum of squares. On a clean move of
  // only a few frames, trimming a quarter of the samples can drop the moving ones, and only the plain fit finds it.
  const none = (tau: number): Start => ({ lv: 0, b: 0, tau, sse: Number.POSITIVE_INFINITY, amp: 1, lts: Number.POSITIVE_INFINITY });
  const ltsPerTau: Start[] = taus.map(none);
  const ssePerTau: Start[] = taus.map(none);
  for (let b = 0; b <= MAX_BOUNCE + 1e-9; b += 0.1) {
    for (let lv = Math.log(0.05); lv <= Math.log(1.5); lv += 0.1) {
      taus.forEach((tau, k) => {
        const c = ltsScore(lv, b, tau);
        if (c.lts < ltsPerTau[k]!.lts) ltsPerTau[k] = c;
        if (c.sse < ssePerTau[k]!.sse) ssePerTau[k] = c;
      });
    }
  }
  ltsPerTau.sort((a, c) => a.lts - c.lts);
  ssePerTau.sort((a, c) => a.sse - c.sse);

  // Levenberg-Marquardt on (log vd, bounce, tau). The three trade off along a narrow diagonal valley (a faster
  // spring that starts earlier looks like a slower one that starts later). A search that moves one parameter at
  // a time stalls there; a step that uses the slope of all three together does not.
  // Unweighted residuals, model minus data, as a fraction of the first-guess distance.
  const rawResiduals = (c: Cand): number[] => {
    const { amp } = fitAmp(Math.exp(c.lv), c.b, c.tau);
    return pts.map((q, i) => amp * g[i]! - q.p);
  };
  // Weighted residuals: their sum of squares is the weighted sse that score() reports.
  const residuals = (c: Cand): number[] => rawResiduals(c).map((r, i) => Math.sqrt(w[i]!) * r);
  const refine = (start: Cand, maxIters = MAX_LM_ITERS): Cand => {
    let cur = start;
    let r0 = residuals(cur);
    let lambda = 1e-3;
    const h = [1e-4, 1e-4, dt * 1e-3];
    for (let iter = 0; iter < maxIters; iter++) {
      // Forward-difference Jacobian, one column per parameter.
      const cols = [0, 1, 2].map((i) => {
        const r = residuals({ ...cur, lv: cur.lv + (i === 0 ? h[0]! : 0), b: cur.b + (i === 1 ? h[1]! : 0), tau: cur.tau + (i === 2 ? h[2]! : 0) });
        return r.map((v, k) => (v - r0[k]!) / h[i]!);
      });
      const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => cols[i]!.reduce((sum, v, k) => sum + v * cols[j]![k]!, 0)));
      const g = [0, 1, 2].map((i) => cols[i]!.reduce((sum, v, k) => sum + v * r0[k]!, 0));
      let moved = false;
      for (let tries = 0; tries < 12 && !moved; tries++) {
        const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
        const step = solve3(M, g.map((v) => -v));
        if (!step) {
          lambda *= 10;
          continue;
        }
        const next = score(cur.lv + step[0]!, cur.b + step[1]!, cur.tau + step[2]!);
        if (next.sse < cur.sse) {
          const gain = cur.sse - next.sse;
          const tiny = Math.abs(next.lv - cur.lv) < 1e-7 && Math.abs(next.b - cur.b) < 1e-7 && Math.abs(next.tau - cur.tau) < dt * 1e-7;
          cur = next;
          r0 = residuals(cur);
          lambda = Math.max(lambda / 4, 1e-9);
          moved = true;
          // Stop when the loss or the step becomes negligible (a step of 1e-7 is far below the fit's bar).
          if (gain <= 1e-14 + 1e-10 * cur.sse || tiny) return cur;
        } else {
          lambda *= 4;
        }
      }
      if (!moved) break;
    }
    return cur;
  };

  // MM-estimator. Each seed is refined by LTS concentration steps into a candidate. The candidate with the lowest
  // trimmed sum is the high-breakdown start, and its scale is held fixed. The final fit is bisquare IRLS (iteratively
  // reweighted least squares) at that scale: each round sets every sample's weight from its residual (1 at 0, falling
  // to 0 at TUKEY_C scales) and refines again. A bisquare weight reaches 0, so a glitch far off the fit has no pull at
  // all (a Huber weight never does, so there a wrong spring can still bend through it).
  const residualsAt = (c: Cand): number[] => {
    fitAmp(Math.exp(c.lv), c.b, c.tau);
    return pts.map((q, i) => c.amp * g[i]! - q.p);
  };
  const quantScale = (r: number[]): number => {
    r.forEach((v, i) => (abs[i] = Math.abs(v)));
    return select(abs, r.length, keep - 1) / KEEP_Z;
  };
  const ltsOf = (r: number[]): number => {
    r.forEach((v, i) => (abs[i] = Math.abs(v)));
    select(abs, r.length, keep - 1);
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += abs[i]! * abs[i]!;
    return sum;
  };
  // Without a scale: LTS concentration steps (weight 1 for the `keep` samples nearest the fit, 0 for the rest; each
  // step can only lower the trimmed sum). With a scale: bisquare rounds at that fixed scale.
  type Got = { c: Cand; r: number[]; w: Float64Array; lts: number };
  const cands: Got[] = [];
  // Two fits this close (0.1 % of visualDuration, 0.001 bounce, 1 % of a frame) are the same; a seed that reaches one
  // already found stops there.
  const same = (a: Cand, c: Cand): boolean => Math.abs(a.lv - c.lv) < 1e-3 && Math.abs(a.b - c.b) < 1e-3 && Math.abs(a.tau - c.tau) < dt * 1e-2;
  const irls = (start: Cand, r0: number[], rounds: number, fixedScale?: number): { c: Cand; r: number[]; dup?: true } => {
    let c = start;
    let r = r0;
    for (let round = 0; round < rounds; round++) {
      const cut = fixedScale === undefined ? quantScale(r) * KEEP_Z : 0;
      const s = Math.max(fixedScale ?? 0, WEIGHT_FLOOR);
      let change = 0;
      r.forEach((v, i) => {
        const next = fixedScale === undefined ? (Math.abs(v) <= cut ? 1 : 0) : bisquare(v, s);
        change = Math.max(change, Math.abs(next - w[i]!));
        w[i] = next;
      });
      if (round > 0 && change < 1e-3) break;
      const prev = c;
      c = refine(score(c.lv, c.b, c.tau), fixedScale === undefined ? START_LM_ITERS : MAX_LM_ITERS);
      r = rawResiduals(c);
      if (fixedScale === undefined && cands.some((k) => same(k.c, c))) return { c, r, dup: true };
      // Stop once the spring itself stops moving (0.01 % of visualDuration, 0.0001 bounce): far below the fit's bar.
      if (Math.abs(c.lv - prev.lv) < 1e-4 && Math.abs(c.b - prev.b) < 1e-4 && Math.abs(c.tau - prev.tau) < dt * 1e-3) break;
    }
    return { c, r };
  };
  const keepCand = (got: { c: Cand; r: number[]; dup?: true }): void => {
    const lts = ltsOf(got.r);
    if (!got.dup && Number.isFinite(lts)) cands.push({ c: got.c, r: got.r, w: w.slice(), lts });
  };
  for (const seed of ltsPerTau.slice(0, SEEDS)) {
    w.fill(1);
    keepCand(irls(seed, residualsAt(seed), MAX_START_ROUNDS));
  }
  // Plain least-squares seeds: refined unweighted first, then the same concentration steps.
  for (const seed of ssePerTau.slice(0, LS_SEEDS)) {
    w.fill(1);
    const c = refine(seed);
    keepCand(irls(c, rawResiduals(c), MAX_START_ROUNDS));
  }
  if (cands.length === 0) throw new Error("fitSpring: the fit did not converge");
  // The high-breakdown start is the candidate with the lowest trimmed sum; its scale is held fixed from here on. Among
  // all candidates, the final fit starts from the one with the lowest bisquare loss at that scale: a sample far off
  // costs 1 whatever its size, and near ones cost about their square, so it is robust and still as sharp as least
  // squares on noise (choosing by the trimmed sum itself throws away a quarter of the moving frames).
  const start = cands.reduce((a, c) => (c.lts < a.lts ? c : a));
  const sStar = Math.max(quantScale(start.r), WEIGHT_FLOOR);
  const loss = (r: number[]): number => r.reduce((sum, v) => sum + 1 - bisquare(v, sStar) ** 1.5, 0);
  const pick = cands.reduce((a, c) => (loss(c.r) < loss(a.r) ? c : a));
  w.set(pick.w);
  const { c: best, r } = irls(pick.c, pick.r, MAX_IRLS, sStar);
  const robustStart = start.c;
  if (!Number.isFinite(best.sse)) throw new Error("fitSpring: the fit did not converge");
  // The noise level: 1.4826 x the median absolute residual (for Gaussian noise, the standard deviation).
  const scale = Math.max(1.4826 * median(r.map(Math.abs)), SCALE_FLOOR);

  // The fitted target and distance. rms is the plain (unweighted) error, so a glitch still counts in it.
  const x1 = x0 + best.amp * d;
  const dist = Math.abs(best.amp * d);
  const rms = Math.sqrt(r.reduce((sum, v) => sum + v * v, 0) / pts.length) / best.amp;

  // Cut-short check. A recording that stops at the top of an overshoot looks settled, so also require enough length.
  // Samples far off the robust fit (glitches) say nothing about where the element is, so they are skipped.
  const vd = Math.exp(best.lv);
  const longEnough = last - best.tau >= MIN_SPAN * vd;
  const tailLen = Math.max(3, Math.ceil(0.2 * (n - firstMove)));
  const outlier = (i: number): boolean => Math.abs(r[i]!) > GLITCH_SCALES * Math.max(scale, GLITCH_FLOOR);
  const tail = samples.map((s, i) => ({ x: s.x, i: i - from })).slice(-tailLen).filter((s) => !outlier(s.i));
  const settled = tail.length > 0 && tail.every((s) => Math.abs(s.x - x1) <= Math.max(STILL_BAND * dist, 4 * noise));

  // The noise level is the robust residual scale. It sees noise on every frame (idle, moving and settled), so it works
  // with no idle frames, and a glitch does not inflate it.
  const noisy = scale / best.amp > NOISY_SCALE;

  const round = (v: number) => Math.round(v * 1000) / 1000;
  const fit = { visualDuration: round(vd), bounce: round(best.b), rms };
  if (rms > FIT_OK_RMS) return { ...fit, ok: false, reason: "poor-fit" };
  if (vd / dt < (noisy ? MIN_FRAMES_NOISY : MIN_FRAMES)) return { ...fit, ok: false, reason: "too-few-frames" };
  // Backstop. On a move of only a few frames per visualDuration, a wrong spring can bend through a glitch, so the
  // robust fit is not trusted there when any sample sits far off it, or when the robust start found another spring.
  if (vd / dt < ROBUST_FRAMES) {
    /** True when c differs from the final fit by more than `share` of the bar (0.05 bounce, 10 % visualDuration). */
    const apart = (c: Cand, share = 1): boolean => Math.abs(c.b - best.b) > 0.05 * share || Math.abs(Math.exp(c.lv - best.lv) - 1) > 0.1 * share;
    if (r.some((_, i) => outlier(i)) || apart(robustStart)) {
      return { ...fit, ok: false, reason: "poor-fit" };
    }
    // Leave-out check: refit without each moving sample, and without the last two together (a tracker that loses
    // the element at the end glitches both). If the spring then moves past the bar, one or two samples decide the
    // answer, and those may be glitches the fit has absorbed. "Moves" here is half the bar: one sample (or the last
    // two) should not control half of the error budget. Other pairs are not left out: on a clean move of 2 to 4
    // frames, the first two moving samples decide the answer too, and the fit there is right.
    const lo = Math.max(0, firstMove - from - 2);
    const drops: [number, number][] = [[pts.length - 2, pts.length]];
    for (let i = lo; i < Math.min(pts.length, lo + MAX_LEAVE_OUT); i++) drops.push([i, i + 1]);
    const kept = w.slice();
    for (const [a, b] of drops) {
      w.set(kept);
      w.fill(0, a, b);
      if (apart(refine(score(best.lv, best.b, best.tau)), LEAVE_OUT_SHARE)) return { ...fit, ok: false, reason: "poor-fit" };
    }
  }
  if (!longEnough || !settled) return { ...fit, ok: false, reason: "cut-short" };
  return { ...fit, ok: true };
}
