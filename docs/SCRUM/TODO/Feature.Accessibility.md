# Accessibility Improvements

Make BibleGuessr usable with keyboard navigation, screen readers, zoom, high
contrast, reduced motion, and other assistive technology. Accessibility is a
cross-cutting requirement for every existing and future feature, not a
separate visual mode.

## Goals

- Meet WCAG 2.2 AA expectations for the core game, setup, multiplayer, report,
  and results flows where the browser and platform provide the necessary
  semantics.
- Preserve the existing game behavior while making state, controls, errors,
  progress, and dynamically changing content perceivable and operable.
- Prefer native HTML semantics and controls before adding ARIA.
- Test the rendered browser experience, including Lit shadow-DOM boundaries,
  rather than relying only on source-level attribute checks.

## Keyboard and focus

- Every interactive control must be reachable in a logical order with Tab and
  operable with keyboard input.
- Focus indicators must remain visible in light mode, dark mode, and high
  contrast environments; do not remove the browser focus outline without an
  equally visible replacement.
- Focus must move predictably when a view, dialog, tab panel, report page, or
  game phase opens, and return to the triggering control when it closes.
- Modal and dialog surfaces must trap focus while open, support Escape where
  dismissal is allowed, and keep destructive actions from becoming the
  accidental default.
- Do not use click-only handlers for actions that should be buttons or links.
- Keyboard operation must work for sliders, tabs, combobox suggestions,
  player actions, file controls, report forms, and game submission.

## Semantics and screen readers

- Use one meaningful page heading per view and a logical heading hierarchy.
- Every form control must have a persistent, programmatically associated label.
- Icon-only controls must have an accessible name and expose their state with
  appropriate attributes such as `aria-pressed`, `aria-expanded`, or
  `aria-selected`.
- Use live regions sparingly and intentionally for errors, loading/progress,
  connection changes, score/reveal updates, report sending, and successful or
  failed actions.
- Dynamic content must not steal focus unless navigation or an error requires
  it, and status announcements must not be duplicated for every timer tick.
- Decorative icons, emoji, and visual status dots must be hidden from the
  accessibility tree or accompanied by equivalent text.
- Lists, tab lists, dialogs, comboboxes, and buttons must use valid structure
  and state relationships; hidden items must not leave misleading empty
  containers for assistive technology.

## File upload and file names

- The Bible-file picker must have an explicit accessible label, such as
  `Choose a Bible file`, and must identify accepted file types without relying
  only on placeholder text.
- When a file is selected, announce its filename and the current state using
  a status region: selecting, parsing, ready, or failed.
- The filename must be presented as the filename, including its extension;
  do not silently replace it with an opaque cache id or use it as the
  translation name.
- If the filename is truncated visually, expose the complete filename through
  accessible text or a labelled relationship, not only a hover tooltip.
- Cached-file remove controls must identify the complete file name in their
  accessible labels, for example `Remove <filename> from cache`.
- Error and report flows must preserve the relevant filename in context, while
  never uploading the Bible file or its verse text merely to improve
  accessibility.
- File progress must be conveyed by text and/or a correctly labelled progress
  indicator, not only animation or changing visuals.
- Choosing the same file again after clearing or an error must be possible
  without requiring a page reload.

## Forms and validation

- Associate every validation message with the invalid control using
  `aria-describedby` or native form semantics, and expose invalid state with
  `aria-invalid` where appropriate.
- Explain required and optional fields in text, not by color or an icon alone.
- Keep entered values when validation or network submission fails.
- Move focus to the first invalid field only when submission identifies an
  error; do not unexpectedly move focus during ordinary typing.
- Disable duplicate submissions while a request is in flight and announce the
  sending state.
- Ensure slider values, visible labels, and accessible values remain in sync,
  including restored round-count and time-limit preferences.

## Visual, motion, and responsive behavior

- Text and controls must remain usable at 200% zoom and on narrow screens
  without clipped labels, overlapping controls, or inaccessible horizontal
  scrolling for ordinary workflows.
- Maintain sufficient text, control, and focus contrast in light and dark
  themes; never communicate state by color alone.
- Respect `prefers-reduced-motion` and provide a non-animated equivalent for
  countdown danger, transitions, and progress indicators.
- Avoid flashing content that can trigger photosensitivity; verify the
  countdown treatment against the applicable accessibility guidance.
- Touch targets must be large enough and separated enough to activate without
  precision pointing.
- Sticky controls, banners, dialogs, and overlays must not cover the current
  focus target or essential content.

## Feature-specific coverage

- Forfeit confirmation: safe default focus, focus trap, Escape/backdrop
  dismissal, retryable errors, and focus restoration.
- Report abuse and its sticky icon: accessible naming, focus movement,
  labelled fields, announced sending/success/failure, and keyboard return.
- Ignore-player controls: labelled icon buttons, state exposure, keyboard
  unignore, and announcements independent of color.
- Round-count and time-limit controls: labelled sliders, synchronized visible
  and accessible values, keyboard persistence, and valid fallback values.
- Multiplayer chat and roster: accessible player actions, connection/busy
  states, filtered content, and valid list structure.
- Game rounds and results: announced phase changes, scores, feedback, timers,
  errors, and a usable path when verse text cannot be resolved.

## Acceptance criteria

- A keyboard-only user can complete mode selection, Bible-file selection,
  setup, guessing, multiplayer chat, reporting, and results navigation.
- A screen-reader user can identify every control, filename, current state,
  error, and successful action without depending on visual styling.
- The complete selected filename is accessible during upload, parsing, ready,
  cached, removal, and error states.
- Focus remains visible and predictable when views change, dialogs open, and
  asynchronous work completes.
- Core flows remain usable at 200% zoom, on mobile widths, in dark mode, and
  with reduced motion enabled.
- Automated tests cover accessible names and relationships, keyboard flows,
  focus management, live-region state changes, file-name announcements,
  validation errors, and responsive interaction-critical layout.
- A manual accessibility pass is performed with keyboard navigation and at
  least one screen reader before the feature is marked complete.
