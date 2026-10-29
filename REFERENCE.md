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

A page's gate sorts a value as a designed loop in one way for every rule: it repeats at one period of 0.5 to 7.5 s after
a lead-in of at most 2 s from when it first moves, or it starts the same way at a fixed period of 0.5 s or more and keeps
its range, or it moves at one steady speed. A step each period counts only for an angle (`deg`); in any other unit a step
or a growing or shrinking swing each period counts only while it adds up to less than the unit's floor over the read. A value
at a steady speed is a loop when, with a first cause (a tap, or the first input sample), it ends at the same steady speed
when the page is read with no input and holds it there from the end of its lead-in, or, with no cause, holds it from the end of its lead-in. A cycle shorter than
250 ms (a buzz) and a swing that takes longer than the lead-in to settle are no loop: the value must come to rest.

The gate waits for a page to stop; it does not read a fixed window. A live or scroll page is read until its sequence ends
(the last move of a value that is no loop, up to 15 s past the input) and a second more, so a toast that holds 4 s or a
blank beat is read whole. The page is at rest when every value that is no loop, on a page with a loop too, has changed by
no more than its unit floor over the last second, and each such value lands where its `?seek` frames end, within its unit floor, on either side: a value that stops short of it fails, and so does one that runs past it. The off-screen
check takes a page off screen only once its sequence is at rest and its loop's value moves (a loop that starts late is waited for),
and coming back is checked on values: the loop keeps moving, and a sequence the page left in the middle goes on to its end.

A page draws its random values from a seeded stream, the same in live play as under `?seek` (reseeded where each sequence starts), so a live run lands where its `?seek` frames end. Known limit: a page that draws unseeded random values live can fail the rest compare.

```js
function seeded(seed) { // any small seeded generator
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEED = 12;
let rand = seeded(SEED);
function startBurst() {
  rand = seeded(SEED); // where the sequence starts: live and under ?seek draw the same values
  return Array.from({ length: 6 }, () => 80 + rand() * 160); // distances of 80 to 240 px
}
```

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
example for that type uses. When the example is in `bars/`, the line also names it, as in
`at base (<example>: 4.0 s)`. The distance is information, and it never changes the exit code:

```text
live.release.visualDuration 0.3 s, 27% above base 0.235 s
live.release.bounce 0.1, 38% below base 0.16
idle.period 6.0 s, 50% above base 4.0 s
scroll.smooth 0.2 s, 20% above base 0.167 s
scroll.maxStep 0.05 s, at base 0.05 s
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
type must do), `dial-set.json` (every feel number a reference example of that type is tuned by,
each with what it means) and `dials.json` (each setting you can change in `motion.json`, its base
and the reference example that sets it). A setting is a dial-set entry made public. Your AI coding tool reads them from
`node_modules/motion-kit/`. `AGENTS.md` in the same folder tells it how.

To check a reference example's folder against its contract, run this from any folder. It reads `bars/moments.json`
and `kinds/` from the kit itself:

```bash
pnpm exec motion-kit validate-bar bars/<slug>
```

It prints `bars/<slug> is valid.` and exits 0. It exits 1 and lists every problem when
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

Before it judges a page, the gate checks its own reading of the page. One of those checks, sudden
jumps, fails a value that moves in one frame step what it should spread over the step. It runs on every
page, as the `suddenJumps` rule of each kind's gate, and on every example. It seeks every step that moves
a visible share of its range (5%), or more than 2.5 times the larger frame step beside it, at eight even
sub-steps, and the eight sub-steps before and after it, and judges spans of 1, 2 and 4 sub-steps that
overlap the step. A span may cross the frame edge. The step fails when a span moves more than 2.5 times
the larger of the two spans of the same width beside it, and carries at least a third of the step's
change. A kink of a fraction of a pixel in a measured value, such as the centre of a cloud of grains, is
no jump. A jump stands out at the width it lands in: a hold, a 40 px tween of a few milliseconds and a
hold lands in one to four sub-steps, and fails at each offset. An ease, a spring or a speed corner
changes gradually, so each of its spans has a neighbor of about the same size and passes. So does a shake
that puts more than half of a leg in one frame: its sub-steps are smooth. So does a cusp, however much it
stands out: circInOut has a square-root cusp at its midpoint, and cubic-bezier(1,0,0,1), a plain CSS ease,
a cube-root one (the speed has no bound at one point, and no jump). Their spans stand out from their
neighbors by 2.6 to 2.9 and by 4 to 5, and a steeper cusp stands out by more, so no cap on that ratio can
tell a cusp from a jump. What does is the largest change in a window of the step as the window is cut in
half: the step is seeked at 256 sub-steps, and 32 more past each end of it, and a window that overlaps the
step slides over them, 1/8, 1/16 and 1/32 of a frame wide (so a cusp in the last or first tenth of a frame
is read whole). A jump keeps its size (0.98 to 1.0 of the one before in a smooth move; 0.86 then 0.92 for
the smallest jump examined), a cusp's shrinks (0.71 for a square root, 0.80 for a cube root, 0.84 at the
most). The step shrinks as a cusp does when its largest window falls to 0.88 of the one before at both
halvings. A tween of a few milliseconds shrinks too (0.5), so a span as wide as the one that stood out,
centred on the step's steepest sub-step, is also seeked at 128 sub-steps: the largest change in 2 of them
against the largest in 8 is 0.40 to 0.67 for a cusp and 0.25 to 0.33 for a smooth tween (its speed is
bounded), and at 0.36 or more the speed has no bound. A hold, a jump and a hold has no neighbor, and a jump
keeps its size as the window narrows.

A cusp whose speed has no bound passes where the value leaves a hold or reaches one: an ease-out or an
ease-in at a vertical tangent, such as cubic-bezier(0,1,0,1), circOut or circIn, where the value is still
(within 1/10000 of its range) for a frame up to the cusp and still moving a frame after it, or still for a
frame from it and moving a frame before it, read at both ends and the middle (so a flick of 2 to 10 ms,
back at rest a frame later, is no ease-out and no ease-in; the cusp may sit just past the frame's edge), and where the value turns at it: it runs one way for a
frame into the cusp and back for a frame out of it, as out on circIn and back on circOut does (a bounce). Any
other step that shrinks as a cusp does passes only as the middle of a steep ease:
a true cusp (circInOut, cubic-bezier(1,0,0,1)), or the straight middle of cubic-bezier(x1,0,1-x1,1) with x1
from 0.9 to 0.995, which is often far narrower than a frame. That middle is the top of one bell. Each frame
step beside it moves the same way, at least 0.02 of the step and at least 1.25 times the step beyond it:
the ease's flanks carry 0.115 to 0.59 of the step at any range from a scale of 1 to 1.02 to 5000 px, and
fall away by 1.30 to 2.7 at any phase from 150 to 1200 ms (1.30 is a square-root cusp's); a flick's tails
carry at most 0.0063 of its step, a hold beside a flick moves 0, and beside a tween inside a steady move
the step beyond moves as much (1.0 to 1.07). And it bends smoothly into its flanks: a window that slides
over the three frames, halved from two frames to 1/16 of a frame, keeps no more of the change at each
halving than at the one before, give or take 0.02. The ease keeps less each time (0.73 to 0.84 at the first
halving, 0.51 to 0.76 at the last); a tween on the flank or the top of a fast ease holds its size once the
window covers it, so a halving keeps more than the one before. So a flick of 2 to 20 ms on an eased curve
fails, circInOut and cubic-bezier(1,0,0,1) included: in a hold, as a recoil out and back, or one way inside
a steady move. The jump sweep (test/jump-sweep.test.ts) reads this rule on 1,413 motions at 64 start phases
a frame each, with no browser, and every honest one passes at every phase but the known limits below.

A step of at most the value's unit floor is too small to see and is not examined, and a value whose whole
range is within its unit floor is still (float noise of 1e-5 px, a 1/64 px snap). A NaN frame fails its
value. Under input, the one step in which a press lands or a scroll burst starts is left out (a thumb that
jumps to the press, a toast that shows on the first scroll tick: the response is out of proportion to the
input's step, and the input has no pace yet), and a step in which the pointer or the scroll moves is left out when the value moves
about as far per px of the input as it does in its other input frames: a value that follows the hand
one to one, or a raw scroll-linked value held between scroll samples, passes, and two lurches in a row do
not excuse each other (a value that follows the hand at a steady speed and stops dead the frame after is a
speed corner and passes). A page that moves a value in whole frames only shows a hold and a jump at every
frame, so a run of four frames of that is skipped with a `note:` line; one teleport on such a page still
fails. A value that a stepped drawing moves on purpose must be named in a bar's `stepped`; on any other
page its drawings are jumps.

Known limits. A tween of a frame or two is a jump at 60 fps that the sub-steps may not tell from a fast
ease (a flick that comes home on legs of 2 frames or less is judged for a pop by the envelope instead);
sharp eases under 63 ms are the same edge. In the jump sweep, at 64 start phases a frame: a linear tween of
20 ms is smooth at the sub-steps and passes at every phase, in a hold, inside a move or as a recoil. A
flick of 20 ms that leaves or reaches a hold at a vertical tangent (circOut, circIn) lasts more than a frame,
is still moving a frame past its cusp and passes as an ease at 46 and 45 of 64 (the same flicks of 2, 5 and
10 ms fail at every phase), and a recoil out on circIn in 10 or 20 ms turns at one and passes as a bounce at
47 or 46.
A flick of 40 px at the top of a fast ease-in moves about as much as the ease's own frame steps and is often
not examined (19 of 24 such cases pass at 4 to 64 of 64). A cubic-bezier(0.98,0,0.02,1) tween retargeted from where it
is at u = 0.5 or 0.53 (an interrupted transition) stops dead at its fastest and passes at 0 to 50 of 64.
Penner's and GSAP's expo.in and expo.out leave or reach rest with a true jump of 2^-10 of the range, and
expoInOut with 2^-11: over 5000 px, 600 to 1200 ms, that is 2.4 to 4.9 px, and it fails at every phase. A
snap of 10 to 40 px on a steep in-out ease, planted at u = 0.2 to 0.8 on 15 eases (cubic-bezier(x1,0,1-x1,1)
for the ten values of x1 from 0.83 to 1, cubic-bezier(0.9,0,0.4,1), cubic-bezier(1,0,0.5,1), expoInOut,
circInOut and quintInOut): at u = 0.5, 30 of 45 cases pass at 6 to 64 of 64 (the snap is read as part of the
ease), and at the other u 45 of 270 pass at 2 to 64 of 64, 43 of them 10 px snaps too small beside the ease's
own steps to be examined. A snap where an ease leaves or reaches a hold at a vertical tangent is read as part
of the cusp (10 of 12 such cases pass at 54 to 64 of 64). A 10 px snap at the start or end of an ordinary ease
is often not examined (3 of 36 such cases, on linear and cubicOut, pass at 16 to 58 of 64). A flick of 120 px
in 2 to 20 ms inside a move of 3000 px over 2000 ms (25 px a frame, under 5% of the move) is missed at some
phases: linear at 5, 11, 21 and 64 of 64 (2, 5, 10 and 20 ms; a flick that falls across a frame edge puts
about half of it in each frame, and neither stands out), circInOut at 2 to 14, and cubic-bezier(1,0,0,1) at
1 to 6. A snap of 20 px in the middle of a move of 1000 px (a cubic in-out over 600 ms, about 42 px a frame
there) passes at 64 of 64. In a probe of 1,296 tweens of 2 to 10 ms placed across each ease, the
rule misses 163 on cubic-bezier(0.98,0,0.02,1), 361 on (0.9,0,0.1,1), 103 on (1,0,0,1) and 147 on
circInOut, most of them on the ease's middle. A swing that crosses home as |s|^0.2, a cusp far steeper than
any ease's, tops one bell as an ease does and passes at every phase. A move rounded to whole pixels shows a step of 1 px beside a hold at the slow end of an ease; every sub-step of it looks like a 1 px snap on a still value, so it fails. A raw scroll mapping or a rubber band under a drag whose gain changes by more than 2.5 times across the input does not keep the input's pace, and a hand-written spring that integrates whole frames fails where its steps turn small; the size test does not reach any of these. A jump that opposes the move it
sits in cancels part of itself in the frame step, and one that is less than 2.5 times the steps beside it
in a move whose steps are all large (one frame at double speed in a 30 px a frame move) is not examined.
A grab pop in the step a press lands in is not examined, and one of up to 2.5 times the pointer's step passes under a drag. A measured value that jumps for
real (an unweighted centre of grains that die one by one) is a wrong value: weight a centre by what is
drawn.

A copied example's `trace.json` may carry optional fields the gate reads: `cuts` (times in ms where a
value may jump; a cut is a scene change, or a small cut that changes only pixels the page's `objects`
cover in the frame before it and the cut frame, such as a part that snaps into a slot, a light that
flips colour or a panel that appears in one frame), `stepped` (values held in drawings on purpose, judged at the drawing rate) and
`tweens` (values that act out a control's meaning with a keyframe tween beside a sim page's bodies,
such as a tile that bobs as it is tapped). Only a sim page may name tweens: on any other kind a
non-empty `tweens` fails. A value in `tweens` is left out of the sim rule that no body gains speed
but under a steady pull (`energyFalls`). The gate guards the name: it must be a value the page
reports, it must change, after every cause it must end where it was just before that cause and hold
there, and inside each cause its swings (peaks, as distance from home) never grow. Every other rule
still reads it.

A fourth optional field, `extents`, names values that are an edge of many moving parts, such as
the box around 24 cards on one canvas: `"extents": { "top": { "edge": "top", "parts": ["card0", "card1", ...] } }`. `edge` is one of
`top`, `bottom`, `left`, `right`, `width` and `height`, and `parts` lists 2 or more objects the page
reports in `__state().objects`. Such a value turns when another part becomes the extreme one, not
because a body passes its rest, so the envelope's pulse attack bound and the `overshoot` rule leave
it out. The gate guards the name: the value must be a `px` value the page reports, and in every frame
where a part is drawn it must equal that edge of the union of the drawn parts' boxes (within 0.5 px),
with 2 or more parts drawn in most of those frames. The edge must pass from one part to another at
least once, and no part may turn round (go one way and then back, by 0.5 px or more, along the edge's
own coordinate) and then come to rest while it holds the edge, so a single body cannot be named, with a
decoy beside it or without, however it drifts across the edge: a turn made by one part that then rests
is a body passing its rest, and the value is then judged in full. (A turn made while three parts or more hold that side in turn, within 1 s before or after it, is the edge of a group and is not read; three holders at another time excuse nothing. A body hidden beside two decoys that each take the edge in turn within that second of its turn is not found, a known limit.) Pops, fades and every other rule
still read it, except that a frame step where a part comes back or goes gone is read as the edge of the
parts drawn in both frames moved it, since the edge then jumps because who is in the union changed. A
part drawn in both frames that jumps in that step is still a pop, and `suddenJumps` leaves the step out only when that change is under 5% of the value's range. Every other value on the page is
judged in full. A part that is not drawn reports a box of 1 by 1, as any object does, so the value
must leave it out of its edge.

Known limits of the other gates, by rule. Each is a gap that is left as it is. "Fails" means a correct page fails; "passes" means a broken page passes.

- Loop sort. A cycle shorter than 500 ms is no loop, so a designed shimmer or vibration of 155 to 180 ms is a buzz that must come to rest. A lead-in longer than 2 s is no loop: a slow exponential slide with a 3.1 s bob on one value, a spring that settles over 2.55 s before a 2 s breath, and a bouncy spring still 0.033 off at 2 s before a 1.6 s breath all fail. Smooth motion with no one period of 0.5 to 7.5 s is no loop: two unrelated sines (6 px at 1.3 s plus 4 px at 2.1 s repeat only every 27.3 s), and a breath of 8, 9 or 10 s, must come to rest. A bounce that loses no energy repeats at a fixed period with equal peaks, so it is a loop, and the gate cannot tell it from a designed bob. A creep of 12 px a second from load that never stops is a loop too, as a marquee is, because the sort cannot know the page's intent. A value in `deg` whose rest angle walks 3 deg each cycle counts as a ticking hand. A loop that stops dead mid-swing and holds (a 40 px bob that halts at its fastest, 168 px a second, after 4 cycles) passes, because no rule tests a sudden stop. The read ends 17 s from the first move, so a bob that freezes at 17.5 s, or a breath that snaps off at 20 s, is not seen to end. On an idle page a value that is no loop is not asked to rest, so a float of two sines, a 10 s float, a bob that sinks a little each cycle, and a spring that never settles (damping ratio 0.01, still 5 px wide after 10 s) pass there.
- Wraps and steps. A value that wraps or steps on purpose reads as a pop on a page that cannot declare it, and fails the envelope and `suddenJumps`. A bar names its stepped values in `stepped`; any other page has no way to. The wrap of a CSS marquee (translateX from 0 to -50%: 299.167 px in the frame after 6000 ms, or a 400 px tile at 80 px a second that wraps every 5 s), a skeleton shimmer whose 600 px reset happens off its box, a spinner on `steps(12)` (30 deg every 83 ms), a quartz second hand that jumps 6 deg once a second, a blinking caret, and the opacity restart of Tailwind's `animate-ping` all fail. The same marquee reported as an unwrapped offset passes.
- Jumps, besides those above. A jump spread over a whole frame by render interpolation has an equal neighbour at every sub-step and passes (79 px against 18.3 px before it, 4.3 times); a tween of 15, 17 or 25 ms with a 60 px jump in a fall of 79 px frame steps passes, and one of 8 or 12 ms is found. A 200 px move done as one 16.7 ms tween that starts half a frame in reads 100 px then 100 px on the grid and passes; shifted by 0.03 ms, it fails the envelope. A page that moves a value in whole frames only is skipped with a note, so a 60 px teleport mid-fall in fixed-step physics with no interpolation (79 px against 17.5 and 19 px beside it) passes. A ball on fixed 1/120 s physics steps with no interpolation fails, because half of each frame's change lands in one sub-step (15.625 px in the frame after 550 ms, 7.708 px in its first half). The gate reads the frame grid at start phase 0, so a glitch between two frames is never seen: a 20 px flick up for 10 ms, or a 60 px teleport for 10 ms, in each 2 s loop passes, though a 120 Hz screen shows it every cycle. A step is examined by its net change, so a jump against the motion hides: a slip of 10 px back in a move of 3 px a frame (net step -7 px, 2.33 times the steps beside it, under 5% of the range), a lurch of 55 px for 2 frames at the top speed of a 2000 px move (2.26 times its neighbour, 4.9% of the range), and a 16 ms flick of 110 px across a frame edge in a 2000 px move (about 95 px against 43.6 px elsewhere) all pass. The press-frame and scroll-burst-start exemptions cover every value, not only the ones the input drives: an ambient 60 px bob whose clock a tap restarts snaps 19.74 px home in one frame, and a header that hides in one frame (0 to -64 px) on the first scroll tick, and both pass. Two scroll lurches excuse each other when theirs are the only two frames that carry a gain (a value that jumps 500 px as the scroll passes 150 px and jumps back when it returns).
- Rest and off screen. A value that comes back to where it started cannot be told from one that never played: a toast that slides in, holds 4 s and leaves, or fades 0 to 1 to 0, passes when the live page never shows it. A unit with no floor gets 1% of its range, so a count-up from 0 to 10000 that stops at 9920 passes. The read ends 15 s past the stop, so a toast that holds 16 s on a timer and never leaves live passes. The gate waits for the `?seek` sequence to end, so a live beat more than about 1.1 s longer than the seeked one (a reply that waits 2.4 s live and 1 s seeked) reads as mid-beat and fails. A fling whose exponential tail moves less than 0.001 px per 50 ms counts as quiet while the page is still 0.01 to 0.02 px from its snap, and a spring that ticks 0.0001 px for 3 frames past its rest counts as moving, so both fail. A chip that hops 3 px every 1.2 s beside a loop passes, because the quiet second between hops reads as rest. `pausesOffScreen` and `resumes` run only for loops. A page with no loop that pauses when hidden and never resumes passes. A page that restarts only its loop on return passes when a delayed toast has not begun at the trip, because the toast rests where it started either way. A catch-up burst on return (0.3 s of missed time played at 5 times the speed for about 75 ms) passes, because `resumes` checks that a frame runs and the loop moves, not how fast.
- Reduced motion. A live page may change nothing more than a frame after the input changes, so a toast that holds 4 s, appears in one frame 0.3 s after the release and leaves in one frame after its hold, as a choreo page may, fails. A loop must hold still, so an opacity pulse that keeps running because Motion's own reduced setup (`<MotionConfig reducedMotion="user">` drops transforms and keeps opacity) fails.
- Live regrab. The rule does not take a loop's own swing off the value, so a dragged dot that also floats with a 3 px, 0.8 s bob fails the press; report the bob as a value of its own.
- Scroll `reverses`. `reverses` reads a loop like any other value, so a scroll page with a loop value passes or fails it by the loop's phase when the scroll turns (a scale breath of 0.1 passes at periods of 1.3, 2 and 3.1 s, and fails at 2.7 s: it moves 0.092 while the page scrolls down, then -0.021 when it scrolls back).
- Tween guard. At 60 fps a shake with equal peaks reads its peaks up to one frame's travel apart, so it can fail `swings further from home` (a linear shake whose peaks read 8.333 then 9.167 px fails, and so does one that reads 28.252 then 29.953 px). A shake that ramps up by design (1, 2, 4 px) fails the same way, named or not (0.989 then 1.946 px). A named body that gets a push in mid-air which raises no later peak passes (a push of 5.556 or 8.889 px of speed in one frame).
- Interrupt (a choreo page). A value that only the control moves (a row that collapses on delete, a like that fills, an add to cart) has a jump bound of its clean run's largest step, often 0, so it fails: a row collapse of 5.388 px in one frame against 0. The rest press lands at the centre of the control's box. It misses a control that depends on where it is pressed (a scrubber: the thumb rests at 440), a ring's hole, a control off screen and one that is hidden, so those pages fail; and the page's background counts as a control, so a frozen sequence behind a floating button whose centre hits an unrelated button passes. A control at opacity 0 still takes the press and excuses a frozen sequence. A value the page reports only after a press is not checked. A rest is matched value by value, so a split state (some pieces docked while the others finish, a backdrop gone while the panel opens, one bar out and two never arrived) passes. A stalled answer from the control matches its own toggle run: a second tap that fades a toast out only to 0.5 passes. A peek that holds 2.5 s at rest becomes a reference rest when it is pressed mid-move, since a hold longer than the longest beat (1500 ms) is a rest. The hit test reads the exact press time, not the last drawn frame as a browser does, so a page that hit-tests its last drawn frame fails. A control drawn on a canvas is not an element, and a control inside a shadow root or an iframe is not seen either (the hit test stops at an open shadow host and at an iframe), so the gate does not see them and such a page fails with a piece stuck halfway.
- Extents. Honest pages that fail: a ring of 5 or 8 cards that turns one slot rests with 2 cards straddling an extreme, so a card that crosses the apex counts as turning round; a staggered list, a carousel, chip reflow and a notification stack hand the edge over only through membership steps, so the guard reads one holder throughout; a fast spark burst's membership step is judged raw past the 5% share; a stack that spreads starts in a tie, and the holder picked depends on the order of the parts in `trace.json`; and a caused spring past its slot fails the extents rule though `overshoot` would allow it. Faults that pass when declared: a part that goes gone for one frame and comes back 800 px away, or the same card remounted under a second name; a reflow that snaps every staying chip 25 px, inside the 5% share of an inflated range; a 30 Hz blink of the holder; a jolt, or a soft spring, that rests 0.6 px inside a still neighbour; one card drawn as 3 aliased layers, which is one object with one box; and an overshoot whose apex is handed between two names.
- Listed cuts. A cut written to 3 decimals (1233.333 for frame 74) reads the step a frame early and sees no change, so it fails with "the cut at 1233.333 ms changes 0% of the view"; write the exact frame time. A cut listed in the middle of ordinary motion hides a teleport inside the moving part's boxes (a 167 px skip in a slide), and one cut excuses a jump of every boxed part (a cut on a light that excuses an 80 px jump of a card). A scene change is 3 times the most any other pair changes, so on a page whose other motion is slow or small any glitch counts as one. A cut on a frame where nothing changes passes on any moving page, and its exemption of the 2 frames before it hides a teleport there. Only the first 16 cuts are read, though every listed cut exempts its frames, so a glitch behind the 17th cut of a ticker passes; 13 cuts listed on a stutter's catch-ups pass; and a 2-frame full-view white flash with both edges listed passes. A 3-frame blink whose second cut falls in the first cut's onset window fails the envelope. A page that reports no objects is not read for its cuts, so a small cut there passes whatever it changes.

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
