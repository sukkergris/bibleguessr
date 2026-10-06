# Map book order and verse numbering across Bibles

A verse the server draws (daily quiz, multiplayer) travels as a
`VerseReference`: book NUMBER, chapter, verse. Each player resolves it in
their own Bible by POSITION (`Verse.bookAtNumber` /
`frontend/src/shared-kernel/book-numbers.ts`). That only works while both
Bibles agree on book order and verse numbering, and the server's bibelen-dk
pool doesn't agree with the New World Translation (a common "own file"):

- **Book order.** bibelen-dk is in Lutheran order: Hebrews 58, 1 Peter 59,
  2 Peter 60, 1 John 61, 2 John 62, 3 John 63, James 64, Jude 65. NWT has
  James 59, 1 Peter 60, … Jude 65. A drawn James 1:13 (book 64) resolves to
  3 John 13 for an NWT player — a different verse, silently.
- **Psalm headings.** bibelen-dk numbers a psalm's heading as verse 1 (or
  1–2), NWT doesn't: bibelen-dk Psalm 83:19 is NWT 83:18, and an NWT player
  is shown a missing or wrong verse.
- **Other chapter splits.** bibelen-dk Joel 3:5 is NWT Joel 2:32.

Found while building famous verses (see `docs/web/famous-verses`), but it
affects every drawn verse from those books, not just famous ones.

## Requirements

- A drawn reference resolves to the same verse in every supported Bible,
  including an uploaded NWT file.
- Matching stays by number, not by name (see `Verse.bookNumbers`).
- Scoring a guess compares like with like after the mapping.

## Notes

- One option: a canonical (e.g. Protestant/English) reference on the wire,
  with a per-source mapping for book order and versification.
- `FamousVerses.all` is numbered as bibelen-dk; it would need converting
  together with the wire format.
