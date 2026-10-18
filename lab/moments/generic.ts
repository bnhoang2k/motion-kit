import { animate } from "motion";
import type { Moment, MomentContext } from "./types.ts";

type Keyframes = Record<string, number | number[]>;

function piece(stage: HTMLElement, label: string, css: Partial<CSSStyleDeclaration>): HTMLElement {
  const el = document.createElement("div");
  el.className = "piece";
  el.textContent = label;
  Object.assign(el.style, css);
  stage.append(el);
  return el;
}

const spring = (s: MomentContext["spring"], delay = 0) => ({ type: "spring" as const, visualDuration: s.visualDuration, bounce: s.bounce, delay });

/** Motion's animation handle is thenable but not a Promise. */
const finished = (a: { then(onResolve: VoidFunction): unknown }): Promise<void> => new Promise((done) => void a.then(done));

/**
 * Moves el, honoring reduced motion: jump, or jump and fade.
 * `opacity` is the target, or [from, to]. The reduced fade runs from `from` to the target (from 0 when only a target is given),
 * so an exit fades out instead of staying at 0. With no `opacity`, reduced motion is a jump.
 * `delay` applies to the reduced branch too, so staggered rows stay staggered.
 */
function go(el: HTMLElement, kf: Keyframes, ctx: MomentContext, opacity?: number | number[], delay = 0): Promise<unknown> {
  if (ctx.reduced) {
    const jump = finished(animate(el, kf, { duration: 0, delay }));
    // No opacity target: nothing here animates opacity, so reduced "fade" is a jump (as src/motion does).
    if (opacity === undefined) return jump;
    const to = Array.isArray(opacity) ? (opacity.at(-1) ?? 1) : opacity;
    if (ctx.reduced === "fade") {
      const from = Array.isArray(opacity) ? (opacity[0] ?? 0) : 0;
      return Promise.all([jump, finished(animate(el, { opacity: [from, to] }, { duration: ctx.reducedFade, ease: "linear", delay }))]);
    }
    return Promise.all([jump, finished(animate(el, { opacity: to }, { duration: 0, delay }))]);
  }
  const runs: Promise<unknown>[] = [finished(animate(el, kf, spring(ctx.spring, delay)))];
  if (opacity !== undefined) runs.push(finished(animate(el, { opacity }, spring(ctx.flat, delay))));
  return Promise.all(runs);
}

const tap: Moment = {
  move: "tap",
  label: "Tap",
  mount(stage) {
    const el = piece(stage, "Save", { left: "calc(50% - 48px)", top: "32px", width: "96px", height: "32px" });
    return { play: (ctx) => void go(el, { scale: ctx.amount }, ctx).then(() => go(el, { scale: 1 }, ctx)) };
  },
};

const enter: Moment = {
  move: "enter",
  label: "Enter",
  mount(stage) {
    const rows = [0, 1, 2].map((i) => piece(stage, ["Inbox", "Drafts", "Archive"][i]!, { left: "16px", top: `${8 + i * 28}px`, width: "160px", height: "24px" }));
    return {
      play(ctx) {
        rows.forEach((r) => void animate(r, { y: 24, opacity: 0 }, { duration: 0 }));
        rows.forEach((r, i) => void go(r, { y: 0 }, ctx, [0, 1], i * ctx.stagger));
      },
    };
  },
};

const exit: Moment = {
  move: "exit",
  label: "Exit",
  mount(stage) {
    const el = piece(stage, "Remove item", { left: "16px", top: "32px", width: "120px", height: "32px" });
    return {
      play(ctx) {
        void animate(el, { x: 0, opacity: 1 }, { duration: 0 });
        void go(el, { x: 160 }, ctx, [1, 0]);
      },
    };
  },
};

const move: Moment = {
  move: "move",
  label: "Move",
  mount(stage) {
    const el = piece(stage, "Tab", { left: "16px", top: "24px", width: "64px", height: "48px" });
    let right = false;
    return {
      play(ctx) {
        right = !right;
        const x = right ? stage.clientWidth - 96 : 0;
        if (ctx.fadeTravel) {
          // Candidate feel: no travel. Fade out, jump, fade back in.
          const half = ctx.reducedFade / 2;
          void finished(animate(el, { opacity: 0 }, { duration: half, ease: "linear" })).then(() => {
            void animate(el, { x }, { duration: 0 });
            return finished(animate(el, { opacity: 1 }, { duration: half, ease: "linear" }));
          });
          return;
        }
        void go(el, { x }, ctx);
      },
    };
  },
};

const attention: Moment = {
  move: "attention",
  label: "Attention",
  mount(stage) {
    const el = piece(stage, "T4", { left: "calc(50% - 24px)", top: "24px", width: "48px", height: "48px" });
    return { play: (ctx) => void go(el, { scale: ctx.amount }, ctx).then(() => go(el, { scale: 1 }, ctx)) };
  },
};

const celebrate: Moment = {
  move: "celebrate",
  label: "Celebrate",
  mount(stage) {
    const el = piece(stage, "Paid", { left: "calc(50% - 40px)", top: "28px", width: "80px", height: "40px" });
    return {
      play(ctx) {
        void animate(el, { scale: 0.6, opacity: 0 }, { duration: 0 });
        void go(el, { scale: 1 }, ctx, [0, 1]);
      },
    };
  },
};

export const genericMoments: Moment[] = [tap, enter, exit, move, attention, celebrate];
