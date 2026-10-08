/**
 * What a player's client knows about the room's Congregation, and which
 * screen that means — see docs/web/congregation.
 *
 * Every Congregation event (RoomActivityChanged, RoundStarted/RoundScored,
 * LeaderboardUpdated, GameOver) is folded in here by a pure function, so
 * the decisions can be tested without a browser or a server. The room
 * screen owns one of these (see congregation-controller.ts) and hands the
 * pieces to the lobby, game and results components — which therefore
 * can't miss an event that arrived before they mounted.
 */

import type {
  CongregationLobby,
  CongregationRules,
  GameOverReason,
  GameSession,
  LeaderboardSnapshot,
  RoomActivityView,
} from '../types'

/** A finished Congregation, kept so its participants can see the final
 * standings until they dismiss them. */
export interface CongregationResult {
  gameId: string
  board?: LeaderboardSnapshot
  reason: GameOverReason
}

export interface CongregationState {
  activity: RoomActivityView
  /** The latest session of the running (or just finished) Congregation. */
  session?: GameSession
  board?: LeaderboardSnapshot
  result?: CongregationResult
}

export const ROOM_OPEN: RoomActivityView = { Case: 'RoomOpen', Fields: [[]] }

export const initialCongregationState: CongregationState = { activity: ROOM_OPEN }

const isCongregation = (session: GameSession) => session.format.Case === 'Congregation'

/** Whichever of two snapshots of the same game is further along; a
 * different game always replaces the old one. A tie goes to `incoming`,
 * the most recently received. */
function laterOf(current: GameSession | undefined, incoming: GameSession): GameSession {
  if (!current || current.gameId !== incoming.gameId) return incoming
  if (incoming.roundIndex !== current.roundIndex) return incoming.roundIndex > current.roundIndex ? incoming : current
  return current.round.Case === 'Scored' && incoming.round.Case !== 'Scored' ? current : incoming
}

export function withActivity(state: CongregationState, activity: RoomActivityView): CongregationState {
  if (activity.Case !== 'RoomCongregating') return { ...state, activity }

  const [game] = activity.Fields
  const session = laterOf(state.session, game.session)
  // A new Congregation replaces the results of the previous one.
  const result = state.result?.gameId === session.gameId ? state.result : undefined
  return { ...state, activity, session, result }
}

export function withSession(state: CongregationState, session: GameSession): CongregationState {
  if (!isCongregation(session)) return state
  return { ...state, session: laterOf(state.session, session) }
}

export function withBoard(state: CongregationState, board: LeaderboardSnapshot): CongregationState {
  // The final board (phase Finished) arrives just after GameOver — fold it
  // into the result so the standings shown are the final ones.
  const result =
    state.result && board.phase.Case === 'Finished' ? { ...state.result, board } : state.result
  return { ...state, board, result }
}

export function withGameOver(state: CongregationState, gameId: string, reason: GameOverReason): CongregationState {
  if (state.session?.gameId !== gameId) return state
  return { ...state, result: { gameId, board: state.board, reason } }
}

export function withoutResult(state: CongregationState): CongregationState {
  return { ...state, result: undefined, session: undefined }
}

/** Which Congregation screen the room shows this player. */
export type CongregationView =
  /** No Congregation: the room's usual duel controls. */
  | { kind: 'none' }
  | { kind: 'lobby'; lobby: CongregationLobby; role: 'host' | 'member' | 'outsider' }
  | { kind: 'playing'; session: GameSession; board?: LeaderboardSnapshot }
  /** A Congregation this player isn't (or is no longer) playing in. */
  | { kind: 'underway' }
  | { kind: 'results'; result: CongregationResult }

const isPlaying = (session: GameSession, myPlayerId: string) =>
  session.participants.includes(myPlayerId) && !session.departed.includes(myPlayerId)

export function congregationViewFor(state: CongregationState, myPlayerId: string): CongregationView {
  if (state.result && state.session && isPlaying(state.session, myPlayerId)) {
    return { kind: 'results', result: state.result }
  }

  const { activity } = state
  switch (activity.Case) {
    case 'RoomOpen':
      return { kind: 'none' }
    case 'RoomGathering': {
      const [lobby] = activity.Fields
      const role =
        lobby.host.id === myPlayerId
          ? 'host'
          : lobby.members.some((m) => m.id === myPlayerId)
            ? 'member'
            : 'outsider'
      return { kind: 'lobby', lobby, role }
    }
    case 'RoomCongregating': {
      const session = state.session ?? activity.Fields[0].session
      return isPlaying(session, myPlayerId) ? { kind: 'playing', session, board: state.board } : { kind: 'underway' }
    }
  }
}

/** Whatever stops this player from hosting a Congregation right now, as
 * the hint shown beside the disabled button — undefined when nothing
 * does. Mirrors the server's own checks (see GameHub.OpenCongregation), so
 * the button is never offered just to be refused. */
export function hostBlockedReason(
  activity: RoomActivityView,
  settings: { roundCount: number; timeLimitSeconds?: number },
  rules: CongregationRules | undefined,
  inWorldChat: boolean,
): string | undefined {
  if (inWorldChat) return 'A Congregation needs a private room. Create one and share its code.'
  if (!rules) return 'Loading the Congregation settings…'
  if (activity.Case !== 'RoomOpen') return 'A Congregation is already using this room.'
  if (activity.Fields[0].length > 0) return 'Wait until the games in this room are over.'

  const { roundCount, timeLimitSeconds } = settings
  if (roundCount < rules.minRoundCount || roundCount > rules.maxRoundCount) {
    return `A Congregation plays ${rules.minRoundCount} to ${rules.maxRoundCount} rounds.`
  }
  if (timeLimitSeconds === undefined) return 'A Congregation needs a time limit. Choose one above.'
  if (timeLimitSeconds < rules.minTimeLimitSeconds || timeLimitSeconds > rules.maxTimeLimitSeconds) {
    return `Choose a time limit between ${rules.minTimeLimitSeconds} and ${rules.maxTimeLimitSeconds} seconds.`
  }
  return undefined
}
