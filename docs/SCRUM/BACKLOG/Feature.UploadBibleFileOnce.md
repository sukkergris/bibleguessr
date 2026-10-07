# Feature: Upload a Bible File Only Once

A player who uses their own Bible file (EPUB or RTF zip) should only ever have
to upload it once per browser. After that, the app should remember the file
and use it again without asking, including after app updates.

## Today

Parsed verses are already cached in IndexedDB
(`frontend/src/bible-sources/verse-cache.ts`). They are listed under "Use a
Bible file you've already uploaded". In practice, players still end up
re-uploading or re-selecting the file in four ways:

1. **The choice is not remembered.** Every setup screen starts on "Server
   translation". On every visit, the player has to switch to "My own Bible
   file" and pick the file again. This applies to all three screens that
   choose a Bible: singleplayer setup, multiplayer room setup and the daily
   quiz.
2. **App updates throw the file away.** Only the parsed verses are stored,
   not the file. When `PARSER_VERSION` is bumped, every cached entry is
   silently hidden and the player has to find and upload the file again. The
   fix for [Bug.VerseTextMissingSpaces.md](../BUGS/Bug.VerseTextMissingSpaces.md)
   requires such a bump.
3. **A failed save blocks play.** `writeCache` is awaited inside the same
   `try` as parsing, in both `game-setup.ts` and
   `translation-source-select.ts`. If saving fails (private browsing, full
   storage), a file that parsed fine is rejected with "This doesn't look like
   a valid file (couldn't open it as a zip)". The player cannot play at all.
4. **The browser may delete the cache.** Persistent storage is never
   requested, so the browser can evict the cache under storage pressure.

## Scope

"Once" means once per browser on a device. Sharing the file across devices
or browsers would require sending it to the server, which the data security
rule in `CLAUDE.md` forbids. That is out of scope.

## Requirements

### Remember the last choice

Covered by
[Feature.RememberBibleChoiceAcrossGameTypes.md](Feature.RememberBibleChoiceAcrossGameTypes.md).
That feature remembers the Bible choice, including an uploaded file, across
every game type and every visit.

### Keep the original file

- Store the uploaded file itself (as a `Blob`) in IndexedDB, next to its
  parsed verses.
- When `PARSER_VERSION` changes, re-parse the stored file automatically, with
  the same progress display as a first upload. Do not hide the entry.
- Entries cached before this feature have no stored file. List them as
  needing one more upload, with a clear message, instead of letting them
  disappear silently.
- "Remove" deletes both the parsed verses and the stored file. Its label
  should make that clear.

### Never let saving block play

- If the file parses but cannot be saved, use it for this session anyway.
  Tell the player it could not be saved for next time.
- Keep parse errors and storage errors separate, each with its own message.

### Ask the browser to keep the data

- After the first successful save, call `navigator.storage.persist()`.
- If the browser says no, carry on as today. Never block or nag the player.
- Browsers may still clear site data, e.g. when the user clears it, or
  Safari after a period without use. The UI must not promise more than the
  browser does.

## Data security and licensing

- The file stays in the player's own browser storage, exactly like the parsed
  verses do today. It is never sent to the server or to other players.
- Test fixtures use synthetic placeholder text only. Real exports from
  `docs/jw.org/` must never be committed, and neither may anything derived
  from them (see `NOTICE.md`).

## Accessibility

- Preselecting the remembered file must not move focus.
- Announce it once through the existing status region, e.g. "Using Bible
  NWT.epub from last time".
- "Choose a different file" stays visible and keyboard-reachable whenever a
  file is preselected.
- The automatic re-parse uses the same labeled `<progress>` as an upload.
  Progress numbers must not be re-announced.
- The storage-error message is announced as an alert. It must not trap the
  player: they can still start the game.

## Design notes

- The file picker exists twice today: `game-setup.ts` owns its own copy, and
  `translation-source-select.ts` is an extraction of it. Implement this once.
  Either move singleplayer setup onto `translation-source-select.ts` first,
  or extract the shared logic. Otherwise the three screens will drift apart.
- Model each cached entry's state explicitly, e.g. `ready`,
  `needs-reparse`, `reparsing` and `needs-upload`, rather than with
  conditionals.
- The object store has no indexes. Adding a `file` field to `CachedBible`
  does not need an IndexedDB version upgrade.
- Name the storage key for the remembered choice as a constant, like the
  existing keys in `game-preferences.ts`.
- Storing the file adds its size to each entry: the local test exports are
  2–16 MB.

## Rollout

Players who already have cached files will have to upload once more, at the
latest at the next `PARSER_VERSION` bump. Their old entries have no stored
file to re-parse. Shipping this together with the fix for
`Bug.VerseTextMissingSpaces.md` makes that the only extra upload.

## Acceptance criteria

- [ ] A returning player finds their last-used Bible file preselected on the
      singleplayer, multiplayer and daily quiz setup screens. This is
      delivered by `Feature.RememberBibleChoiceAcrossGameTypes.md`.
- [ ] After a `PARSER_VERSION` bump, a cached file is re-parsed from the
      stored file without asking the player to upload it again.
- [ ] Entries from before this feature are shown as needing one more upload.
      They do not disappear.
- [ ] A file that parses but cannot be saved can still be played, and the
      player is told it was not saved.
- [ ] Persistent storage is requested after the first successful save.
- [ ] Removing a cached file also deletes the stored file.
- [ ] Neither the file nor its verse text ever leaves the browser.
- [ ] Unit tests cover re-parsing on a version change, the remembered choice,
      and a failed save. Each test is first shown to fail without the change.
- [ ] An e2e test uses a synthetic EPUB fixture to cover a returning visit
      that starts with the file preselected.
- [ ] `docs/web/local-bible-files` is updated.
- [ ] Frontend `revision` is incremented.
