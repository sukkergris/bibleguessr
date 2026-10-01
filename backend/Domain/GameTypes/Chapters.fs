/// "Chapters" game type: verses come only from the picked chapters of the
/// picked book. Its own bounded context — it must never reference the
/// other game types (see GameType.fs and docs/web/game-types).
module BibleGuessr.Domain.GameTypes.Chapters

open System
open BibleGuessr.Domain

/// Picked chapters keyed by book NUMBER — see Verses.fs's
/// Verse.bookNumbers for why numbers rather than names. The frontend only
/// ever sends one book, but the shape allows more.
type Selection = Map<int, int list>

/// Each picked book, narrowed to its picked chapters.
let restriction (selection: Selection) : Set<int> * Map<int, Set<int>> =
    let books = selection |> Map.keys |> Set.ofSeq
    let chaptersByBook = selection |> Map.map (fun _ chapters -> Set.ofList chapters)
    books, chaptersByBook

/// Whether only one chapter was picked — then the chapter is as much a
/// given as the book.
let private chapterIsGiven (selection: Selection) =
    selection
    |> Map.toSeq
    |> Seq.sumBy (fun (_, chapters) -> chapters |> List.distinct |> List.length)
    |> (=) 1

/// How a multiplayer guess scores in this game type — its own rule. What's
/// given at setup is no achievement: the book always is (it's fixed), and
/// so is the chapter when only one was picked. The standard rule would
/// count a book-only guess as correct, which here would be points for
/// nothing. So a guess must also get the chapter right — and, when the
/// chapter is a given, the verse number too; then it scores like the
/// standard rule. The singleplayer equivalent is
/// frontend/src/game-types/chapters/chapters.ts's scoreGuess.
let scoreGuess
    (selection: Selection)
    (timeLimit: TimeLimit)
    (elapsed: TimeSpan)
    (verse: VerseReference)
    (guess: Guess)
    : GuessScore =
    let guessedWhatIsNotGiven =
        guess.Chapter.IsSome
        && (not (chapterIsGiven selection) || guess.VerseNumber = Some verse.VerseNumber)

    if guessedWhatIsNotGiven then
        Scoring.standardMultiplayer timeLimit elapsed verse guess
    else
        { Correct = false; Points = 0 }
