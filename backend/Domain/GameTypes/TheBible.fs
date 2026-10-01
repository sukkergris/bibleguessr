/// "The Bible" game type: every verse of the Bible is in play. Its own
/// bounded context — it must never reference the other game types (see
/// GameType.fs, the only place that knows all of them, and
/// docs/web/game-types).
module BibleGuessr.Domain.GameTypes.TheBible

/// No restriction at all — every verse matches (see
/// Verse.matchesRestrictionByNumber, where empty books means "all").
let restriction: Set<int> * Map<int, Set<int>> = Set.empty, Map.empty
