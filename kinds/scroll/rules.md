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
  `objects` is optional, and needed for a value in `stepped`: it names the things on screen, each
  with its box in this frame and the values that move it (REFERENCE.md, "The objects a page reports").
- Every duration, easing, spring and loop period sits in the page's `MOTION` const or in the
  `KNOBS` block that `motion-kit knobs scroll` prints. A copy of one of the kit's own bars may keep its
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
  move). Setting a value in one frame is a pop. A steady linear move is not. A move that comes back to
  where it started and holds there, as a shake or a bob, has no pop test here: a frame of it is a share
  of a swing that goes both ways, so `suddenJumps` reads its motion between frames instead. A chain of
  moves with holds of under 100 ms between them that comes back as a whole (a tada, a bounce that
  pauses at its top) is read the same way. A chain whose every leg lasts 2 frames or less (about
  33 ms: a flick out and back) is no swing, and its frames are judged as any move's: a smooth leg that
  short is no cusp, so only the frame it lands in tells it from a snap.
- A start whose whole change is below its unit's floor (0.5 px, 0.5 deg, 0.01 ratio, 0.01 opacity,
  0.002 scale, 0.017 s) is too small to see, so it is not judged: a spring or a smoothed scroll may
  snap to rest at the end of a still stretch.
- A pulse rises from rest to a peak within 500 ms, then comes back at least halfway toward where it
  started: a flash, a highlight, a badge pulse. Its attack, from its start to its peak, is 40 to
  120 ms. Ordinary moves, tweens, springs, loops and checked extents (see Extents) have no attack
  bound, and neither has a pulse inside a choreo or sim page's caused sequence (a shake or a toss is
  no flash). There anything that
  comes back at least halfway is a pulse however slowly it peaks, so a dip through black is no fade
  that rises again. One sort finds the loops, and every rule reads it. A value is a loop when it
  starts the same way 3 or more times at a fixed period of 0.5 s or more (within 1 frame), the last
  start within one period, plus a frame, of the last frame read, and it keeps its range each period:
  every period's swing is as large as the first, and, but for a value in `deg` (a hand that ticks
  round), it starts and tops out at the same levels (within the unit's floor, plus what a crest
  known only to a frame can be off: half the bend of the frames at it). A step each period in `px`,
  `scale` or `opacity` (a staircase), or a swing that grows each beat, is no loop, however small:
  every period is held to the first, so a drift that adds up over the read fails. The gate looks 15 s ahead for those repeats (on a
  choreo or sim page, 15 s past the last cause's stop, the same read that finds the sequence's end).
  A piece that steps or breathes a few times and then holds stops before the end, so it is no loop.
  A value is a loop too when it moves at one steady speed over the
  last 500 ms of the frames read (a marquee, a strip that drifts), whatever it did before: a hand held
  it, or it eased in or back to its drift. Every frame step in those 500 ms is within the larger of the
  still threshold of those 500 ms' own range and 1% of the median step, of that median, and the median
  step is above the still threshold of the value's range. A drift that slows (even with a long time
  constant), a speed that wobbles by 5% or more, or one that has stopped is no loop. With a first
  cause (a tap on a choreo or sim page, the first input sample on a live or scroll page) the value must
  move the same with no input: the gate reads the page once more with none, and the value must end at the
  same steady speed, the same way, there, and hold it from the end of its lead-in in that read. A drift that starts a little after load or eases in stays a loop;
  a value that starts at a cause and never stops (a tween with no clamp, a body with no friction, a fling
  clamped to a minimum speed) is no loop, and fails the span and rest rules, whatever else the page did
  before the cause (a breath), and whichever way the breath was going. With no cause (an idle page, or a page that starts on load) the value must hold
  that speed from the end of its lead-in, 2 s after it first moves, to the end of the frames read: a
  ramp up to the speed is that lead-in, a breath that turns into a creep later is not. A value is a designed loop too when its whole series repeats at one
  period of 0.5 to 7.5 s, after a lead-in of at most 2 s counted from when it first moves (a loop a
  tap starts has the lead-in a loop at load has), within its unit's floor: the gate reads 17 s from
  that move and checks each frame against the exact time one period later, so a period off the frame
  grid counts, and a crest between two frames is no harder to find than one on a frame. A step each
  period (a ticking hand) counts only for a value in `deg`. In any other unit a step each period, or a
  swing that grows or shrinks each period, counts only while what it adds up to over the read stays
  within the unit's floor: a bob that sinks 0.5 px a cycle is no loop. When the shortest repeat the gate finds
  does not hold (two equal hops with different settles), it tries that repeat's multiples up to
  7.5 s. A value whose own cycle is shorter than 250 ms (a flip-flop every frame, a buzz of 4 frames
  a cycle) repeats at 500 ms too, as every multiple of its cycle does, but it is a buzz, no loop: it
  must come to rest. A loop is still checked for pops.
- Known limits of the loop sort. A cycle shorter than 500 ms is no loop, so a designed shimmer or vibration
  of 155 to 180 ms is a buzz that must come to rest. A lead-in longer than 2 s is no loop: a slow
  exponential slide with a 3.1 s bob on one value, a spring that settles over 2.55 s before a 2 s breath,
  and a bouncy spring still 0.033 off at 2 s before a 1.6 s breath all fail. Smooth motion with no one
  period of 0.5 to 7.5 s is no loop: two unrelated sines (6 px at 1.3 s plus 4 px at 2.1 s repeat only every
  27.3 s), and a breath of 8, 9 or 10 s, must come to rest. A bounce that loses no energy repeats at a fixed
  period with equal peaks, so it is a loop, and the gate cannot tell it from a designed bob. A creep of 12
  px a second from load that never stops is a loop too, as a marquee is, because the sort cannot know the
  page's intent. A value in `deg` whose rest angle walks 3 deg each cycle counts as a ticking hand. A loop
  that stops dead mid-swing and holds (a 40 px bob that halts at its fastest, 168 px a second, after 4
  cycles) passes, because no rule tests a sudden stop. The read ends 17 s from the first move, so a bob that
  freezes at 17.5 s, or a breath that snaps off at 20 s, is not seen to end. On an idle page a value that is
  no loop is not asked to rest, so a float of two sines, a 10 s float, a bob that sinks a little each cycle,
  and a spring that never settles (damping ratio 0.01, still 5 px wide after 10 s) pass there.
- Known limit: a value that wraps or steps on purpose reads as a pop on a page that cannot declare it, and
  fails the envelope and `suddenJumps`. A bar names its stepped values in `stepped`; any other page has no
  way to. The wrap of a CSS marquee (translateX from 0 to -50%: 299.167 px in the frame after 6000 ms, or a
  400 px tile at 80 px a second that wraps every 5 s), a skeleton shimmer whose 600 px reset happens off its
  box, a spinner on `steps(12)` (30 deg every 83 ms), a quartz second hand that jumps 6 deg once a second, a
  blinking caret, and the opacity restart of Tailwind's `animate-ping` all fail. The same marquee reported
  as an unwrapped offset passes.
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

**Sudden jumps (`suddenJumps`).** No value moves in one frame step what it should spread over the
step. It is Gate A's sudden-jumps check, run on every page.

- The gate examines each 1/60 s step in which a value moves at least 5% of its range, or more than
  2.5 times the larger frame step beside it, so a snap in a long move is found too. A step of at most
  the value's unit floor (0.5 px, 0.5 deg, 0.01 ratio, 0.01 opacity, 0.002 scale, 0.017 s) is too small
  to see and is not examined, and a value whose whole range is within its unit floor is still. A value
  with no unit is still only when its range is rounding noise.
- Each examined step is seeked again at eight even sub-steps, with the eight before it and the eight
  after it. The step fails when a span of 1, 2 or 4 sub-steps moves more than 2.5 times the larger of
  the two spans of the same width beside it, and carries at least a third of the step's change. An
  ease, a spring or a speed corner changes gradually and passes. A hold, a jump and a hold fails at
  every offset inside the frame. A shake that puts 51% to 69% of a leg in one frame passes, since the
  leg is smooth between its frames.
- A cusp is no jump, however much it stands out. circInOut (Motion, GSAP, Penner) has a square-root
  cusp at its midpoint, and cubic-bezier(1,0,0,1), a plain CSS ease, has a cube-root cusp: the speed
  has no bound and the value does not jump. Their sub-steps stand out from their neighbours by 2.6 to
  2.9 (square root) and 4 to 5 (cube root), and a steeper cusp stands out by more, so no cap on that
  ratio tells a cusp from a jump. What does is the largest change in a window of the step as the
  window is cut in half. The step is seeked at 256 even sub-steps, and 32 more past each end of it,
  and a window that overlaps the step slides over them, 1/8, 1/16 and 1/32 of a frame wide. So a cusp
  in the last or first tenth of a frame is read whole. A jump keeps its size (0.98 to 1.0 of the one
  before in a smooth move, 0.86 then 0.92 for the smallest jump examined), and a cusp's shrinks (0.71
  for a square root, 0.80 for a cube root, 0.84 at the most). The step shrinks as a cusp does when its
  largest window falls to 0.88 of the one before at both halvings. A tween of a few milliseconds
  shrinks too (0.5), so a span as wide as the one that stood out, centred on the step's steepest
  sub-step, is also seeked at 128 even sub-steps. The largest change in 2 of them against the largest
  in 8 is 0.40 to 0.67 for a cusp, and 0.25 to 0.33 for a tween, whose speed is bounded. At 0.36 or
  more the speed has no bound.
- A cusp whose speed has no bound passes where the value leaves a hold or reaches one: an ease-out or
  an ease-in at a vertical tangent, such as cubic-bezier(0,1,0,1), circOut or circIn. The value is
  still (within 1/10000 of its range) for a frame up to the cusp and still moving a frame after it,
  or still for a frame from it and moving a frame before it, read at both ends and the middle. So a
  flick of 2 to 10 ms, which is back at rest a frame later, is no ease-out and no ease-in. The cusp
  may sit just past the frame's edge. Such a cusp passes where the value turns too: it runs one way for a frame into the cusp and back for a frame out of it, as out on
  circIn and back on circOut does (a bounce).
- Any other step that shrinks as a cusp does passes only as the middle of a steep ease: a true cusp,
  or the straight middle of cubic-bezier(x1,0,1-x1,1) with x1 from 0.9 to 0.995, which is often far
  narrower than a frame. That middle is the top of one bell. Each frame step beside it moves the same
  way, at least 0.02 of the step and at least 1.25 times the step beyond it. The ease's flanks carry
  0.115 to 0.59 of the step at any range, so a scale of 1 to 1.02 passes, and fall away by 1.30 to
  2.7. A flick's tails carry at most 0.0063 of its step, a hold beside a flick moves 0, and beside a
  tween in a steady move the step beyond moves as much (1.0 to 1.07). And a window that slides over
  the three frames, halved from two frames to 1/16 of a frame, keeps no more of the change at each
  halving than at the one before, give or take 0.02 (a tween holds its size once the window covers
  it). So a flick of 2 to 20 ms on an eased curve fails, circInOut and cubic-bezier(1,0,0,1)
  included: in a hold, as a recoil, or one way inside a steady move.
  Known limit, measured at 64 start phases a frame: a cubic-bezier(0.98,0,0.02,1) tween retargeted from
  where it is at u = 0.5 or 0.53 (an interrupted transition) stops dead at its fastest and passes at 0
  to 50 of 64. Penner's and GSAP's expo.in and expo.out leave or reach rest with a true jump of 2^-10 of
  the range, and expoInOut with 2^-11: over 5000 px, 600 to 1200 ms, that is 2.4 to 4.9 px, and it fails
  at every phase. A linear tween of 20 ms is smooth at the sub-steps and passes at every phase, in a
  hold, inside a move or as a recoil. A flick of 20 ms that leaves or reaches a hold at a vertical
  tangent (circOut, circIn) lasts more than a frame, is still moving a frame past its cusp and passes
  as an ease at 46 and 45 of 64 (the same flicks of 2, 5 and 10 ms fail at every phase), and a recoil
  out on circIn in 10 or 20 ms turns at one and passes as a bounce at 47 or 46. A flick of 40 px at the top of a fast ease-in
  moves about as much as the ease's own frame steps and is often not examined (19 of 24 such cases pass
  at 4 to 64 of 64). A snap of 10 to 40 px on a steep in-out ease, planted at u = 0.2 to 0.8 on 15 eases
  (cubic-bezier(x1,0,1-x1,1) for the ten values of x1 from 0.83 to 1, cubic-bezier(0.9,0,0.4,1),
  cubic-bezier(1,0,0.5,1), expoInOut, circInOut and quintInOut): at u = 0.5, 30 of 45 cases pass at
  6 to 64 of 64 (the snap is read as part of the ease), and at the other u 45 of 270 pass at 2 to 64
  of 64, 43 of them 10 px snaps too small beside the ease's own steps to be examined. A snap where an
  ease leaves or reaches a hold at a vertical tangent is read as part of the cusp (10 of 12 such cases
  pass at 54 to 64 of 64). A 10 px snap at the start or end of an ordinary ease is often not examined
  (3 of 36 such cases, on linear and cubicOut, pass at 16 to 58 of 64). A flick of 120 px in 2 to 20 ms
  inside a move of 3000 px over 2000 ms (25 px a frame, under 5% of the move) is missed at some phases:
  linear at 5, 11, 21 and 64 of 64 (2, 5, 10 and 20 ms; a flick that falls across a frame edge puts
  about half of it in each frame, and neither stands out), circInOut at 2 to 14, and
  cubic-bezier(1,0,0,1) at 1 to 6. A snap of 20 px in the middle of a move of 1000 px (a cubic in-out
  over 600 ms, about 42 px a frame there) passes at 64 of 64. In a probe of 1,296 tweens of 2 to 10 ms placed across each ease, the rule misses 163 on
  cubic-bezier(0.98,0,0.02,1), 361 on (0.9,0,0.1,1), 103 on (1,0,0,1) and 147 on circInOut, most of them
  on the ease's middle. A swing that crosses home as |s|^0.2, a cusp far steeper than any ease's, tops
  one bell as an ease does and passes at every phase.
- Not examined: a step that starts from two frames before a cut to one frame after it. With an
  input, the one step in which a press lands (a pointer's first sample, or a press after a lift) or a
  scroll burst starts: the page answers the start with a response that is out of proportion to the
  input's step (a thumb that jumps to the press, a body that tilts as it is grabbed, a toast that shows
  on the first scroll tick), and the input has no pace yet to compare it with. A step before or after
  it is examined. With an input, a step in which the input moves (the pointer's larger move along an axis, the scroll's move)
  when the value moves at most 2.5 times as far per px of the input as it does in the lower median of
  the other frames where both move and the value moves more than its unit floor. So a value that
  follows the hand one to one, or a raw scroll-linked value held between scroll samples, passes. Two
  lurches in a row do not excuse each other, and a value the input does not move gets no excuse from
  one frame. The sub-steps of an excused frame do not count beside the step next to it, unless that is
  the only reason the step stands out (a value that follows the hand at a steady speed and stops dead the
  frame after: a speed corner, which passes).
- Known limits of the examined steps. A tween of a frame or two (14 to 25 ms) is a jump at 60 fps that the
  sub-steps may not tell from a fast ease: a 60 px jump in a fall of 79 px frame steps is found when it is
  spread over 8 or 12 ms, and passes over 15, 17 or 25 ms. A jump spread over a whole frame by render
  interpolation has an equal neighbour at every sub-step and passes (79 px against 18.3 px before it, 4.3
  times). A 200 px move done as one 16.7 ms tween that starts half a frame in reads 100 px then 100 px on
  the grid and passes; shifted by 0.03 ms, it fails the envelope. A page that moves a value in whole frames
  only is skipped with a note, so a 60 px teleport mid-fall in fixed-step physics with no interpolation (79
  px against 17.5 and 19 px beside it) passes, and a hand-written spring that integrates whole frames fails
  where its steps turn small. A ball on fixed 1/120 s physics steps with no interpolation fails, because
  half of each frame's change lands in one sub-step (15.625 px in the frame after 550 ms, 7.708 px in its
  first half). The gate reads the frame grid at start phase 0, so a glitch between two frames is never seen:
  a 20 px flick up for 10 ms, or a 60 px teleport for 10 ms, in each 2 s loop passes, though a 120 Hz screen
  shows it every cycle. A step is examined by its net change, so a jump against the motion hides: a slip of
  10 px back in a move of 3 px a frame (net step -7 px, 2.33 times the steps beside it, under 5% of the
  range), a lurch of 55 px for 2 frames at the top speed of a 2000 px move (2.26 times its neighbour, 4.9%
  of the range), and a 16 ms flick of 110 px across a frame edge in a 2000 px move (about 95 px against 43.6
  px elsewhere) all pass. A move rounded to whole pixels shows a step of 1 px beside a hold at the slow end
  of an ease, and every sub-step of it looks like a 1 px snap on a still value, so it fails. A raw scroll
  mapping or a rubber band under a drag, whose gain changes by more than 2.5 times across the input, does
  not keep the input's pace, and fails. The press-frame and scroll-burst-start exemptions cover every value,
  not only the ones the input drives: an ambient 60 px bob whose clock a tap restarts snaps 19.74 px home in
  one frame, and a header that hides in one frame (0 to -64 px) on the first scroll tick, and both pass. Two
  scroll lurches excuse each other when theirs are the only two frames that carry a gain (a value that jumps
  500 px as the scroll passes 150 px and jumps back when it returns). A grab pop in the step a press lands
  in is not examined, and one of up to 2.5 times the pointer's step passes under a drag. A measured value
  that jumps for real (an unweighted centre of grains that die one by one) is a wrong value: weight a centre
  by what is drawn.
- A value that is NaN or Infinity in a frame is for `values`, and a stepped value is for `stepped`.
- A page that moves a value in whole frames only (a seek that ignores the part of a frame past the
  last whole one) shows a hold and a jump at every frame. Four frames or more in a row of that are the
  page's own clock: the gate cannot read between them, skips them and prints a `note:` line. One
  teleport on such a page still fails.
- The line: `suddenJumps: <name> moves <d> in the frame after <ms> ms, and <d2> in its first half; no
  cut marks it`.

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

**Tweens (`tweens`).** A sim page's control may act out its meaning with a keyframe tween beside the
bodies (a tile that bobs or shakes as it is tapped), and `energyFalls` leaves it out. Only a sim
page may name tweens: on any other kind a non-empty `tweens` fails with `tweens: only a sim page may
name tweens`. A CSS `ease` segment ends at
zero speed and the next starts at 0.4 of its mean speed, which reads as a bounce that rises, and a
kick at a body's apex looks the same, so the name is guarded.

- A copied bar's `trace.json` may name values in `tweens`. Each must be a value the page reports, it
  must change over the frames the rules read, and after every cause it must end where it was just
  before that cause (within its unit's floor) and hold still there for 3 frames. A thrown body lands
  elsewhere, so it cannot be named.
- Inside each cause's window the value's peaks (its local extremes, as distance from home) never
  grow: a bob has equal peaks, a shake falling ones. A later peak further from home than an earlier
  one by more than the unit's floor fails (`swings further from home`), so a body that hops 10, 20,
  then 40 px and lands at 0 each time cannot be named to hide a rising bounce. A peak within the
  floor of home is noise and does not count. A small dip before a larger swing (an anticipation)
  reads as a swing that grows, so it is left out.
- Each cause is judged from its start to the next cause. A tween the next cause cuts off while it
  still moves is not read at its end, and the next cause's tween must come back to where this one
  left. The last cause's tween must be at rest where the frames end.
- Every other rule still reads a named value: the envelope (a named tween that pops still fails),
  overshoot, values, `restsInTime` and reduced motion. A page whose only `px` or `deg` value is named
  has no body and fails `energyFalls`.
- Known limits of the tween guard. At 60 fps a shake with equal peaks reads its peaks up to one frame's
  travel apart, so it can fail `swings further from home` (a linear shake whose peaks read 8.333 then 9.167
  px fails, and so does one that reads 28.252 then 29.953 px). A shake that ramps up by design (1, 2, 4 px)
  fails the same way, named or not (0.989 then 1.946 px). A named body that gets a push in mid-air which
  raises no later peak passes (a push of 5.556 or 8.889 px of speed in one frame).

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

**Extents (`extents`).** A value that is an edge of many moving parts, such as the box around 24
cards on one canvas, turns when another part becomes the extreme one, not because a body passes its
rest. A copied bar's `trace.json` may declare it in `extents`. The page reports each part as an
object, so the parts have boxes the `drawn` rule checks against the screen. A page that declares
none passes.

- `extents` maps a value name to `{ edge, parts }`. `edge` is one of `top`, `bottom`, `left`,
  `right`, `width` and `height`, and `parts` lists 2 or more distinct objects of `__state().objects`.
  The value must be a `px` value the page reports, and each part must be in the object record.
- In every frame where a part is drawn, the value must equal that edge of the union of the drawn
  parts' boxes, within 0.5 px (the `px` floor): "extents: `<name>` is not the `<edge>` of its parts
  at `<ms>` ms". A part is drawn when its box is not gone (1 by 1) and not wholly outside the
  viewport. A frame where no part is drawn is not judged.
- The parts must be a group: 2 or more are drawn in more than half of the frames where any part is
  drawn. So neither a single body nor one beside a part that is never drawn, or drawn with it for only a short while, can be named.
- The edge must pass from one part to another: in some frame step, the part at the extreme of the
  edge, among the parts drawn in both frames, is another one. "extents: `<name>` is held by
  `<part>` throughout; an extent is an edge that passes from one part to another". An edge held by
  one part throughout is that body's own value, however many parts sit beside it, a still decoy
  included.
- No part turns round and comes to rest while it holds the edge. A part within 0.5 px of the extreme
  (it holds the edge) turns round when, in a frame, its coordinate along the edge (its top, bottom,
  left or right side; a width or a height has two sides, each read on its own) goes one way by 0.5 px
  or more over the 4 or 8 frame steps before it, and back by 0.5 px or more over the 4 or 8 after it,
  and it then comes to rest still holding the edge: once it has come back by 0.5 px, it holds within
  0.5 px for 100 ms, drawn and within 0.5 px of the extreme all the while. "extents: `<name>` has
  `<part>` turn round at `<ms>` ms while it holds the edge and then comes to rest; a body that passes
  its rest is no handover". How the part moves across the edge does not matter: a body that drifts
  sideways while it springs past its rest turns round all the same. A card that goes on round an arc
  goes through its apex the same way, and gives the edge to the next card before it rests: it is no
  turn. A turn made by one part that then rests is a body passing its rest, so the value is no
  extent, and `overshoot` and the pulse test judge it as they do any value: a value whose guard fails
  is left out of nothing. A turn made while three parts or more hold that side in turn, within 1 s
  before or after it, is the edge of a group, and is not read: a ring of cards that stops with one
  card a few degrees past its apex, or a card whose edge wobbles as it tilts, is not a body past its
  rest. Three holders at another time (a fade-in, an intro shuffle) excuse nothing. A body hidden
  beside two decoys that each take the edge in turn within that second of its turn is not found (a
  known limit).
- Known limits of extents. Honest pages that fail: a ring of 5 or 8 cards that turns one slot rests with 2
  cards straddling an extreme, so a card that crosses the apex counts as turning round; a staggered list, a
  carousel, chip reflow and a notification stack hand the edge over only through membership steps, so the
  guard reads one holder throughout; a fast spark burst's membership step is judged raw past the 5% share; a
  stack that spreads starts in a tie, and the holder picked depends on the order of the parts in
  `trace.json`; and a caused spring past its slot fails the extents rule though `overshoot` would allow it.
  Faults that pass when declared: a part that goes gone for one frame and comes back 800 px away, or the
  same card remounted under a second name; a reflow that snaps every staying chip 25 px, inside the 5% share
  of an inflated range; a 30 Hz blink of the holder; a jolt, or a soft spring, that rests 0.6 px inside a
  still neighbour; one card drawn as 3 aliased layers, which is one object with one box; and an overshoot
  whose apex is handed between two names.
- A value whose extent passes has no attack bound in the envelope's pulse test, and `overshoot`
  leaves it out. Pops, fades, `values`, `objects`, `drawn` and the rules of the kind still read it.
  The envelope reads it as its parts moved it: in a frame step where a part comes back or goes gone
  (its box turns 1 by 1, or leaves or enters the viewport) the edge jumps because who is in the
  union changed, not because a body moved, so that jump is left out of the value's whole change and
  of its pop test, and the step counts for how far the edge moved over the parts drawn in both
  frames. A card drawn in both frames that jumps in that step is still a pop, and so is one that
  jumps in a step where none comes or goes. `suddenJumps` reads such a step the same way: it is
  exempt when that change of the parts drawn in both frames is under 5% of the value's range (the
  share `suddenJumps` judges a step on), and a card that jumps more than that in the step is a jump.
  Every other value on the page is judged in full: a slide beside the ring that springs past its
  rest still fails `overshoot`, and a badge that pulses with a slow attack still fails `envelope`.

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
- A listed cut must be a scene change or a small cut inside the objects. The gate reads it over two
  frame steps: its pair, and the step into the pair's first frame, since a page may switch its scene
  at the cut or after it. It is a scene change when the larger change of the two is more than half
  the viewport, or more than 3 times the most pixels any other pair changes (the ratio is not used on
  a page where no other pair changes at all, so a cut there is a scene change only by its share of
  the view). Any other cut (a part
  that snaps into a slot, a light that flips colour, a panel that appears in one frame) is a small
  cut: it must change some pixels, and in each of the two steps the pixels outside every object may
  be no more than the stray allowance above (1% of those changed, and 64 px). The objects counted
  are the ones that changed in that step, drawn in either of its frames: the frame before the cut
  and the cut frame. A small cut that reaches the background fails, and so does one declared on a
  frame where nothing changes. Neither step is judged for anything else, whichever pair it is
  sampled as. One gap remains: a page that reports no objects is not read for its cuts, so a small
  cut there passes whatever it changes (reading it would turn red the tracked bars that declare cuts
  and report no objects, until they report objects).
- Known limits of a listed cut. A cut written to 3 decimals (1233.333 for frame 74) reads the step a frame
  early and sees no change, so it fails with "the cut at 1233.333 ms changes 0% of the view"; write the
  exact frame time. A cut listed in the middle of ordinary motion hides a teleport inside the moving part's
  boxes (a 167 px skip in a slide), and one cut excuses a jump of every boxed part (a cut on a light that
  excuses an 80 px jump of a card). A scene change is 3 times the most any other pair changes, so on a page
  whose other motion is slow or small any glitch counts as one. A cut on a frame where nothing changes
  passes on any moving page, and its exemption of the 2 frames before it hides a teleport there. Only the
  first 16 cuts are read, though every listed cut exempts its frames, so a glitch behind the 17th cut of a
  ticker passes; 13 cuts listed on a stutter's catch-ups pass; and a 2-frame full-view white flash with both
  edges listed passes. A 3-frame blink whose second cut falls in the first cut's onset window fails the
  envelope.
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
- A value declared in `extents` (see Extents) whose guard passes is left out.
- A pulse (its first turn is its farthest, within 500 ms, and it comes back at least halfway) is
  no overshoot, and neither is a sway that turns at the same two levels.
- A designed loop (see the envelope rule) may settle past its rest by up to 50% of its move, once
  its lead-in ends, when each cycle holds still (within half its unit's floor) for 3 frame steps: a
  loader's squash, a relay of hops, a breath, a badge that springs in. A one-time spring at load, an
  endless bounce that never holds still, and a loop that pops still fail. Opacity never overshoots,
  in a loop too.
- On a choreo or sim page, the lead-in of a loop a cause started (the value did not move before that
  cause) is a move the person caused: it may pass its rest from the cause until the lead-in ends, as a
  spring does. A loop that moves before the first cause is the page's own, and a tap in its lead-in
  does not excuse its spring.

**The loop stops at rest (`loopStopsAtRest`).** No rAF callback runs in the second after the page comes to rest.

- The page is at rest when no value has moved by more than 0.001 for 150 ms on its live loop, and every value that is no
  loop (on a page with a loop too) has changed by no more than its unit floor in total over the last second. A creep too
  slow for two reads 50 ms apart to see, 0.02 a second, is no rest: it changes a scale by 0.02 in a second, over the 0.002 floor.
- On every kind but idle, the gate plays the input, then waits for the sequence to end, as the `?seek`
  frames show it: a pause inside the sequence (a gate that fades out, a blank beat, then the next
  page arriving) is no rest. There every value but the loops must rest where its `?seek` frames end, within its unit
  floor (0.01 of its range for a unit with none), on either side: a live page that stops in a pause,
  or partway through a fade, with the rest of the sequence never played, fails, even when the value ends where it started
  (a toast that never leaves), and so does one that runs past the end (a panel that flies on past its slot, a badge that grows
  to 3). A page draws its random values from a seeded stream, the same in live play as under `?seek` (reseeded where each
  sequence starts), so a live run lands where its `?seek` frames end. Known limit: a page that draws unseeded random values
  live can fail the rest compare. A spring that bounces or a pop that backs out must land at its `?seek` rest too: a stall at a
  peak fails. A value the `?seek` frames report and the live page never reports (a late element
  that never mounts) fails. A live frame may run longer than 1/60 s, which does not change where a page that has stopped
  lands. A value the gate sorts as a loop may keep
  running: the page is at rest when every other value is, and the loop must pause off screen (see that
  kind's rules).
- Known limits of the rest compare. A value that comes back to where it started cannot be told from one that
  never played: a toast that slides in, holds 4 s and leaves, or fades 0 to 1 to 0, passes when the live
  page never shows it. A unit with no floor gets 1% of its range, so a count-up from 0 to 10000 that stops
  at 9920 passes. The read ends 15 s past the stop, so a toast that holds 16 s on a timer and never leaves
  live passes. The gate waits for the `?seek` sequence to end, so a live beat more than about 1.1 s longer
  than the seeked one (a reply that waits 2.4 s live and 1 s seeked) reads as mid-beat and fails. A fling
  whose exponential tail moves less than 0.001 px per 50 ms counts as quiet while the page is still 0.01 to
  0.02 px from its snap, and a spring that ticks 0.0001 px for 3 frames past its rest counts as moving, so
  both fail. A chip that hops 3 px every 1.2 s beside a loop passes, because the quiet second between hops
  reads as rest.

**The console stays clean (`consoleClean`).** No error, warning or uncaught error, on the `?seek` run or the live run.

**Reduced motion (`reducedMotion`).** On a scroll page this rule is the stepped-states rule below.

## Rules for scroll pages

A scroll page answers the scroll position.

**Loops.** As on a choreo page, a value that repeats at a fixed period, or moves at one steady speed, is a loop. It may keep
running, and it gets the idle rules: it pauses off screen (`pausesOffScreen`) and resumes and keeps moving (`resumes`). The gate plays the input before it looks, so a loop the input starts is running then. Known limits: `pausesOffScreen` and `resumes` run only for loops. A page with no loop that pauses when hidden and never resumes passes. A page that restarts only its loop on return passes when a delayed toast has not begun at the trip, because the toast rests where it started either way. A catch-up burst on return (0.3 s of missed time played at 5 times the speed for about 75 ms) passes, because `resumes` checks that a frame runs and the loop moves, not how fast. Known limit: `reverses` reads a loop like any other value, so a scroll page with a loop value passes or fails it by the loop's phase when the scroll turns (a scale breath of 0.1 passes at periods of 1.3, 2 and 3.1 s, and fails at 2.7 s: it moves 0.092 while the page scrolls down, then -0.021 when it scrolls back).

**Scrolling back reverses it (`reverses`).** Each value that moves while the page scrolls down moves back at
least 50% of the way when it scrolls back to the top.

**A stepped drawing is held to the scroll (`scroll`).** From the first scroll sample until the values rest after
the last one, a stepped value (a flipbook drawn by the scroll) that moves an object, is not an index, and has a gain
is held to the scroll in its own drawing steps, by the checks of the live `follows` rule: its drawing step is the
median change of its non-zero drawing steps there; no drawing taken while the scroll moves one way lands more than
1.5 drawing steps, plus the scroll's own travel over the drawing before it (times the gain), ahead of where the scroll
puts it; no step jumps off the scroll by more than 1.5 times the largest of the drawing step, that travel and the
step before it when the drawing between the two is shown under 100 ms, unless the scroll holds still across the step
and the step is at most one drawing step more than a same-way step next to it, before or after, whose drawing is shown
under 100 ms (a chase of 1 to 2 drawings a frame rounds to steps of 1 and 2); and the out-and-back test of the pop
checks runs here too. The scroll puts the value at its value before the input plus its gain times how far the page has
scrolled since (a page opens at the top). The gain is read from rests, not from a fit, since a page that smooths the
scroll lags it. A rest is where the scroll holds and the value holds still over its last 3 frame steps there. The gain
is the median of the gains read between rests one after another, a pair at the same scroll left out; with none, it is
read from the value before the input to the rest furthest from it in scroll. A value that lags the scroll is behind
it, never ahead, so a chase that skips drawings passes. Each value reports its first failing step only:
`scroll: <name> at <ms> ms runs <n> of its drawing steps ahead of the input`, `scroll: <name> at <ms> ms jumps <n> of
its drawing steps off the input in one drawing`, or `scroll: <name> at <ms> ms jumps <L> object lengths and back in
one drawing; that is a teleport`. The envelope rule does not report that value's steps there again. A stepped value
with no rest away from the top has no gain, and it or one that moves no object is not judged by this rule: the pop
checks judge it there instead. A known gap: a page that scrolls once and stays ahead, with no second rest, is judged
with a gain that took its offset in, so it can pass. Another: while the scroll holds still, a fault of one drawing
step that the rounding allowance covers passes.

**Reduced motion: stepped states (`reducedMotion`).** Under `prefers-reduced-motion: reduce` the
scroll still answers, but the page moves between a few still states, not with the scroll. There is no
continuous scroll-linked zoom, parallax or transform. A loop is no value that answers the scroll: it holds still under reduced motion, and the blank-start check leaves it out when its start state lies inside its own swing (a fade-in, then a glow, is an entrance and is judged).

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
  motion: an entrance. The last frame under reduced motion must not be that state. An angle (`deg`)
  comes back after a whole turn.
- The page must be tall enough to scroll 50 px.

**The input.** 3 wheel ticks of 100 px down, 50 ms apart, then 3 ticks back up after a pause, at
the viewport center. Under `?seek` the samples are `window.__input`, each `[ms, scrollY]`:
the scroll position the wheel ticks set at that time (a page that smooths the scroll chases it).
The page must be tall enough to scroll 300 px. The input starts 250 ms in. A page still moving
then from its load motion (what it does with no input, watched for 15 s) gets the input 250 ms
after that motion ends, so the rules judge only what the input moves; a page that never comes
to rest keeps 250 ms. The rules read at least 3 s, and 1000 ms past the end of the sequence the input starts: the last move of
a value that is no loop, looked for up to 15 s past the input's last sample. A value still moving there fails `span`.
