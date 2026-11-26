import { type KindRule } from "../../src/gate/kind-gate.ts";
/**
 * The idle rules (kinds/idle/rules.md): the loop pauses off screen, and it resumes within one frame
 * of coming back. The gate takes the page off screen two ways at once, so a page may listen for
 * either: `document.hidden` turns true with a `visibilitychange` event, and the body moves
 * 200vh down, out of the viewport (an IntersectionObserver sees it leave).
 */
/**
 * A page learns it is off screen a frame late, and an IntersectionObserver is told later still: the last rAF callback of a
 * page that pauses by the observer alone ran 36 to 70 ms after the body moved, over 30 runs of a live page in Chromium (40
 * to 75 ms in an earlier review). So frames that run this soon after the page goes off screen do not count; the window
 * starts 25 ms past the slowest delivery seen. The rules let a page pause by the observer alone.
 */
export declare const PAUSE_GRACE_MS = 100;
export declare const rules: KindRule[];
