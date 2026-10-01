// Mirrors the F# Domain types in backend/Domain/*.fs. Keep in sync by hand
// for now; consider generating these from the backend if the shape starts
// drifting often.
//
// The Bible vocabulary and the game-type wire format live in the shared
// kernel (./shared-kernel) so the game-type domains can use them without
// depending on this app-shell module; they are re-exported here for the
// rest of the app.

import type { Guess, Verse, VerseReference } from './shared-kernel/bible'
import type { GameType } from './shared-kernel/game-type-wire'

export type { Guess, Verse, VerseReference, VerseRestriction, VerseSource } from './shared-kernel/bible'
export type { GameType } from './shared-kernel/game-type-wire'

export interface Player {
  id: string
  name: string
  score: number
}

export type RoundState =
  | { Case: 'WaitingForPlayers' }
  | { Case: 'InProgress'; Fields: [VerseReference] }
  | { Case: 'Scored'; Fields: [VerseReference, GuessResult[]] }

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

/** A round's time limit — see docs/SCRUM/Feature.Time.md and
 * backend/Domain/Scoring.fs's TimeLimit, which this mirrors. Unlimited means
 * no limit at all (the "infinite" end of the challenge-settings slider). */
export type TimeLimit = { Case: 'Unlimited' } | { Case: 'LimitedTo'; Fields: [string] }

export interface ChatMessage {
  playerId: string
  playerName: string
  text: string
  sentAt: string
}

/** A "start a game" invite one player sends another, for the
 * GameType/roundCount/roundTimeLimit they chose beforehand — see
 * docs/SCRUM/Feature.StartMPGame.md, docs/SCRUM/Feature.RequestToStartMPGame.md,
 * and docs/SCRUM/Feature.Time.md. The challenged player can accept it
 * (starting the GameSession it describes) or deny it. */
export interface PlayRequest {
  fromPlayerId: string
  fromPlayerName: string
  toPlayerId: string
  gameType: GameType
  roundCount: number
  roundTimeLimit: TimeLimit
  sentAt: string
}

/**
 * A synced multiplayer game in progress between exactly two players — see
 * backend/Domain/Game.fs's GameSession, which this mirrors. Sent in full on
 * every RoundStarted/RoundScored event (see signalr-client.ts) rather than
 * as a delta, so a client that reconnects or remounts mid-game always has
 * an authoritative, self-correcting snapshot — same principle as
 * onRoomPlayers's full roster snapshot.
 */
export interface GameSession {
  /** This game instance's own identity — see backend/Domain/Game.fs's
   * GameId. The player pair alone does NOT identify a game: the same two
   * people can finish one and immediately start another, so clients match
   * game-scoped messages on this and ignore any that belong to a
   * different game (see BUGS/BUG.StaleGameOverEndsTheWrongGame.md). */
  gameId: string
  playerA: string
  playerB: string
  gameType: GameType
  roundCount: number
  roundTimeLimit: TimeLimit
  roundIndex: number
  round: RoundState
  roundStartedAt?: string
  guessesThisRound: Record<string, Guess>
  /** Running total per player id, as of this event — always the full
   * cumulative score, never a delta. */
  scores: Record<string, number>
}

/** How a GameSession ended — see backend/Domain/Game.fs's GameOverReason. */
export type GameOverReason =
  | { Case: 'Completed' }
  | { Case: 'Forfeited'; Fields: [string | undefined] }

/** One completed round's outcome, kept around to build the end-of-game summary. */
export interface RoundResult {
  verse: Verse
  guess: Guess
  points: number
}
