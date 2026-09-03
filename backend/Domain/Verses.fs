namespace BibleGuessr.Domain

/// A single Bible verse, as loaded from a translation's data source.
type Verse =
    { Book: string
      Chapter: int
      VerseNumber: int
      Text: string
      Translation: string }

    member this.Reference = $"{this.Book} {this.Chapter}:{this.VerseNumber}"
