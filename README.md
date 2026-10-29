# motion-kit

Make the animations your AI coding tool writes feel smooth, deliberate and consistent.

## What it does

When you ask an AI coding tool for an animation, it guesses the timing. It guesses again for the
next one. One button snaps, a menu drifts, and a list just jumps into place.

motion-kit removes the guess. Your tool starts from finished example pages and one shared set of
timings, so every animation moves like it belongs to the same app. Then it checks its work in a
real browser before it calls the animation done.

## Use it

Run this in your project folder:

```bash
npx github:bnhoang2k/motion-kit#v0.5.0 init
```

It installs motion-kit, sets up the browser it uses to check animations, and adds one line to
your `CLAUDE.md` (and to `AGENTS.md`, if your project has one). Running it again is safe: it
skips what is already done. The `v0.5.0` tag exists once that release is published.

Then ask for animations as usual. That is all.

## Tune it yourself

```bash
npx --no motion-lab
```

This opens the Lab in your browser. Play each animation, change its numbers, and watch the result.
Save writes only your changes to `motion.json` in your project folder.

## Reference

To call motion-kit from your own code, see [REFERENCE.md](REFERENCE.md).
