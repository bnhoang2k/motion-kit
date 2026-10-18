# motion-kit: instructions for coding agents

Follow these steps for any animation in this project. Never pick a duration, easing or bounce by
guessing. Read it from motion-kit.

## 1. List the moments

Write down each moment on the page that moves. Examples: the first view, idle while reading,
hover over a set of choices, the sign-up tap.

## 2. Check the bars

Open `node_modules/motion-kit/bars/INDEX.md` and read the section for each moment.

## 3. Take one path per moment

- **Copy:** a bar fits. Copy these files from `node_modules/motion-kit/bars/<slug>/` into one
  folder of your project: `index.html`, `bar.json`, `trace.json`, and the `fonts/` folder when the
  bar has one. Keep the `motion-kit-bar` meta tag in `index.html`. The gate reads the kind from
  `bar.json` beside the page. Swap the page's assets as the asset contract in `bar.json` says, and
  keep its `MOTION` block as it is: the gate skips its literal check only for a page whose
  `MOTION` block is the bar's, byte for byte.
- **Adapt:** a bar is close. Keep its mechanism, read its notes, and start from its knobs. Replace
  the `motion-kit-bar` meta tag with `<meta name="motion-kit-kind" content="<kind>">`, because the
  page is no longer the bar. An adapted page gets the full audit: move every motion number into
  `MOTION` or the `KNOBS` block. If you keep the bar's tag by mistake, the gate still runs the
  full audit, and prints a `note:` line that says why.
- **Build:** nothing fits. Use only the kind's rules and its knob bases. Read
  `node_modules/motion-kit/kinds/<kind>/rules.md` and `dials.json`. Then tell the person you are
  building for that no bar covers this moment.

## 4. Use the numbers, not literals

- Short animations (tap, enter, exit, move, attention, celebrate): call `transition(cfg, feel,
  move, { byTouch })` from `motion-kit/motion`, or `tx(...)` from `motion-kit` for other engines.
  Set `byTouch: true` only when a person caused the motion.
- Ongoing motion (live, idle, scroll): run `motion-kit knobs <kind>` and paste the block it prints
  into the page exactly as printed, marker comment included. Read the knob from `KNOBS`.
- Load the config with `resolve()` and the project's `motion.json`. Never copy default numbers
  into code.
- Respect reduced motion. Use `reducedTransition(cfg, feel, move)` when the person asks for it.

## 5. Run the gate

Run the kind gate on every page you build or copy:

```bash
pnpm exec motion-kit gate <page.html>
```

It needs Playwright: `pnpm add -D playwright && pnpm exec playwright install chromium`.
It prints `passed`, `partial` or `failed: n`. A partial run is not a pass. Fix each failure line,
then run the gate again.
