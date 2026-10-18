# 31 Breath pacer: notes

One file: `index.html`. No libraries, no build step. It opens from `file://`.

## What the page teaches

A drawing that never rests, and a chrome that swaps in about 0.38 s.

- Five line drawings each run on their own clock. Dots move at constant speed along a path. A soft disc or rows that trade places carry the breath, not the dots.
- A mode swap is one shared recipe, timed from the cut (the frame the text swaps). The whole card dips to 0.9853 scale about a point below the drawing. The title slides 19.9 u and hard-cuts to the new text. Then the old drawing fades out (ease-out) while the new one fades in (S-curve). There is no overshoot and no spring.
- The state at time T is a pure function of a swap list. A frozen frame and a live run draw the same thing, so the page is easy to test and to record.

## How to reuse it

- Copy the file. Change `MODES` (title and sub text) and the `DRAW[]` functions. Keep `MOTION`, `stateAt`, `render`, the swap code and the page clock as they are.
- Keep exactly 5 modes. The fixed swap schedule (`scheduleCuts`, played by `?schedule=1` and `?seek`) names modes 1 to 4, so with fewer modes the page throws.
- A drawing is `DRAW[i](tm, alpha)`. It draws in u units from the drawing center, from `tm` (seconds since that mode's cut) and `alpha`. The swap code handles the fade.
- Constant-speed dots on any ellipse: `Ellipse(cx, cy, a, b)` builds an arc-length table, and `.at(s0, speed, dt)` returns a point.
- `disc()` draws the soft ring: a clear hollow, a rise to the edge and a crisp outline. `lobe()` draws the belly lobes.
- Inputs: tap, left swipe, arrow keys, space. A tap starts the out phase at once, and the cut lands 9.7 frames later.
- `?schedule=1` plays a fixed swap schedule: cuts on frames 300, 513, 662, 909 and 1140. `?auto=3.6` swaps on a fixed gap. `?freeze=12.3` draws one frame at that time (add `?schedule=1` for the fixed schedule).
- Reduced motion: each mode shows a still frame of its rest pose, and a tap swaps with a hard cut. No loop runs.
- The loop caps one time step at 0.05 s. It runs while the page is on screen, pauses when the page is hidden, and starts again on the next frame when the page comes back.

## The dial

`MOTION.reso.loopS` (4.0 s) is the `idle.period` dial. It sets the resonance breath: the disc hollow and the corner arcs. The two dots keep their own speed, `reso.dotSpeedU` (162 u/s on a 103.2 u circle, one lap in about 4.0 s). To change the period and keep the dots in step, change both.

## Gate hooks

- `?seek` starts no live loop and plays the fixed swap schedule. `window.__seek(ms)` runs the page clock from 0 to `ms` in whole 1/60 s steps, then one shorter step, and draws that frame.
- `window.__state()` reads the page's own state. From the resonance drawing: `dotA` is dot A's angle on its circle, in degrees; `hollow` is the radius where the disc first gets brighter than 10/255, in px; `arc` is where the top-left outer corner arc crosses the row 120 u above the center, in px. From the swap: `title` is the title's on-screen x shift, in px; `scale` is the shared card scale.
- Events: `loopWrap` is the first time the resonance loop wraps (4000 ms). `firstCut` is the first swap's text cut (5000 ms on the fixed schedule).
- `trace.json` has two windows: 0 to 4683 ms (the resonance loop, before the first swap) and 10667 to 11667 ms (the third swap). A value of `null` is a channel that window does not measure: the resonance channels in the swap window. `cuts` lists the text cuts at 5000, 8550 and 11033 ms.

## MOTION values (all in the `MOTION` block at the top of `index.html`)

Swap: the out phase starts 9.7 frames before the cut and runs easeInOutSine over 8.9 frames, with title dx -19.9 u and scale 0.9853. The title comes in from +19.5 u over 13.05 frames (217 ms) with cubic-bezier(0, 0, 0.58, 1), from 0.8 frame before the cut. The scale returns from 1 frame before the cut, on the same bezier over 13.2 frames. The old drawing's opacity is (1 - p)^2 over 11.6 frames from 0.6 frame after the cut. The new drawing fades in on easeInOutSine over 14.8 frames from 0.1 frame after the cut. The page dots are round (5.25 u idle, 11.25 u active). The old one shrinks on easeOutCubic over 11.8 frames, and the new one grows on easeOutCubic over 17 frames, both from 1 frame after the cut. The scale origin is 65 u below the drawing center.

Paint: main lines at 0.73 alpha (peak about 180/255), guide lines at 0.13. The resonance disc ramp power is 0.75. Sigh mode has a faint guide circle, r 155.3 u. Box ring dots sit at -90, 32.4 and 147.6 deg.

Resonance: loop 4.00 s. Dots run at 162 u/s, linear, on two r 103.2 circles. Dot A is at the top at 237 ms, and dot B is A turned 180 deg. The disc hollow holds at 41.5 u from 0.50 to 0.62 s, runs linear up to 126.5 u at 2.24 s, then linear down to 41.5 u at 4.50 s. The disc edge is r 164, peak 31/255. The corner arcs bow 12.9 u on the hollow's timing, sine-eased.

Box: rim dots at 142 u/s, linear (4 dots, 168 u apart in pairs). 3 ring dots at 120 deg on the junction ride the disc edge. The edge is 84 u at tm 0.3 s and grows 6.4 u/s. The hollow is 51.5 u and grows 10.2 u/s.

Sigh: vertical-ellipse dots at 157 u/s, horizontal-ellipse dots at 134 u/s (3 dots, one unpaired). 4 soft rings travel 189 u to the center on the 100 ms step table (peak about 120 u/s), radius 16.3 to 33.5 u. The faint loops hold still at 30 deg.

Alternate nostril: dots at 100 u/s, linear, on two 59.5 x 96.3 ellipses at x plus or minus 104. The faint loops turn 36.0 deg/s from 30 deg at the cut. The disc ring is still (hollow 43, edge 72.5).

Belly: the first breath is linear with a hard stop (B1 and A2 at tm 1.45 s, A1 and B2 at 1.683 s). Then the rows turn every 1.42 s on an ease (0.75 sine + 0.25 quad). The row ranges are in the block.

## Limits

- Box mode runs a plain 4-4-4-4 count (inhale, hold, exhale, hold, each 4 s).
- After the first breath, the belly rows repeat one 1.42 s half period.
- Every swap uses one fade curve for the old drawing.
- Page dots are SVG circles, because CSS boxes snap to device pixels and jitter while the card scales.
- The titles and subtitles are placeholder copy.
