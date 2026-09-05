# Report Abuse

Provide a persistent, accessible way for a player to report abusive,
harassing, or otherwise unsafe behavior in the application.

## User experience

- Show a sticky icon button in the bottom-left corner of the application.
- Use a recognizable warning/report symbol, such as a siren or shield. The
  icon must have a visible tooltip and an accessible name: `Report abuse`.
- Keep the control above application content and safe-area insets on mobile.
- Do not let the control cover important game controls, chat messages, form
  fields, or the countdown.
- Selecting the control opens a dedicated view titled **Report abuse**.
- The report view must be reachable by keyboard and must work on narrow mobile
  screens as well as desktop screens.

## Report form

The page should explain that the report is sent to the application owner for
review. It should provide:

- A required description of what happened and why it is abusive or unsafe.
- An optional field for the reported player's visible name or other
  non-sensitive identifying context.
- An optional field for the reporter's contact address if they want a reply.
- A clear **Send report** action.
- A clear **Cancel** or **Back** action that returns to the previous view
  without submitting anything.

The form must trim input, reject an empty description, preserve entered values
when validation fails, and prevent duplicate submissions while the request is
in progress. The user must see a clear success message after submission and a
clear retryable error if sending fails.

The form must not require the reporter to upload files, reveal a password, or
include private Bible text. The UI should warn reporters not to include
passwords, payment information, or other sensitive personal data.

## Delivery

- Submit the report to a dedicated abuse-report API endpoint rather than
  reusing the Bible-file upload error-report contract.
- Send the report by email using the application's existing SMTP configuration
  and configured report recipient.
- Use a distinct email subject such as `BibleGuessr: Abuse report`.
- Include the submitted description, reported-player context, optional reply
  address, submission time, and minimal application context in the email.
- Treat all report fields as untrusted input. Escape or otherwise safely encode
  user text before placing it in an HTML email, and never use the submitted
  contact address as the message sender.
- Do not store reports in browser storage, local Bible caches, analytics, or
  the game state.
- Do not include uploaded verse text or other players' private data in the
  request automatically. Only include information explicitly entered by the
  reporter, plus minimal server-side request metadata needed for abuse
  handling.

## Abuse prevention and failure handling

- Apply server-side rate limiting per client/IP and a global cap so the form
  cannot be used as an unrestricted mail relay.
- Enforce reasonable maximum lengths for every text field at the API boundary.
- Return validation errors without sending mail.
- Return a non-success response when the SMTP relay cannot deliver the report;
  the frontend must keep the form open so the reporter can retry.
- Log delivery failures for operators without logging report content or
  contact details unnecessarily.
- Avoid exposing SMTP configuration, recipient addresses, stack traces, or
  internal delivery details to the reporter.

## Accessibility

- The sticky control must be a native button with an accessible name; the icon
  alone is not sufficient.
- Every field needs a persistent label and an associated validation message.
- Announce sending, success, and failure states to assistive technology.
- Keep focus on the report page after navigation and return focus to the
  sticky report button when the user cancels or returns.
- The page must support keyboard-only submission and cancellation, with
  visible focus indicators and no reliance on color alone.

## Acceptance criteria

- The bottom-left report control is visible throughout the application without
  obscuring essential content and remains usable on mobile.
- Keyboard and screen-reader users can identify and activate the control.
- Activating it opens a page titled `Report abuse` with a clearly labelled
  form.
- An empty or whitespace-only description cannot be submitted.
- A valid report sends exactly one request even if the user clicks repeatedly
  while it is being processed.
- Successful delivery shows a confirmation and clears or exits the form in a
  predictable way.
- A failed delivery shows an actionable error and preserves the entered report
  for retry.
- Invalid or overlong requests are rejected by the server without sending
  email.
- Rate limiting prevents repeated abuse submissions from exhausting the SMTP
  service.
- Email content is safely encoded and includes the report fields needed for
  review without leaking unrelated private game or Bible data.
- Automated tests cover rendering/navigation, validation, keyboard access,
  duplicate-submit prevention, successful delivery, delivery failure,
  malformed input, and rate limiting.
