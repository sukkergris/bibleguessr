import { describe, expect, it } from 'vitest'
import type {
  CongregationGame,
  CongregationLobby,
  CongregationRules,
  GameSession,
  LeaderboardSnapshot,
  RoomActivityView,
} from '../types'
import {
  ROOM_OPEN,
  congregationViewFor,
  hostBlockedReason,
  initialCongregationState,
  withActivity,
  withBoard,
  withGameOver,
  withSession,
  withoutResult,
} from './congregation-state'

const verse = { book: 'John', bookNumber: 43, chapter: 3, verseNumber: 16 }

function session(overrides: Partial<GameSession> = {}): GameSession {
  return {
    gameId: 'game-1',
    format: { Case: 'Congregation', Fields: ['alice'] },
    participants: ['alice', 'bob', 'carol'],
    departed: [],
    gameType: { Case: 'AllVerses' },
    roundCount: 3,
    roundTimeLimit: { Case: 'LimitedTo', Fields: ['00:00:30'] },
    revealPause: '00:00:05',
    roundIndex: 0,
    round: { Case: 'InProgress', Fields: [verse] },
    roundStartedAt: '2026-10-08T10:00:00Z',
    guessesThisRound: {},
    scores: { alice: 0, bob: 0, carol: 0 },
    ...overrides,
  }
}

const congregating = (s: GameSession): RoomActivityView => {
  const game: CongregationGame = {
    session: s,
    roster: s.participants.map((id) => ({ id, name: id })),
  }
  return { Case: 'RoomCongregating', Fields: [game] }
}

const lobby: CongregationLobby = {
  host: { id: 'alice', name: 'Alice' },
  members: [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
  ],
  gameType: { Case: 'AllVerses' },
  roundCount: 5,
  roundTimeLimit: '00:00:30',
}

const finishedBoard = { phase: { Case: 'Finished' } } as LeaderboardSnapshot

describe('congregation view', () => {
  it('shows nothing special while the room is open', () => {
    expect(congregationViewFor(initialCongregationState, 'alice')).toEqual({ kind: 'none' })
  })

  it.each([
    ['alice', 'host'],
    ['bob', 'member'],
    ['dave', 'outsider'],
  ])('shows the lobby to %s as %s', (me, role) => {
    const state = withActivity(initialCongregationState, { Case: 'RoomGathering', Fields: [lobby] })

    expect(congregationViewFor(state, me)).toMatchObject({ kind: 'lobby', role })
  })

  it('shows the game to a participant and "underway" to everyone else', () => {
    const state = withActivity(initialCongregationState, congregating(session()))

    expect(congregationViewFor(state, 'bob').kind).toBe('playing')
    expect(congregationViewFor(state, 'dave').kind).toBe('underway')
  })

  it('stops showing the game to a participant who left it', () => {
    const state = withActivity(initialCongregationState, congregating(session({ departed: ['bob'] })))

    expect(congregationViewFor(state, 'bob').kind).toBe('underway')
  })

  it('shows the results to participants once the game is over, until dismissed', () => {
    let state = withActivity(initialCongregationState, congregating(session()))
    state = withGameOver(state, 'game-1', { Case: 'Completed' })
    state = withActivity(state, ROOM_OPEN)
    state = withBoard(state, finishedBoard)

    const view = congregationViewFor(state, 'bob')
    expect(view.kind).toBe('results')
    if (view.kind === 'results') expect(view.result.board).toBe(finishedBoard)
    expect(congregationViewFor(state, 'dave').kind).toBe('none')

    expect(congregationViewFor(withoutResult(state), 'bob').kind).toBe('none')
  })

  it('ignores the end of a game it is not following', () => {
    const state = withActivity(initialCongregationState, congregating(session()))

    expect(withGameOver(state, 'another-game', { Case: 'Completed' })).toBe(state)
  })
})

describe('congregation session tracking', () => {
  it('ignores duel sessions', () => {
    const duel = session({ format: { Case: 'Duel' } })

    expect(withSession(initialCongregationState, duel)).toBe(initialCongregationState)
  })

  it('keeps the furthest-along snapshot of the same game', () => {
    const scored = session({ round: { Case: 'Scored', Fields: [verse, []] } })
    let state = withSession(initialCongregationState, scored)

    // An activity snapshot of the same round, still being guessed, is older.
    state = withActivity(state, congregating(session()))
    expect(state.session?.round.Case).toBe('Scored')

    state = withSession(state, session({ roundIndex: 1 }))
    expect(state.session?.roundIndex).toBe(1)
  })

  it('takes a new game over the previous one', () => {
    let state = withSession(initialCongregationState, session({ roundIndex: 2 }))
    state = withSession(state, session({ gameId: 'game-2' }))

    expect(state.session?.gameId).toBe('game-2')
  })
})

describe('hosting a Congregation', () => {
  const rules: CongregationRules = {
    minPlayers: 3,
    maxPlayers: 20,
    minTimeLimitSeconds: 10,
    maxTimeLimitSeconds: 60,
    revealSeconds: 5,
    minRoundCount: 3,
    maxRoundCount: 10,
  }
  const ok = { roundCount: 5, timeLimitSeconds: 30 }

  it('is allowed in an idle private room with a time limit in range', () => {
    expect(hostBlockedReason(ROOM_OPEN, ok, rules, false)).toBeUndefined()
  })

  it.each([
    ['World chat', ROOM_OPEN, ok, false, true],
    ['a running duel', { Case: 'RoomOpen', Fields: [['alice', 'bob']] }, ok, false, false],
    ['an open lobby', { Case: 'RoomGathering', Fields: [lobby] }, ok, false, false],
    ['no time limit', ROOM_OPEN, { roundCount: 5 }, false, false],
    ['a time limit below the minimum', ROOM_OPEN, { roundCount: 5, timeLimitSeconds: 5 }, false, false],
    ['rules not loaded yet', ROOM_OPEN, ok, true, false],
  ] as const)('is blocked by %s', (_name, activity, settings, rulesMissing, inWorldChat) => {
    expect(
      hostBlockedReason(activity as RoomActivityView, settings, rulesMissing ? undefined : rules, inWorldChat),
    ).toBeTypeOf('string')
  })
})
