import { describe, expect, it } from 'vitest'
import type { BoardEntry, BoardRound, LeaderboardSnapshot } from '../types'
import { announcementFor } from './board-announcer'

function entry(name: string, score: number, rank: number): BoardEntry {
  return {
    playerId: name,
    name,
    score,
    rank,
    status: { Case: 'Active' },
    guessedThisRound: false,
  }
}

function board(phase: LeaderboardSnapshot['phase']['Case'], round: BoardRound, entries: BoardEntry[] = []): LeaderboardSnapshot {
  return {
    roomCode: '1234',
    phase: { Case: phase } as LeaderboardSnapshot['phase'],
    hostName: 'Anna',
    roundCount: 5,
    round,
    entries,
    minPlayers: 3,
    maxPlayers: 20,
  }
}

const guessing = (n: number): BoardRound => ({ Case: 'Guessing', Fields: [n, '2026-10-08T10:00:30Z'] })
const revealed = (n: number): BoardRound => ({
  Case: 'Revealed',
  Fields: [n, { book: 'John', bookNumber: 43, chapter: 3, verseNumber: 16 }],
})

describe('board announcer', () => {
  it('announces the lobby opening', () => {
    expect(announcementFor(undefined, board('LobbyOpen', { Case: 'NotStarted' }))).toMatch(/Anna opened a Congregation/)
  })

  it('announces the start', () => {
    const lobby = board('LobbyOpen', { Case: 'NotStarted' })
    expect(announcementFor(lobby, board('Playing', guessing(1)))).toBe('The game has started. Round 1 of 5.')
  })

  it('stays quiet while players guess', () => {
    const before = board('Playing', guessing(2), [entry('Anna', 10, 1)])
    const after = board('Playing', guessing(2), [{ ...entry('Anna', 10, 1), guessedThisRound: true }])

    expect(announcementFor(before, after)).toBeUndefined()
  })

  it('announces a scored round once, with the leader', () => {
    const before = board('Playing', guessing(2))
    const after = board('Playing', revealed(2), [entry('Anna', 120, 1), entry('Ben', 10, 2)])

    expect(announcementFor(before, after)).toBe('Round 2 scored. Anna leads with 120 points.')
    expect(announcementFor(after, after)).toBeUndefined()
  })

  it('names everyone sharing the lead', () => {
    const after = board('Playing', revealed(1), [entry('Anna', 10, 1), entry('Ben', 10, 1), entry('Cleo', 10, 1)])

    expect(announcementFor(board('Playing', guessing(1)), after)).toBe(
      'Round 1 scored. Anna, Ben and Cleo share the lead with 10 points.',
    )
  })

  it('announces the winner at the end', () => {
    const before = board('Playing', revealed(5))
    const after = board('Finished', revealed(5), [entry('Ben', 3000, 1), entry('Anna', 1200, 2)])

    expect(announcementFor(before, after)).toBe('The game is over. Ben wins with 3000 points.')
  })
})
