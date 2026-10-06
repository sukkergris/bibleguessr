open System
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open Microsoft.Extensions.Logging
open Serilog
open System.Threading.RateLimiting
open BibleGuessr.Domain
open BibleGuessr.Api
open Serilog.Events

/// POST /api/reports's request body — see docs/SCRUM/Feature.ErrorMessageBibleLoader.md.
/// A plain DTO (nullable `string`, not `string option`) since it's bound
/// directly from client JSON — the JsonFSharpConverter's option-unwrapping
/// is for values already inside domain types like BibleFileUploadReport, not for
/// modeling "this JSON field may be null/absent" from an untrusted client.
type ReportRequest =
    { Description: string
      FileName: string
      ErrorMessage: string }

/// POST /api/abuse-reports's request body — see
/// docs/SCRUM/Feature.ReportAbuse.md. Deliberately its own contract rather
/// than a reuse of ReportRequest above: that one describes a failed Bible
/// file upload, and the spec is explicit that abuse reports must not ride
/// on it. Same plain-DTO convention (nullable `string`) for the same
/// reason — these values arrive from an untrusted client, and are
/// validated into a domain AbuseReport before anything else happens.
type AbuseReportRequest =
    { Description: string
      ReportedPlayer: string
      ReplyTo: string }

/// POST /api/bug-reports's request body — see
/// docs/SCRUM/DONE/Feature.BugReport.md. Distinct from both
/// ReportRequest (Bible-file upload failures, which capture the file name
/// and loader error automatically) and AbuseReportRequest (another
/// player's behaviour); the spec is explicit that a technical bug must
/// not be routed through the abuse flow.
type GeneralBugReportRequest =
    { Description: string
      Context: string
      ReplyTo: string }

[<Literal>]
let BackendRevision = 11

[<Literal>]
let StartupLogCategory = "BibleGuessr.Api.Startup"

[<Literal>]
let ReportsLogCategory = "BibleGuessr.Api.Reports"

[<Literal>]
let HealthzPath = "/api/healthz"

[<EntryPoint>]
let main args =
    let builder = WebApplication.CreateBuilder(args)

    // One JSON format for HTTP and the hub alike — see Json.fs.
    builder.Services.ConfigureHttpJsonOptions(fun options ->
        options.SerializerOptions.Converters.Add(Json.converter ()))
    |> ignore

    builder.Services.AddSerilog(fun services configuration ->
    configuration
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
            |> ignore)
        |> ignore

    // No CORS setup here on purpose. The browser only ever reaches this
    // API same-origin: the web server in front (nginx in the server
    // replica, Vite's dev proxy locally) serves the frontend and routes
    // /api/ and /hubs/ to this process under the same scheme, host and
    // port. Same-origin requests aren't subject to CORS at all, so a
    // policy here would grant nothing and only invite drift between the
    // allowed origin and the real one.
    builder.Services
        .AddSignalR(fun options ->
            // Without this, a hub method that fails via `failwith "..."`
            // (e.g. "Room not found", "That name is already taken...")
            // only reaches the client as a generic "An unexpected error
            // occurred invoking '...' on the server." — the actual message
            // is swallowed. These are deliberate, user-facing validation
            // messages (never raw exception/stack-trace detail), so it's
            // safe and necessary to let them through.
            options.EnableDetailedErrors <- true)
        .AddJsonProtocol(fun options -> options.PayloadSerializerOptions.Converters.Add(Json.converter ()))
    |> ignore
    builder.Services.AddSingleton<GameHub.RoomStore>() |> ignore

    // How long a disconnected player stays in the room, and how often
    // PlayerCleanupService checks, before being removed — see GameHub.fs's
    // PresenceSettings/PlayerCleanupService. Configurable (in seconds, not
    // a TimeSpan string, matching this file's existing Smtp:Port
    // convention) so a test environment can dial BOTH down from the real
    // 2-minute grace period / 30-second sweep without touching production
    // code or its defaults.
    let presenceSettings: GameHub.PresenceSettings =
        { DisconnectGracePeriod =
            builder.Configuration["Presence:DisconnectGracePeriodSeconds"]
            |> Option.ofObj
            |> Option.map (int >> float >> TimeSpan.FromSeconds)
            |> Option.defaultValue Room.disconnectGracePeriod
          SweepInterval =
            builder.Configuration["Presence:SweepIntervalSeconds"]
            |> Option.ofObj
            |> Option.map (int >> float >> TimeSpan.FromSeconds)
            |> Option.defaultValue (TimeSpan.FromSeconds 30.0) }

    builder.Services.AddSingleton<GameHub.PresenceSettings>(presenceSettings) |> ignore

    // Periodically removes players who've been disconnected for more than
    // presenceSettings.DisconnectGracePeriod, so a closed tab/dropped
    // connection doesn't leave a stale entry in the room forever — see
    // GameHub.fs's PlayerCleanupService.
    builder.Services.AddHostedService<GameHub.PlayerCleanupService>() |> ignore

    // The public-domain bibelen-dk archive (tracked in git under
    // bibles/bibelen-dk/src/, shipped in the API image) is unpacked into a
    // data folder on startup — a volume in production, the gitignored
    // bibles/.data/ in development — then loaded once and served from
    // memory. See BibleArchiveUnpacker.fs and docs/web/bible-data-volume/.
    let unpackSettings: BibleArchiveUnpacker.UnpackSettings =
        { ArchivePath =
            builder.Configuration["Verses:ArchivePath"]
            |> Option.ofObj
            |> Option.defaultValue "../../bibles/bibelen-dk/src/Bibelen Files.zip"
          DataDirectory =
            builder.Configuration["Verses:DataDirectory"]
            |> Option.ofObj
            |> Option.defaultValue "../../bibles/.data"
          TranslationFolder = BibelenDkLoader.TranslationFolder }

    let unpackOutcome = BibleArchiveUnpacker.ensureUnpacked unpackSettings
    let versesDirectory = BibleArchiveUnpacker.targetDirectory unpackSettings
    let verses = BibelenDkLoader.loadFromHtmlDirectory versesDirectory

    builder.Services.AddSingleton<Verse list>(verses) |> ignore

    // The app's single SQLite database file — see Database.fs and
    // docs/web/daily-quiz. A volume in production (see
    // build/Dockerfile.api), the gitignored .data/ folder in development.
    let databaseSettings: Database.Settings =
        { FilePath =
            builder.Configuration["Database:FilePath"]
            |> Option.ofObj
            |> Option.defaultValue "../../.data/bibleguessr.db" }

    builder.Services.AddSingleton<Database.Settings>(databaseSettings) |> ignore

    let dailyQuizSettings: DailyQuizService.Settings =
        { VerseCount =
            builder.Configuration["DailyQuiz:VerseCount"]
            |> Option.ofObj
            |> Option.map int
            |> Option.defaultValue 5 }

    builder.Services.AddSingleton<DailyQuizService.Settings>(dailyQuizSettings) |> ignore

    // How often a draw from the whole Bible (the daily quiz, and "The
    // Bible" game type) picks one of the famous verses — see
    // docs/web/famous-verses and Domain/FamousVerses.fs. In whole percent.
    let famousVersesSettings: FamousVerses.Settings =
        { ChancePercent =
            builder.Configuration["FamousVerses:ChancePercent"]
            |> Option.ofObj
            |> Option.map int
            |> Option.defaultValue FamousVerses.defaultChancePercent }

    builder.Services.AddSingleton<FamousVerses.Settings>(famousVersesSettings) |> ignore
    builder.Services.AddSingleton<TimeProvider>(TimeProvider.System) |> ignore
    builder.Services.AddHostedService<DailyQuizService.DailyQuizScheduler>() |> ignore

    // How often RoundTimeoutService checks for an expired round — see
    // GameHub.fs's RoundTimeoutSettings/RoundTimeoutService. Same
    // seconds-not-TimeSpan-string convention as PresenceSettings above.
    let roundTimeoutSettings: GameHub.RoundTimeoutSettings =
        { SweepInterval =
            builder.Configuration["RoundTimeout:SweepIntervalSeconds"]
            |> Option.ofObj
            |> Option.map (int >> float >> TimeSpan.FromSeconds)
            |> Option.defaultValue (TimeSpan.FromSeconds 1.0) }

    builder.Services.AddSingleton<GameHub.RoundTimeoutSettings>(roundTimeoutSettings) |> ignore

    // Periodically resolves any multiplayer round whose time limit has
    // elapsed, even if a player never guessed — see GameHub.fs's
    // RoundTimeoutService.
    builder.Services.AddHostedService<GameHub.RoundTimeoutService>() |> ignore

    // SMTP settings for the bug-report endpoint — see MailSender.fs and
    // docs/SCRUM/Feature.ErrorMessageBibleLoader.md. Local dev points these
    // at Mailpit (see .devcontainer/debian/docker-compose.yml's `mailpit`
    // service — a local SMTP catcher with a web UI at localhost:8073, so
    // reports can be tested end-to-end without a real mail provider) via
    // appsettings.Development.json (gitignored, same convention as any
    // other local/secret config in this project). A real deployment would
    // supply its own values the same way.
    let smtpSettings: MailSender.SmtpSettings =
        { Host = builder.Configuration["Smtp:Host"] |> Option.ofObj |> Option.defaultValue "localhost"
          Port = builder.Configuration["Smtp:Port"] |> Option.ofObj |> Option.map int |> Option.defaultValue 1025
          EnableSsl =
            builder.Configuration["Smtp:EnableSsl"]
            |> Option.ofObj
            |> Option.map bool.Parse
            |> Option.defaultValue false
          Username = builder.Configuration["Smtp:Username"] |> Option.ofObj |> Option.defaultValue ""
          Password = builder.Configuration["Smtp:Password"] |> Option.ofObj |> Option.defaultValue ""
          From =
            builder.Configuration["Smtp:From"]
            |> Option.ofObj
            |> Option.defaultValue "bibleguessr@example.test"
          To =
            builder.Configuration["Smtp:To"] |> Option.ofObj |> Option.defaultValue "bibleguessr@example.test" }

    builder.Services.AddSingleton<MailSender.SmtpSettings>(smtpSettings) |> ignore

    // Rate limiting for the bug-report endpoint (the only rate-limited
    // endpoint in the app today) — see
    // docs/SCRUM/Feature.ErrorMessageBibleLoader.md. Two fixed-window
    // limiters, both consulted for every request to this endpoint (see the
    // endpoint's rate-limit check below, called directly rather than via
    // ASP.NET's declarative .RequireRateLimiting — that attribute/method
    // only supports ONE named policy per endpoint, and a policy's
    // partitioner can only express one partition key, not "per-IP AND
    // globally" as two independent caps at once). "report-per-ip" caps one
    // caller's own submissions; "report-global" caps the total across
    // every caller, so the mail relay/inbox can't be exhausted even by
    // many distinct IPs.
    // Configurable rather than hardcoded, following the same convention as
    // the presence and round-timeout settings. All three report endpoints
    // share these limiters — they protect one mail relay, so a caller must
    // not be able to dodge their budget by rotating between endpoints —
    // which also means an end-to-end suite exercising every report flow
    // can exhaust a production-sized daily budget in one run. Raising them
    // in the development settings keeps the tests honest without weakening
    // the deployed limits.
    let perIpReportLimit =
        builder.Configuration["Reports:PerIpDailyLimit"]
        |> Option.ofObj
        |> Option.map int
        |> Option.defaultValue 5

    let globalReportLimit =
        builder.Configuration["Reports:GlobalDailyLimit"]
        |> Option.ofObj
        |> Option.map int
        |> Option.defaultValue 100

    let perIpLimiter =
        PartitionedRateLimiter.Create<HttpContext, string>(fun context ->
            let ip = context.Connection.RemoteIpAddress |> Option.ofObj |> Option.map string |> Option.defaultValue "unknown"

            RateLimitPartition.GetFixedWindowLimiter(
                ip,
                fun _ ->
                    FixedWindowRateLimiterOptions(
                        PermitLimit = perIpReportLimit,
                        Window = TimeSpan.FromDays 1.0,
                        QueueLimit = 0
                    )
            ))

    let globalLimiter =
        new FixedWindowRateLimiter(
            FixedWindowRateLimiterOptions(PermitLimit = globalReportLimit, Window = TimeSpan.FromDays 1.0, QueueLimit = 0)
        )

    builder.Services.AddSingleton<PartitionedRateLimiter<HttpContext>>(perIpLimiter) |> ignore
    builder.Services.AddSingleton<FixedWindowRateLimiter>(globalLimiter) |> ignore

    let app = builder.Build()

    app.UseSerilogRequestLogging(fun options ->
        options.GetLevel <- Func<HttpContext, float, exn, LogEventLevel>(RequestLogging.levelFor HealthzPath))
    |> ignore

    let loggerFactory = app.Services.GetRequiredService<ILoggerFactory>()
    let startupLogger = loggerFactory.CreateLogger StartupLogCategory
    let reportsLogger = loggerFactory.CreateLogger ReportsLogCategory

    match unpackOutcome with
    | BibleArchiveUnpacker.AlreadyUpToDate ->
        startupLogger.LogInformation(
            "Bible archive already unpacked in {Directory}; skipping unpack",
            versesDirectory
        )
    | BibleArchiveUnpacker.Unpacked reason ->
        startupLogger.LogInformation(
            "Unpacked Bible archive {Archive} into {Directory} (reason: {Reason})",
            unpackSettings.ArchivePath,
            versesDirectory,
            BibleArchiveUnpacker.describeReason reason
        )
    | BibleArchiveUnpacker.NoArchive ->
        startupLogger.LogWarning(
            "No Bible archive at {Archive}; using whatever is already in {Directory}",
            unpackSettings.ArchivePath,
            versesDirectory
        )
    | BibleArchiveUnpacker.Failed message ->
        startupLogger.LogError(
            "Could not unpack Bible archive {Archive} into {Directory}: {Error}",
            unpackSettings.ArchivePath,
            versesDirectory,
            message
        )

    startupLogger.LogInformation("Verses loaded: {Count}", verses.Length)

    let verseHealth = VerseHealth.evaluate verses.Length

    if verseHealth = VerseHealth.NoVerses then
        startupLogger.LogError(
            "No verses loaded from {Directory}; the game is unplayable and /api/healthz will report unhealthy",
            versesDirectory
        )

    startupLogger.LogInformation("SMTP host for bug reports: {Host}:{Port}", smtpSettings.Host, smtpSettings.Port)

    // Before anything can read or write it — including DailyQuizScheduler,
    // which starts with the app below.
    Database.initialize databaseSettings
    startupLogger.LogInformation("Database ready at {Path}", IO.Path.GetFullPath databaseSettings.FilePath)


    // /healthz is the conventional name for a liveness endpoint, and the
    // connection panel names it directly rather than calling it "backend"
    // — see docs/SCRUM/DONE/Feature.ConnectionPanelRefinements.md. It is
    // the only health endpoint; the old /api/health alias was removed.
    //
    // No verses answers 503, not "ok": an API serving an empty game must
    // not look healthy (the connection panel shows any non-2xx as an error).
    let healthResponse =
        Func<IResult>(fun () ->
            match verseHealth with
            | VerseHealth.Healthy count -> Results.Json({| status = "ok"; versesLoaded = count |})
            | VerseHealth.NoVerses ->
                Results.Json(
                    {| status = "unhealthy"; versesLoaded = 0 |},
                    statusCode = StatusCodes.Status503ServiceUnavailable
                ))

    app.MapGet(HealthzPath, healthResponse) |> ignore

    // Today's quiz (UTC) — references only, never verse text: each player
    // looks the text up in their own source, as in a multiplayer round. See
    // docs/web/daily-quiz. Made here if the midnight job hasn't made it
    // (DailyQuizService.getOrCreate); 503 only when there are no verses.
    app.MapGet(
        "/api/daily-quiz",
        Func<Database.Settings, DailyQuizService.Settings, FamousVerses.Settings, Verse list, TimeProvider, IResult>
            (fun database settings famous verses timeProvider ->
                match DailyQuizService.today (Database.connectionString database) settings famous verses timeProvider with
                | Some quiz ->
                    Results.Json(
                        {| date = quiz.Date.ToString("yyyy-MM-dd", Globalization.CultureInfo.InvariantCulture)
                           verses = quiz.Verses |}
                    )
                | None ->
                    Results.Problem(
                        statusCode = StatusCodes.Status503ServiceUnavailable,
                        detail = "No verses are loaded, so there is no daily quiz."
                    ))
    )
    |> ignore

    app.MapGet(
        "/api/revision",
        Func<_>(fun () -> {| revision = BackendRevision |})
    )
    |> ignore

    // Which image this is: commit, build context and image tag — see
    // docs/web/build-info. Read once; the environment doesn't change while
    // the process runs.
    let buildInfo = BuildInfo.fromEnvironment ()

    app.MapGet("/api/build-info", Func<_>(fun () -> buildInfo)) |> ignore

    // The famous verses, in Bible order, for the nerd panel — see
    // docs/web/famous-verses. References only, never text.
    app.MapGet(
        "/api/famous-verses",
        Func<Verse list, VerseReference list>(fun verses -> FamousVerses.referencesIn verses)
    )
    |> ignore

    app.MapGet(
        "/api/verses/random",
        Func<Verse list, FamousVerses.Settings, HttpRequest, Verse>(fun verses famous request ->
            let translation = request.Query["translation"]

            let byTranslation =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            // Optional restriction to a subset of books/chapters — see
            // docs/SCRUM/Feature.BibleSelector.md. Repeated `book` query
            // params narrow to those books (level 2, "choose books");
            // repeated `bookChapter` params, each formatted "Book:Chapter",
            // narrow further to specific chapters within a book (level 3).
            // No `book` params at all means "default ALL" — the existing,
            // unrestricted behavior.
            let books = request.Query["book"] |> Seq.filter (fun b -> not (String.IsNullOrEmpty b)) |> Set.ofSeq

            let chaptersByBook =
                request.Query["bookChapter"]
                |> Seq.choose (fun entry ->
                    match entry.Split(':', 2) with
                    | [| book; chapterStr |] ->
                        match Int32.TryParse(chapterStr) with
                        | true, chapter -> Some(book, chapter)
                        | false, _ -> None
                    | _ -> None)
                |> Seq.groupBy fst
                |> Seq.map (fun (book, entries) -> book, entries |> Seq.map snd |> Set.ofSeq)
                |> Map.ofSeq

            let candidates = byTranslation |> List.filter (Verse.matchesRestriction books chaptersByBook)

            if candidates.IsEmpty then
                failwith "No verses match the requested translation/book/chapter selection"
            elif books.IsEmpty then
                // The whole Bible ("The Bible" game type) favors the famous
                // verses — see docs/web/famous-verses.
                FamousVerses.pickOne Random.Shared.Next famous.ChancePercent (Verse.bookNumbers byTranslation) candidates
            else
                candidates[Random.Shared.Next(candidates.Length)])
    )
    |> ignore

    // Resolves an exact verse reference to its full text for one
    // translation — needed because a multiplayer round's server state is
    // a bare VerseReference (see backend/Domain/Verses.fs's doc comment:
    // the server never sends verse text over the wire, since two players
    // in the same game may each be reading a different translation).
    // Each client calls this against its OWN chosen translation to render
    // the round's verse locally — see frontend/src/api.ts's lookupVerse.
    //
    // Prefers `bookNumber` (this translation's OWN Bible-order position —
    // see Verse.bookNumberOf/bookAtNumber) over `book` (a name) whenever
    // it's given: a VerseReference's Book field is just the spelling from
    // whichever pool picked the round's verse (typically a DIFFERENT
    // translation than this endpoint is now being asked to search), so
    // matching by name here would reintroduce the exact cross-translation
    // spelling-mismatch bug BookNumber exists to fix (see
    // VerseReference's doc comment). `book` stays supported as a fallback
    // for callers with no number at all (e.g. local-verses.ts's own
    // lookupVerse resolves by number first and falls back to name the
    // same way — see local-verses.ts).
    app.MapGet(
        "/api/verses/lookup",
        Func<Verse list, HttpRequest, Verse>(fun verses request ->
            let translation = request.Query["translation"]
            let book = request.Query["book"].ToString()

            let bookNumber =
                match Int32.TryParse(request.Query["bookNumber"].ToString()) with
                | true, n -> Some n
                | false, _ -> None

            let chapter =
                match Int32.TryParse(request.Query["chapter"].ToString()) with
                | true, c -> c
                | false, _ -> failwith "chapter must be a number"

            let verseNumber =
                match Int32.TryParse(request.Query["verseNumber"].ToString()) with
                | true, v -> v
                | false, _ -> failwith "verseNumber must be a number"

            let byTranslation =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            let matchesBook =
                match bookNumber with
                | Some number ->
                    let resolvedBook = Verse.bookAtNumber byTranslation number
                    fun (v: Verse) -> Some v.Book = resolvedBook
                | None -> fun (v: Verse) -> String.Equals(v.Book, book, StringComparison.OrdinalIgnoreCase)

            match byTranslation |> List.tryFind (fun v -> matchesBook v && v.Chapter = chapter && v.VerseNumber = verseNumber) with
            | Some verse -> verse
            | None -> failwith "That verse doesn't exist in the requested translation")
    )
    |> ignore

    app.MapGet(
        "/api/translations",
        Func<Verse list, string list>(fun verses ->
            verses |> List.map (fun v -> v.Translation) |> List.distinct |> List.sort)
    )
    |> ignore

    app.MapGet(
        "/api/books",
        Func<Verse list, HttpRequest, string list>(fun verses request ->
            // Different translations spell some book names differently (e.g.
            // bibelen-dk's "1.Mosebog" vs. the NWT sources' "1. Mosebog"), so
            // the book list a guess is checked against must come from the
            // same translation as the verse being guessed — not the whole
            // pooled set, which would offer spellings that can never match.
            let translation = request.Query["translation"]

            let relevantVerses =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            relevantVerses |> List.map (fun v -> v.Book) |> List.distinct |> List.sort)
    )
    |> ignore

    app.MapGet(
        "/api/books-in-bible-order",
        Func<Verse list, HttpRequest, string list>(fun verses request ->
            // Same book set as /api/books, but in the order they appear in
            // the Bible (Genesis..Revelation) rather than alphabetically —
            // see docs/SCRUM/Feature.BooksGameSorting.md. Every loader
            // appends verses strictly in reading order, so first-occurrence
            // order in the (unsorted) verse list already IS Bible order for
            // a complete translation; List.distinct preserves that order
            // (it keeps each element's first occurrence), it just must not
            // be followed by List.sort the way /api/books is.
            let translation = request.Query["translation"]

            let relevantVerses =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            relevantVerses |> List.map (fun v -> v.Book) |> List.distinct)
    )
    |> ignore

    app.MapGet(
        "/api/chapters",
        Func<Verse list, HttpRequest, int list>(fun verses request ->
            // Chapter suggestions are scoped to one book (within a
            // translation, for the same book-spelling reasons as /api/books)
            // so the guess form only offers chapter numbers that actually
            // exist for the book the player has already picked.
            let translation = request.Query["translation"]
            let book = request.Query["book"]

            let relevantVerses =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            if book.Count = 0 then
                []
            else
                let b = book.ToString()

                relevantVerses
                |> List.filter (fun v -> v.Book = b)
                |> List.map (fun v -> v.Chapter)
                |> List.distinct
                |> List.sort)
    )
    |> ignore

    app.MapGet(
        "/api/verse-numbers",
        Func<Verse list, HttpRequest, int list>(fun verses request ->
            // Verse-number suggestions are scoped to one book+chapter (within
            // a translation, for the same book-spelling reasons as
            // /api/books) so the guess form only offers verse numbers that
            // actually exist for the book/chapter the player has already
            // picked.
            let translation = request.Query["translation"]
            let book = request.Query["book"]
            let chapter = request.Query["chapter"]

            let relevantVerses =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            if book.Count = 0 || chapter.Count = 0 then
                []
            else
                let b = book.ToString()

                match Int32.TryParse(chapter.ToString()) with
                | false, _ -> []
                | true, c ->
                    relevantVerses
                    |> List.filter (fun v -> v.Book = b && v.Chapter = c)
                    |> List.map (fun v -> v.VerseNumber)
                    |> List.distinct
                    |> List.sort)
    )
    |> ignore

    app.MapPost(
        "/api/rooms",
        Func<GameHub.RoomStore, Room>(fun rooms -> rooms.CreateRoom())
    )
    |> ignore

    // Bug reports from a failed Bible-file upload — see
    // docs/SCRUM/Feature.ErrorMessageBibleLoader.md and game-setup.ts's
    // "Report this issue" flow. `request` is bound from the POST body as
    // JSON (the JsonFSharpConverter registered above via
    // ConfigureHttpJsonOptions handles the F# record); this is the first
    // endpoint in the app that reads a request body, everything before it
    // was GET-with-query-params or a body-less POST.
    app.MapPost(
        "/api/reports",
        Func<HttpContext, PartitionedRateLimiter<HttpContext>, FixedWindowRateLimiter, MailSender.SmtpSettings, ReportRequest, IResult>
            (fun httpContext perIpLimiter globalLimiter smtp request ->
                // Both limits must permit the request — see the limiters'
                // construction above for why this is a manual check rather
                // than declarative .RequireRateLimiting.
                use ipLease = perIpLimiter.AttemptAcquire(httpContext)

                if not ipLease.IsAcquired then
                    Results.Problem(statusCode = 429, detail = "Too many reports from this address today. Please try again tomorrow.")
                else
                    use globalLease = globalLimiter.AttemptAcquire(1)

                    if not globalLease.IsAcquired then
                        Results.Problem(
                            statusCode = 429,
                            detail = "Too many reports have been submitted today. Please try again tomorrow."
                        )
                    else
                        let report: BibleFileUploadReport =
                            { Description = request.Description
                              FileName = request.FileName |> Option.ofObj
                              ErrorMessage = request.ErrorMessage
                              SubmittedAt = DateTimeOffset.UtcNow }

                        if MailSender.sendBibleFileUploadReport smtp reportsLogger report then
                            Results.Ok({| status = "sent" |})
                        else
                            // The mail relay failed, but this is never the
                            // caller's fault (bad input would be a 400) —
                            // 502 signals "we couldn't reach the thing we
                            // depend on", closest standard status for an
                            // upstream SMTP failure.
                            Results.Problem(statusCode = 502, detail = "Failed to send the report. Please try again later."))
    )
    |> ignore

    // Abuse reports — see docs/SCRUM/Feature.ReportAbuse.md. Deliberately
    // a separate endpoint from /api/reports (which is for Bible-file
    // upload failures), but sharing that endpoint's rate limiters: both
    // caps exist to protect the same single mail relay, so one caller
    // can't dodge their per-IP budget by alternating between the two
    // endpoints, and the global cap covers the relay as a whole.
    app.MapPost(
        "/api/abuse-reports",
        Func<HttpContext, PartitionedRateLimiter<HttpContext>, FixedWindowRateLimiter, MailSender.SmtpSettings, AbuseReportRequest, IResult>
            (fun httpContext perIpLimiter globalLimiter smtp request ->
                use ipLease = perIpLimiter.AttemptAcquire(httpContext)

                if not ipLease.IsAcquired then
                    Results.Problem(statusCode = 429, detail = "Too many reports from this address today. Please try again tomorrow.")
                else
                    use globalLease = globalLimiter.AttemptAcquire(1)

                    if not globalLease.IsAcquired then
                        Results.Problem(
                            statusCode = 429,
                            detail = "Too many reports have been submitted today. Please try again tomorrow."
                        )
                    else
                        // Validation happens before any mail is attempted,
                        // so a malformed or oversized request costs the
                        // relay nothing.
                        let validated =
                            AbuseReport.validate
                                request.Description
                                (request.ReportedPlayer |> Option.ofObj)
                                (request.ReplyTo |> Option.ofObj)
                                DateTimeOffset.UtcNow

                        match validated with
                        | Error DescriptionMissing ->
                            Results.Problem(statusCode = 400, detail = "Please describe what happened.")
                        | Error(FieldTooLong(field, maxLength)) ->
                            Results.Problem(
                                statusCode = 400,
                                detail = $"That %s{field} is too long — please keep it under %d{maxLength} characters."
                            )
                        | Ok report ->
                            if MailSender.sendAbuseReport smtp reportsLogger report then
                                Results.Ok({| status = "sent" |})
                            else
                                // Same reasoning as /api/reports: an SMTP
                                // failure is an upstream problem, not the
                                // reporter's fault. The detail deliberately
                                // says nothing about the relay, recipient or
                                // the underlying exception.
                                Results.Problem(statusCode = 502, detail = "Failed to send the report. Please try again later."))
    )
    |> ignore

    // General bug reports — see docs/SCRUM/DONE/Feature.BugReport.md.
    // Shares the report rate limiters with the other two endpoints: all
    // three protect the same single mail relay, so a caller must not be
    // able to dodge their budget by rotating between them.
    app.MapPost(
        "/api/bug-reports",
        Func<HttpContext, PartitionedRateLimiter<HttpContext>, FixedWindowRateLimiter, MailSender.SmtpSettings, GeneralBugReportRequest, IResult>
            (fun httpContext perIpLimiter globalLimiter smtp request ->
                use ipLease = perIpLimiter.AttemptAcquire(httpContext)

                if not ipLease.IsAcquired then
                    Results.Problem(statusCode = 429, detail = "Too many reports from this address today. Please try again tomorrow.")
                else
                    use globalLease = globalLimiter.AttemptAcquire(1)

                    if not globalLease.IsAcquired then
                        Results.Problem(
                            statusCode = 429,
                            detail = "Too many reports have been submitted today. Please try again tomorrow."
                        )
                    else
                        let validated =
                            GeneralBugReport.validate
                                request.Description
                                (request.Context |> Option.ofObj)
                                (request.ReplyTo |> Option.ofObj)
                                DateTimeOffset.UtcNow

                        match validated with
                        | Error DescriptionMissing ->
                            Results.Problem(statusCode = 400, detail = "Please describe what happened.")
                        | Error(FieldTooLong(field, maxLength)) ->
                            Results.Problem(
                                statusCode = 400,
                                detail = $"That %s{field} is too long — please keep it under %d{maxLength} characters."
                            )
                        | Ok report ->
                            if MailSender.sendGeneralBugReport smtp reportsLogger report then
                                Results.Ok({| status = "sent" |})
                            else
                                // Deliberately says nothing about the relay,
                                // recipient, or the underlying exception.
                                Results.Problem(statusCode = 502, detail = "Failed to send the report. Please try again later."))
    )
    |> ignore

    app.MapHub<GameHub.GameHub>("/hubs/game") |> ignore

    app.Run()

    0 // Exit code
