/// "The Bible" game type: every verse of the Bible is in play. Its own
/// bounded context — it must never reference the other game types (see
/// GameType.fs, the only place that knows all of them, and
/// docs/web/game-types).
module BibleGuessr.Domain.GameTypes.TheBible

open BibleGuessr.Domain

/// No restriction at all — every verse matches (see
/// Verse.matchesRestrictionByNumber, where empty books means "all").
let restriction: Set<int> * Map<int, Set<int>> = Set.empty, Map.empty

/// How a multiplayer guess scores in this game type: nothing is given at
/// setup, so every part earns its standard tier. Change it here to give
/// this game type its own scoring — no other game type is affected. The
/// singleplayer equivalent is frontend/src/game-types/the-bible/the-bible.ts's
/// scoreGuess; scoring-scenarios/the-bible.json holds both to the same points.
let scoreGuess (verse: VerseReference) (guess: Guess) : int =
    Scoring.tieredPoints Scoring.standardTiers verse guess
