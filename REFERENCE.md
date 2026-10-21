# motion-kit reference

For calling motion-kit from your own code. Some code names are older than the words here and
change in the next version: a preset is `feel`, a transition is `move`, a setting is `knob`, a
reference example is a bar (`bars/`), and a type of continuous motion is a `kind` (`kinds/`).

Each transition is two numbers: `visualDuration` (seconds until it looks done) and `bounce` (0 to 0.4).
Every call says `byTouch`. Without a touch, bounce is 0.

Install `motion` (for React and the DOM), `three` (for three.js), or both, next to motion-kit.
The Lab needs both.

## React or DOM, with Motion

```tsx
import { resolve } from "motion-kit";
import { transition } from "motion-kit/motion";
import overrides from "./motion.json";

const cfg = resolve(overrides);
<motion.div animate={{ x: 200 }} transition={transition(cfg, "sidebar", "move", { byTouch: false })} />
```

Wrap the app in `<MotionConfig reducedMotion="user">`. Motion then drops travel on its own.
Motion does not read each transition's `reduced` or `reducedFade`. For that, call `useReducedMotion()`
and pass `reducedTransition(cfg, feel, move)` as the transition. It returns
`{ duration, ease: "linear" }`: duration 0 for `instant`, `reducedFade` for `fade`.

Two helpers work in every engine. `flatTx(cfg, feel, move)` gives the bounce-0 spring for
opacity, color and shadow. `staggerOf(cfg, feel)` gives the stagger in seconds.

## three.js

```ts
import { tx } from "motion-kit";
import { tween } from "motion-kit/three";

tween({ from: mesh.position.x, to: 3, spring: tx(cfg, "sidebar", "move", { byTouch: true }),
  reducedFade: cfg.reducedFade, onUpdate: (x) => { mesh.position.x = x; } });
```

To change course mid-flight, call `retarget(to, spring)` on the tween with the new transition's
spring. It keeps the current position and speed, so the motion bends instead of jumping.

## Blender

```bash
pnpm exec motion-kit resolve --out motion.resolved.json
```

Then, in a Blender script, `from motion_bake import load_resolved, move_for, bake_property` from
`node_modules/motion-kit/blender/`. Set new keys to LINEAR first.

## The numbers file

`motion.json` holds only your changes. Everything else comes from the kit's defaults, so an
upgrade brings new defaults and your changes still win. Add your own preset with `extends`, and
map parts of your app (here `sidebar` and `dialog`) to presets with `use`:

```json
{ "feels": { "playful": { "extends": "whimsical", "moves": { "tap": { "bounce": 0.25 } } } },
  "use": { "sidebar": "calm", "dialog": "playful" } }
```

`pnpm exec motion-kit validate` checks the file. It rejects a misspelled key (`bouce`), a wrong
shape (`"feels": []`) and a value out of range, and lists every problem at once. Exit codes:
0 valid, 1 invalid config, 2 usage or file error.

## Continuous motion and settings

Continuous motion keeps going: `live` (pointer-follow, drag and release), `idle` (idle loop) and
`scroll` (scroll-linked). A setting is one named number for one type. This release has four:

- `live.release`: the spring a part uses when you let go (`visualDuration` and `bounce`).
- `idle.period`: seconds for one loop.
- `scroll.smooth`: seconds the scroll takes to catch up with the wheel.
- `scroll.maxStep`: the longest time step, in seconds, that one frame may cover.

Settings live in a version 2 `motion.json`. Set `"version": 2` and add `kinds`. A version 1 file is
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

`pnpm exec motion-kit validate` accepts this file. A setting has no ceiling and no floor. It rejects
only a value that cannot run: not a finite number, zero or below for a time, and a `bounce` outside
0 up to (not including) 1. It also rejects a setting it does not know. After the `is valid.` line,
`validate` prints how far each setting sits from its base. A base is the value the kit's reference
example for that type uses. The distance is information, and it never changes the exit code:

```text
live.release.visualDuration 0.3 s, 27% above base (13-drag-past-a-threshold: 0.235 s)
live.release.bounce 0.1, 38% below base (13-drag-past-a-threshold: 0.16)
idle.period 6.0 s, 50% above base (31-breath-pacer: 4.0 s)
scroll.smooth 0.2 s, 20% above base (04-scale-as-camera: 0.167 s)
scroll.maxStep 0.05 s, at base (04-scale-as-camera: 0.05 s)
```

`pnpm exec motion-kit knobs idle scroll` prints the resolved values for those types as a block
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

## Reference examples

A reference example is a finished page for one type of motion, kept in `bars/`. `bars/INDEX.md`
lists them by moment, such as an idle stretch or a drag and release. Each entry says what the
example feels like, when it fits and when it is wrong. An example's folder holds `index.html` (one
file, no build step), `bar.json` (its contract, its settings and its asset contract), `notes.md`
(how to reuse it) and `trace.json` (the values the page must match). Its fonts sit in `fonts/`.

Each type of continuous motion has a folder in `kinds/` with `rules.md` (what every page of that
type must do) and `dials.json` (each setting, its base and the reference example that sets it). Your AI coding tool reads them from
`node_modules/motion-kit/`. `AGENTS.md` in the same folder tells it how.

To check a reference example's folder against its contract, run this from any folder. It reads `bars/moments.json`
and `kinds/` from the kit itself:

```bash
pnpm exec motion-kit validate-bar bars/04-scale-as-camera
```

It prints `bars/04-scale-as-camera is valid.` and exits 0. It exits 1 and lists every problem when
the folder breaks the contract, a `trace.json` the example check cannot play included. It exits 2 when
an example file is missing or is not valid JSON, or the path is not a folder it can read.

## Gates

`pnpm exec motion-kit gate <page.html>` runs the gate on one page. It opens the page in a
headless browser, steps its clock, plays input and checks the rules in that type's `rules.md`. It
needs Playwright: `pnpm add -D playwright && pnpm exec playwright install chromium`.

The command prints `passed`, `partial` or `failed: n`. Exit codes: 0 passed, 1 failed or partial,
2 when the page cannot be read or the gate cannot start. A partial run is not a pass.

`pnpm exec motion-kit sheet <page.html> [--out sheet.png] [--samples 8] [--to ms] [--full]` draws
the page at evenly spaced times from 0 to the span the gate reads (or `--to`), with the input the
gate plays, and saves the frames as one labelled PNG grid. The frames are cropped to the area where
pixels change, unless `--full`. It also needs Playwright. Exit codes: 0 written, 2 when the page
cannot be read, Playwright is missing, or the page has no `window.__seek`.

A page names its type of motion with `<meta name="motion-kit-kind" content="idle">`. A page
copied from a reference example keeps `<meta name="motion-kit-bar" content="<slug>">`. The gate
then reads the type from the example's `bar.json`, so copy `bar.json` and `trace.json` into the
same folder as the page. The audit skips its literal check only for a copy of one of the kit's own
reference examples: the slug names one in the kit, and the page's `MOTION` block is that
example's, byte for byte. Any other page gets the check,
and the gate prints a `note:` line that says why.

The example check is a second check. It compares a reference example's page to its own
`trace.json`. It has no command:
it runs in the kit's repository with `pnpm test:bars`.

### The objects a page reports

A page may report the things on screen that its values move. `window.__state()` returns an
optional `objects` map next to `values`:

```js
window.__state = () => ({
  values: { dotY },
  objects: { dot: { box: [x, y, w, h], moves: ["dotY"], halo: 12 } },
});
```

- `box` is `[x, y, w, h]` in CSS px of the viewport, for the frame `window.__seek` just drew. For a
  DOM element, read it from `getBoundingClientRect()` after drawing. A page that draws on a canvas
  works the box out itself.
- The box is the smallest box that holds what is drawn. Leave out shadows and glows. `w` and `h`
  are at least 1, and all four numbers are finite. A box may reach past the viewport, as
  `getBoundingClientRect()` gives it: the gate clips it to the viewport.
- `halo` is optional: how far the object's ink spreads past its box, in px. A shadow, a glow, a
  blur, an outline, an SVG stroke and a glyph's overhang all spread past it. It is 4 unless set,
  and a finite number of 0 or more. It counts for at most 16 px or the object's length (the larger
  of `w` and `h`), whichever is larger. `getBoundingClientRect()` leaves out shadows, outlines, SVG
  strokes and glyph overhang, so a DOM page adds their reach here.
- `moves` lists the names of the values that change this object: its place, size, shape or look.
  A value belongs to at most one object. Each name must be a key of `values`.
- The set of objects stays the same in every frame. An object that is not drawn in a frame reports
  a box of `[x, y, 1, 1]`, and the gate skips it for that frame. An object that a clip hides
  (`overflow: hidden`, a mask) is not drawn, so it reports that box too. A box wholly outside the
  viewport also counts as gone.
- An effect that no value moves, such as rays or a drawn cursor, is an object with `moves: []`.
- A value in unit `px` must move its box. An ambient object, whose box grown by its halo covers more
  than half the viewport, is left out: a background that pans inside its still box changes its look,
  not its place. A box that jumps far, all at once, needs a value in its `moves` that changes in that
  frame, is not an `index`, and explains the jump. The kind gate's `objects` rule checks both
  (`kinds/<kind>/rules.md`).
- The kind gate's `drawn` rule screenshots pairs of frames and checks that the boxes hold what
  changes on screen. So once a page reports objects, every drawn thing that moves needs a box. A
  background that moves on its own is an object too: its box covers more than half the viewport,
  and the rule reads it as ambient (`kinds/<kind>/rules.md`).

Without `objects`, the gate reads the page as before.

## Project moments

Put `motion-lab.moments.ts` (or `.js`) next to `motion.json`. Export `moments`: an array of
`{ move, label, mount(stage) }`, where `mount` returns `{ play(ctx) }`. A project moment
replaces the generic one for the same transition. In TypeScript, `import type { Moment } from
"motion-kit/lab"` gives the types.
