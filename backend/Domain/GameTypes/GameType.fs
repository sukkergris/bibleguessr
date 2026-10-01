namespace BibleGuessr.Domain

open System

/// Which verses a challenged game will draw from — chosen by the challenger
/// before sending the request (see docs/SCRUM/Feature.RequestToStartMPGame.md),
/// so the challenged player can see what they're being invited to.
///
/// Each case is its own game type with its own module in GameTypes/
/// (TheBible, Books, Chapters). This file is the ONLY place that knows all
/// of them: it composes them into the wire type and dispatches to each.
/// The modules themselves never reference one another — see
/// docs/web/game-types and Tests/GameTypeIsolationTests.fs.
///
/// Books/Chapters are keyed by book NUMBER, not name — see
/// Verses.fs's Verse.bookNumbers doc comment for why book names can't be
/// trusted to match across two players' different translations/uploaded
/// files (or even within the same one — bibelen-dk's own loader has
/// produced both "Jeremias" and "Jeremias." for one book). The challenger
/// picks books from their OWN VerseSource and sends the numbers THEIR OWN
/// source assigned those books (its own Bible-order position); the server
/// matches those numbers against its own pool's own book numbers (see
/// Verse.matchesRestrictionByNumber) — same book, regardless of spelling.
///
/// The case names and payload shapes are the JSON wire format shared with
/// frontend/src/shared-kernel/game-type-wire.ts, so they must not change
/// without changing both sides.
type GameType =
    | AllVerses
    | Books of GameTypes.Books.Selection
    | Chapters of GameTypes.Chapters.Selection

module GameType =
    /// Converts a GameType into Verse.matchesRestrictionByNumber's (books,
    /// chaptersByBook) shape, by asking the game type's own module. Needed
    /// because the server (not the client) picks the verse for a
    /// multiplayer round — see GameHub.fs's AcceptPlayRequest/resolveRound.
    let restrictionOf (gameType: GameType) : Set<int> * Map<int, Set<int>> =
        match gameType with
        | AllVerses -> GameTypes.TheBible.restriction
        | Books selection -> GameTypes.Books.restriction selection
        | Chapters selection -> GameTypes.Chapters.restriction selection

    /// Scores one multiplayer guess by the game type's own rule — see each
    /// module's scoreGuess. `elapsed` is the time since the round started.
    let scoreGuess (gameType: GameType) (timeLimit: TimeLimit) (elapsed: TimeSpan) (verse: VerseReference) (guess: Guess) : GuessScore =
        match gameType with
        | AllVerses -> GameTypes.TheBible.scoreGuess timeLimit elapsed verse guess
        | Books _ -> GameTypes.Books.scoreGuess timeLimit elapsed verse guess
        | Chapters selection -> GameTypes.Chapters.scoreGuess selection timeLimit elapsed verse guess
