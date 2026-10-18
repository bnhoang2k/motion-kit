# Idle: rules

Every idle page meets these rules. `motion-kit gate` checks each one, and each rule has a
planted-fault test that it must fail. Each failure line starts with the rule's name, shown in
parentheses below; the gate's own checks add `kind`, `audit`, `noHook`, `zeroFrames` and `span`
(the input runs past the frames the rules read).

## What the gate needs from the page

- The marker: `<meta name="motion-kit-kind" content="idle">`, or `<meta name="motion-kit-bar"
  content="<slug>">` on a copied bar (the gate then reads the main kind from `bar.json`).
- The fixed clock: under `?seek` the page starts no live loop, and `window.__seek(ms)` re-runs it
  from 0 to `ms` in whole 1/60 s steps, then one shorter step for the rest.
- The state read: `window.__state()` returns `{ values, events, units }` from the page's own state.
  `units` is optional and names a value's unit: `px`, `deg`, `ratio`, `opacity`, `scale` or `s`.
- Every duration, easing, spring and loop period sits in the page's `MOTION` const or in the
  `KNOBS` block that `motion-kit knobs idle` prints. A copy of one of the kit's own bars may keep its
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

## Rules for idle pages

An idle page loops on its own clock while it is on screen.

**It pauses off screen (`pausesOffScreen`).** No rAF callback runs from 50 ms to 550 ms after the page goes off screen.

**It resumes after leaving and coming back (`resumes`).** A frame runs within 50 ms (one frame, plus room for
timer jitter) of the page coming back on screen.

**Off screen.** The gate does two things at once, so a page may listen for either:
`document.hidden` turns true with a `visibilitychange` event, and the body moves 200vh down,
out of the viewport (an IntersectionObserver sees it leave). Coming back undoes both.

**At rest.** An idle page never rests while it loops, so "the loop stops at rest" is checked at
its still frame under reduced motion. It gets no input.
