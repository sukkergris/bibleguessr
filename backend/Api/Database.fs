/// The app's one small database: a single SQLite file (see
/// docs/web/daily-quiz). One API process writes to it, so SQLite's
/// single-writer model is all that's needed — no database server.
///
/// It must never hold verse TEXT: only book, chapter and verse NUMBERS
/// (see "Data security" in CLAUDE.md).
module BibleGuessr.Api.Database

open System.IO
open Microsoft.Data.Sqlite

type Settings =
    { /// Path to the database file. Its folder is created if missing.
      FilePath: string }

let connectionString (settings: Settings) : string =
    SqliteConnectionStringBuilder(DataSource = settings.FilePath, Mode = SqliteOpenMode.ReadWriteCreate)
        .ToString()

let openConnection (connectionString: string) : SqliteConnection =
    let connection = new SqliteConnection(connectionString)
    connection.Open()
    connection

/// Schema changes, in order. Each runs once, in its own transaction, and
/// is never edited afterwards — a later change is a new entry. The version
/// reached is kept in SQLite's own PRAGMA user_version, so no migrations
/// table or tool is needed.
let private migrations: (int * string) list =
    [ 1,
      """
      CREATE TABLE daily_quizzes (
          date       TEXT PRIMARY KEY,  -- the UTC day, yyyy-MM-dd
          created_at TEXT NOT NULL      -- ISO 8601, UTC
      );
      CREATE TABLE daily_quiz_verses (
          date         TEXT    NOT NULL REFERENCES daily_quizzes (date),
          position     INTEGER NOT NULL,  -- play order, from 0
          book         TEXT    NOT NULL,  -- the server pool's own spelling, display only
          book_number  INTEGER NOT NULL,
          chapter      INTEGER NOT NULL,
          verse_number INTEGER NOT NULL,
          PRIMARY KEY (date, position)
      );
      """ ]

let latestSchemaVersion = migrations |> List.map fst |> List.max

let private scalar (connection: SqliteConnection) (sql: string) =
    use command = connection.CreateCommand()
    command.CommandText <- sql
    command.ExecuteScalar()

let schemaVersion (connectionString: string) : int =
    use connection = openConnection connectionString
    scalar connection "PRAGMA user_version" |> System.Convert.ToInt32

/// Brings the database up to latestSchemaVersion. Safe to call on every
/// startup: migrations already applied are skipped.
let migrate (connectionString: string) : unit =
    use connection = openConnection connectionString
    // Write-ahead logging: readers don't wait for the writer. Persisted in
    // the file, so setting it once would do; setting it again is harmless.
    // (Creates -wal/-shm files next to the database — keep them together.)
    scalar connection "PRAGMA journal_mode = WAL" |> ignore

    let current = scalar connection "PRAGMA user_version" |> System.Convert.ToInt32

    for version, sql in migrations do
        if version > current then
            use transaction = connection.BeginTransaction()
            use command = connection.CreateCommand()
            command.Transaction <- transaction
            command.CommandText <- $"{sql}\nPRAGMA user_version = {version};"
            command.ExecuteNonQuery() |> ignore
            transaction.Commit()

/// Creates the database file's folder if needed, then migrates.
let initialize (settings: Settings) : unit =
    match Path.GetDirectoryName(Path.GetFullPath settings.FilePath) with
    | null -> ()
    | directory -> Directory.CreateDirectory directory |> ignore

    migrate (connectionString settings)
