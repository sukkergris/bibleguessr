# Nerd Panel Shortcut Guide

Add an accessible **Keyboard shortcuts** section to the existing Nerd Panel so
users can discover and understand the application's keyboard shortcuts without
reading the browser console or source code.

## Existing shortcut

Document the current Nerd Panel shortcut accurately:

- `Ctrl+Shift+N` toggles the Nerd Panel on supported browsers and operating
  systems.
- The shortcut is handled while the application has focus and prevents the
  browser's default action where the browser allows the page to receive the
  key event.
- Some browsers reserve this chord for a new private/incognito window and may
  intercept it before the application sees it. The guide must state that the
  shortcut may be unavailable in those browsers and provide the panel's close
  control as the reliable alternative.
- The guide must not promise shortcuts that are not implemented.

## Guide content

- Add a clearly labelled `Keyboard shortcuts` section inside the Nerd Panel.
- List each implemented shortcut in a definition list or equivalent semantic
  structure with the key combination, action, and any browser/platform caveat.
- Explain that `Ctrl`, `Shift`, and the letter key must be pressed together;
  use a readable representation rather than relying on a visual keycap alone.
- Include a short note that shortcuts should not be used while focus is in a
  text field unless the shortcut is intentionally global.
- Update the section whenever a new global shortcut is added or an existing
  shortcut changes.
- Keep developer diagnostics, version information, and user-facing shortcut
  guidance distinguishable so the panel remains useful to both audiences.

## Accessibility

- Use a real heading for the guide and semantic descriptions for shortcut/action
  pairs so screen readers can navigate them.
- Ensure the guide is available when the panel is opened with the shortcut and
  when the panel is inspected with other keyboard navigation.
- Give the close button an accessible name and keep it keyboard reachable.
- Move focus into the panel when it opens and return focus to the element that
  had focus when it closes, unless an existing panel contract specifies a more
  appropriate target.
- Do not require color, hover, animation, or the browser console to discover
  or understand a shortcut.
- Keep the guide readable at 200% zoom, in dark mode, with high contrast, and
  with reduced motion enabled.

## Shortcut behavior

- Global shortcuts must not trigger destructive actions, submit forms, or
  unexpectedly change game state.
- Do not steal focus or interfere with ordinary typing in inputs, textareas,
  comboboxes, or content-editable controls unless the shortcut is explicitly
  documented as global and safe there.
- Repeated activation must be idempotent: it only toggles the panel and does
  not create duplicate panels or duplicate event listeners.
- If the browser intercepts a shortcut, the panel must remain usable through
  its normal accessible controls.
- Respect the user's platform conventions where practical, including the
  possibility of `Cmd`/`Meta` equivalents for future shortcuts. Do not display
  a platform-specific alternative until it is implemented.

## Acceptance criteria

- The Nerd Panel contains a visible `Keyboard shortcuts` guide.
- The guide documents `Ctrl+Shift+N` and its browser limitation accurately.
- A keyboard-only and screen-reader user can reach, read, and leave the guide.
- Shortcut/action pairs have semantic labels and are understandable without
  relying on visual keycap styling.
- Opening and closing the panel preserves the user's prior focus where the
  panel contract allows it.
- The shortcut does not submit forms or alter game state unexpectedly.
- The guide remains usable at 200% zoom, in dark mode, high contrast, and
  reduced-motion settings.
- Automated tests cover the guide content, shortcut toggle, repeat activation,
  accessible structure, focus behavior, and non-interference with text input.
