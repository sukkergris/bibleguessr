# BibleGuessr

## Language

Code, comments, commit messages, and documentation (README, this file,
etc.) are written in English (US), regardless of what language the conversation
with the user happens to be in.

## Documentation

Each feature should be documented here: `docs/web`.

Use only HTML, JavaScript, and CSS.

Each feature should have its own file and be organized in folders.

The consumer will use a VS Code extension to display the documentation.

Keep the `README.md` minimal and intended for developers. Explain how to use `docs/web` in `README.md`.

## Code architecture

Always consider using DDD in some form, but do not follow it blindly or dogmatically.
Always consider using TDD, but do not follow it dogmatically.
Prefer explicit state models, such as discriminated unions or state objects, when they make state transitions clearer than conditional logic.
Prefer configuration values over hardcoded values for system settings.
Avoid inline magic numbers/strings even for internal-only values that don't warrant full configuration — give them a named binding (a `let` constant, a static field) instead.

## Testing

Before trusting a test that covers a bug fix, prove it actually catches the bug: with the fix removed (revert it, or temporarily break it), confirm the test fails — then restore the fix and confirm it passes. A test that passes against the broken code proves nothing, and is worse than no test because it looks like protection.

## Accessibility

Accessibility is a cross-cutting requirement for every feature, not a separate mode or an afterthought. Strive to meet WCAG 2.2 AA standards across all flows.

Every interactive control must be reachable in a logical order and operable via keyboard. Focus indicators must remain clearly visible in both light and dark themes; never remove browser focus outlines without an equally visible replacement. Modals and dialogs must trap focus while open, support Escape to dismiss, and restore focus to the triggering element upon closing. Dynamic content must never steal focus unexpectedly.

Prefer native HTML semantics before adding ARIA. Every interactive control and form field must have a persistent, programmatically associated accessible label. Expose states (e.g., `aria-pressed`, `aria-expanded`, `aria-invalid`) appropriately and use live regions intentionally for status updates and errors without duplicate announcements.

Maintain sufficient color contrast for text, interactive controls, and focus states in both light and dark themes. Never convey state or information by color alone. Respect `prefers-reduced-motion` and ensure layouts remain functional at 200% zoom and on narrow screens.

## Versioning

When a feature is completed, increase the version number for each affected application. Update the frontend version when the feature changes the frontend, update the backend version when it changes the backend, and update both when it affects both applications.

## Data security

Uploaded verse text must never be sent to the server or to other players. Only the book number, chapter number, and verse number may be transmitted.
