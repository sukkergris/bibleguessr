// Mirrors backend/Domain/Verses.fs's Verse.bookNumberOf/bookAtNumber — see
// that file's Verse.bookNumbers doc comment for the full rationale. Book
// NAMES aren't reliable to match across two players' translations/files
// (or even within one — a single translation's parser can produce
// inconsistent spellings for the same book), so a book's NUMBER — its
// 1-based position in a source's own Bible-order book list, from
// VerseSource.getBooksInBibleOrder — is used instead wherever a book
// identity needs to cross a player/server boundary (GameType
// restrictions, a round's VerseReference, a submitted Guess).

/** The 1-based position of `book` in `booksInBibleOrder` (case-insensitive),
 * or undefined if it isn't present at all. */
export function bookNumberOf(booksInBibleOrder: string[], book: string): number | undefined {
  const index = booksInBibleOrder.findIndex((candidate) => candidate.toLowerCase() === book.toLowerCase())
  return index === -1 ? undefined : index + 1
}

/** The book name at 1-based position `number` in `booksInBibleOrder`, or
 * undefined if out of range — the inverse of bookNumberOf, used to
 * resolve a book NUMBER (e.g. from another player's game session) back
 * to THIS source's own spelling for that position. */
export function bookAtNumber(booksInBibleOrder: string[], number: number): string | undefined {
  if (number < 1) return undefined
  return booksInBibleOrder[number - 1]
}
