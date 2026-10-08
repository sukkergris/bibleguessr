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
  /** The guess earned points — see backend/Domain/Game.fs's GuessResult. */
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

/** Which kind of multiplayer game a GameSession is — see
 * backend/Domain/Game.fs's GameFormat. A duel is the one-vs-one game; a
 * Congregation is a group game, carrying its host's player id. */
export type GameFormat = { Case: 'Duel' } | { Case: 'Congregation'; Fields: [string] }

/**
 * A synced multiplayer game in progress — see backend/Domain/Game.fs's
 * GameSession, which this mirrors. Sent in full on every
 * RoundStarted/RoundScored event (see signalr-client.ts) rather than as a
 * delta, so a client that reconnects or remounts mid-game always has an
 * authoritative, self-correcting snapshot — same principle as
 * onRoomPlayers's full roster snapshot.
 */
export interface GameSession {
  /** This game instance's own identity — see backend/Domain/Game.fs's
   * GameId. The players alone do NOT identify a game: the same two
   * people can finish one and immediately start another, so clients match
   * game-scoped messages on this and ignore any that belong to a
   * different game (see BUGS/BUG.StaleGameOverEndsTheWrongGame.md). */
  gameId: string
  format: GameFormat
  /** Everyone who started the game — two for a duel. */
  participants: string[]
  /** Congregation participants who left mid-game (always empty for a duel). */
  departed: string[]
  gameType: GameType
  roundCount: number
  roundTimeLimit: TimeLimit
  /** How long a scored round stays revealed, as a .NET TimeSpan string. */
  revealPause: string
  roundIndex: number
  round: RoundState
  roundStartedAt?: string
  roundScoredAt?: string
  guessesThisRound: Record<string, Guess>
  /** Running total per player id, as of this event — always the full
   * cumulative score, never a delta. */
  scores: Record<string, number>
}

/** How a GameSession ended — see backend/Domain/Game.fs's GameOverReason. */
export type GameOverReason =
  | { Case: 'Completed' }
  | { Case: 'Forfeited'; Fields: [string | undefined] }
  | { Case: 'Abandoned' }

/** A player taking part in a Congregation — see backend/Domain/Lobby.fs. */
export interface Participant {
  id: string
  name: string
}

/** An open Congregation lobby — see backend/Domain/Lobby.fs's
 * CongregationLobby. Members include the host, first. */
export interface CongregationLobby {
  host: Participant
  members: Participant[]
  gameType: GameType
  roundCount: number
  /** Always set — a Congregation has no "unlimited". A .NET TimeSpan string. */
  roundTimeLimit: string
}

/** A running Congregation: the shared session plus everyone's names. */
export interface CongregationGame {
  session: GameSession
  roster: Participant[]
}

/** What the room is doing — see backend/Api/GameHub.fs's RoomActivityView.
 * Sent as RoomActivityChanged on every change and right after joining. */
export type RoomActivityView =
  | { Case: 'RoomOpen'; Fields: [string[]] }
  | { Case: 'RoomGathering'; Fields: [CongregationLobby] }
  | { Case: 'RoomCongregating'; Fields: [CongregationGame] }

/** The limits of a Congregation, served by GET /api/congregation/rules. */
export interface CongregationRules {
  minPlayers: number
  maxPlayers: number
  minTimeLimitSeconds: number
  maxTimeLimitSeconds: number
  revealSeconds: number
  minRoundCount: number
  maxRoundCount: number
}

/** Where the Congregation's round stands on the spectator board — see
 * backend/Domain/Leaderboard.fs. `Guessing` carries no verse reference by
 * design. */
export type BoardRound =
  | { Case: 'NotStarted' }
  | { Case: 'Guessing'; Fields: [number, string] }
  | { Case: 'Revealed'; Fields: [number, VerseReference] }

export type EntryStatus = { Case: 'Active' } | { Case: 'Disconnected' } | { Case: 'Left' }

export interface BoardEntry {
  playerId: string
  name: string
  score: number
  rank: number
  status: EntryStatus
  guessedThisRound: boolean
  pointsThisRound?: number | null
}

export type BoardPhase =
  | { Case: 'NoCongregation' }
  | { Case: 'LobbyOpen' }
  | { Case: 'Playing' }
  | { Case: 'Finished' }

/** The Congregation leaderboard — everything a spectator can see. */
export interface LeaderboardSnapshot {
  roomCode: string
  phase: BoardPhase
  hostName?: string | null
  gameType?: GameType | null
  roundCount: number
  round: BoardRound
  entries: BoardEntry[]
  minPlayers: number
  maxPlayers: number
}

/** One completed round's outcome, kept around to build the end-of-game summary. */
export interface RoundResult {
  verse: Verse
  guess: Guess
  points: number
}
