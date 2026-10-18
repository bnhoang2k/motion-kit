# Scroll: rules

Every scroll page meets these rules. `motion-kit gate` checks each one, and each rule has a
planted-fault test that it must fail. Each failure line starts with the rule's name, shown in
parentheses below; the gate's own checks add `kind`, `audit`, `noHook`, `zeroFrames` and `span`
(the input runs past the frames the rules read).

## What the gate needs from the page

- The marker: `<meta name="motion-kit-kind" content="scroll">`, or `<meta name="motion-kit-bar"
  content="<slug>">` on a copied bar (the gate then reads the main kind from `bar.json`).
- The fixed clock: under `?seek` the page starts no live loop, and `window.__seek(ms)` re-runs it
  from 0 to `ms` in whole 1/60 s steps, then one shorter step for the rest.
- The state read: `window.__state()` returns `{ values, events, units }` from the page's own state.
  `units` is optional and names a value's unit: `px`, `deg`, `ratio`, `opacity`, `scale` or `s`.
- Every duration, easing, spring and loop period sits in the page's `MOTION` const or in the
  `KNOBS` block that `motion-kit knobs scroll` prints. A copy of one of the kit's own bars may keep its
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

**Reduced motion (`reducedMotion`).** On a scroll page this rule is the stepped-states rule below.

## Rules for scroll pages

A scroll page answers the scroll position.

**Scrolling back reverses it (`reverses`).** Each value that moves while the page scrolls down moves back at
least 50% of the way when it scrolls back to the top.

**Reduced motion: stepped states (`reducedMotion`).** Under `prefers-reduced-motion: reduce` the
scroll still answers, but the page moves between a few still states, not with the scroll. There is no
continuous scroll-linked zoom, parallax or transform.

- The gate sweeps the page with its own input: down in 50 px steps, one every 2 frames, to the
  page's end (at most 5000 px), a 30 frame hold, back up to the top the same way, and a hold. It
  starts where the input below starts. It runs once without reduced motion and once with it.
- Under reduced motion each value takes at most 6 still values over the sweep.
- Each change lands in the frame the scroll changes or the one after it. A value whose `units`
  entry is `opacity` may instead fade to its new state, ending at most 300 ms after the scroll
  changed.
- A value that moves with the sweep without reduced motion also moves with it under reduced motion.
- A value that, each time it moves, lands on the scroll position (within one frame) is the scroll
  itself, and is not judged.
- The blank start state is a start that the page leaves and never comes back to without reduced
  motion: an entrance. The last frame under reduced motion must not be that state.
- The page must be tall enough to scroll 50 px.

**The input.** 3 wheel ticks of 100 px down, 50 ms apart, then 3 ticks back up after a pause, at
the viewport center. Under `?seek` the samples are `window.__input`, each `[ms, scrollY]`:
the scroll position the wheel ticks set at that time (a page that smooths the scroll chases it).
The page must be tall enough to scroll 300 px. The input starts 250 ms in. A page still moving
then from its load motion (what it does with no input, watched for 15 s) gets the input 250 ms
after that motion ends, so the rules judge only what the input moves; a page that never comes
to rest keeps 250 ms.
