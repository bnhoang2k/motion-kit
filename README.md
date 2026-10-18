# motion-kit

Make the animations your AI coding tool writes feel smooth, deliberate and consistent.

## What it does

When you ask an AI coding tool for an animation, it guesses the timing. It guesses again for the
next one. One button snaps, a menu drifts, and a list just jumps into place.

motion-kit removes the guess. Every animation in your project reads its timing from one file.

- **Pick a feel:** calm, sleek, snappy or whimsical.
- **Every animation follows it.** A tap, a menu that opens, a list that reorders: they all move
  like they belong to the same app.
- **Change one number, and the whole app follows.** Make it slower, faster or bouncier in one place.

## Use it with your AI coding tool

1. Install it in your project:

   ```bash
   pnpm add github:bnhoang2k/motion-kit#v0.2.0
   ```

   `v0.2.0` is the first release with bars and kinds. The tag exists once that release is published.

2. Add this line to your project's `CLAUDE.md` (for Claude Code) or `AGENTS.md` (for other tools):

   ```text
   For any animation, follow node_modules/motion-kit/AGENTS.md.
   ```

3. Ask for animations as usual. Your tool now starts from motion-kit's numbers and finished
   examples, not from a guess.

## Tune it yourself

```bash
pnpm exec motion-lab
```

This opens the Lab in your browser. Play each animation, change its numbers, and watch the result.
Save writes only your changes to `motion.json` in your project folder.

## Words you'll see

- **Feel:** a named set of timings, such as `snappy`. The kit ships four.
- **Move:** one kind of short animation. There are six: `tap`, `enter`, `exit`, `move`,
  `attention` and `celebrate`. Each move gets its timing from the feel.
- **Bounce:** how far a motion overshoots before it settles. motion-kit adds bounce only when a
  person caused the motion, such as a tap. A motion the app starts on its own does not bounce.
- **Kind:** motion that keeps going, not a short animation. Examples: something that follows your
  finger, a slow loop, or a scroll effect.
- **Knob:** one named number for a kind, such as how long one loop takes.
- **Bar:** a finished example page. Your tool copies it or adapts it, so it starts from something
  that already works.
- **Motion:** a JavaScript animation library, formerly called Framer Motion. motion-kit plugs into
  it for websites and React apps.
- **three.js:** a JavaScript library for 3D graphics in the browser.

## For developers

Each move is two numbers: `visualDuration` (seconds until it looks done) and `bounce` (0 to 0.4).
Every call says `byTouch`. Without a touch, bounce is 0.

Install `motion` (for React and the DOM), `three` (for three.js), or both, next to motion-kit.
The Lab needs both.

### React or DOM, with Motion

```tsx
import { resolve } from "motion-kit";
import { transition } from "motion-kit/motion";
import overrides from "./motion.json";

const cfg = resolve(overrides);
<motion.div animate={{ x: 200 }} transition={transition(cfg, "sidebar", "move", { byTouch: false })} />
```

Wrap the app in `<MotionConfig reducedMotion="user">`. Motion then drops travel on its own.
Motion does not read each move's `reduced` or `reducedFade`. For that, call `useReducedMotion()`
and pass `reducedTransition(cfg, feel, move)` as the transition. It returns
`{ duration, ease: "linear" }`: duration 0 for `instant`, `reducedFade` for `fade`.

Two helpers work in every engine. `flatTx(cfg, feel, move)` gives the bounce-0 spring for
opacity, color and shadow. `staggerOf(cfg, feel)` gives the stagger in seconds.

### three.js

```ts
import { tx } from "motion-kit";
import { tween } from "motion-kit/three";

tween({ from: mesh.position.x, to: 3, spring: tx(cfg, "sidebar", "move", { byTouch: true }),
  reducedFade: cfg.reducedFade, onUpdate: (x) => { mesh.position.x = x; } });
```

To change course mid-move, call `retarget(to, spring)` on the tween with the new move's spring.
It keeps the current position and speed, so the move bends instead of jumping.

### Blender

```bash
pnpm exec motion-kit resolve --out motion.resolved.json
```

Then, in a Blender script, `from motion_bake import load_resolved, move_for, bake_property` from
`node_modules/motion-kit/blender/`. Set new keys to LINEAR first.

### The numbers file

`motion.json` holds only your changes. Everything else comes from the kit's defaults, so an
upgrade brings new defaults and your changes still win. Add your own feel with `extends`, and
map parts of your app (here `sidebar` and `dialog`) to feels with `use`:

```json
{ "feels": { "playful": { "extends": "whimsical", "moves": { "tap": { "bounce": 0.25 } } } },
  "use": { "sidebar": "calm", "dialog": "playful" } }
```

`pnpm exec motion-kit validate` checks the file. It rejects a misspelled key (`bouce`), a wrong
shape (`"feels": []`) and a value out of range, and lists every problem at once. Exit codes:
0 valid, 1 invalid config, 2 usage or file error.

### Kinds and knobs

A kind is motion that keeps going: `live` (follows a pointer), `idle` (loops on its own) and
`scroll` (answers the wheel). A knob is one named number for a kind. This release has four:

- `live.release`: the spring a part uses when you let go (`visualDuration` and `bounce`).
- `idle.period`: seconds for one loop.
- `scroll.smooth`: seconds the scroll takes to catch up with the wheel.
- `scroll.maxStep`: the longest time step, in seconds, that one frame may cover.

Knobs live in a version 2 `motion.json`. Set `"version": 2` and add `kinds`. A version 1 file is
still valid, and it resolves as before. `kinds` is allowed only with version 2.

```json
{
  "version": 2,
  "use": { "sidebar": "calm" },
  "kinds": {
    "live": { "release": { "visualDuration": 0.3, "bounce": 0.1 } },
    "idle": { "period": 6 },
    "scroll": { "smooth": 0.2, "maxStep": 0.05 }
  }
}
```

`pnpm exec motion-kit validate` accepts this file. A knob has no ceiling and no floor. It rejects
only a value that cannot run: not a finite number, zero or below for a time, and a `bounce` outside
0 up to (not including) 1. It also rejects a knob it does not know. After the `is valid.` line,
`validate` prints how far each knob sits from its base. A base is the value the kit's bar for that
kind uses. The distance is information, and it never changes the exit code:

```text
live.release.visualDuration 0.3 s, 27% above base (13-drag-past-a-threshold: 0.235 s)
live.release.bounce 0.1, 38% below base (13-drag-past-a-threshold: 0.16)
idle.period 6.0 s, 50% above base (31-breath-pacer: 4.0 s)
scroll.smooth 0.2 s, 20% above base (04-scale-as-camera: 0.167 s)
scroll.maxStep 0.05 s, at base (04-scale-as-camera: 0.05 s)
```

`pnpm exec motion-kit knobs idle scroll` prints the resolved values for those kinds as a block
to paste into a page. With no `motion.json`, it prints the bases:

```text
/* motion-kit:knobs */
const KNOBS = {
  "idle": {
    "period": 4
  },
  "scroll": {
    "smooth": 0.166666666667,
    "maxStep": 0.05
  }
};
```

### Bars

A bar is a finished example page for one kind of motion. `bars/INDEX.md` lists the bars by moment,
such as an idle stretch or a drag and release. Each entry says what the bar feels like, when it
fits and when it is wrong. A bar's folder holds `index.html` (one file, no build step),
`bar.json` (its contract, its knobs and its asset contract), `notes.md` (how to reuse it) and
`trace.json` (the values the page must match). A bar's fonts sit in `fonts/`.

Each kind has a folder with `rules.md` (what every page of that kind must do) and `dials.json`
(each knob, its base and the bar that sets it). Your AI coding tool reads them from
`node_modules/motion-kit/`. `AGENTS.md` in the same folder tells it how.

To check a bar folder against its contract, run this from any folder. It reads `bars/moments.json`
and `kinds/` from the kit itself:

```bash
pnpm exec motion-kit validate-bar bars/04-scale-as-camera
```

It prints `bars/04-scale-as-camera is valid.` and exits 0. It exits 1 and lists every problem when
the folder breaks the contract, a `trace.json` the bar gate cannot play included. It exits 2 when a
bar file is missing or is not valid JSON, or the path is not a folder it can read.

### Gates

`pnpm exec motion-kit gate <page.html>` runs the kind gate on one page. It opens the page in a
headless browser, steps its clock, plays input and checks the rules in the kind's `rules.md`. It
needs Playwright: `pnpm add -D playwright && pnpm exec playwright install chromium`.

The command prints `passed`, `partial` or `failed: n`. Exit codes: 0 passed, 1 failed or partial,
2 when the page cannot be read or the gate cannot start. A partial run is not a pass.

A page names its kind with `<meta name="motion-kit-kind" content="idle">`. A page copied from a
bar keeps `<meta name="motion-kit-bar" content="<slug>">`. The gate then reads the kind from the
bar's `bar.json`, so copy `bar.json` and `trace.json` into the same folder as the page. The audit
skips its literal check only for a copy of one of the kit's own bars: the slug names a bar in the
kit, and the page's `MOTION` block is that bar's, byte for byte. Any other page gets the check,
and the gate prints a `note:` line that says why.

The bar gate is a second check. It compares a bar page to its own `trace.json`. It has no command:
it runs in the kit's repository with `pnpm test:bars`.

### Project moments

Put `motion-lab.moments.ts` (or `.js`) next to `motion.json`. Export `moments`: an array of
`{ move, label, mount(stage) }`, where `mount` returns `{ play(ctx) }`. A project moment
replaces the generic one for the same move. In TypeScript, `import type { Moment } from
"motion-kit/lab"` gives the types.
