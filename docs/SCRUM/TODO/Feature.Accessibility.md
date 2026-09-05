# Accessibility Improvements

Make BibleGuessr usable with keyboard navigation, screen readers, zoom, high
contrast, reduced motion, and other assistive technology.

Note that accessibility is also a standing rule in `CLAUDE.md` — it applies to
every feature as it is built, not only to the work listed here. This file
covers the gap between that rule and the existing application, and should
shrink to nothing rather than being deferred.

## Already enforced automatically

These need no further work: an automated audit runs against the rendered
application (including Lit shadow DOM) on every end-to-end test run, across the
home, singleplayer setup, active game, report, multiplayer pre-join and
multiplayer room screens — see `frontend/e2e/accessibility.spec.ts` and
`frontend/e2e/helpers/a11y.ts`.

- Every interactive control has an accessible name.
- No form field depends on a placeholder for its name.

Any new control that breaks either rule fails the test suite, so these cannot
silently regress.

Three real problems were found and fixed this way: the connection-status dot
was an icon-only button named only by a `title` attribute (now has a
status-aware name and exposes `aria-expanded`), and both the chat message field
and the room-code field were named only by their placeholders, which disappear
as soon as the field has content (both now have persistent labels).

The audit deliberately checks only what a machine can judge reliably. It does
not verify contrast, zoom, focus order, live-region behaviour or screen-reader
output, and passing it is not a claim of WCAG conformance.

## Remaining work

### Keyboard and focus

- Every interactive control must be reachable in a logical order with Tab and
  operable with keyboard input.
- Focus indicators must remain visible in light mode, dark mode, and high
  contrast environments; do not remove the browser focus outline without an
  equally visible replacement.
- Focus must move predictably when a view, tab panel or game phase opens, and
  return to the triggering control when it closes.
- Do not use click-only handlers for actions that should be buttons or links.
  The multiplayer roster is the known offender: player rows are clickable
  `<li>` elements rather than buttons, so they cannot be reached or activated
  by keyboard at all.
- Keyboard operation must work for sliders, tabs, combobox suggestions, player
  actions, file controls and game submission.

The forfeit dialog and the report-abuse flow already meet the focus-management
requirements and are covered by their own tests; they do not need revisiting.

### Semantics and screen readers

- Use one meaningful page heading per view and a logical heading hierarchy.
- Icon-only controls must expose their state with appropriate attributes such
  as `aria-pressed`, `aria-expanded` or `aria-selected`.
- Use live regions sparingly and intentionally for errors, loading/progress,
  connection changes, score/reveal updates, and successful or failed actions.
- Status announcements must not be duplicated for every countdown tick.
- Decorative icons, emoji and visual status dots must be hidden from the
  accessibility tree or accompanied by equivalent text. The roster's
  connection dots and the report button's shield emoji are known cases.
- Lists, tab lists, comboboxes and buttons must use valid structure and state
  relationships; hidden items must not leave misleading empty containers.

### File upload and file names

- The Bible-file picker must have an explicit accessible label, such as
  `Choose a Bible file`, and must identify accepted file types without relying
  only on placeholder text.
- When a file is selected, announce its filename and current state using a
  status region: selecting, parsing, ready, or failed.
- The filename must be presented as the filename, including its extension; do
  not silently replace it with an opaque cache id or use it as the translation
  name.
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

### Forms and validation

- Associate every validation message with the invalid control using
  `aria-describedby` or native form semantics, and expose invalid state with
  `aria-invalid` where appropriate.
- Explain required and optional fields in text, not by color or an icon alone.
- Keep entered values when validation or network submission fails.
- Ensure slider values, visible labels and accessible values remain in sync,
  including restored round-count and time-limit preferences.

The report-abuse form already meets these and is covered by its own tests.

### Visual, motion, and responsive behavior

- Text and controls must remain usable at 200% zoom and on narrow screens
  without clipped labels, overlapping controls, or inaccessible horizontal
  scrolling for ordinary workflows.
- Maintain sufficient text, control and focus contrast in light and dark
  themes; never communicate state by color alone.
- Respect `prefers-reduced-motion` and provide a non-animated equivalent for
  transitions and progress indicators. The countdown blink already does this.
- Touch targets must be large enough and separated enough to activate without
  precision pointing.
- Sticky controls, banners and overlays must not cover the current focus target
  or essential content.

### Feature-specific coverage still outstanding

- Ignore-player controls: labelled icon buttons, state exposure, keyboard
  unignore, and announcements independent of color. (Not yet built — see
  `BACKLOG/Feature.UsersShuldBeAbleToIgnoreEachother.md`.)
- Round-count and time-limit controls: synchronized visible and accessible
  values, keyboard persistence, and valid fallback values.
- Multiplayer chat and roster: accessible player actions, connection/busy
  states, and valid list structure.
- Game rounds and results: announced phase changes, scores, feedback, timers,
  errors, and a usable path when verse text cannot be resolved.

## Acceptance criteria

- A keyboard-only user can complete mode selection, Bible-file selection,
  setup, guessing, multiplayer chat and results navigation.
- A screen-reader user can identify every control, filename, current state,
  error and successful action without depending on visual styling.
- The complete selected filename is accessible during upload, parsing, ready,
  cached, removal and error states.
- Focus remains visible and predictable when views change and asynchronous work
  completes.
- Core flows remain usable at 200% zoom, on mobile widths, in dark mode, and
  with reduced motion enabled.
- Automated tests cover keyboard flows, focus management, live-region state
  changes, file-name announcements, validation errors, and responsive
  interaction-critical layout.
- The manual pass in `Checklist.ManualAccessibilityPass.md` has been completed.
