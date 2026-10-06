namespace BibleGuessr.Domain

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
    /// The game a game type actually plays as: one that selects nothing (no
    /// books, or no book in Chapters) plays as The Bible — the verses it
    /// draws AND the points it gives. A rule that spans game types, so it
    /// lives here, the only place that knows them all; the frontend's
    /// registry applies the same rule (see docs/web/game-types). Such a
    /// value can still arrive, e.g. from a client whose own Bible couldn't
    /// resolve the picked book (see chapters.ts's toWire).
    let playedAs (gameType: GameType) : GameType =
        match gameType with
        | Books [] -> AllVerses
        | Chapters selection when Map.isEmpty selection -> AllVerses
        | _ -> gameType

    /// Whether `gameType` draws its verses from the whole Bible (see
    /// playedAs) — the draws that favor the famous verses (see
    /// FamousVerses and docs/web/famous-verses).
    let drawsFromWholeBible (gameType: GameType) : bool =
        match playedAs gameType with
        | AllVerses -> true
        | Books _
        | Chapters _ -> false

    /// Converts a GameType into Verse.matchesRestrictionByNumber's (books,
    /// chaptersByBook) shape, by asking the game type's own module. Needed
    /// because the server (not the client) picks the verse for a
    /// multiplayer round — see GameHub.fs's AcceptPlayRequest/resolveRound.
    let restrictionOf (gameType: GameType) : Set<int> * Map<int, Set<int>> =
        match playedAs gameType with
        | AllVerses -> GameTypes.TheBible.restriction
        | Books selection -> GameTypes.Books.restriction selection
        | Chapters selection -> GameTypes.Chapters.restriction selection

    /// The points one multiplayer guess earns, by the rule of the game the
    /// game type plays as (see playedAs and each module's scoreGuess).
    let scoreGuess (gameType: GameType) (verse: VerseReference) (guess: Guess) : int =
        match playedAs gameType with
        | AllVerses -> GameTypes.TheBible.scoreGuess verse guess
        | Books selection -> GameTypes.Books.scoreGuess selection verse guess
        | Chapters selection -> GameTypes.Chapters.scoreGuess selection verse guess
