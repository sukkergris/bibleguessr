/// "Books" game type: verses come only from the books the challenger
/// picked. Its own bounded context — it must never reference the other
/// game types (see GameType.fs and docs/web/game-types).
module BibleGuessr.Domain.GameTypes.Books

open BibleGuessr.Domain

/// The picked books, by book NUMBER (1-based position in the challenger's
/// own Bible order), never by name — see Verses.fs's Verse.bookNumbers.
type Selection = int list

/// Every chapter of each picked book.
let restriction (selection: Selection) : Set<int> * Map<int, Set<int>> = Set.ofList selection, Map.empty

/// Whether only one book was picked — then the guess form offers nothing
/// else, so the book is a given.
let private bookIsGiven (selection: Selection) = (selection |> List.distinct |> List.length) = 1

/// What's given at setup is no achievement, so it earns nothing: with one
/// book picked, the book.
let private loneBookTiers = { Scoring.standardTiers with BookPoints = 0 }

/// How a multiplayer guess scores in this game type: the standard tiers,
/// except that a lone picked book earns nothing. Change it here to give
/// this game type its own scoring — no other game type is affected. The
/// singleplayer equivalent is frontend/src/game-types/books/books.ts's
/// scoreGuess; scoring-scenarios/books.json holds both to the same points.
let scoreGuess (selection: Selection) (verse: VerseReference) (guess: Guess) : int =
    let tiers = if bookIsGiven selection then loneBookTiers else Scoring.standardTiers
    Scoring.tieredPoints tiers verse guess
