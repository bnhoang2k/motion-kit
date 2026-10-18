# Live: rules

Every live page meets these rules. `motion-kit gate` checks each one, and each rule has a
planted-fault test that it must fail. Each failure line starts with the rule's name, shown in
parentheses below; the gate's own checks add `kind`, `audit`, `noHook`, `zeroFrames` and `span`
(the input runs past the frames the rules read).

## What the gate needs from the page

- The marker: `<meta name="motion-kit-kind" content="live">`, or `<meta name="motion-kit-bar"
  content="<slug>">` on a copied bar (the gate then reads the main kind from `bar.json`).
- The fixed clock: under `?seek` the page starts no live loop, and `window.__seek(ms)` re-runs it
  from 0 to `ms` in whole 1/60 s steps, then one shorter step for the rest.
- The state read: `window.__state()` returns `{ values, events, units }` from the page's own state.
  `units` is optional and names a value's unit: `px`, `deg`, `ratio`, `opacity`, `scale` or `s`.
- Every duration, easing, spring and loop period sits in the page's `MOTION` const or in the
  `KNOBS` block that `motion-kit knobs live` prints. A copy of one of the kit's own bars may keep its
  numbers where they are: its marker names a bar in the kit's `bars/`, and its `MOTION` block is that
  bar's, byte for byte. Any other page gets the literal check, an adapted bar too, and the gate prints
  one `note:` line that says why.
- Motion runs on the page clock. Every `setTimeout`, `setInterval`, `performance.now()` and
  `Date.now()` fails the audit, on every page, unless its line carries one of two marker comments:
  - `// motion-kit:clock` marks the page clock's own time read (for example, the first timestamp
    of the live loop).
  - `// motion-kit:not-motion` marks a use that times no motion (for example, a work budget for
    loading).
- A copied bar's `trace.json` may list `cuts`, in ms. Motion that starts at a cut may jump.

Run it with `motion-kit gate <page.html>`. It prints `passed`, `partial` or `failed: n`, and how far
each `KNOBS` value sits from its base.

## Rules for every kind

**Envelope (`envelope`).** No value pops. A pulse has an attack of 40 to 120 ms. Fades only fall.
The page caps one time step, so a long frame gap cannot throw its motion.

- The gate finds each place a value starts to move after holding still for 2 frames (the page
  counts as still before its first frame). Motion the input drives is left out, from the input's
  first sample until the page rests after the last one. So is motion that starts at a cut.
- A pop is one 1/60 s frame that covers more than half of a start's whole change: the farthest
  the value goes, either way, before it rests (so a small anticipation dip before a move is not the
  move). Setting a value in one frame is a pop. A steady linear move is not.
- A start whose whole change is below its unit's floor (0.5 px, 0.5 deg, 0.01 ratio, 0.01 opacity,
  0.002 scale, 0.017 s) is too small to see, so it is not judged: a spring or a smoothed scroll may
  snap to rest at the end of a still stretch.
- A pulse rises from rest to a peak within 500 ms, then comes back at least halfway toward where it
  started: a flash, a highlight, a badge pulse. Its attack, from its start to its peak, is 40 to
  120 ms. Ordinary moves, tweens, springs and loops have no attack bound. A value is a loop when it
  starts the same way 3 or more times at a fixed period (within 1 frame); the gate looks 15 s
  ahead for those repeats. A loop is still checked for pops.
- A value whose `units` entry is `opacity`, and that starts to fall without coming back as a
  pulse, is a fade. It must not rise again before it rests.
- The page runs once on its live loop with a 2000 ms jump in the frame clock. No value may move
  more than 4 times its largest step between two 1/60 s frames.

**The loop stops at rest (`loopStopsAtRest`).** No rAF callback runs in the second after the page comes to rest.

- The page is at rest when no value has moved by more than 0.001 for 150 ms on its live loop.

**The console stays clean (`consoleClean`).** No error, warning or uncaught error, on the `?seek` run or the live run.

**Reduced motion (`reducedMotion`).** Input still answers, the target is reached in 1 frame, and the still frame is
not the blank start state.

- Under `prefers-reduced-motion: reduce`, a value may change only in the first frame and in the
  frame the input changes or the one after it.
- A value that moves with the input without reduced motion also moves with it under reduced motion.
- The blank start state is a start that the page leaves and never comes back to without reduced
  motion: an entrance. The last frame under reduced motion must not be that state.

## Rules for live pages

A live page answers a pointer as it moves.

**It follows the input (`follows`).** While the pointer drags, a value moves in at least 80% of the frames.

**A release starts from the hand's speed (`releaseSpeed`).** Right after the release, a value that moved in the
drag's last frame keeps at least 50% of that frame's speed, in the same direction. A hand that held still
in that frame (it moved the value less than 5% of the value's largest frame step in the drag, not counting a
step with a cut in it) has no speed
to keep, so that value is not judged: a spring may pull back from rest speed.

**A regrab mid-settle picks up with no jump (`regrab`).** It runs on the fixed clock. One `?seek`
input holds the drag, the release, and a press held still for 300 ms from 5 frames (83 ms) after
the release, while the page settles. The press lands where the handle is then: the point where the
drag grabbed it, moved by how far each value that follows the pointer has gone since; an axis no
value follows keeps the grab point. The gate tries the handle's spot one frame before the press,
then at the press, and judges the first press that grabs. The press must grab: while the pointer
holds still, a value that was still on its way to rest covers at most 25% of that way (when every
such value already rests, the rule fails: there is nothing to test). And it must
not jump: no value moves by more than 2.5 times its largest frame step just before the press (plus
1% of its range). The rest, and each value's range, come from a run of the first press alone, so a
second press in a bar's input cannot move them. A value follows the pointer when it moves with one
pointer axis during the drag (|r| 0.9 or more). With no such value the press cannot be aimed, and the
rule fails.

**The input.** A copied bar plays the pointer input in its `trace.json`. Any other page gets a
press at the viewport center (640, 360), then a drag along a 300 px curve over 600 ms, one sample
per frame, then the release. The press comes 250 ms in, or 250 ms after the page's load motion
ends when it is still moving then (see the scroll rules). The curve goes right at a steady speed while it dips down and comes
back up, so a page that follows only x, only y, or both, all see a drag. Under `?seek` the samples are `window.__input`, each
`[ms, x, y]` or `[ms, x, y, down]`: the pointer sits at the latest sample, down unless that
sample's `down` is 0, and up after the last sample. Without `down` flags that is one press: down
at the first sample, a move at each sample, up after the last. The rules above judge the first press: the samples
before the first one with `down` 0. A bar's `trace.json` input may hold a second press. The regrab input uses the flag, so
a live page under `?seek` must read it. With a bar's own input, the rules read frames to 3000 ms,
the bar's last `trace.json` row, or 1000 ms after the input's last sample, whichever is latest.
