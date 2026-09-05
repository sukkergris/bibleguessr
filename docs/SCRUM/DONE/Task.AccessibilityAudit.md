# Accessibility audit

Build an automated accessibility audit for the existing application, and fix
what it finds. Split out of `Feature.Accessibility.md`, which retains the
remaining work that this audit does not cover.

## What was built

An audit that runs against the rendered application rather than the source,
walking Lit shadow roots — a plain `document.querySelectorAll` sees almost
nothing in this codebase, so source-level attribute checks would have been
misleading.

- `frontend/e2e/helpers/a11y.ts` — the audit itself.
- `frontend/e2e/accessibility.spec.ts` — runs it across the home, singleplayer
  setup, active game, report-abuse, multiplayer pre-join and multiplayer room
  screens.

It runs as part of the ordinary end-to-end suite, so a new control that breaks
either rule below fails the build rather than needing anyone to remember to
check.

## What it checks

- Every interactive control has an accessible name.
- No form field depends on a placeholder for its name, since a placeholder
  disappears as soon as the field has content.

`title` is deliberately not accepted as an accessible name: it is unreliable
across screen readers and invisible to touch users.

## What it found and fixed

- The connection-status dot was an icon-only button named only by a `title`
  attribute. It now has a status-aware accessible name and exposes
  `aria-expanded`.
- The chat message field was named only by its placeholder. It now has a
  persistent, visually hidden label.
- The room-code field had the same problem, fixed the same way.

A visually-hidden label pattern was introduced for the latter two, so a field
can have a real label without changing the compact inline layout.

## What it deliberately does not check

The audit only reports what a machine can judge reliably. It does not verify
contrast, zoom, focus order, live-region behaviour, keyboard operability or
screen-reader output, and passing it is not a claim of WCAG conformance.

Two gaps confirmed by hand while writing this up, both left to
`Feature.Accessibility.md`: the Bible-file picker has no meaningful accessible
label, and the setup screen has no live regions at all, so file
selecting/parsing/ready/failed states are announced to nobody.

A separate confirmed blocker — roster players cannot be challenged by keyboard
at all — is tracked as
`BUGS/BUG.RosterPlayersCannotBeChallengedByKeyboard.md`.

## Verification

The audit was verified the way `CLAUDE.md` requires: the connection-dot fix was
removed, the audit was confirmed to fail with a precise message naming the
offending control, and the fix was restored.
