# Choreo: rules

Every live page meets these rules. `motion-kit gate` checks each one, and each rule has a
planted-fault test that it must fail. Each failure line starts with the rule's name, shown in
parentheses below; the gate's own checks add `kind`, `audit`, `noHook`, `zeroFrames` and `span`
(the input runs past the frames the rules read).

## What the gate needs from the page

- The marker: `<meta name="motion-kit-kind" content="choreo">`, or `<meta name="motion-kit-bar"
  content="<slug>">` on a copied bar (the gate then reads the main kind from `bar.json`).
- The fixed clock: under `?seek` the page starts no live loop, and `window.__seek(ms)` re-runs it
  from 0 to `ms` in whole 1/60 s steps, then one shorter step for the rest.
- The state read: `window.__state()` returns `{ values, events, units }` from the page's own state.
  `units` is optional and names a value's unit: `px`, `deg`, `ratio`, `opacity`, `scale` or `s`.
  `objects` is optional, and needed for a value in `stepped`: it names the things on screen, each
  with its box in this frame and the values that move it (REFERENCE.md, "The objects a page reports").
- Every duration, easing, spring and loop period sits in the page's `MOTION` const or in the
  `KNOBS` block that `motion-kit knobs choreo` prints. A copy of one of the kit's own bars may keep its
  numbers where they are: its marker names a bar in the kit's `bars/`, and its `MOTION` block is that
  bar's, byte for byte. Any other page gets the literal check, an adapted bar too, and the gate prints
  one `note:` line that says why.
- Motion runs on the page clock. Every `setTimeout`, `setInterval`, `requestIdleCallback`,
  `performance.now()`, `Date.now()`, `new Date()` and `document.timeline.currentTime` fails the
  audit, on every page, unless its line carries one of two marker comments:
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

- The gate finds each place a value starts to move after holding still for 2 frames (the page counts
  as still before its first frame). Motion the input drives is left out, from the input's first
  sample until the page rests after the last one. So is motion that starts at a cut, and a move ends
  at a cut: its jump there is no pop, and what follows is new motion. A move a cut ends within 100
  ms of its start is cut off, as one the frames end, and its pops are not judged. On a choreo or sim
  page only a drag (a press whose pointer moves while it is down) or a burst of scroll ticks drives
  motion, from its first sample to one frame after its last: the sequence a tap starts is judged,
  however late a piece in it starts. A start inside the frames the rules read is followed on to its
  rest, up to 1 s past them.
- A pop is one 1/60 s frame that covers more than half of a start's whole change: the farthest
  the value goes, either way, before it rests (so a small anticipation dip before a move is not the
  move). Setting a value in one frame is a pop. A steady linear move is not.
- A start whose whole change is below its unit's floor (0.5 px, 0.5 deg, 0.01 ratio, 0.01 opacity,
  0.002 scale, 0.017 s) is too small to see, so it is not judged: a spring or a smoothed scroll may
  snap to rest at the end of a still stretch.
- A pulse rises from rest to a peak within 500 ms, then comes back at least halfway toward where it
  started: a flash, a highlight, a badge pulse. Its attack, from its start to its peak, is 40 to
  120 ms. Ordinary moves, tweens, springs and loops have no attack bound, and neither has a pulse
  inside a choreo or sim page's caused sequence (a shake or a toss is no flash). There anything that
  comes back at least halfway is a pulse however slowly it peaks, so a dip through black is no fade
  that rises again. A value is a loop when it
  starts the same way 3 or more times at a fixed period (within 1 frame); the gate looks 15 s
  ahead for those repeats. A value is a designed loop too when its whole series repeats at one
  period of 0.5 to 7.5 s, after a lead-in of at most 2 s, within its unit's floor: the gate reads
  17 s and checks each frame against the exact time one period later, so a period off the frame
  grid counts. A ticking hand counts as well: each period it moves on by the same step. When the
  shortest repeat the gate finds does not hold (two equal hops with different settles), it tries
  that repeat's multiples up to 7.5 s. A loop is still checked for pops.
- A value whose `units` entry is `opacity`, and that starts to fall without coming back as a pulse,
  is a fade. It must not rise again before it rests. An opacity value in a designed loop (a shimmer)
  is a loop, not a fade.
- A stepped pulse is read on its drawings: its attack runs from half its first new drawing's
  length before that drawing starts (as a smooth start is read at the middle of its frame) to the
  start of its peak drawing, and that is also when it peaks for the 500 ms bound.
- The page runs once on its live loop with a 2000 ms jump in the frame clock. No value may move
  more than 4 times its largest step between two 1/60 s frames.

**Values (`values`).** Each value the page reports is a finite number in every frame, from the
first frame that holds it on (a value of its own, not one every object has, such as `constructor`).
An idle page is read for 17 s here. A value that is NaN or Infinity, or left out, for one frame hides
what it does there from the other rules, while the screen drops that frame and the value jumps.

**Stepped (`stepped`).** Motion held in drawings on purpose (cel on twos or threes, stop-motion, a
sprite) is judged at its drawing rate, not as a row of pops.

- A copied bar's `trace.json` may name values in `stepped`. Each must be a value the page reports,
  it must change over the frames the rules read, and it must move an object in `__state().objects`.
- A drawing is a run of frames within the still tolerance of each other: a ten-thousandth of the
  value's range over the frames read, its one lowest and one highest frame left out, so one wild
  frame cannot merge drawings. Every rule's still tolerance for a value is found the same way. A
  rest is a drawing held 3 frames or more, and at least 3 times as long as the typical drawing
  beside it (the lower median of up to 3 drawings on each side). So a rest is long next to its own
  drawings, at any drawing rate, and a steady train of equal holds has none. Slow drawings beside
  fast ones (threes into ones) are not rests.
- For the pop checks, a rest is a drawing shown 250 ms or more, the first drawing of the frames
  read (the page opens on it), or one that holds to the end of the frames read (the span and 4 s
  more). Below four drawings a second, motion stops reading as continuous, so a jump between two
  rests is seen as a jump. So a pop in the first drawings after load leaves a rest. A first drawing
  shown under 250 ms is a rest only to the teleport line, and only toward a rest: a loop read from
  mid-motion opens on a drawing whose motion runs on into the cycle's own holds.
- A hold is a drawing shown 100 ms or more and at least twice as long as the typical drawing on
  each side of it (the lower median of up to 3 drawings, each side apart): the held drawing that
  also ends an overshoot chain. A slow drawing among slow ones holds nothing, so threes and fours
  keep the spike test. A side with no drawings counts for nothing. For the pop checks, neither does
  a side that the start or end of the frames read cuts short of 3 drawings: a loop read from a hold
  has none of the drawings before it. A moving step has no hold on either side.
- Every step from one drawing to the next is judged across the boundary frame: from the object's
  box in the last frame of the drawing before to its box in the first frame of the drawing after.
  A step has two parts, each in lengths of the object. Its position part is how far the box's
  centre moves, over the longer side of the bigger box. Its size part is how much the width or
  height changes, over the longer side of the smaller box. When the value's own box coordinates
  fit (the slopes the objects rule fits), each part is the value's own share, so another value
  that moves the same box adds nothing to it. When they do not fit, each part is the box's change
  less what the object's other values whose coordinates fit explain across the same two frames:
  a squash judged on its width is not charged with the fall it lands from. A `ratio` with
  no fit is read the same way to tell whether it leaves its box as it is. The lengths are always
  the real boxes'. A step's speed is a part in px over how long the
  drawing before it was shown, or the drawing after it when the one before is a hold, so a long
  hold never makes a step look slow. Motion before the first rest, motion with no rest and moving
  holds are all judged.
- The three tests below run in the envelope rule and in Gate A's sudden jumps, with the same
  exemptions as any pop. A step that a cut or an input window exempts is not judged, and no other
  step is compared with it.
- Spike (position parts and look values): a run of one to three steps in a row is a pop when each
  step in it is more than 3 times as fast as the faster of the moving steps just outside it (the
  one before the run and the one after it), and the run is a quarter of a length or more in all.
  So two big steps in a row cannot shield each other. A run of two or three is made of moving
  steps, with a moving step on each side. One exception, for position parts only: a run of two or
  three that goes out and comes back (its last step runs against its first, and it ends within half
  of its largest offset from where it started) may sit next to a hold, and is compared with the
  moving step on its other side alone. So one drawing set the wrong way and back just before a key
  hold fails, and a slow-in whose two big last drawings run into a key hold passes. The way back is
  read as for an excursion below. A look value's run always needs moving steps on both sides. A
  single step out of a hold or into one is compared with the moving step on its other side alone.
  A single step between two holds that are not both rests has no moving step beside it: it is
  compared with the steps just past the holds (the step into the first and the step out of the
  second, each when its hold is not a rest), since a hold under 250 ms still reads as part of the
  motion around it. Its speed is timed by the shorter of its two holds, so a snap from a short hold
  into a long rest is judged too. So a snap of 0.9 lengths between two 117 ms holds in a creep of 2
  px a drawing fails. With no step to compare, there is no spike test.
  A creep of 1 px a drawing on a 40 px object is 0.025 lengths, so it never pops.
- Teleport between rests (position and size parts): a step of more than one length between two
  rests is a teleport. Here a hold counts as a rest too, so a jump between two holds of 100 to 250
  ms is judged on this line. So a slideshow, a two-pose bob bigger than its object, a 40 px dot that
  snaps to 400 px and a 2-length snap between two short key holds fail. A move from rest to rest
  through one or two brief in-betweens (each shown under 100 ms) is judged on the same line: its position part by its largest step, its size part
  by its net size change from rest to rest. So a smear drawing between two holds passes, and a
  size snap through an in-between fails. A 12 px eyelid that shuts on a 24 px eye moves half a
  length, so it passes.
- Out and back (position parts): a step out, a brief drawing (shown under 100 ms), and a step that
  comes at least half the way back form an excursion when the path resumes. The way back is read
  in the value's own units when its box coordinates fit, else by the box's centre. The path
  resumes when the steps just before and just after the excursion, each counted only when it is a
  moving step, go the same way, or neither moves. An excursion longer than one length is a
  teleport. A shorter one is a pop when its step out is a quarter of a length or more and both its
  steps are more than 3 times as fast as the moving steps outside it. A turn (a bounce, a yo-yo, a
  walk's turnaround) and an alternation (a shake, a flicker, a wobble) are not excursions.
- Size parts get the teleport line only: a squash, a smear, a blink by `scaleY` and a sparkle that
  pops in are shape changes by nature.
- A value that changes the look, not the box (`opacity`, `deg`, and a `ratio` that leaves its box
  as it is over the whole run), is measured in its own unit: a change of 0.25 `opacity`, 15 `deg`
  (the shorter way round) or 0.25 `ratio` is one length. Look values get the spike only: a blink,
  a cursor flash, a clock tick and a layer swap are on/off changes by nature. An `index` value (a
  sprite frame, a count) never pops: a frame swap is a pose change by nature.
- Gone gaps: a gap where the object is gone (a 1 by 1 box, or a box wholly outside the viewport)
  that is shorter than 100 ms is bridged, so the step is judged from the last drawn drawing to the
  next. A gap is not bridged when the box leaves through the viewport's edge: a wrap off screen is
  honest. A step into or out of a longer gap is not judged, and no other step is compared with it.
- At each step the gate tries the teleport between rests first, then the excursion, then the
  spike, then the single step between two holds, and reports each value's earliest pop:
  - `envelope: <name> at <ms> ms jumps <L> of its object's length in <n> drawing(s), <r> times the
    drawings around it; that is a pop`. A run is reported at its first step, with its whole length
    and its smallest step's ratio. A short excursion is a run of 2, with the length of its step
    out.
  - `envelope: <name> at <ms> ms jumps <L> object lengths between two rests; that is a teleport`.
  - `envelope: <name> at <ms> ms jumps <L> object lengths and back in one drawing; that is a
    teleport`.
- Every other rule reads a stepped value as its pose line: a line that reaches each drawing when
  the next one starts, so it never moves before the drawings do. Into a rest it glides over one
  drawing's length, then holds. The time-step budget and the choreo interrupt test compare drawings
  with drawings.
- On a live or scroll page the input drives the motion, so a stepped value reads as its drawings
  while it does: from the input's first sample until the values rest after the last one. The input
  rules judge each such value that moves an object, is not an index and follows the input, and the
  pop checks leave it to them there. The pop checks judge every other stepped value there too.
- A value that is an index or a count (a sprite's frame number, a ticking counter) is no motion
  channel: trace what it moves instead.

**Objects (`objects`).** A page that reports objects in `__state().objects` reports a whole record
in every frame the rules read. Each object is `{ box: [x, y, w, h], moves: [value names] }`, has a
box of finite numbers at least 1 px wide and high in every frame, and is in the record from the
first frame. Each name in `moves` is a value the page reports, and no value moves two objects. A
page that reports no objects passes.

- An object may set `halo`: how far its ink spreads past its box, in px (a shadow, a glow, a blur, an
  outline, an SVG stroke, a glyph's overhang). It is 4 unless set, and a finite number of 0 or more.
  It counts for at most 16 px or the object's length, whichever is larger.
- An object that a clip hides (`overflow: hidden`, a mask) is gone, and reports a box of 1 by 1. A box
  wholly outside the viewport counts as gone too.
- The gate fits each of the object's box coordinates (centre x, centre y, width, height) on all the
  values in its `moves` together, by least squares over the frames where it is drawn. A coordinate
  fits when the fit explains 81% of its variance or more. A value has no fit when no coordinate
  fits, when it changes in fewer than 3 frames, or when it moves together with another value in
  `moves`. On a scroll page the object is fitted twice, in the viewport and with the scroll added to
  its centre y, and keeps the one where its centre y travels less over the run.
- A value in unit `px` moves its box. A `px` value with no fit fails when, in every frame where it
  changes, all four box numbers change by 0.5 px or less: "objects: `<name>` changes but its
  object's box does not follow it". A value listed under a still box fails here. An ambient object
  is left out: one whose box, grown by its halo, covers more than half the viewport in a frame where
  it is drawn. A background that pans inside its still box changes its look, not its place.
- A box spike has a cause. A box whose centre moves more than 1 object length (of the bigger box) in
  one frame, and more than 3 times its largest centre move in the 3 frames on each side, needs a value
  in its `moves` that changes in that frame and is not an `index`: "objects: `<object>` jumps `<L>`
  object lengths at `<ms>` ms with no value in its moves changing". Steps to or from a gone box are
  left out, and so is a frame at a cut. On a scroll page the move must be a spike in both frames of
  reference. Steady fast motion (a flicked cursor, confetti) is no spike; a still box that jumps and
  holds still again is.
- The cause must explain the jump. A changing value whose box coordinates fit (the slopes above)
  causes only its own share of the move. When every value that changes there fits, the move less
  their shares is judged again on the same line, in the frame of reference the fit kept: "objects:
  `<object>` jumps `<L>` object lengths at `<ms>` ms more than the values in its moves explain". A
  value with no fit that changes there causes the jump, since what it does to the box cannot be
  told. So a box that jumps sideways while its one value bobs it up and down fails.

**Drawn (`drawn`).** The boxes a page reports in `__state().objects` hold what changes on screen.
A page that reports no objects passes.

- The gate compares 24 pairs of frames under `?seek`. At least 8 are spread evenly over the frames
  the rules read. The rest are at events, in this order: each cut; an object that goes gone or comes
  back, the bigger box first; one pair for each slow object; then box jumps, scrolls and stepped
  drawing boundaries (at most 16 boundaries), the largest box move or scroll first. On a tie, the
  earliest comes first. A cut's pair is the frame at or before it and the next frame. A slow
  object's box moves, but never more than 2 px in one frame: its pair is a frame and the first later
  frame at the same scroll position, up to 30 on, where its box has moved more than 2 px. Every other
  pair is two frames in a row. The gate seeks the page to each frame right before it screenshots it,
  at 1 pixel per CSS px.
- A pixel changes when one of its colour channels moves by more than 8 of 255. Inside the own box
  (not grown) of a solid object that changed, the ghost and tightness tests count a change of more
  than 2 of 255, so a faint or fading object still shows its change. Boxes and pixels meet at pixel
  centres.
- Each object's box grows by its halo. An object changed in a pair when a box number changed by more
  than 0.01 px, it went gone or came back, or a value in its `moves` changed. An object with
  `moves: []` counts as changed in every pair, since no value says when it changes. A changed pixel
  is covered when the grown box of an object that changed holds it. A still box whose object did not
  change covers nothing, and a gone box adds nothing.
- A grown box that covers more than half the viewport is ambient: a moving background, a full-canvas
  glow. The changed pixels that only ambient boxes hold are grouped into clusters: the viewport is
  cut into 4 by 4 px cells, a cell is on when one of its pixels changed, and on cells join when the
  cells around them (one cell out, diagonals too) touch. A cluster is compact when its on cells fill
  at least 25% of their bounding box and that box covers less than 25% of the viewport. With one or
  two clusters, a compact one is stray: a teleport or a spot no object reports. Three clusters or
  more, and a cluster that is not compact, are the background's own change.
- In a pair with three clusters or more, or where a solid object's grown box overlaps a cluster that
  is not compact, the object is not judged for ghosts or tightness. An object not judged in any pair
  where it changed (its box, a value, or gone) gets a note, not a failure: "drawn: `<object>` could
  not be judged: the background changes around it in every sampled pair". A lie over a background
  that changes everywhere, or in many patches, is not judged.
- A pair fails when more than 1% of its changed pixels, or more than 64 of them, are stray: covered
  by no box, or in a compact cluster: the objects do not cover what the page draws.
- A pair fails when an object's box moves more than 2 px (its centre, or its width or height), goes
  gone or comes back, and no pixel changes where it was or where it went: its grown box in that
  frame, less the grown boxes of the other solid objects that changed. A side those boxes hide wholly
  is skipped, and a gone side has no box, so a step to or from gone is judged on its drawn side
  alone. An object whose own box lies inside the other changing objects' grown boxes moves with them
  (an eye in a nodding head) and is not judged in that pair.
- A fade's last step may change nothing on screen: an object all but invisible in the frame before
  it is gone. So when an object goes gone or comes back, nothing changes where it is drawn, and its
  gone gap lasts 100 ms or more (or runs to the edge of the frames read), the gate also compares the
  gone frame with the frame on the drawn side, up to 30 frames away, where the object's record
  differs most: each value in its `moves` by its share of its range, and its box by its move in
  object lengths. A shorter gone gap gets no such frame, wherever it sits: its step is judged on its
  pair alone, so a fade into a gap under 100 ms must change something at its last step. One gap
  remains: a box reported gone for 100 ms or more while the object is still drawn, within 30 frames
  of a change in its record, is compared with that change and passes.
- A box must be tight. The changed pixels a solid object alone holds (inside its grown boxes, outside
  the other changing objects') must come within a quarter of what they span along that edge's axis,
  plus 1 px, of both edges along its longer side (top and bottom for a box as wide as it is high or
  wider) and of one of its other two edges, in the box of the pair's second frame (its first when
  the second is gone). The allowance is measured on what is drawn, so it does not grow with a box
  reported too big: a box more than 1.5 times what it draws fails. A halo adds nothing to it, since
  ink in the halo lies past the edge and reaches it. The box is clipped to the viewport: an edge
  the viewport cuts off is not judged. When less than half the box shows across the cut, neither
  are the two edges across it (the left and right edges of a box cut at the top or bottom, and the
  other way round): a round object shows its widest part only once half of it does. A box from
  `getBoundingClientRect()` half off screen passes; one too big on its on-screen side fails. A box
  too wide across a cut that leaves less than half of it on screen passes.
  Each event pair where its box moves and it is judged must pass. An object in no such pair passes
  when, over the pairs where it changed (its box, a value, or gone) and is judged, each of those
  edges is reached in some pair. A pair where it holds no changed pixel tells nothing, and an object
  whose own box lies inside the other changing objects' grown boxes is not judged. An inflated box
  that hides motion inside it fails, and so does one box for a body whose arm alone moves: report the
  arm as an object of its own. One gap remains: an inflated moving box can hide a second mover
  travelling inside it.
- A listed cut must be a scene change. The gate reads it over two frame steps: its pair, and the
  step into the pair's first frame, since a page may switch its scene at the cut or after it. The
  larger change of the two must be more than half the viewport, or more than 3 times the most pixels
  any other pair changes. Neither step is judged for anything else, whichever pair it is sampled as,
  since a scene change is not drawn by the objects.
- A pair may span a scroll, on a page that scrolls itself under `?seek`. A box counts as moved,
  changed, gone or back only when it does so in both frames of reference, so a fixed header and an
  in-flow card both hold still across a scroll, and each side of the first frame counts both where
  it was in the viewport and where the document carried it. A pixel counts as changed only when it
  differs both in viewport coordinates and after shifting by the scroll's change. A pixel whose
  shifted source lies outside the first frame is not judged, nor is one whose shifted source lies in
  the grown box of an object that holds still in the viewport and changes no value (the page there
  was hidden under it),
  nor one within the scroll's change, in its column, of a still pixel: one the same in viewport
  coordinates that the scroll did not carry, such as a fixed or sticky header. A pixel is not still
  when it, or the pixel it is compared with across the scroll, lies in the grown box of an object
  that moves in that frame: the difference is the object's own.
- Inside the grown sides of an object that moves across a scroll, a pixel counts as changed when it
  differs after shifting by the scroll's change alone, or, when its shifted source lies outside the
  first frame, in viewport coordinates alone; no still pixel near it hides it. A fixed flipbook over
  a flat background, which matches itself across the scroll, and a parallax card, which moves with
  neither frame, change the two frames in different places. Where the document carried such an
  object's box in the first frame wholly off screen, that side is not judged for ghosts: on a flat
  background its old place shows no change, and where the scroll took it cannot be seen. The page
  must be scrolled to the same place on every load at a given time.
- So every drawn thing that moves has a box. An effect that no value moves is an object with
  `moves: []`, and a background that moves on its own is an object too, with its own box.
- The rule prints the first pair for each cause: one line for pixels outside every object, one for
  each object that moves where nothing changes, one for each object whose box is bigger than what it
  draws, and one for each cut that changes little.

**Overshoot (`overshoot`).** Only motion a person caused, and a designed loop's settle, may pass
where it comes to rest and come back, and opacity never does.

- Motion the input drives is left out, from the input's first sample until the page rests after the
  last one, and so is motion at a cut. On a choreo or sim page, each cause's whole sequence is left
  out, pauses included, while a sequence the page starts on load is judged. For an opacity value
  only the time until the input's last sample (on a choreo or sim page, each press's lift) is left
  out, so the settle after a release is judged too.
- The gate reads each value in chains of motion. A chain ends where the value holds still for about
  100 ms (6 frame steps; for a stepped value, also after a drawing held that long and at least twice
  as long as the drawings on each side of it), at a cut, and where the frames end. A move ends where
  the chain ends, where it nearly stops (below a tenth of its top speed) and then speeds up again
  the same way (past a fifth of its top speed), and at a turn after which it swings back more than 3
  times its last swing, or, in a chain that does not end held where it started, goes farther from
  where the move started than it has been (by more than the frame step beside its farthest turn,
  since a sharp turn such as a ball's landing falls between frames). So an anticipation dip starts
  the move it winds up, while a shake that grows stays one move. A turn held still for 3 frame steps
  short of the farthest the move has gone ends the move, and so does a stop held that long after
  which the value moves on the same way at any speed.
- An overshoot is a turn of a move that passes the level the move stops at, in the move's
  direction, by more than its unit's floor and more than 2% of the move, then comes back. It is
  measured as a share of the move, from where it started to where it stops: a drawn settle of
  108, 97, 101, 100 passes its rest by 8%. A move the frames cut off before it stops is not judged.
- A move that ends where it started, held there, with its first turn within 500 ms, passes no rest:
  a shake, a heartbeat, a hop that dips as it lands, a ball that bounces lower each time. It is
  judged as pulses. Otherwise each swing past the start, on the far side of the first swing,
  overshoots the first swing: a way home that peaks after 500 ms and settles past home, an endless
  bounce whose next hop starts with no hold, and any opacity value, since opacity never passes where
  it rests.
- A pulse (its first turn is its farthest, within 500 ms, and it comes back at least halfway) is
  no overshoot, and neither is a sway that turns at the same two levels.
- A designed loop (see the envelope rule) may settle past its rest by up to 50% of its move, once
  its lead-in ends, when each cycle holds still (within half its unit's floor) for 3 frame steps: a
  loader's squash, a relay of hops, a breath, a badge that springs in. A one-time spring at load, an
  endless bounce that never holds still, and a loop that pops still fail. Opacity never overshoots,
  in a loop too.

**The loop stops at rest (`loopStopsAtRest`).** No rAF callback runs in the second after the page comes to rest.

- The page is at rest when no value has moved by more than 0.001 for 150 ms on its live loop.
- On a choreo or sim page, the gate first waits for the sequence to end, as the `?seek` frames show
  it: a pause inside the sequence is no rest. There every value the `?seek` frames move away from
  where it was at the first cause must have left it on the live page too (by its unit floor or 2%
  of its range): a live loop that stops in a pause and never plays the rest fails. Where a value
  lands is not compared, since a live frame may run long and chaotic physics may land elsewhere. A value the gate sorts as a loop may keep running:
  the page is at rest when every other value is, and the loop must pause off screen (see that
  kind's rules).

**The console stays clean (`consoleClean`).** No error, warning or uncaught error, on the `?seek` run or the live run.

**Reduced motion (`reducedMotion`).** Input still answers, the target is reached in 1 frame, and the still frame is
not the blank start state.

- Under `prefers-reduced-motion: reduce`, a value may change only in the first frame and in the
  frame the input changes or the one after it (on a choreo or sim page, also where it enters or
  leaves a held state, below).
- A value that moves with the input without reduced motion also moves with it under reduced motion.
- On a choreo or sim page the gate instead plays the input with its last cause played once more,
  500 ms after its sequence ends, with and without reduced motion. Each value ends every caused
  sequence, the repeat's too, where it ends without reduced motion (within its unit floor or 2% of
  its range). A value already at that end, as in an entrance shown finished, a replay or a shake
  that comes back, need not move; a second cause must still answer as it does without reduced motion.
- On a choreo or sim page, a sequence that ends where it began but holds a value somewhere else for
  500 ms or more, as a toast does, shows that held state under reduced motion for as long as it
  holds. It may enter it in one frame, from the cause until the hold starts, and leave it in one
  frame, onto the sequence's end, from when the hold ends until the sequence ends. A replay, where the value goes back to its first frame from a start elsewhere and
  plays its way back, may be skipped.
- The blank start state is a start that the page leaves and never comes back to without reduced
  motion: an entrance. The last frame under reduced motion must not be that state. An angle (`deg`)
  comes back after a whole turn, a ticking loop each time it moves on by its step, and a value that
  moves at one steady speed (a marquee) each frame, so none of them is an entrance.

## Rules for choreo pages

A choreo page plays a sequence after a cause: one tap, scroll or load starts pieces that move with
offsets, and the last piece lands last.

**The cause.** A copied bar plays the input in its `trace.json`. Each press of a pointer input is a
cause, and so is each burst of scroll ticks (ticks less than 250 ms apart). A bar whose input is
empty starts on load. Any other page gets a tap at the viewport center 250 ms in, or 250 ms after its
load motion ends; when no value answers the tap within 1500 ms, the page starts by itself and the
gate judges its load motion. The rules read to 1000 ms past the end of the last cause's sequence, and at least 5000 ms past its stop. The gate looks for that end up to 15 s past the stop: a value still moving there fails `span`.

**Loops.** A value that starts the same way at a fixed period, or that never holds still and peaks
at the same height at a fixed period, is a loop. A loop is not a piece of the sequence: the
interrupt leaves it out, and it may keep running after the sequence ends. A page with a loop gets
the idle rules for it: it pauses off screen (`pausesOffScreen`) and resumes within one frame
(`resumes`).

**A second trigger may not jump or freeze a piece (`interrupt`).**

- The gate finds each piece start: a frame where a value starts to move after holding still for 3
  frames, after a cause and before the next. Starts within one frame of each other are one.
- Fewer than 2 piece starts after every cause fails: one onset is not a sequence.
- For each piece start that comes after the cause's lift (at most 8, picked evenly), the gate plays
  the same input with the cause played once more, 8 ms before the start, and again in another run
  8 ms after it. The repeat is the cause itself: the same press at the same spot for the same
  length, the same scroll tick, or a center tap for a load.
- No jump: no value moves more than 2.5 times its largest frame step without the repeat, plus 1% of
  its range, in one frame (a cut in `trace.json` is exempt).
- Nothing stuck: each value comes to rest, and its rest is one the page also reaches without the
  repeat, within 2% of its range or its unit's floor. Those rests are its start before the cause,
  its end after the sequence, and its rest after a repeat played 500 ms after the sequence ends.
  A page may turn the sequence back, carry it on, or ignore the repeat. A rest anywhere else is a
  piece frozen halfway.
