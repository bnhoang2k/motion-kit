# motion-kit

One set of motion numbers for Motion, three.js and Blender.

Each move is two numbers: `visualDuration` (seconds until it looks done) and `bounce` (0 to 0.4).
Bounce only answers a touch. Every call says `byTouch`, and without a touch, bounce is 0.

## Install

    pnpm add github:bnhoang2k/motion-kit#v0.1.1

Add `motion` (for React and DOM) or `three` (for three.js), or both.
The Lab needs both `motion` and `three` installed.

## Tune a feel

    pnpm exec motion-lab

Tap a lane to play a move as a touch. Press "Server event" to play it without a touch.
Save writes only your changes to `motion.json` in the project folder. Commit it yourself.

## Use it

React or DOM, with Motion:

    import { resolve } from "motion-kit";
    import { transition } from "motion-kit/motion";
    import overrides from "./motion.json";

    const cfg = resolve(overrides);
    <motion.div animate={{ x: 200 }} transition={transition(cfg, "station", "move", { byTouch: false })} />

Wrap the app in `<MotionConfig reducedMotion="user">`. Motion then drops travel on its own.
Motion does not read each move's `reduced` or `reducedFade`. For that, call `useReducedMotion()` and
pass `reducedTransition(cfg, feel, move)` as the transition. It returns `{ duration, ease: "linear" }`:
duration 0 for `instant`, `reducedFade` for `fade`. three.js does the same.

Two helpers work in both engines. `flatTx(cfg, feel, move)` gives the bounce-0 spring for opacity,
color and shadow. `staggerOf(cfg, feel)` gives the stagger in seconds. `motion-kit/motion` also exports `staggerOf`.

three.js:

    import { tx } from "motion-kit";
    import { tween } from "motion-kit/three";

    tween({ from: mesh.position.x, to: 3, spring: tx(cfg, "station", "move", { byTouch: true }),
      reducedFade: cfg.reducedFade, onUpdate: (x) => { mesh.position.x = x; } });

To change course mid-move, call `retarget(to, spring)` on the tween with the new move's spring.
It keeps the current position and speed, so the move bends instead of jumping.

Blender (headless):

    pnpm exec motion-kit resolve --out motion.resolved.json

Then, in a Blender script, `from motion_bake import load_resolved, move_for, bake_property` from
`node_modules/motion-kit/blender/`. Set new keys to LINEAR first.

## The numbers file

`motion.json` holds only your overrides. The package ships four feels: calm, sleek, snappy and
whimsical. Add your own feel with `extends`, and map surfaces to feels with `use`:

    { "feels": { "guest": { "extends": "whimsical", "moves": { "tap": { "bounce": 0.25 } } } },
      "use": { "station": "calm", "tablet": "guest" } }

`pnpm exec motion-kit validate` checks it. It rejects a misspelled key (`bouce`), a wrong shape
(`"feels": []`) and a value out of range, and lists every problem at once. Exit codes: 0 valid,
1 invalid config, 2 usage or file error.

## Project moments

Put `motion-lab.moments.ts` (or `.js`) next to `motion.json`. Export `moments`: an array of
`{ move, label, mount(stage) }`, where `mount` returns `{ play(ctx) }`. A project moment
replaces the generic one for the same move.
In TypeScript, `import type { Moment } from "motion-kit/lab"` gives the types.
