# Bug: Failed Report Submission Breaks Offline Play

When a user cannot submit a report, the UI must show a clear message explaining
that the report was not sent and what the user can do next. It must not break
the offline/local Bible-file experience.

## Problem

Report forms can fail for reasons outside the user's control, such as:

- The backend is unavailable.
- The network connection is lost.
- The SMTP/mail relay cannot send the report.
- The request is rate-limited.
- The submitted report is invalid or too long.

If submission is impossible, the user should not be left wondering whether the
report was sent. A failed report must never look like a successful submission or
silently disappear.

More importantly, report submission must be optional. The player may be using a
local Bible file specifically because the backend is unreachable or unavailable.
In that state, failing to submit a report must not block upload recovery, cached
file selection, returning to setup, or starting/continuing an offline game.

## Expected behavior

- Show a visible error message when a report cannot be submitted.
- Keep the user's entered report text available so they can retry or copy it.
- Re-enable the submit action after a retryable failure.
- Make non-retryable failures, such as rate limiting or validation errors,
  understandable.
- Announce the failure to assistive technology using an appropriate alert or
  status region.
- Do not expose SMTP settings, stack traces, secrets, recipient addresses, or
  other internal details in the user-facing message.
- Keep the surrounding offline flow usable even when every report request fails.

## Offline requirements

- The Bible-file upload/parser flow must remain usable without the backend.
- A failed report request must not trap focus, leave controls disabled, or keep
  the user stuck in a sending state.
- The user must be able to dismiss/cancel the report UI and continue using the
  local file workflow.
- Cached Bible files must remain selectable after a failed report submission.
- Retrying a report must be optional and must not be required before continuing
  offline.

## Affected report flows

Check every report flow, including:

- General bug reports.
- Abuse reports.
- Bible-file upload/parser error reports.

## Acceptance criteria

- A failed report submission produces a clear user-visible message.
- The message distinguishes retryable delivery failures from validation or
  rate-limit failures where possible.
- The report form preserves entered data after failure.
- The user can retry when the failure is retryable.
- Offline/local Bible-file play remains usable after report submission fails.
- Screen readers are notified when the failure appears.
- Automated tests cover backend failure, network failure, SMTP failure,
  validation failure, rate limiting, and offline continuation for every report
  flow.
