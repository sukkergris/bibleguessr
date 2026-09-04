// Mirrors the F# Domain types in backend/Domain/*.fs. Keep in sync by hand
// for now; consider generating these from the backend if the shape starts
// drifting often.

export interface Verse {
  book: string
  chapter: number
  verseNumber: number
  text: string
  translation: string
  reference: string
}

export interface Player {
  id: string
  name: string
  score: number
}

export type RoundState =
  | { Case: 'WaitingForPlayers' }
  | { Case: 'InProgress'; Fields: [Verse] }
  | { Case: 'Scored'; Fields: [Verse, GuessResult[]] }

export interface GuessResult {
  playerId: string
  correct: boolean
  pointsAwarded: number
}

export interface Room {
  code: string
  players: Player[]
  round: RoundState
}

export interface ChatMessage {
  playerId: string
  playerName: string
  text: string
  sentAt: string
}

/** A "start a game" invite one player sends another — see
 * docs/SCRUM/Feature.StartMPGame.md. Send/see/withdraw only; accepting a
 * request depends on round sync, which doesn't exist yet. */
export interface PlayRequest {
  fromPlayerId: string
  fromPlayerName: string
  toPlayerId: string
  sentAt: string
}

export interface Guess {
  book: string
  chapter?: number
  verseNumber?: number
}

/** One completed round's outcome, kept around to build the end-of-game summary. */
export interface RoundResult {
  verse: Verse
  guess: Guess
  points: number
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
  getChapters(book: string, translation?: string): Promise<number[]>
  getVerseNumbers(book: string, chapter: number, translation?: string): Promise<number[]>
}
