# Feature: Remember the Bible Choice Across All Game Types

The player's choice of Bible should be made once and then reused by every
kind of game, until the player changes it. That choice is either a server
translation or one of their own uploaded files. The Bible choice applies to
every game type:

- The Bible
- Books
- Chapters
- Multiplayer
- Daily quiz

It should also survive closing the browser.

## Today

Every setup screen starts from scratch. `game-setup.ts` and
`translation-source-select.ts` both start with `mode = 'server'` and the first
translation in the list. So the Bible choice is lost:

- whenever the player switches game type,
- on "Play again", because `_onPlayAgain` in `bg-app.ts` returns to
  mode-select and the setup screen is created anew,
- between singleplayer, multiplayer and the daily quiz, which each have their
  own picker instance,
- on every new visit.

By contrast, the per-game-type choice (selected books and chapters) is already
kept for the session in `savedChoices` in `bg-app.ts`. The Bible choice is the
odd one out.

## Requirements

- There is one shared Bible choice, not one per game type. Changing it on any
  setup screen changes it for all of them.
- Every setup screen preselects the remembered choice:
  - singleplayer for each game type (The Bible, Books, Chapters),
  - multiplayer room setup,
  - daily quiz.
- The choice is remembered in this browser across visits, like round count and
  time limit (`game-preferences.ts`).
- The stored value is either a server translation (by name) or an uploaded file
  (by its cache fingerprint). Verse text is never stored as part of the choice.
- Every read is validated. A missing, malformed or outdated value falls back
  to today's default without an error:
  - The remembered server translation is no longer offered: use the first
    translation.
  - The remembered file is no longer in the cache: use the default.
  - Storage is unavailable (private browsing): behave as today.
- If the server is unreachable and the remembered choice is a server
  translation, show today's error banner. Do not switch to a file on the
  player's behalf.

## Multiplayer

Each player already plays from their own translation. The remembered choice
only preselects this player's own picker. Nothing new is sent to the server or
to other players: only book, chapter and verse numbers are transmitted, as
today.

## Data security

The choice lives in this browser's local storage only. A file fingerprint
contains the file name, so it is never sent anywhere either.

## Accessibility

- Preselecting must not move focus or announce anything for a server
  translation. The preselected value is visible in the select and exposed to
  assistive technology through it.
- For an uploaded file, announce it once through the existing status region,
  e.g. "Using Bible NWT.epub from last time".
- The mode tabs keep `aria-selected` in sync with the restored mode.
- Changing the Bible stays fully keyboard-operable, as today.

## Design notes

- Model the choice as a discriminated union, e.g.
  `{ kind: 'server', translation } | { kind: 'file', fingerprint }`.
- Put load, save and parse in their own module, e.g.
  `bible-choice-storage.ts`, mirroring `game-preferences.ts`. Use a
  versioned, named storage key such as `bibleguessr:preferences:bibleChoice:v1`.
- The picker exists twice: `game-setup.ts` owns its own copy, and
  `translation-source-select.ts` is an extraction of it. Both must read and
  write the same stored choice. Consolidating them first would keep this from
  drifting.
- [Feature.UploadBibleFileOnce.md](../BACKLOG/Feature.UploadBibleFileOnce.md) builds on
  this feature for preselecting an uploaded file. Its remembered-choice
  requirement is covered here.

## Resolution

- `frontend/src/bible-sources/bible-choice-storage.ts` holds the
  `BibleChoice` union, the key `bibleguessr:preferences:bibleChoice:v1`, and
  the pure rules: `parseBibleChoice`, `translationToPreselect` and
  `fileToRestore` (one per list, since the translation list and the file
  cache arrive independently, and a remembered file must work with the
  server unreachable).
- The two pickers are consolidated first: `game-setup.ts` now hosts
  `<bg-translation-source-select>` instead of its own copy. The picker took
  over the copy's file status live region and accessible file input, so
  multiplayer and the daily quiz have them too.
- The picker loads the remembered choice and saves only the player's own
  actions, never its automatic preselection. Restoring is abandoned as soon
  as the player chooses something.
- A restored file is announced once: "Using <file> from last time."
- Found along the way: a game type's saved selection (`savedChoices` in
  `bg-app.ts`) names books in one Bible's spelling, and is now kept with that
  Bible and only restored for it. Before, it was restored against whichever
  Bible came first.
- Documented in `docs/web/remembered-bible`. Frontend revision 24.

## Acceptance criteria

- [x] A Bible chosen in one game type is preselected in every other game type,
      in multiplayer and in the daily quiz.
- [x] "Play again" keeps the chosen Bible.
- [x] The choice survives a page reload and a new visit.
- [x] Changing the choice on any screen updates it for all screens.
- [x] An unavailable translation, a removed file or a malformed stored value
      falls back to the default without an error.
- [x] Nothing about the choice is sent to the server or to other players.
- [x] Unit tests cover parsing and validating the stored value. Each test is
      first shown to fail without the change.
- [x] An e2e test chooses a Bible in one game type and finds it preselected in
      another game type and after a reload.
- [x] The feature is documented in `docs/web`.
- [x] Frontend `revision` is incremented.
