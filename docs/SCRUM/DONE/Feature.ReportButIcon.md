# Sticky Report Button

Provide a persistent report button so a player can open the application's
existing **Report abuse** page from any screen.

This feature defines the entry point and navigation behavior. The report form,
validation, email delivery, privacy rules, rate limiting, and submission
states are defined by [Feature.ReportAbuse.md](Feature.ReportAbuse.md) and
must not be reimplemented as a second report flow.

## Button

- Render one native `<button>` from the application shell so it remains
  available across mode selection, setup, gameplay, results, and multiplayer
  screens.
- Position it fixed in the bottom-left corner, with safe-area inset support on
  mobile devices.
- Use a recognizable report/warning icon, such as a shield, siren, or bug.
  The icon may communicate the action visually but must not be the button's
  only accessible name.
- Give the button the accessible name `Report abuse` and a visible tooltip
  with the same meaning.
- Keep it above the application's content without covering essential controls,
  chat, forms, countdowns, or status messages.
- Provide a visible keyboard focus indicator and preserve sufficient contrast
  in both light and dark themes.
- Keep the hit target large enough for touch input and do not rely on hover to
  reveal the button.

## Navigation and focus

- Activating the button opens the existing `Report abuse` view in the current
  application shell; it must not open an unrelated external bug tracker.
- Save the button that opened the view so focus can be restored when the user
  cancels, goes back, or finishes reporting.
- Move focus into the report view after navigation, preferably to its
  `Report abuse` heading or first meaningful control.
- Keep the report page's keyboard and screen-reader behavior consistent with
  `Feature.ReportAbuse.md`.
- Opening and closing the report view must not reset the underlying game,
  chat, setup selections, or active multiplayer session.
- If the trigger is no longer connected when the report view closes, restore
  focus to the nearest sensible application control without throwing.

## Visual and responsive behavior

- The button must remain visible above page content at desktop and mobile
  widths, including when the application is in a long form or active game.
- Respect `env(safe-area-inset-left)` and `env(safe-area-inset-bottom)` where
  supported.
- Avoid covering the multiplayer countdown or primary game actions; adjust
  layout padding or placement if a future screen makes the bottom-left corner
  unavailable.
- The icon and focus treatment must remain understandable without color alone.

## Acceptance criteria

- The report button is present on every application phase that can be reached
  after the shell mounts.
- Keyboard, pointer, and touch users can activate it.
- Screen readers announce it as `Report abuse`, not as an unlabeled icon.
- Activating it opens the existing page titled `Report abuse` and does not
  start a duplicate or separate reporting workflow.
- Focus moves into the report page and returns to the trigger when the page
  closes.
- The current game, room, chat, and setup state remain intact after opening
  and closing the report page.
- The button remains usable on narrow screens, in dark mode, and with visible
  focus styles.
- Automated tests cover presence across app phases, accessible naming,
  navigation, focus restoration, responsive placement, and preservation of
  underlying application state.
