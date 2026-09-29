# Bug: Dark-Theme Accent Fails AA Contrast for Text

`--accent` in the dark theme is `#aa3bff`. Paired with `--accent-text`
(`#ffffff`), that renders at **4.39:1** — just under the WCAG 2.2 AA threshold
of 4.5:1 for body-sized text.

## How it was found

Surfaced by `frontend/e2e/mode-switch-contrast.spec.ts` while fixing
[Bug.ModeSwitchTabLabelInvisible.md](../DONE/Bug.ModeSwitchTabLabelInvisible.md). The
*selected* mode-switch tab is white text on `--accent`:

```
"Server translation" (selected) renders rgb(255, 255, 255) on rgb(170, 59, 255) — 4.39:1
```

This is **not** specific to the mode switch. `--accent` is used as a filled
background behind `--accent-text` in roughly 39 places across the components,
so every accent-filled control with text on it is affected — including the
primary "Start game" button. The light theme's `--accent` (`#7a2fd4`) is fine at
about 7.9:1.

That the miss is small (4.39 vs 4.5) is what let it survive: it looks perfectly
readable, and only a measured check catches it.

## Why it was not fixed alongside the mode-switch bug

Correcting it means changing a shared theme token in `frontend/src/index.css`,
which restyles the entire app's accent colour in dark mode. That is a visual
design decision with app-wide reach, deliberately left to a maintainer rather
than folded silently into an unrelated layout fix.

The mode-switch regression test therefore asserts only on the *unselected* tab,
with a comment pointing here, so it does not fail on a defect it is not about.

## Expected behavior

Text drawn on `--accent` meets at least 4.5:1 in both themes.

## Possible fixes

- Darken dark-theme `--accent` slightly — e.g. `#9b2bf0` reaches ≈4.9:1 against
  white while staying close to the current hue.
- Or introduce a separate `--accent-strong` for accent surfaces that carry text,
  leaving `--accent` for non-text decoration.

The first is simpler and keeps one accent contract; the second is more precise
if the current hue matters to the design.

## Acceptance criteria

- [ ] White text on `--accent` measures at least 4.5:1 in the dark theme.
- [ ] The light theme keeps its current (passing) ratio.
- [ ] A test asserts the ratio for accent-filled controls in both themes.
- [ ] The unselected-tab-only scoping in `mode-switch-contrast.spec.ts` is
      widened back to both tabs once this is fixed.
