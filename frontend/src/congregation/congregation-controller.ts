import type { ReactiveController, ReactiveControllerHost } from 'lit'
import {
  onGameOver,
  onLeaderboardUpdated,
  onRoomActivityChanged,
  onRoundScored,
  onRoundStarted,
} from '../signalr-client'
import {
  initialCongregationState,
  withActivity,
  withBoard,
  withGameOver,
  withSession,
  withoutResult,
  type CongregationState,
} from './congregation-state'

/**
 * Follows the room's Congregation for the room screen (see
 * bg-room-setup.ts): subscribes to every Congregation event while the
 * player is in a room and folds each one into a CongregationState (see
 * congregation-state.ts), re-rendering its host on every change.
 *
 * Owned by the room screen, which is listening from the moment it joins,
 * rather than by the lobby or game components — those mount in response
 * to these very events, too late to hear the ones that caused them.
 */
export class CongregationController implements ReactiveController {
  state: CongregationState = initialCongregationState

  private unsubscribers: Array<() => void> = []
  private readonly host: ReactiveControllerHost

  constructor(host: ReactiveControllerHost) {
    this.host = host
    host.addController(this)
  }

  /** Starts following — call when joining a room. */
  start() {
    this.stop()
    this.unsubscribers = [
      onRoomActivityChanged((activity) => this.apply(withActivity(this.state, activity))),
      onRoundStarted((session) => this.apply(withSession(this.state, session))),
      onRoundScored((session) => this.apply(withSession(this.state, session))),
      onLeaderboardUpdated((board) => this.apply(withBoard(this.state, board))),
      onGameOver((gameId, _scores, _participants, reason) => this.apply(withGameOver(this.state, gameId, reason))),
    ]
  }

  /** Stops following and forgets everything — call when leaving a room. */
  stop() {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    this.state = initialCongregationState
  }

  /** The player has seen the results. */
  dismissResult() {
    this.apply(withoutResult(this.state))
  }

  hostDisconnected() {
    this.stop()
  }

  private apply(next: CongregationState) {
    if (next === this.state) return
    this.state = next
    this.host.requestUpdate()
  }
}
