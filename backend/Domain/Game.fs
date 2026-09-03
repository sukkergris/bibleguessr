namespace BibleGuessr.Domain

open System

type PlayerId = PlayerId of Guid
type RoomCode = RoomCode of string

type Player =
    { Id: PlayerId
      Name: string
      Score: int }

/// A guess a player submits for the current round's verse. Chapter and
/// VerseNumber are optional — a player can guess just the book — but
/// VerseNumber only makes sense alongside a Chapter guess.
type Guess =
    { PlayerId: PlayerId
      Book: string
      Chapter: int option
      VerseNumber: int option
      SubmittedAt: DateTimeOffset }

/// Result of scoring one player's guess against the round's actual verse.
type GuessResult =
    { PlayerId: PlayerId
      Correct: bool
      PointsAwarded: int }

type RoundState =
    | WaitingForPlayers
    | InProgress of Verse
    | Scored of Verse * GuessResult list

type Room =
    { Code: RoomCode
      Players: Player list
      Round: RoundState }

module Scoring =

    /// Points for a correct guess, decreasing the longer a player takes to answer.
    /// `elapsed` is time since the round started; `roundLength` is the total time allowed.
    let pointsForGuess (roundLength: TimeSpan) (elapsed: TimeSpan) (correct: bool) =
        if not correct then
            0
        else
            let remainingFraction =
                1.0 - (elapsed.TotalSeconds / roundLength.TotalSeconds) |> max 0.0

            let basePoints = 100
            let bonus = int (float basePoints * remainingFraction)
            basePoints + bonus

    let isCorrectGuess (verse: Verse) (guess: Guess) =
        let bookMatches =
            String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

        match guess.Chapter with
        | Some chapter -> bookMatches && chapter = verse.Chapter
        | None -> bookMatches

    /// Points awarded per level of a guess, each gated on every level before
    /// it being correct: the book alone is worth 1000; the chapter only
    /// counts (100 more) if the book was also right; the verse number only
    /// counts (10 more) if both book and chapter were right. An omitted
    /// Chapter/VerseNumber guess simply can't earn that level's points.
    let private bookPoints = 1000
    let private chapterPoints = 100
    let private verseNumberPoints = 10

    let pointsForVerseGuess (verse: Verse) (guess: Guess) =
        let bookCorrect =
            String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

        if not bookCorrect then
            0
        else
            let chapterCorrect =
                match guess.Chapter with
                | Some chapter -> chapter = verse.Chapter
                | None -> false

            if not chapterCorrect then
                bookPoints
            else
                let verseNumberCorrect =
                    match guess.VerseNumber with
                    | Some verseNumber -> verseNumber = verse.VerseNumber
                    | None -> false

                if verseNumberCorrect then
                    bookPoints + chapterPoints + verseNumberPoints
                else
                    bookPoints + chapterPoints
