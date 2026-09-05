# General Bug Report Panel

Provide a persistent, accessible bug-report entry point for technical
problems that are not abuse reports. A sticky icon on the right side of the
application opens a general **Report a bug** panel, and the same icon toggles
that panel closed.

This feature is separate from:

- [Feature.ReportAbuse.md](Feature.ReportAbuse.md), which is for abusive,
  harassing, or unsafe behavior and uses the abuse-report endpoint.
- The existing Bible-file upload error reporter, which captures a file name
  and loader error automatically through `bg-report-error`.

The implementation may reuse the existing bug-report email infrastructure, but
must not silently classify a technical bug as abuse or expose unrelated private
Bible data.

## Sticky button

- Render one native button from the application shell so it is available from
  mode selection, setup, gameplay, multiplayer, results, and other main views.
- Position it fixed on the right side without covering the nerd panel,
  connection status, countdown, forms, chat, or primary game actions.
- Respect safe-area insets, narrow mobile widths, right-to-left layouts if
  supported, and increased text zoom.
- Use a recognizable bug/report icon with an accessible name. The icon alone
  must not be the only label.
- Use `Report a bug` when the panel is closed and `Close bug report` when it
  is open. Keep the tooltip aligned with the current action.
- Provide a visible focus indicator, adequate contrast in light and dark
  themes, and a touch target large enough for reliable activation.

## Toggle and panel behavior

- Activating the closed icon opens the existing bug-report panel in the
  current application shell without navigating away or resetting state.
- Activating the same icon while the panel is open closes it, equivalent to
  the panel's Cancel or Close action.
- Closing without submitting must not send an API request.
- The panel must preserve the underlying game, chat, setup selections, active
  multiplayer session, and results state when it opens and closes.
- Move focus into the panel on open, preferably to its heading or first field,
  and return focus to the same sticky button on close.
- If the trigger is no longer connected, restore focus to a sensible fallback
  without throwing.
- Unsaved text may be discarded on close only if that matches the panel's
  explicit Cancel behavior. Do not silently discard a report while it is being
  submitted.
- Disable the toggle or otherwise keep the panel open while a report request
  is in flight; repeated activation must never interrupt or duplicate a
  submission.

## Bug report form

The panel should let a player report a technical problem without requiring
them to understand the application's internals. It should provide:

- A required description of what the player expected and what actually
  happened.
- An optional concise reproduction context, such as the current screen or
  steps already tried.
- An optional contact address if the player wants a reply.
- A clear **Send bug report** action and a **Cancel** action.
- A warning not to include passwords, payment information, private Bible text,
  or other sensitive personal data.

Trim input, reject an empty description, preserve values after validation or
delivery failure, prevent duplicate submissions, and show announced sending,
success, and retryable failure states.

The existing Bible-file error report may continue to auto-include the relevant
filename and loader error in its specialized flow. The general bug panel must
not automatically upload a Bible file, verse text, chat history, or a full
game transcript.

## Delivery and privacy

- Use a dedicated general bug-report request shape or explicitly extend the
  existing `/api/reports` contract; do not send general bugs to
  `/api/abuse-reports`.
- Send the report through the configured SMTP recipient using the existing
  mail infrastructure where practical.
- Treat all user fields as untrusted input and safely encode them in HTML
  email. Never use a submitted contact address as the sender address.
- Enforce maximum field lengths and server-side validation before sending.
- Rate-limit per client/IP and globally so the endpoint cannot become an
  unrestricted mail relay.
- Return a generic, actionable delivery error without exposing SMTP settings,
  recipient addresses, stack traces, or other internal details.
- Do not persist reports in local storage, browser caches, analytics, or game
  state. Do not log report content or contact details unnecessarily.

## Accessibility

- Use a native button with an accessible name and expose open/closed state with
  `aria-expanded`; use `aria-controls` when the panel has a stable id.
- Give the panel a meaningful heading and persistent labels for every field.
- Keep keyboard focus inside the panel while it is acting as a modal surface,
  support Escape if dismissal is allowed, and restore focus on close.
- Associate validation errors with their fields using `aria-describedby` and
  expose invalid state with `aria-invalid` where appropriate.
- Announce request progress, success, and failure with appropriate status or
  alert regions without stealing focus for ordinary updates.
- Keep the icon, tooltip, focus ring, and panel usable in dark mode, high
  contrast, reduced motion, and at 200% zoom.

## Acceptance criteria

- The right-side bug icon is visible and usable across the application's main
  phases without obscuring important content.
- Activating it opens a titled `Report a bug` panel; activating it again
  closes the panel exactly as Cancel does.
- Opening and closing preserves the underlying application state.
- Focus enters the panel and returns to the sticky trigger on close.
- An empty report cannot be submitted, and a valid report sends exactly one
  request even under repeated activation.
- Delivery success, validation failure, and SMTP failure are clearly reported
  while preserving retryable input where appropriate.
- General bug reports are not sent through the abuse-report flow and do not
  include unrelated private Bible or game data automatically.
- Automated tests cover button presence, toggle behavior, focus management,
  accessible naming/state, validation, duplicate-submit prevention, successful
  delivery, failed delivery, rate limiting, and preservation of the
  underlying application state.
