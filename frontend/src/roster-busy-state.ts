/**
 * Tracking which players in a room are currently in a game.
 *
 * The roster shows `(in a game)` beside those players and refuses to offer
 * them as challenge targets — see
 * docs/SCRUM/TODO/Feature.ChangeIconStatusIChatWhenPlayerIsInAGame.md.
 *
 * The rules live here as pure functions rather than inline in
 * bg-room-setup.ts because the interesting case cannot be reproduced
 * through the UI: a `GameOver` from an already-finished game arriving
 * *after* the same two players have started a new one. Driving a browser
 * can't force that ordering, but the decision itself is a plain function
 * of the tracked state, so it can be tested directly.
 */

export interface RosterBusyState {
  /** Ids of the games currently believed to be running in this room. */
  activeGameIds: ReadonlySet<string>
  /** Ids of the players currently believed to be in one of those games. */
  busyPlayerIds: ReadonlySet<string>
}

export const emptyBusyState: RosterBusyState = {
  activeGameIds: new Set(),
  busyPlayerIds: new Set(),
}

/** A game started: both of its players are busy, and the game is tracked so
 * its own end can later be recognised. */
export function gameStarted(state: RosterBusyState, gameId: string, playerA: string, playerB: string): RosterBusyState {
  return {
    activeGameIds: new Set(state.activeGameIds).add(gameId),
    busyPlayerIds: new Set(state.busyPlayerIds).add(playerA).add(playerB),
  }
}

/**
 * A game ended.
 *
 * Ignored entirely unless this is a game we are actually tracking. That is
 * the whole point: the same two players can finish one game and immediately
 * start another, so an event naming that pair is not enough to conclude they
 * are free — only an event naming *this* game is. Without the check, a late
 * event from the finished game would mark them available while they are
 * mid-way through the next one.
 */
export function gameEnded(state: RosterBusyState, gameId: string, playerA: string, playerB: string): RosterBusyState {
  if (!state.activeGameIds.has(gameId)) return state

  const activeGameIds = new Set(state.activeGameIds)
  activeGameIds.delete(gameId)

  const busyPlayerIds = new Set(state.busyPlayerIds)
  busyPlayerIds.delete(playerA)
  busyPlayerIds.delete(playerB)

  return { activeGameIds, busyPlayerIds }
}

/** A player left the room for good. Their busy flag goes with them, since
 * nothing else will ever clear it — but any game they were in stays tracked
 * until its own end arrives, so the opponent's status is unaffected. */
export function playerLeft(state: RosterBusyState, playerId: string): RosterBusyState {
  if (!state.busyPlayerIds.has(playerId)) return state

  const busyPlayerIds = new Set(state.busyPlayerIds)
  busyPlayerIds.delete(playerId)
  return { activeGameIds: state.activeGameIds, busyPlayerIds }
}
