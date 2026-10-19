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
export declare const FIT_OK_RMS = 0.03;
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
export declare function fitSpring(samples: Sample[]): Fit;
