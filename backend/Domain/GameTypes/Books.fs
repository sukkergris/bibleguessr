/// "Books" game type: verses come only from the books the challenger
/// picked. Its own bounded context — it must never reference the other
/// game types (see GameType.fs and docs/web/game-types).
module BibleGuessr.Domain.GameTypes.Books

open System
open BibleGuessr.Domain

/// The picked books, by book NUMBER (1-based position in the challenger's
/// own Bible order), never by name — see Verses.fs's Verse.bookNumbers.
type Selection = int list

/// Every chapter of each picked book.
let restriction (selection: Selection) : Set<int> * Map<int, Set<int>> = Set.ofList selection, Map.empty

/// How a multiplayer guess scores in this game type. The standard rule
/// today; replace it here to give this game type its own scoring — no
/// other game type is affected.
let scoreGuess: TimeLimit -> TimeSpan -> VerseReference -> Guess -> GuessScore = Scoring.standardMultiplayer
