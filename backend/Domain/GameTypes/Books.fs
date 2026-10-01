/// "Books" game type: verses come only from the books the challenger
/// picked. Its own bounded context — it must never reference the other
/// game types (see GameType.fs and docs/web/game-types).
module BibleGuessr.Domain.GameTypes.Books

/// The picked books, by book NUMBER (1-based position in the challenger's
/// own Bible order), never by name — see Verses.fs's Verse.bookNumbers.
type Selection = int list

/// Every chapter of each picked book.
let restriction (selection: Selection) : Set<int> * Map<int, Set<int>> = Set.ofList selection, Map.empty
