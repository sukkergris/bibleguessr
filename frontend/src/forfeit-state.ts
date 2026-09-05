/**
 * The forfeit confirmation dialog's in-flight state.
 *
 * Forfeiting is confirmed locally but resolved remotely: the dialog shows
 * "Forfeiting…" and disables both buttons until the server's GameOver
 * arrives and tears the game screen down. That means the dialog depends on
 * a message that might never come — the connection drops, or the game was
 * already ended by the opponent's disconnect so there is nothing left to
 * forfeit. When that happened the dialog stayed disabled forever and the
 * player was trapped with no way out (see
 * docs/SCRUM/BUGS/BUG.CanForfeitAGameWhereConnectionLost.md).
 *
 * The rule below is what prevents that. It lives here as a pure function
 * rather than inside <bg-multiplayer-game> so it can be tested directly —
 * the component itself has no unit-test harness in this project, and the
 * real-world trigger (a two-minute reconnect grace period elapsing) is not
 * practical to reproduce end-to-end.
 */

/** How long to wait for the server to act on a forfeit before handing
 * control back to the player. Long enough that a healthy round-trip never
 * trips it; short enough that nobody sits on a dead dialog. */
export const FORFEIT_RESPONSE_TIMEOUT_MS = 5000

export type ForfeitOutcome =
  /** Keep waiting — the request is still plausibly in flight. */
  | { kind: 'waiting' }
  /** Give control back and say why. */
  | { kind: 'recovered'; message: string }

/**
 * Decides what the dialog should do once `elapsedMs` has passed since the
 * player confirmed a forfeit and the server still has not responded.
 *
 * Recovering is always safe: either the game is genuinely over (so the
 * player can simply leave) or it is still running (so they can retry).
 * Staying stuck is never safe, which is why there is no third "keep
 * waiting indefinitely" outcome.
 */
export function forfeitOutcomeAfter(elapsedMs: number, timeoutMs = FORFEIT_RESPONSE_TIMEOUT_MS): ForfeitOutcome {
  if (elapsedMs < timeoutMs) return { kind: 'waiting' }

  return {
    kind: 'recovered',
    message: 'No response from the server — the game may have already ended. Try again, or use “Back to chat selection”.',
  }
}
