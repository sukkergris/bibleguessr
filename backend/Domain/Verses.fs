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

module Verse =
    let create book chapter verseNumber text translation =
        { Book = book
          Chapter = chapter
          VerseNumber = verseNumber
          Text = text
          Translation = translation
          Reference = $"{book} {chapter}:{verseNumber}" }

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
