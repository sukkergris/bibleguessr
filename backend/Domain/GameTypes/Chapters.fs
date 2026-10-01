/// "Chapters" game type: verses come only from the picked chapters of the
/// picked book. Its own bounded context — it must never reference the
/// other game types (see GameType.fs and docs/web/game-types).
module BibleGuessr.Domain.GameTypes.Chapters

/// Picked chapters keyed by book NUMBER — see Verses.fs's
/// Verse.bookNumbers for why numbers rather than names. The frontend only
/// ever sends one book, but the shape allows more.
type Selection = Map<int, int list>

/// Each picked book, narrowed to its picked chapters.
let restriction (selection: Selection) : Set<int> * Map<int, Set<int>> =
    let books = selection |> Map.keys |> Set.ofSeq
    let chaptersByBook = selection |> Map.map (fun _ chapters -> Set.ofList chapters)
    books, chaptersByBook
