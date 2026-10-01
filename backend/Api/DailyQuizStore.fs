/// Reads and writes daily quizzes in the database — see Database.fs and
/// docs/web/daily-quiz. References only, never verse text.
module BibleGuessr.Api.DailyQuizStore

open System
open System.Globalization
open BibleGuessr.Domain

/// How a quiz's day is written: ISO 8601, so it also sorts by date.
let private dateFormat = "yyyy-MM-dd"

let private dateText (date: DateOnly) = date.ToString(dateFormat, CultureInfo.InvariantCulture)

let tryGet (connectionString: string) (date: DateOnly) : DailyQuiz option =
    use connection = Database.openConnection connectionString
    use command = connection.CreateCommand()

    command.CommandText <-
        """
        SELECT q.date, v.book, v.book_number, v.chapter, v.verse_number
        FROM daily_quizzes q
        LEFT JOIN daily_quiz_verses v ON v.date = q.date
        WHERE q.date = $date
        ORDER BY v.position
        """

    command.Parameters.AddWithValue("$date", dateText date) |> ignore
    use reader = command.ExecuteReader()

    let rows =
        [ while reader.Read() do
              if not (reader.IsDBNull 1) then
                  yield
                      { Book = reader.GetString 1
                        BookNumber = reader.GetInt32 2
                        Chapter = reader.GetInt32 3
                        VerseNumber = reader.GetInt32 4 } ]

    // A quiz row exists exactly when the query found its date at all.
    if reader.HasRows || not rows.IsEmpty then
        Some { Date = date; Verses = rows }
    else
        None

/// Stores `quiz` unless its day already has one. Returns whether it was
/// stored: false means another quiz for that day got there first and is
/// kept — a day's quiz never changes once it exists.
let tryAdd (connectionString: string) (createdAt: DateTimeOffset) (quiz: DailyQuiz) : bool =
    use connection = Database.openConnection connectionString
    use transaction = connection.BeginTransaction()

    let execute (sql: string) (parameters: (string * obj) list) =
        use command = connection.CreateCommand()
        command.Transaction <- transaction
        command.CommandText <- sql

        for name, value in parameters do
            command.Parameters.AddWithValue(name, value) |> ignore

        command.ExecuteNonQuery()

    let inserted =
        execute
            "INSERT OR IGNORE INTO daily_quizzes (date, created_at) VALUES ($date, $createdAt)"
            [ "$date", box (dateText quiz.Date); "$createdAt", box (createdAt.UtcDateTime.ToString("o")) ]

    if inserted = 0 then
        transaction.Rollback()
        false
    else
        quiz.Verses
        |> List.iteri (fun position reference ->
            execute
                """
                INSERT INTO daily_quiz_verses (date, position, book, book_number, chapter, verse_number)
                VALUES ($date, $position, $book, $bookNumber, $chapter, $verseNumber)
                """
                [ "$date", box (dateText quiz.Date)
                  "$position", box position
                  "$book", box reference.Book
                  "$bookNumber", box reference.BookNumber
                  "$chapter", box reference.Chapter
                  "$verseNumber", box reference.VerseNumber ]
            |> ignore)

        transaction.Commit()
        true
