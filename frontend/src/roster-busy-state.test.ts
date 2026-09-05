import { describe, expect, it } from 'vitest'
import { emptyBusyState, gameEnded, gameStarted, playerLeft } from './roster-busy-state'

describe('roster busy state', () => {
  it('marks both players busy when a game starts', () => {
    const state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')

    expect(state.busyPlayerIds.has('alice')).toBe(true)
    expect(state.busyPlayerIds.has('bob')).toBe(true)
  })

  it('frees both players when that game ends', () => {
    let state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')
    state = gameEnded(state, 'game-1', 'alice', 'bob')

    expect(state.busyPlayerIds.has('alice')).toBe(false)
    expect(state.busyPlayerIds.has('bob')).toBe(false)
    expect(state.activeGameIds.size).toBe(0)
  })

  // The rule that cannot be reproduced through the UI, and the reason this
  // module exists: the same two players finish a game and immediately start
  // another. A late event from the finished game names that same pair, and
  // must not make them look available while they are still playing.
  it('ignores a late end from an earlier game between the same players', () => {
    let state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')
    state = gameEnded(state, 'game-1', 'alice', 'bob')
    state = gameStarted(state, 'game-2', 'alice', 'bob')

    const afterStaleEvent = gameEnded(state, 'game-1', 'alice', 'bob')

    expect(afterStaleEvent.busyPlayerIds.has('alice')).toBe(true)
    expect(afterStaleEvent.busyPlayerIds.has('bob')).toBe(true)
  })

  it('ignores an end for a game it never saw start', () => {
    const state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')

    expect(gameEnded(state, 'never-seen', 'alice', 'bob')).toBe(state)
  })

  it('keeps other games untouched when one ends', () => {
    let state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')
    state = gameStarted(state, 'game-2', 'carol', 'dave')
    state = gameEnded(state, 'game-1', 'alice', 'bob')

    expect(state.busyPlayerIds.has('carol')).toBe(true)
    expect(state.busyPlayerIds.has('dave')).toBe(true)
    expect(state.activeGameIds.has('game-2')).toBe(true)
  })

  // Nothing else will ever clear a departed player's flag, so leaving has
  // to. Their opponent is deliberately left busy: that game has not ended.
  it('clears a departing player without freeing their opponent', () => {
    let state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')
    state = playerLeft(state, 'alice')

    expect(state.busyPlayerIds.has('alice')).toBe(false)
    expect(state.busyPlayerIds.has('bob')).toBe(true)
  })

  it('leaves state alone when a player who was not busy leaves', () => {
    const state = gameStarted(emptyBusyState, 'game-1', 'alice', 'bob')

    expect(playerLeft(state, 'carol')).toBe(state)
  })
})
