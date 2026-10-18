# 13 Drag past a threshold: notes

One file: `index.html`. No libraries, no build step. It opens from `file://`.

A zipper closes a phone screen. The finger pulls the slider down, and a V-shaped gap opens above it. A short pull springs back shut. A long pull commits: the slider runs on by itself, the cloth halves part off the screen, and the screen behind builds its header.

## What the page teaches

1. A drag is 1:1 input. The slider top is the finger's y less a fixed grab offset. The 41 px jump in the first frame of the first drag comes from the finger, not from an animation.
2. The release decides. Below a threshold, a damped spring brings the slider home. Above it, a one-shot run plays with no more input.
3. The gap is made by moving cloth, not by clipping. Each row of each half slides outward by the gap half width plus 2.5 px. The teeth, tape and stitches ride on the same shift.
4. The pull tab is a second, smaller physics. It snaps toward the finger on a grab, and swings like a damped pendulum after the release.
5. The exit is a chain keyed to one moment, the commit: run-on, cut, logo rise, letters, rainbow, clouds, home bar.

## How to reuse it

- Change the feel in `MOTION` only. Every motion number is there, with its row (see "MOTION values" below).
- Swap the content: the screen behind the cloth is plain DOM in `#behind`. The cloth, tape, teeth and slider are drawn in `drawCloth` and `drawSlider`.
- Swap the threshold: `commitSliderTop`. It is a position threshold. Add speed to the test in `release()` if a fling should commit.
- The loop is `frame()`: a capped time step (`maxStep`, 50 ms), one `update`, one `render`. It stops by itself once the spring and the tab rest.
- Reduced motion: the drag still follows the finger. There is no spring, swing or header motion. A committing release jumps to the opened screen, and a short release jumps back to rest.
- Keyboard: focus the phone. Enter opens it, and R closes it again. The small icon at the top right also closes it.
- `window.__zip` reads the slider top, the apex, the tab angle and the mode.

## The dials

`MOTION.springOmega` (22.25 rad/s) and `MOTION.springZeta` (0.84) set the spring back, and they are the `live.release` dial: visual duration 0.235 s, bounce 0.16. The spring starts from rest speed, because the finger holds still before it lets go. `releaseLeadMs` (16.7 ms) times all motion after a release from one frame before the frame that sees it.

## Gate hooks

- `?seek` starts no live loop. `window.__seek(ms)` re-runs the page from 0 to `ms` in whole 1/60 s steps, then one shorter step, and draws that frame. On the way it plays `window.__input`, the recorded pointer samples `[ms, x, y]` or `[ms, x, y, down]` in page px, so the state at a time depends on the drag before it. A release seen between two frames keeps the one-frame lead, so the spring has no jump between frames.
- `window.__state()` reads the page's own state. `slider` is the slider top, in px from the screen top. `gap` is the gap's half width on the row 100 px from the screen top, as it shows on the screen: the cloth edge less the teeth, 0 while the gap is shut there. `logo` is the logo's top edge, in px from the screen top, from its rise and scale.
- Events: `grab` is the frame that takes the first press (683 ms), `release` the frame that sees the first release (1183 ms), `back` the time the spring first brings the slider top to rest (about 1366 ms), and `commit` the frame that sees the release that commits (2950 ms).
- `trace.json` holds both drags, 0 to 4617 ms: the tease, the spring back, the commit pull, the run-on and the logo rise. Its input is two presses, `[ms, x, y, down]`, in the gate's 1280 x 720 viewport, where the page scales the phone by 0.8451. Each press lands between two frames. `cuts` marks frame 41, where the finger's first move jumps the slider 41 px, and frame 193, where the last cloth vanishes. A value is `null` where it is not traced: the slider once it is off the bottom, the gap where it is too thin, and the logo before 3100 ms, while it is blurred.
- `cover` lists the title letters, the clouds and the home bar: they move after the commit, and no channel reads them.
- The tab angle is not in `__state()`, a known gap. The tab snaps toward the finger on every grab and holds still under reduced motion, and the live rules read both as faults.
- The slider tolerance is loose (34.9 px): the traced spring back steps unevenly from frame to frame, up to 17 px off the page's smooth spring. The `back` event checks the spring's timing to within one frame.

## MOTION values

All times after the commit are ms since the committing release, which comes 2933 ms into the trace.

- Geometry (Viewport, Paint): 393 x 852; slider top 94.6; ring 68.9 below the slider top; tab pivot 20 below; tab 81 long; gap center x 197.2.
- Gap geometry and Cloth geometry: the apex sits 7.8 above the slider top (9.2 at rest). The half width table runs from 0 to 700 px above the apex. Each cloth row shifts by the half width plus 2.5.
- Input and Threshold: the finger holds the ring. The threshold is a slider top of 426, half the screen. The trace bounds it: a pull to 366.6 springs back, and a pull to 585 commits.
- Row 2 and Row 8, the tab while held: keyframes by ms since the grab. The first grab snaps to 10.8 deg, every later grab to 48 deg.
- Row 5, the spring back: omega 22.25, damping ratio 0.84, start speed 0.
- Row 6, the tab swing: omega 12.26, decay 1.22, start speed -25.3 deg/s, from 16 ms after the release. It rests from its 3rd zero crossing, with no third swing.
- Rows 10 to 13, the run-on: peak 3600 px/s, ease in 24 ms, peak at 140 ms, slowdown 13750 px/s squared, the cut at 284 ms.
- Rows 14 to 16, the logo: rise 129 px, omega 8.9, start 105 ms; blur, opacity and scale as keyframe tables.
- Row 17, the title: 9 letters, a 55 ms stagger, the first at 15 ms, opacity (t / 275) squared, a 6 px rise over 350 ms.
- Rows 18 and 19, the rainbow and clouds: bands start at 650, 700, 720, 770 and 850 ms; the outer band draws in 184 ms and the inner ones in 165 ms; the clouds build from 634 to 1667 ms.
- Row 20, the home bar: grey 240 at rest, keyframes down to 16 by 867 ms, then a fade from 1017 to 1200 ms.

## Limits

- Any threshold between the two traced pulls works; move it with `commitSliderTop`.
- The grab angle rule: 10.8 deg for the first grab and 48 deg for every later one. A drag with the finger left of the tab swings the other way.
- The spring's rest point (0.01 px of swing left) is a page choice, so the loop stops.
- The cloth is drawn in code. The status bar blur is a flat blur of the top 52 px. The logo and the title word are placeholders.
- The `.step` rows behind the cloth have fixed heights, and their headings no width. A heading that wraps overlaps its description, and a 3-line description touches the next row. Keep the copy short, or give the rows a height that grows.
