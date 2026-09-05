/**
 * Deciding whether a game-scoped server message belongs to the game a
 * client is actually playing.
 *
 * A game is NOT identified by its two players. The same two people can
 * finish a game and immediately start another, and a message from the
 * finished one still names that same pair — which is how a stale GameOver
 * used to tear down a live game mid-round (see
 * docs/SCRUM/BUGS/BUG.StaleGameOverEndsTheWrongGame.md). Each game carries
 * its own id (backend/Domain/Game.fs's GameId) and that is what must be
 * matched on.
 *
 * Kept here as a pure function rather than a private method on
 * <bg-multiplayer-game> so the rule can be tested directly — the
 * component itself has no unit-test harness in this project.
 */

/**
 * Whether a game-scoped message with `incomingGameId` belongs to the game
 * identified by `currentGameId`.
 *
 * Returns false when the client has no current game id yet: an
 * unrecognised message must never be allowed to end a game. The server
 * re-broadcasts authoritative state on the next round, so ignoring one is
 * always recoverable — wrongly acting on one is not.
 */
export function isSameGame(currentGameId: string | undefined, incomingGameId: string | undefined): boolean {
  if (currentGameId === undefined || incomingGameId === undefined) return false
  return currentGameId === incomingGameId
}
