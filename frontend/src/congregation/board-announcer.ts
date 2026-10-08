/**
 * What the spectator board says out loud through its one live region —
 * see spectator-board.ts and docs/web/congregation.
 *
 * Deliberately sparse: only the moments a sighted viewer would notice on
 * a projector (the lobby opening, the game starting, a round's result, the
 * end). Individual guesses and the ticking clock are never announced —
 * with twenty players they would drown everything else out.
 */

import type { BoardEntry, LeaderboardSnapshot } from '../types'

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Anna leads with 42 points." / "Anna and Ben share the lead with 42 points." */
function standing(entries: BoardEntry[], verb: { one: string; many: string }): string | undefined {
  const leaders = entries.filter((e) => e.rank === 1)
  if (leaders.length === 0) return undefined
  const points = leaders[0].score
  const names = joinNames(leaders.map((e) => e.name))
  return `${names} ${leaders.length === 1 ? verb.one : verb.many} with ${points} points.`
}

const roundOf = (board: LeaderboardSnapshot) =>
  board.round.Case === 'NotStarted' ? undefined : board.round.Fields[0]

/** The announcement for moving from `previous` to `next`, or undefined
 * when nothing worth announcing changed. */
export function announcementFor(previous: LeaderboardSnapshot | undefined, next: LeaderboardSnapshot): string | undefined {
  const phase = next.phase.Case
  const previousPhase = previous?.phase.Case

  if (phase === 'LobbyOpen' && previousPhase !== 'LobbyOpen') {
    return `${next.hostName ?? 'Someone'} opened a Congregation. Waiting for players to join.`
  }

  if (phase === 'Finished' && previousPhase !== 'Finished') {
    return ['The game is over.', standing(next.entries, { one: 'wins', many: 'share first place' })]
      .filter(Boolean)
      .join(' ')
  }

  if (phase !== 'Playing') return undefined

  if (previousPhase !== 'Playing') return `The game has started. Round 1 of ${next.roundCount}.`

  const revealedNow = next.round.Case === 'Revealed'
  const revealedBefore = previous?.round.Case === 'Revealed' && roundOf(previous) === roundOf(next)
  if (revealedNow && !revealedBefore) {
    return [`Round ${roundOf(next)} scored.`, standing(next.entries, { one: 'leads', many: 'share the lead' })]
      .filter(Boolean)
      .join(' ')
  }

  return undefined
}
