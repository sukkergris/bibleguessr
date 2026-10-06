namespace BibleGuessr.Domain

/// One well-known verse, identified the same way a VerseReference is: by
/// book NUMBER, chapter and verse number — never by name, never with text
/// (see Verse.bookNumbers for why names can't be trusted).
type FamousVerse =
    { BookNumber: int
      Chapter: int
      VerseNumber: int }

/// Well-known verses that a random draw favors — see
/// docs/web/famous-verses. Each draw first rolls whether it should be a
/// famous verse (`Settings.ChancePercent`) and, if so, picks evenly among
/// the famous verses that are in play; otherwise it picks evenly among all
/// verses in play, as before.
module FamousVerses =
    type Settings =
        { /// The chance, in whole percent (0–100), that a draw picks one
          /// of the famous verses.
          ChancePercent: int }

    /// Used when "FamousVerses:ChancePercent" isn't configured.
    let defaultChancePercent = 20

    /// What one draw is for — decided by drawKind before a verse is picked.
    type Draw =
        /// Pick among the famous verses in play (if there are any).
        | Famous
        /// Pick among every verse in play.
        | Any

    /// The book numbers the list uses: each book's position in the
    /// server's bibelen-dk pool, which is in Lutheran order — so e.g.
    /// Hebrews = 58, 1 Peter = 59, 2 Peter = 60, 1 John = 61, James = 64,
    /// unlike the New World Translation's order. Tests/FamousVersesTests.fs
    /// pins each one to that pool's name for the book.
    module Book =
        let genesis = 1
        let exodus = 2
        let deuteronomy = 5
        let joshua = 6
        let job = 18
        let psalms = 19
        let proverbs = 20
        let ecclesiastes = 21
        let isaiah = 23
        let jeremiah = 24
        let ezekiel = 26
        let daniel = 27
        let joel = 29
        let micah = 33
        let zephaniah = 36
        let malachi = 39
        let matthew = 40
        let luke = 42
        let john = 43
        let acts = 44
        let romans = 45
        let corinthians1 = 46
        let corinthians2 = 47
        let philippians = 50
        let timothy1 = 54
        let timothy2 = 55
        let hebrews = 58
        let peter1 = 59
        let peter2 = 60
        let john1 = 61
        let james = 64
        let revelation = 66

    let private famous bookNumber chapter verseNumber =
        { BookNumber = bookNumber
          Chapter = chapter
          VerseNumber = verseNumber }

    /// The list, numbered as the server's bibelen-dk pool numbers its
    /// books and verses — NOT as the New World Translation does:
    /// - books are in that pool's order (see Book);
    /// - a psalm's heading is its verse 1, so NWT's Sl 83,18 is 83,19 here;
    /// - NWT's Joel 2,32 is Joel 3,5 here.
    /// Tests/FamousVersesTests.fs checks every entry is in that pool.
    /// A verse range is one entry per verse, since a draw is one verse.
    let all: FamousVerse list =
        [ // Chosen by the maintainer
          famous Book.genesis 9 4 // 1 Mos 9,4
          famous Book.deuteronomy 30 15 // 5 Mos 30,15
          famous Book.deuteronomy 30 16 // 5 Mos 30,16
          famous Book.joshua 1 8 // Jos 1,8
          famous Book.joshua 23 14 // Jos 23,14
          // Well-known verses Jehovah's Witnesses will recognize
          famous Book.genesis 1 1 // 1 Mos 1,1
          famous Book.genesis 1 28 // 1 Mos 1,28
          famous Book.genesis 2 7 // 1 Mos 2,7
          famous Book.genesis 2 17 // 1 Mos 2,17
          famous Book.genesis 3 4 // 1 Mos 3,4
          famous Book.genesis 3 15 // 1 Mos 3,15
          famous Book.genesis 3 19 // 1 Mos 3,19
          famous Book.genesis 22 18 // 1 Mos 22,18
          famous Book.exodus 3 15 // 2 Mos 3,15
          famous Book.exodus 6 3 // 2 Mos 6,3
          famous Book.deuteronomy 6 5 // 5 Mos 6,5
          famous Book.deuteronomy 18 10 // 5 Mos 18,10
          famous Book.deuteronomy 32 4 // 5 Mos 32,4
          famous Book.job 14 14 // Job 14,14
          famous Book.psalms 37 9 // Sl 37,9
          famous Book.psalms 37 11 // Sl 37,11
          famous Book.psalms 37 29 // Sl 37,29
          famous Book.psalms 83 19 // Sl 83,19 (NWT 83:18)
          famous Book.psalms 104 5 // Sl 104,5
          famous Book.psalms 115 16 // Sl 115,16
          famous Book.psalms 146 4 // Sl 146,4
          famous Book.psalms 145 16 // Sl 145,16
          famous Book.psalms 65 2 // Sl 65,2
          famous Book.psalms 119 105 // Sl 119,105
          famous Book.proverbs 3 5 // Ordsp 3,5
          famous Book.proverbs 4 18 // Ordsp 4,18
          famous Book.proverbs 27 11 // Ordsp 27,11
          famous Book.ecclesiastes 9 5 // Præd 9,5
          famous Book.ecclesiastes 9 10 // Præd 9,10
          famous Book.ecclesiastes 12 13 // Præd 12,13
          famous Book.isaiah 2 4 // Es 2,4
          famous Book.isaiah 9 6 // Es 9,6
          famous Book.isaiah 11 9 // Es 11,9
          famous Book.isaiah 33 24 // Es 33,24
          famous Book.isaiah 35 5 // Es 35,5
          famous Book.isaiah 40 26 // Es 40,26
          famous Book.isaiah 42 8 // Es 42,8
          famous Book.isaiah 43 10 // Es 43,10
          famous Book.isaiah 45 18 // Es 45,18
          famous Book.isaiah 55 11 // Es 55,11
          famous Book.isaiah 25 8 // Es 25,8
          famous Book.jeremiah 10 23 // Jer 10,23
          famous Book.ezekiel 18 4 // Ez 18,4
          famous Book.daniel 2 44 // Dan 2,44
          famous Book.micah 6 8 // Mika 6,8
          famous Book.zephaniah 2 3 // Zef 2,3
          famous Book.malachi 3 10 // Mal 3,10
          famous Book.joel 3 5 // Joel 3,5 (NWT 2:32)
          famous Book.matthew 5 3 // Matt 5,3
          famous Book.matthew 5 5 // Matt 5,5
          famous Book.matthew 6 9 // Matt 6,9
          famous Book.matthew 6 10 // Matt 6,10
          famous Book.matthew 6 33 // Matt 6,33
          famous Book.matthew 7 13 // Matt 7,13
          famous Book.matthew 24 3 // Matt 24,3
          famous Book.matthew 24 7 // Matt 24,7
          famous Book.matthew 24 14 // Matt 24,14
          famous Book.matthew 28 19 // Matt 28,19
          famous Book.luke 23 43 // Luk 23,43
          famous Book.luke 22 19 // Luk 22,19
          famous Book.john 3 16 // Joh 3,16
          famous Book.john 4 24 // Joh 4,24
          famous Book.john 8 32 // Joh 8,32
          famous Book.john 13 35 // Joh 13,35
          famous Book.john 14 6 // Joh 14,6
          famous Book.john 14 28 // Joh 14,28
          famous Book.john 17 3 // Joh 17,3
          famous Book.john 17 16 // Joh 17,16
          famous Book.john 5 28 // Joh 5,28
          famous Book.acts 15 29 // ApG 15,29
          famous Book.acts 17 11 // ApG 17,11
          famous Book.acts 20 20 // ApG 20,20
          famous Book.acts 24 15 // ApG 24,15
          famous Book.acts 5 29 // ApG 5,29
          famous Book.romans 5 12 // Rom 5,12
          famous Book.romans 6 23 // Rom 6,23
          famous Book.romans 10 13 // Rom 10,13
          famous Book.romans 12 2 // Rom 12,2
          famous Book.romans 15 4 // Rom 15,4
          famous Book.corinthians1 15 26 // 1 Kor 15,26
          famous Book.corinthians1 15 33 // 1 Kor 15,33
          famous Book.corinthians2 4 4 // 2 Kor 4,4
          famous Book.philippians 4 6 // Fil 4,6
          famous Book.timothy1 2 5 // 1 Tim 2,5
          famous Book.timothy2 3 1 // 2 Tim 3,1
          famous Book.timothy2 3 16 // 2 Tim 3,16
          famous Book.hebrews 11 6 // Hebr 11,6
          famous Book.hebrews 10 25 // Hebr 10,25
          famous Book.james 1 13 // Jak 1,13
          famous Book.peter1 3 15 // 1 Pet 3,15
          famous Book.peter1 5 7 // 1 Pet 5,7
          famous Book.peter2 3 13 // 2 Pet 3,13
          famous Book.john1 4 8 // 1 Joh 4,8
          famous Book.john1 5 3 // 1 Joh 5,3
          famous Book.john1 5 19 // 1 Joh 5,19
          famous Book.revelation 4 11 // Åb 4,11
          famous Book.revelation 12 9 // Åb 12,9
          famous Book.revelation 12 12 // Åb 12,12
          famous Book.revelation 21 3 // Åb 21,3
          famous Book.revelation 21 4 // Åb 21,4
        ]

    let private famousKeys =
        all |> List.map (fun f -> f.BookNumber, f.Chapter, f.VerseNumber) |> Set.ofList

    /// The scale ChancePercent is a share of.
    let private percentScale = 100

    /// Rolls what one draw is for. `nextIndex upper` returns a random
    /// index in [0, upper) — the same injected randomness as
    /// DailyQuiz.pick, so callers and tests control it.
    let drawKind (nextIndex: int -> int) (chancePercent: int) : Draw =
        if nextIndex percentScale < chancePercent then Famous else Any

    /// Whether `reference` is on the list.
    let isFamousReference (reference: VerseReference) : bool =
        famousKeys.Contains(reference.BookNumber, reference.Chapter, reference.VerseNumber)

    /// Whether `verse` is on the list, with its book number looked up in
    /// `numbersByBookName` (its pool's own — see Verse.bookNumbers).
    let isFamous (numbersByBookName: Map<string, int>) (verse: Verse) : bool =
        match numbersByBookName.TryFind verse.Book with
        | Some bookNumber -> famousKeys.Contains(bookNumber, verse.Chapter, verse.VerseNumber)
        | None -> false

    /// Picks one verse from `candidates` (which must not be empty): a
    /// famous one with a `chancePercent` chance, otherwise any. Falls back
    /// to any verse when no famous verse is among the candidates.
    let pickOne
        (nextIndex: int -> int)
        (chancePercent: int)
        (numbersByBookName: Map<string, int>)
        (candidates: Verse list)
        : Verse =
        let pool =
            match drawKind nextIndex chancePercent with
            | Famous ->
                match candidates |> List.filter (isFamous numbersByBookName) with
                | [] -> candidates
                | famous -> famous
            | Any -> candidates

        pool[nextIndex pool.Length]
