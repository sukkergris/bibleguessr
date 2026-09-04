namespace BibleGuessr.Domain

/// A single Bible verse, as loaded from a translation's data source.
/// Reference is a plain field (not a computed member) so it round-trips
/// through JSON serialization for API consumers.
type Verse =
    { Book: string
      Chapter: int
      VerseNumber: int
      Text: string
      Translation: string
      Reference: string }

/// Identifies a verse WITHOUT its text — book/chapter/verseNumber, plus
/// BookNumber (the book's 1-based position in the POOL the round's verse
/// was drawn from — see Verse.bookNumbers). This is deliberately what a
/// multiplayer round's server-side state holds (see Game.fs's RoundState)
/// and what SubmitGuess broadcasts to the room: the server picks which
/// verse a round is about and scores guesses against it purely by these
/// fields, but never needs — and must never send — the verse's actual
/// text, since two players in the same game may be reading from two
/// different translations/uploaded files.
///
/// `Book` is kept alongside `BookNumber` for display purposes only (it's
/// the spelling from whichever pool picked the verse, typically the
/// server's own) — matching/scoring must always go through `BookNumber`,
/// never `Book`, since a guessing player's own source may spell the same
/// book differently (see Scoring.isCorrectGuess). Each client resolves
/// this reference to displayable text from its OWN locally-chosen
/// VerseSource (see frontend/src/types.ts's VerseSource), using
/// `BookNumber` to find its own spelling for that book (see
/// Verse.bookAtNumber) rather than trusting `Book`.
type VerseReference =
    { Book: string
      BookNumber: int
      Chapter: int
      VerseNumber: int }

module Verse =
    let create book chapter verseNumber text translation =
        { Book = book
          Chapter = chapter
          VerseNumber = verseNumber
          Text = text
          Translation = translation
          Reference = $"{book} {chapter}:{verseNumber}" }

    /// Builds a VerseReference for `verse`, with BookNumber looked up from
    /// `numbersByBookName` (its pool's own book numbers — see
    /// bookNumbers). The caller is expected to have computed
    /// `numbersByBookName` once for the whole pool `verse` came from (see
    /// GameHub.fs's pickRandomVerse) rather than recomputing it per verse.
    /// Falls back to 0 if `verse`'s own book is somehow absent from
    /// `numbersByBookName` (shouldn't happen when both come from the same
    /// pool) rather than throwing — a VerseReference must always be total.
    let referenceOfIn (numbersByBookName: Map<string, int>) (verse: Verse) : VerseReference =
        { Book = verse.Book
          BookNumber = numbersByBookName |> Map.tryFind verse.Book |> Option.defaultValue 0
          Chapter = verse.Chapter
          VerseNumber = verse.VerseNumber }

    /// Whether `verse` falls within a book/chapter restriction — see
    /// docs/SCRUM/Feature.BibleSelector.md. `books` empty means "default
    /// ALL" (no restriction at all, matches everything). Otherwise the
    /// verse's book must be selected; if that book also has an entry in
    /// `chaptersByBook`, the verse's chapter must be in that set too — a
    /// selected book with no entry there means "all of its chapters".
    /// Pulled out as a pure function (rather than left inline in the
    /// /api/verses/random handler in Program.fs) so it's unit-testable on
    /// its own, mirroring this codebase's existing "pure domain function,
    /// thin endpoint/hub wrapper" pattern (see Game.fs's Room/Scoring
    /// modules).
    let matchesRestriction (books: Set<string>) (chaptersByBook: Map<string, Set<int>>) (verse: Verse) =
        if books.IsEmpty then
            true
        elif not (books.Contains verse.Book) then
            false
        else
            match chaptersByBook.TryFind verse.Book with
            | Some chapters -> chapters.Contains verse.Chapter
            | None -> true

    /// Assigns every book in `verses` a stable 1-based number, by the
    /// order each is first encountered — the same "Bible order" every
    /// loader already produces by construction (see
    /// docs/SCRUM/Feature.BooksGameSorting.md and
    /// Program.fs's /api/books-in-bible-order) but never captured as a
    /// number before now.
    ///
    /// This exists to fix a real bug: two players in a multiplayer game
    /// may each have a different translation/uploaded file, and book
    /// NAMES vary too much to match across them reliably — not just
    /// across languages/translations, but even within the SAME
    /// translation (bibelen-dk's own loader has produced both "Jeremias"
    /// and "Jeremias." for what's really one book, a parsing artifact).
    /// A NUMBER derived from position, rather than a name-alias lookup
    /// table, needs no per-translation/per-language maintenance and is
    /// exactly as reliable as each source's own reading order already is
    /// — which this codebase already trusts everywhere else (see
    /// local-verses.ts's getBooksInBibleOrder, BibelenDkLoader.fs).
    ///
    /// Known limit: two sources only agree on a book's number as long as
    /// they agree on every earlier book's presence/order too — a file
    /// missing or inserting a book (e.g. a different canon) will disagree
    /// with another from that point on. Accepted the same way this
    /// codebase already accepts "per-player translation mismatches are
    /// rare" elsewhere (see VerseReference's doc comment) rather than
    /// solved outright.
    let bookNumbers (verses: Verse list) : Map<string, int> =
        verses
        |> List.map (fun v -> v.Book)
        |> List.distinct
        |> List.mapi (fun i book -> book, i + 1)
        |> Map.ofList

    /// The number `book` was assigned by bookNumbers, if it's present in
    /// `verses` at all — case-insensitive, so a caller doesn't need to
    /// match a source's exact casing to look itself up in its own list.
    let bookNumberOf (verses: Verse list) (book: string) : int option =
        let numbers = bookNumbers verses

        numbers
        |> Map.tryPick (fun candidate number ->
            if System.String.Equals(candidate, book, System.StringComparison.OrdinalIgnoreCase) then
                Some number
            else
                None)

    /// The book name at position `number` (1-based) in `verses`' own
    /// Bible order, if any — the inverse of bookNumberOf, used to resolve
    /// a book NUMBER (e.g. from another player's game session) back to
    /// THIS source's own spelling for that position.
    let bookAtNumber (verses: Verse list) (number: int) : string option =
        if number < 1 then
            None
        else
            verses
            |> List.map (fun v -> v.Book)
            |> List.distinct
            |> List.tryItem (number - 1)

    /// Whether `verse` falls within a book/chapter restriction given by
    /// NUMBER rather than name — see bookNumbers' doc comment for why:
    /// `books`/`chaptersByBook` may have been computed against a
    /// DIFFERENT source's own spelling (e.g. a challenger's uploaded
    /// file), so `numbersByBookName` (this restriction's own pool's book
    /// numbers, from bookNumbers — typically the server's) is used only
    /// to look up what number VERSE's own book has, never to match names
    /// directly. Same shape/semantics as matchesRestriction, just keyed
    /// by number. Callers filtering a whole verse list should compute
    /// `bookNumbers verses` ONCE and reuse it (see GameHub.fs's
    /// pickRandomVerse) rather than recomputing it per verse.
    let matchesRestrictionByNumber
        (numbersByBookName: Map<string, int>)
        (books: Set<int>)
        (chaptersByBook: Map<int, Set<int>>)
        (verse: Verse)
        : bool =
        if books.IsEmpty then
            true
        else
            match numbersByBookName.TryFind verse.Book with
            | None -> false
            | Some number ->
                if not (books.Contains number) then
                    false
                else
                    match chaptersByBook.TryFind number with
                    | Some chapters -> chapters.Contains verse.Chapter
                    | None -> true
