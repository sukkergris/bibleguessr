# Manual accessibility pass

Some accessibility requirements cannot be verified by automated tests. This
checklist covers what a person has to check by hand, with a real screen reader
and a real keyboard, before `Feature.Accessibility.md` can be called complete.

It is deliberately separate from that feature file: everything here needs a
human, so it should not sit in a list of development tasks waiting to be
picked up.

Automated coverage handles accessible names and placeholder-only labels on
every test run (see `frontend/e2e/accessibility.spec.ts`). Nothing below
duplicates that — these are the judgements a machine cannot make.

## Keyboard only

Unplug or ignore the mouse entirely for each of these.

- [ ] Choose a game mode, configure it, start a game, guess, and reach the
      results screen.
- [ ] Select a Bible file, including recovering from a parse error and choosing
      the same file again afterwards.
- [ ] Join World chat, send a chat message, challenge another player, accept a
      challenge, play a round, and forfeit.
- [ ] Open the report-abuse form, complete it, submit it, and return.
- [ ] Confirm the focus indicator is clearly visible at every step, in both
      light and dark themes.
- [ ] Confirm Tab order follows the visual order and never traps you somewhere
      unexpected.

## With a screen reader

At least one of VoiceOver, NVDA or Narrator.

- [ ] Every control announces what it is and what it does.
- [ ] The selected Bible filename is announced, in full, during selecting,
      parsing, ready, cached, removal and error states.
- [ ] Errors are announced when they appear, without needing to hunt for them.
- [ ] The countdown does not announce on every tick.
- [ ] Score changes, round changes and connection changes are announced once,
      not repeatedly.
- [ ] Decorative icons and status dots are not announced as meaningless text.
- [ ] Each view has one clear heading and the heading order makes sense.

## Zoom, contrast and motion

- [ ] At 200% browser zoom, no labels are clipped, no controls overlap, and no
      ordinary workflow requires horizontal scrolling.
- [ ] On a narrow mobile width, the same holds, and the sticky report button
      does not cover anything essential.
- [ ] Text, controls and focus indicators have sufficient contrast in both
      light and dark themes.
- [ ] With the operating system's reduced-motion setting enabled, the countdown
      danger treatment and any transitions have a non-animated equivalent.
- [ ] Nothing conveys state by color alone — check the roster's connection
      dots and any validation styling in particular.

## Photosensitivity

- [ ] The countdown blink stays within the flash-rate guidance in its default
      (safe) mode.
- [ ] The opt-in "stress mode" is genuinely opt-in: it is off by default, and
      nothing enables it without the player choosing it.

## Result

Record the date, who performed the pass, which screen reader and browser were
used, and anything found. Anything that needs fixing should become a bug in
`BUGS/` rather than being left in this checklist.
