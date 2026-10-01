// The shared kernel's Bible vocabulary: what a verse, a reference to one,
// a guess and a source of verses are. Every game type (see
// ../game-types) and the app shell use these; nothing here may know about
// any particular game type. Mirrors backend/Domain/Verses.fs and Game.fs.

export interface Verse {
  book: string
  chapter: number
  verseNumber: number
  text: string
  translation: string
  reference: string
}

/** Identifies a verse WITHOUT its text — see backend/Domain/Verses.fs's
 * VerseReference, which this mirrors. This is deliberately all a
 * multiplayer round's server-side state carries: the server must never
 * send verse TEXT over the wire, since two players in the same game may
 * each be reading a different translation/uploaded file — see
 * VerseSource.lookupVerse, which each client uses to resolve this
 * reference to displayable text from its own locally-chosen source.
 *
 * `bookNumber` is the book's 1-based position in the POOL the round's
 * verse was drawn from (see book-numbers.ts) — `book` is just that pool's
 * own spelling, kept for display only. Matching/scoring must always go
 * through `bookNumber`, never `book` — see book-numbers.ts's
 * bookNumberOfGuess and Guess.bookNumber's doc comment for why book names
 * can't be trusted to match across two players' different
 * translations/files (or even within one — some parsers/loaders have
 * produced inconsistent spellings for the very same book). */
export interface VerseReference {
  book: string
  bookNumber: number
  chapter: number
  verseNumber: number
}

/** `bookNumber` is the guessed book's 1-based position in the GUESSING
 * PLAYER'S OWN VerseSource's Bible order (see book-numbers.ts) — set
 * alongside `book` (which stays for display/singleplayer purposes) so
 * multiplayer scoring can match by number rather than name (see
 * VerseReference's doc comment on why name matching isn't reliable
 * across two players' different translations/files). Undefined if the
 * player's own source couldn't resolve a number for what they typed
 * (backend falls back to name matching in that case). */
export interface Guess {
  book: string
  bookNumber?: number
  chapter?: number
  verseNumber?: number
}

/**
 * Narrows which books/chapters a game's verses are drawn from — see
 * docs/SCRUM/Feature.BibleSelector.md. Undefined (or an empty `books` list)
 * means "default ALL", the same as no restriction at all.
 *
 * `books` alone (level 2, "choose books") is any subset of the books a
 * translation/file has. `chaptersByBook` narrows further per book (level 3,
 * "choose books and chapters") — a book present here only offers verses
 * from the listed chapters; a book in `books` but absent from
 * `chaptersByBook` offers all of that book's chapters.
 */
export interface VerseRestriction {
  books: string[]
  chaptersByBook: Record<string, number[]>
}

/**
 * Where the game gets its verses from: the backend (`api`) or a Bible file
 * the player parsed client-side (`local-verses.ts`'s createLocalVerseSource).
 * `api` already structurally satisfies this — see api.ts.
 */
export interface VerseSource {
  getTranslations(): Promise<string[]>
  getRandomVerse(translation?: string, restriction?: VerseRestriction): Promise<Verse>
  getBooks(translation?: string): Promise<string[]>
  /** Same set of books as getBooks, but in the order they appear in the
   * Bible (Genesis..Revelation) rather than alphabetically — see
   * docs/SCRUM/Feature.BooksGameSorting.md. Used by the "Books" game
   * type's selection grid; getBooks (alphabetical) stays as-is for the
   * guess form's autocomplete, where alphabetical is what a player typing
   * a book name actually wants. */
  getBooksInBibleOrder(translation?: string): Promise<string[]>
  getChapters(book: string, translation?: string): Promise<number[]>
  getVerseNumbers(book: string, chapter: number, translation?: string): Promise<number[]>
  /** Resolves an exact book/chapter/verseNumber reference to its full
   * Verse (text included) from THIS source — used to render a
   * multiplayer round's verse locally from a bare VerseReference the
   * server sent (see RoundState's doc comment: the server never sends
   * verse text). Rejects if this source has no such verse (e.g. a
   * player's own translation/file lacks the book the server referenced —
   * see docs/SCRUM/Feature.RequestToStartMPGame.md's note that per-player
   * translation mismatches are rare and can be shown as a fallback rather
   * than fixed). */
  lookupVerse(reference: VerseReference, translation?: string): Promise<Verse>
}
