import type { MotionConfig } from "../src/core/types.ts";
/** `feel` is the selected lane. A lane with no engine numbers (a preview-only candidate) plays sleek, and the rows say so. */
interface Opts {
    cfg: MotionConfig;
    feel: () => string;
    reduced: () => boolean;
}
/** Three rows that play the selected feel's "move": DOM (Motion), three.js (tween) and a Blender clip. */
export declare function mountEngines(root: HTMLElement, opts: Opts): {
    play(byTouch: boolean): void;
};
export {};
