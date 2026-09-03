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
 * Where the game gets its verses from: the backend (`api`) or a Bible file
 * the player parsed client-side (`local-verses.ts`'s createLocalVerseSource).
 * `api` already structurally satisfies this — see api.ts.
 */
export interface VerseSource {
  getTranslations(): Promise<string[]>
  getRandomVerse(translation?: string): Promise<Verse>
  getBooks(translation?: string): Promise<string[]>
}
