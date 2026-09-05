# Toggle the Report Abuse View

Make the persistent **Report abuse** icon act as a toggle. Activating it while
the report view is closed opens the existing report page; activating the same
icon while the report view is open performs the same close/cancel action as the
report page's **Cancel** or **Back** control.

This feature changes only the shell-level entry point. The form fields,
validation, email delivery, privacy rules, rate limiting, and submission
states remain governed by [Feature.ReportAbuse.md](Feature.ReportAbuse.md).

## Toggle behavior

- When `Report abuse` is closed, activating the icon opens the existing
  `Report abuse` view in place of the current screen.
- When `Report abuse` is open, activating the same icon closes the view and
  returns to the exact underlying screen, including its current game, room,
  chat, setup, or results state.
- Closing through the icon has the same semantics as pressing **Cancel** or
  **Back**: it does not submit a report.
- Any text entered in an unsent report is discarded when the view is closed,
  matching the existing Cancel behavior. A future “save draft” feature would
  need separate requirements and must not be implied by this toggle.
- Clicking the icon while a report request is sending must not interrupt the
  request or create a second submission. The behavior must be chosen
  explicitly: either keep the report view open until the request finishes, or
  disable the toggle while sending. It must never silently discard an
  in-flight report.
- After a successful submission, the existing success state remains in force;
  the icon can close the report view using the same return path as **Back**.

## Accessible state

- Keep the control a native button with an accessible name that describes its
  current action: `Report abuse` when closed and `Close report abuse` when
  open.
- Expose whether the report view is open with `aria-expanded` and associate
  the control with the report view using `aria-controls` where the DOM
  structure permits it.
- Keep a visible tooltip aligned with the current action; do not rely on the
  icon changing shape or color alone.
- Move focus into the report view when it opens and return focus to the same
  toggle button when it closes, including when closing through the icon.
- Preserve the report page's labelled fields, validation announcements, and
  keyboard behavior from `Feature.ReportAbuse.md`.

## Interaction and layout

- The toggle must work with pointer, touch, and keyboard activation.
- The sticky button must remain available while the report view is open, but
  must not cover the report form or its focused control.
- The open/closed state must be deterministic if the user activates the
  button repeatedly or an asynchronous render is still pending.
- Opening and closing must not navigate to an unrelated page or reset the
  underlying application state.
- The button must remain usable in light mode, dark mode, narrow viewports,
  and at increased text zoom.

## Acceptance criteria

- Activating the closed report icon opens the existing `Report abuse` view.
- Activating the same icon again closes the view exactly as Cancel does and
  restores the underlying screen.
- Closing through the icon sends no report and does not invoke the abuse-report
  API.
- Unsent form data is discarded consistently with the existing Cancel path.
- An in-flight report cannot be interrupted or duplicated by toggling the
  icon.
- Focus enters the report view on open and returns to the toggle on close.
- The button's accessible name, tooltip, and expanded state describe whether
  it will open or close the report view.
- The toggle works across all application phases without losing game, chat,
  setup, or results state.
- Automated tests cover open, icon-close, Cancel-close, focus restoration,
  accessible state, unsent-data behavior, in-flight submission behavior, and
  preservation of the underlying application state.
