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
