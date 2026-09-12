# Bug: Unselected Mode-Switch Tab Label Is Invisible

The translation-source mode switch ("Server translation" / "My own Bible file")
renders the unselected tab as an empty pill. The label text is present in the
DOM and reachable by screen readers, but is painted in the same color as the
surface behind it, so a sighted user sees a blank button.

## Problem

Both copies of the mode switch styled the unselected tab with:

```css
color: var(--surface-raised);
```

`--surface-raised` is a *background* token, not a foreground one. It resolves to
`#ffffff` in the light theme and `#262832` in the dark theme, while the pill
itself is `background: transparent` and therefore inherits the page surface:

- Light theme: white text on a white surface — contrast ratio 1.0:1.
- Dark theme: `#262832` text on a `#16171d`/`#1e1f27` surface — roughly 1.3:1.

WCAG 2.2 AA requires 4.5:1 for this text. The bug is not theme-specific; it is
present in both themes and was simply most visible in the light theme
screenshot that reported it.

The selected tab was unaffected, because `.mode-switch button.active` overrides
the color with `var(--accent-text)` on an `--accent` background. That is why the
switch looked "half broken": one filled, readable pill next to one blank pill.

The same declaration existed in two places, since `translation-source-select.ts`
is an extraction of the picker that `game-setup.ts` still owns its own copy of
(see the class comment in `translation-source-select.ts`). Both were affected:

- Singleplayer setup — `src/components/game-setup.ts`
- Multiplayer pre-join / room setup — `src/components/translation-source-select.ts`

The unselected tab also had no `:focus-visible` style. Because the label was
invisible, a keyboard user tabbing onto it had no reliable indication of where
focus was.

## Expected behavior

- Both tab labels are legible in the light and the dark theme, selected or not.
- Text on the unselected tab meets at least the WCAG 2.2 AA 4.5:1 ratio against
  the surface actually painted behind it.
- Tab state is conveyed by more than color alone — `aria-selected` already
  carries it programmatically, and the filled/outlined pill shapes differ
  visually.
- Keyboard focus on either tab is clearly visible in both themes.

## Fix

Use the foreground token `--text` for the unselected tab in both components, and
add the repo's standard `:focus-visible` outline (`2px solid var(--focus)` with
a `2px` offset, matching `bug-report.ts` and `theme-select.ts`).

## Acceptance criteria

- [x] The unselected tab's label is visible in the light theme.
- [x] The unselected tab's label is visible in the dark theme.
- [x] Both tabs keep a contrast ratio of at least 4.5:1 in both themes.
- [x] Both tabs show a visible focus indicator when focused by keyboard.
- [x] Fixed in both the singleplayer and the multiplayer copy of the switch.
- [x] A regression test fails against the unfixed code and passes with the fix.

## Regression test

`frontend/e2e/mode-switch-contrast.spec.ts` measures the computed color of both
tabs against the nearest ancestor that actually paints a background, in both
themes and in both screens, and asserts a 4.5:1 minimum.
