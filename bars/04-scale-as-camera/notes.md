# 04 Scale as camera: notes

One page: `index.html`, with its three font faces in `fonts/` (Unbounded 700, Lexend Exa 300 and Lexend 600, from @fontsource 5.2.5, under the SIL Open Font License; `fonts/OFL.txt` holds the license and each family's copyright notice). No build step. It opens from `file://` and makes no network request, so it works offline. Copy the `fonts/` folder with the page.

A dark intro cuts to a lit window, drawn in code. The scroll then grows the window frame past the screen while three layers move at three rates, so one scale change reads as the camera flying through the window.

## What the page teaches

1. One scale stands in for camera travel. The text plane scales 1 to 8 and spreads apart. The cabin (wall, frame, shade, vignette) scales 1 to 6.5. The sky never scales: it only rises at half the scroll speed. Fast near and slow far reads as one move forward.
2. Every scroll-linked value is a straight line of one smoothed scroll position. The smoothing is one exponential rule (lambda 6 a second). So the zoom is two-way and has no overshoot.
3. The order of the zoom over 1800 px: the type is gone by about scroll 450, the frame clears between 720 and 1000, and the rest is pure sky.
4. Colour does the rest of the work: warm dark brown, a cut to warm light, then the cool blue of the sky. There is no crossfade.
5. The load is a second lesson: a dark hold, one hard cut, then about 2.3 s of overlapped settling (nav, shade, headline characters, intro fade). After that only the cloud strip moves.

## How to reuse it

- Change the feel in `MOTION` only. Every motion number is there, with its row (see "MOTION rows" below).
- Keep the layer order: sky, wordmark, cabin (ring, shade, wall, frame, contact shadow, vignette), text plane, fixed header and action bar, intro screen.
- Swap the object, not the rates. The frame is three superellipses in `GEO` (outer edge, opening, glass). Anything with a window works: a lens, a door, a phone screen. The cabin must have a hole, so the unscaled layer behind it shows through.
- Keep the rates: cabin 1 to 6.5, text 1 to 8, sky 0.5 px per scroll px. The order (text fastest, sky slowest) makes the depth.
- The driver is `frame()`: a capped time step (`maxStepMs`, 50 ms), the wheel adds to a target, `follow()` chases it, `scrollTo` follows, and one `renderScrub(y)` writes every transform from `zoomAt(y)`. Keyboard, scrollbar and touch scroll jump to the position, and the same scrub follows.
- For a tap or timed driver, keep `renderScrub` and replace the wheel target with a timed tween of the same 0 to 1800 value.
- The art is drawn in code in 7 ms slices from a small job queue (`enqueue`), so the intro never stalls a frame. The cut waits if the art is late.
- The loop asks for frames only while something moves: the intro, the dark hold, a smoothed scroll or the lead reveal. At rest it stops. The cloud strip and wisps are CSS animations.

## The dials

`MOTION.lambda` (6.0 a second) is the `scroll.smooth` dial: each frame covers a share of what is left, 50% at about 115 ms and 99% at about 770 ms. `MOTION.maxStepMs` (50 ms) is the `scroll.maxStep` dial: a stalled frame moves the scroll by at most 50 ms of smoothing.

A 25% change to `maxStepMs` (62.5 ms) is below what the gates can see. A cap acts only on a frame longer than the cap. Under `?seek` every step is 1/60 s, and the gate's 2000 ms clock jump is far over both caps. So the cap's presence is checked (the "no time-step cap" fault), not its exact size. Every cap dial has this limit.

## Gate hooks

- `?seek` starts no live loop and ignores wheel and scroll events. `window.__seek(ms)` re-runs the page from 0 to `ms` in whole 1/60 s steps, then one shorter step, and draws that frame. On the way it plays `window.__input`, the recorded scroll targets `[ms, scrollY]`. A step from a to b moves toward the target set at a. So a tick's sample sits one frame before the first frame that moves. The CSS cloud animations are paused at the same time.
- `window.__state()` reads the page's own state. `scroll` is the smoothed scroll position, px. `cabin` and `text` are the two layer scales. `sky` is the sky layer's y on the screen, px. `tagline` is the opacity of the last tagline line, `header` the nav bar offset in px, and `title` the opacity of the last headline character. The last three let the gate see the intro.
- `trace.json` holds 8500 to 22000 ms of scroll: 9 wheel ticks of +200 px, one a second from about 9017 ms, then a flick back of 3 ticks of -600 px, 150 ms apart, from about 20017 ms. The input is the target after each tick, one sample a frame, on the 1/60 s grid. Four rows near 9040 to 9090 ms are left out.
- The trace keeps true times, so the gate's real-time replay takes about 21 s.
- `cover` lists the intro screen, the header and action bar, the shade, the headline characters, the small text lines, the lead paragraph and the cloud layers. They move, and no trace channel reads them.
- Tolerances: scroll 38.04 px, cabin 0.116, text 0.148, sky 19.02 px. The scroll one is loose because the page's flick back runs about 4% ahead of the trace. On the forward ticks the page is within about 3 px.
- Faults: "linear" makes the follow a constant 1200 px/s ramp, and the trace catches it (930 px off). "no time-step cap" removes the 50 ms cap. The gate's 2000 ms clock jump lands during the intro, so the tagline jumps in one frame and the realClockGap check fails it.

## Reduced motion

There is no intro, no smoothing and no cloud drift, and no continuous zoom. The scroll moves between four still views (`MOTION.reducedViews`, row Z10): the closed window at scroll 0, the type gone at 450, the frame cleared at 1000 and pure sky at 1800. Each view is the zoom at that scroll position, reached in one frame and held until the next one, so the scroll still answers. The lead paragraph shows at once. To change the views, change `reducedViews`; keep 6 or fewer, the kind gate's limit.

## MOTION rows

Easing names: `power3.in` is x^4, `power4.out` is 1-(1-x)^5, and `quart.inOut` is cubic-bezier(0.76, 0, 0.24, 1). S is the instant of the cut; load times are ms after S unless the row says "after load".

- L1, the intro tagline: four lines, from 809, 890, 969 and 1050 ms after load, blur 36 px to 0 and fade in, 1190 ms, power4.out. Line 1 is an empty spacer.
- L2, the dark hold: S is 3360 ms after load.
- L3, the cut: 200 ms after S. A soft dark veil at the top then slides up and out in about 315 ms (`veilStops`, `veilA`, `veilB`).
- L4, nav down and action bar up: from S+473, 1366 ms, power4.out, from -72 px and +120 px.
- L5, the shade lifts and its face squashes to 0.5: from S+417, 1200 ms, quart.inOut, 433.263 px. The rail rises 557 px.
- L6, the headline characters: from S+765, a 50 ms stagger, 1190 ms each, power4.out. Small text lines use a 100 ms stagger.
- L7, the intro leaves: each line blurs out from S+419 with an 18 ms stagger, 600 ms, power3.in. The layer fades from S+817, 726 ms, power4.out.
- L8, the contact shadow: same curve as L5, from S+816.
- L9, the light bloom: the sum of L3 to L8, no value of its own.
- I1, the cloud strip: 5836 px every 48 s, linear, always on.
- Z1, the smoothing: lambda 6.0 a second, time step capped at 50 ms.
- Z2 to Z5, the zoom over 1800 px of scroll: cabin scale 1 to 6.5 and x 0 to -28.8, text scale 1 to 8, the text blocks spread 720 px each way, the sky rises 0.5 px per scroll px. Origin (720, 450).
- Z6, the frame clears the screen between scroll 720 and 1000. It follows Z2.
- The wordmark: from the middle of the window to the header slot on the CSS `ease` curve over the zoom, a 396 px rise, scale 1.25 to 1.
- Z7, the hero lets go at scroll 1800 and scrolls away.
- Z8, the lead paragraph: plays once when its top crosses 85.33% of the screen, 1190 ms, power4.out. Z8b: its characters ink in with the scroll, from 0.2 opacity to solid over 592 px, with a 4 character soft edge.
- Z9, scroll back: Z2 to Z5 run backward on the same smoothing.
- Z10, reduced motion: four still views at scroll 0, 450, 1000 and 1800, each the zoom at that position.

## Limits

- The wall, frame, shade, sky and clouds are drawn in code. The shapes are superellipses (exponent 2.5).
- The cloud strip's top edge shows a faint seam against the sky's haze. Setting the strip's top gradient stop to rgba(206,213,233,.95) removes it.
- The scroll cue uses the 100 ms small-line stagger.
- The lead paragraph plays once and stays.
- The page scales the 1440 x 900 stage to cover the screen, so a phone shows the middle of it.
- The fonts and the copy are placeholders.
