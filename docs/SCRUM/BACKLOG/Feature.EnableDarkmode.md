# Dark Mode

Provide a consistent dark theme for BibleGuessr that can be selected by the
player and remains usable across single-player, multiplayer, setup, chat,
results, reports, dialogs, and developer panels.

The current frontend follows the operating-system preference with
`prefers-color-scheme: dark`, but several Lit components define their own
colors and light/dark overrides. This feature should establish one theme
contract rather than adding isolated dark backgrounds component by component.

## Theme selection

- Provide an accessible theme control with at least `Light`, `Dark`, and
  `System` options.
- `System` follows `prefers-color-scheme` and remains the default for users
  without a saved preference.
- Apply the selected theme consistently to the document and all Lit shadow-DOM
  components.
- Persist only the theme preference in the browser under a named,
  versionable `bibleguessr:` storage key.
- Invalid, missing, or unavailable storage must fall back to `System` without
  preventing the application from starting.
- Apply the theme before or during the initial render where practical so the
  page does not flash the wrong theme.
- Changing the theme must not reset game progress, chat, setup selections,
  active multiplayer sessions, reports, or cached Bible files.

## Visual system

- Define shared semantic color tokens for page background, surfaces, text,
  muted text, borders, controls, links, focus rings, success, warning, error,
  disabled states, overlays, and game feedback.
- Use the tokens across global styles and component shadow roots; do not leave
  hard-coded white backgrounds or dark text that becomes unreadable in dark
  mode.
- Keep input fields, native selects, range controls, checkboxes, suggestion
  lists, dialogs, popovers, reports, and Nerd Panel surfaces readable in both
  themes.
- Preserve the existing visual hierarchy and brand accents while ensuring
  accent colors meet contrast requirements against both light and dark
  surfaces.
- Ensure browser-controlled UI such as form controls and scrollbars receives
  the intended theme through `color-scheme` without making text or borders
  invisible.
- Keep status meaning independent of color: connection, busy, error, success,
  selected, disabled, and active states need text, shape, pattern, or semantic
  attributes as appropriate.

## Accessibility

- Meet WCAG 2.2 AA contrast expectations for body text, controls, links,
  borders that convey boundaries, error text, and visible focus indicators in
  both themes.
- Theme controls must have persistent labels and expose the current selection
  through native selection semantics or `aria-pressed`/`aria-checked` as
  appropriate.
- Keyboard users must be able to change theme without losing focus or
  triggering game actions.
- Respect `prefers-reduced-motion` in theme transitions; a user who disables
  motion must not receive animated theme changes.
- Theme changes must not move focus unexpectedly or cause dynamic content to
  be announced repeatedly.
- Verify readability at 200% zoom, on narrow screens, and with high-contrast
  or forced-colors settings where supported.

## Coverage

Verify the theme in every major application surface:

- Mode selection and home/navigation controls.
- Single-player setup, Bible-file upload/parsing/error states, selectors,
  sliders, forms, and results.
- Multiplayer room roster, chat, play requests, matchmaking, active rounds,
  timers, disconnect states, and multiplayer results.
- Forfeit confirmation dialog, abuse-report page, general bug-report panel,
  and their validation/success/failure states.
- Nerd Panel, version diagnostics, connection-status details, tooltips, and
  sticky report controls.
- Loading, empty, disabled, offline, error, success, and countdown-danger
  states, including reduced-motion behavior.

## Responsive and browser behavior

- The theme must work at desktop and mobile widths without clipping or
  overlapping content.
- Do not rely on hover to reveal the only readable label or state.
- Avoid a flash of unstyled or incorrectly themed content during startup and
  page reload.
- Test Chromium, Firefox, and WebKit where the project’s browser test setup
  supports them, including native form controls and shadow-DOM styling.

## Acceptance criteria

- A player can choose Light, Dark, or System from an accessible theme control.
- Dark mode is applied consistently across all listed application surfaces.
- The choice survives reload in the same browser profile and does not alter
  game, chat, setup, report, or cached-file state.
- System mode follows OS theme changes while the application is open.
- Unavailable or corrupt storage falls back safely to System.
- Text, controls, focus indicators, errors, status states, dialogs, and form
  controls remain readable and operable in both themes.
- No important state is communicated by color alone.
- Reduced-motion, high-contrast, narrow viewport, and 200% zoom checks pass.
- Automated tests cover default/system behavior, persistence, invalid storage,
  theme switching, key controls, and representative light/dark screenshots or
  contrast assertions.
- A manual visual and keyboard review confirms there is no incorrect-theme
  flash, unreadable component, or focus loss during switching.
