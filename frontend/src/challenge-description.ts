import { describeWire } from './game-types/registry'
import { parseTimeSpanMs } from './timer'
import type { GameType, TimeLimit, VerseSource } from './types'

/** Everything a challenged player is agreeing to, in one line: which
 * verses, how many rounds, and how long they get per verse — see
 * <bg-play-requests>, which shows this under "<name> wants to play".
 *
 * "Which verses" comes from the game type itself (see
 * game-types/registry.ts's describeWire); the round count and time limit
 * live on the PlayRequest, not on the GameType — see types.ts's
 * PlayRequest and docs/SCRUM/Feature.Time.md. */
export async function describeChallenge(
  gameType: GameType,
  roundCount: number,
  roundTimeLimit: TimeLimit,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<string> {
  const verses = await describeWire(gameType, verseSource, translation)
  const rounds = `${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`
  const time =
    roundTimeLimit.Case === 'Unlimited'
      ? 'No time limit'
      : `${Math.round(parseTimeSpanMs(roundTimeLimit.Fields[0]) / 1000)}s per verse`

  return `${verses} · ${rounds} · ${time}`
}
