// What the guess form may offer for the current game — the shared
// kernel's contract between the game types (which decide it, see
// ../game-types) and <bg-guess-form> (which renders it). An explicit
// union rather than three optional props, so a combination no game type
// produces (say, a fixed book alongside a list of allowed books) can't be
// expressed at all.
export type GuessConstraint =
  /** Every book of the selected Bible, with free chapter/verse entry. */
  | { kind: 'any-book' }
  /** Only these books (in the viewer's own spelling); free chapter/verse.
   * `givenBook` is set when the game type counts the book as given (only
   * one was picked) — decided from the game itself, not from how many of
   * its books the viewer's own Bible happens to have — so the form selects
   * it from the start. */
  | { kind: 'one-of-books'; books: string[]; givenBook?: string }
  /** The book is already decided and is shown as fixed text; the chapter
   * is chosen from exactly `chapters`. */
  | { kind: 'fixed-book'; book: string; chapters: number[] }

export const ANY_BOOK: GuessConstraint = { kind: 'any-book' }
