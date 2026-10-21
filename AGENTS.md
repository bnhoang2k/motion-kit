# motion-kit: instructions for coding agents

Follow these steps for any animation in this project. Never pick a duration, easing or bounce by
guessing. Read it from motion-kit.

Some code names are older than the words in this file and change in the next version: a preset
is `feel`, a setting is `knob`, a reference example is a bar (`bars/`), and a type of continuous
motion is a `kind` (`kinds/`).

## 1. List the moments

Write down each moment on the page that moves. Examples: the first view, an idle loop while
reading, hover over a set of choices, the sign-up tap.

## 2. Decide whether each moment should move

Ask how often a person sees it:

- 100+ times a day (keyboard shortcuts, command palette): no animation.
- Tens of times a day (hover, list navigation): barely any, or none.
- Occasionally (modals, drawers, toasts): a normal transition.
- Rarely (onboarding, success): delight goes here.

Never animate an action started from the keyboard. Then name the purpose in one word: spatial
consistency, state change, explanation, feedback, or avoiding a jarring cut. If the only purpose
is that it looks good and people see it often, drop the motion. Carry on with the moments left.

## 3. Check the reference examples

Open `node_modules/motion-kit/bars/INDEX.md` and read the section for each moment.

## 4. Take one path per moment

- **Copy:** a reference example fits. Copy these files from `node_modules/motion-kit/bars/<slug>/`
  into one folder of your project: `index.html`, `bar.json`, `trace.json`, and the `fonts/` folder
  when the example has one. Keep the `motion-kit-bar` meta tag in `index.html`. The gate reads the
  type of motion from `bar.json` beside the page. Swap the page's assets as the asset contract in
  `bar.json` says, and keep its `MOTION` block as it is: the gate skips its literal check only for
  a page whose `MOTION` block is the example's, byte for byte.
- **Adapt:** a reference example is close. Keep its mechanism, read its notes, and start from its
  settings. Replace the `motion-kit-bar` meta tag with `<meta name="motion-kit-kind"
  content="<kind>">`, because the page is no longer the example. An adapted page gets the full
  audit: move every motion number into `MOTION` or the `KNOBS` block. If you keep the example's
  tag by mistake, the gate still runs the full audit, and prints a `note:` line that says why.
- **Build:** nothing fits. Use only the rules and default settings for that type of continuous
  motion: read `node_modules/motion-kit/kinds/<kind>/rules.md` and `dials.json`. Then tell the
  person you are building for that no reference example covers this moment.

## 5. Use the numbers, not literals

- Short transitions (tap feedback, enter, exit, layout move, attention, celebrate): call
  `transition(cfg, feel, move, { byTouch })` from `motion-kit/motion`, or `tx(...)` from
  `motion-kit` for other engines. `feel` names the preset and `move` the transition. Set
  `byTouch: true` only when a person caused the motion: only those bounce.
- Continuous motion (`live`: pointer-follow, drag and release; `idle`: idle loop; `scroll`:
  scroll-linked): run `motion-kit knobs <kind>` and paste the block it prints into the page exactly
  as printed, marker comment included. Read each setting from `KNOBS`.
- Load the config with `resolve()` and the project's `motion.json`. Never copy default numbers
  into code.
- Respect reduced motion. Use `reducedTransition(cfg, feel, move)` when the person asks for it.

## 6. Run the gate

Run the gate on every page you build or copy:

```bash
npx --no motion-kit gate <page.html>
```

`motion-kit init` already set up Playwright, which the gate needs. It prints `passed`, `partial`
or `failed: n`. A partial run is not a pass. Fix each failure line, then run the gate again.

## 7. Look at the motion

The gate checks numbers. It cannot tell you whether the motion looks right. After the gate
passes, draw the page over time and read the image:

```bash
npx --no motion-kit sheet <page.html> --out sheet.png
```

It saves one PNG: the page at 8 evenly spaced times, with the same input the gate plays. Each
frame shows its time and the input at that time. A red ring marks where the pointer is held. The
frames are cropped to the area where pixels change; add `--full` to see the whole page. Use
`--samples <n>` (2 to 24) for more frames, and `--to <ms>` to cover a longer loop.

Read `sheet.png`. Compare it with the reference example you picked. Fix what looks wrong, then run
the gate and the sheet again.
