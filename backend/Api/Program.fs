open System
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open Microsoft.Extensions.Logging
open System.Threading.RateLimiting
open BibleGuessr.Domain
open BibleGuessr.Api
open System.Text.Json.Serialization

/// POST /api/reports's request body — see docs/SCRUM/Feature.ErrorMessageBibleLoader.md.
/// A plain DTO (nullable `string`, not `string option`) since it's bound
/// directly from client JSON — the JsonFSharpConverter's option-unwrapping
/// is for values already inside domain types like BugReport, not for
/// modeling "this JSON field may be null/absent" from an untrusted client.
type ReportRequest =
    { Description: string
      FileName: string
      ErrorMessage: string }

[<EntryPoint>]
let main args =
    let builder = WebApplication.CreateBuilder(args)

    // MapFormat.Object (rather than the library's default, an array of
    // [key, value] pairs) makes every F# Map serialize as a plain JSON
    // object — {"1":[1,2]}, not [[1,[1,2]]] — matching what the frontend
    // has always assumed for every Map-backed field that crosses this
    // boundary (GameSession.Scores/GuessesThisRound, GameType.Chapters —
    // see types.ts's Record<string,...>/Record<number,...> mirrors).
    // Using the array-of-pairs default silently broke all of these: a
    // multiplayer round's displayed score was always 0 (Map.scores[id]
    // read against an array returns undefined, masked by a "?? 0"
    // fallback) and sending a Chapters-scoped challenge threw a server
    // error outright, since the client sent an object where the default
    // format expected pairs.
    let jsonOptions = JsonFSharpOptions.Default().WithMapFormat(MapFormat.Object)

    builder.Services.ConfigureHttpJsonOptions(fun options ->
        options.SerializerOptions.Converters.Add(JsonFSharpConverter(jsonOptions)))
    |> ignore

    builder.Services.AddHttpLogging(fun options ->
        options.LoggingFields <-
            Microsoft.AspNetCore.HttpLogging.HttpLoggingFields.RequestMethod
            ||| Microsoft.AspNetCore.HttpLogging.HttpLoggingFields.RequestPath
            ||| Microsoft.AspNetCore.HttpLogging.HttpLoggingFields.RequestQuery
            ||| Microsoft.AspNetCore.HttpLogging.HttpLoggingFields.ResponseStatusCode
            ||| Microsoft.AspNetCore.HttpLogging.HttpLoggingFields.Duration)
    |> ignore

    let frontendOrigin =
        builder.Configuration["Frontend:Origin"] |> Option.ofObj |> Option.defaultValue "http://localhost:5173"

    builder.Services.AddCors(fun options ->
        options.AddDefaultPolicy(fun policy ->
            policy.WithOrigins(frontendOrigin).AllowAnyHeader().AllowAnyMethod().AllowCredentials()
            |> ignore))
    |> ignore

    builder.Services
        .AddSignalR()
        .AddJsonProtocol(fun options -> options.PayloadSerializerOptions.Converters.Add(JsonFSharpConverter(jsonOptions)))
    |> ignore
    builder.Services.AddSingleton<GameHub.RoomStore>() |> ignore

    // Periodically removes players who've been disconnected for more than
    // Room.disconnectGracePeriod, so a closed tab/dropped connection
    // doesn't leave a stale entry in the room forever — see
    // GameHub.fs's PlayerCleanupService.
    builder.Services.AddHostedService<GameHub.PlayerCleanupService>() |> ignore

    // Verse data lives outside the repo, under bibles/bibelen-dk/src/
    // (tracked in git — public domain, no redistribution concern); loaded
    // once at startup and served from memory.
    let versesDirectory =
        builder.Configuration["Verses:Directory"]
        |> Option.ofObj
        |> Option.defaultValue "../../bibles/bibelen-dk/src"

    let verses = BibelenDkLoader.loadFromDirectory versesDirectory

    builder.Services.AddSingleton<Verse list>(verses) |> ignore

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
    let perIpLimiter =
        PartitionedRateLimiter.Create<HttpContext, string>(fun context ->
            let ip = context.Connection.RemoteIpAddress |> Option.ofObj |> Option.map string |> Option.defaultValue "unknown"

            RateLimitPartition.GetFixedWindowLimiter(
                ip,
                fun _ -> FixedWindowRateLimiterOptions(PermitLimit = 5, Window = TimeSpan.FromDays 1.0, QueueLimit = 0)
            ))

    let globalLimiter =
        new FixedWindowRateLimiter(
            FixedWindowRateLimiterOptions(PermitLimit = 100, Window = TimeSpan.FromDays 1.0, QueueLimit = 0)
        )

    builder.Services.AddSingleton<PartitionedRateLimiter<HttpContext>>(perIpLimiter) |> ignore
    builder.Services.AddSingleton<FixedWindowRateLimiter>(globalLimiter) |> ignore

    let app = builder.Build()

    let startupLogger = app.Services.GetRequiredService<ILogger<obj>>()
    startupLogger.LogInformation("Verses loaded: {Count}", verses.Length)
    startupLogger.LogInformation("CORS allowed origin: {Origin}", frontendOrigin)
    startupLogger.LogInformation("SMTP host for bug reports: {Host}:{Port}", smtpSettings.Host, smtpSettings.Port)

    app.UseHttpLogging() |> ignore
    app.UseCors() |> ignore

    app.MapGet(
        "/api/health",
        Func<_>(fun () -> {| status = "ok"; versesLoaded = verses.Length |})
    )
    |> ignore

    app.MapGet(
        "/api/verses/random",
        Func<Verse list, HttpRequest, Verse>(fun verses request ->
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
        Func<HttpContext, PartitionedRateLimiter<HttpContext>, FixedWindowRateLimiter, MailSender.SmtpSettings, ILogger<obj>, ReportRequest, IResult>
            (fun httpContext perIpLimiter globalLimiter smtp logger request ->
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
                        let report: BugReport =
                            { Description = request.Description
                              FileName = request.FileName |> Option.ofObj
                              ErrorMessage = request.ErrorMessage
                              SubmittedAt = DateTimeOffset.UtcNow }

                        if MailSender.sendBugReport smtp logger report then
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

    app.MapHub<GameHub.GameHub>("/hubs/game") |> ignore

    app.Run()

    0 // Exit code
