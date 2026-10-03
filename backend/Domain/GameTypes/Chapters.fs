/// "Chapters" game type: verses come only from the picked chapters of the
/// picked book. Its own bounded context — it must never reference the
/// other game types (see GameType.fs and docs/web/game-types).
module BibleGuessr.Domain.GameTypes.Chapters

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
/// given as the book. A chapter listed twice is still one chapter.
let private chapterIsGiven (selection: Selection) =
    selection
    |> Map.toSeq
    |> Seq.sumBy (fun (_, chapters) -> chapters |> List.distinct |> List.length)
    |> (=) 1

/// What's given at setup is no achievement, so it earns nothing: the book
/// always is (it's fixed)...
let private chaptersTiers = { Scoring.standardTiers with BookPoints = 0 }

/// ...and so is the chapter when only one was picked.
let private loneChapterTiers = { chaptersTiers with ChapterPoints = 0 }

/// How a multiplayer guess scores in this game type — its own rule: what's
/// given at setup earns nothing (see chaptersTiers/loneChapterTiers). The
/// singleplayer equivalent is frontend/src/game-types/chapters/chapters.ts's
/// scoreGuess; scoring-scenarios/chapters.json holds both to the same points.
let scoreGuess (selection: Selection) (verse: VerseReference) (guess: Guess) : int =
    let tiers = if chapterIsGiven selection then loneChapterTiers else chaptersTiers
    Scoring.tieredPoints tiers verse guess
