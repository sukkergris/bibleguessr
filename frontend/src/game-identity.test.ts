import { describe, expect, it } from 'vitest'
import { isSameGame } from './game-identity'

describe('isSameGame', () => {
  it('matches a message belonging to the current game', () => {
    expect(isSameGame('game-1', 'game-1')).toBe(true)
  })

  // The actual bug: two games between the SAME two players. Matching on
  // the players alone said "yes" to both, so the finished game's GameOver
  // ended the live one. Matching on the game's own id says "no".
  it('rejects a message from a different game', () => {
    expect(isSameGame('game-2', 'game-1')).toBe(false)
  })

  // Ignoring an unrecognised message is recoverable (the server
  // re-broadcasts state next round); wrongly ending a live game is not.
  it('rejects a message when the client has no current game', () => {
    expect(isSameGame(undefined, 'game-1')).toBe(false)
  })

  it('rejects a message that carries no game id', () => {
    expect(isSameGame('game-1', undefined)).toBe(false)
  })

  it('rejects when neither side has an id, rather than treating them as equal', () => {
    expect(isSameGame(undefined, undefined)).toBe(false)
  })
})
