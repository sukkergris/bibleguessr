open System
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open Microsoft.Extensions.Logging
open BibleGuessr.Domain
open BibleGuessr.Api
open System.Text.Json.Serialization

[<EntryPoint>]
let main args =
    let builder = WebApplication.CreateBuilder(args)

    builder.Services.ConfigureHttpJsonOptions(fun options ->
        options.SerializerOptions.Converters.Add(JsonFSharpConverter()))
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
        .AddJsonProtocol(fun options -> options.PayloadSerializerOptions.Converters.Add(JsonFSharpConverter()))
    |> ignore
    builder.Services.AddSingleton<GameHub.RoomStore>() |> ignore

    // Verse data lives outside the repo (bibles/bibelen-dk/src/ and
    // bibles/jw/src/ are both gitignored); loaded once at startup and
    // served from memory. Both translations' verses are pooled into one
    // list — the random-verse endpoint doesn't distinguish between
    // translations.
    let versesDirectory =
        builder.Configuration["Verses:Directory"]
        |> Option.ofObj
        |> Option.defaultValue "../../bibles/bibelen-dk/src"

    let jwDirectory =
        builder.Configuration["Verses:JwDirectory"]
        |> Option.ofObj
        |> Option.defaultValue "../../bibles/jw/src"

    // JwEpubLoader and JwRtfLoader both load the same NWT translation from
    // different export formats, and name books differently under the
    // hood — running both at once would pool two conflicting spellings of
    // the same book for the same translation. Pick exactly one via config
    // ("epub", the default, or "rtf"); never load both.
    let jwSource =
        builder.Configuration["Verses:JwSource"]
        |> Option.ofObj
        |> Option.defaultValue "epub"

    let jwVerses =
        match jwSource.ToLowerInvariant() with
        | "rtf" -> JwRtfLoader.loadFromDirectory jwDirectory
        | "epub" -> JwEpubLoader.loadFromDirectory jwDirectory
        | other -> failwith $"Unknown Verses:JwSource '{other}' — expected \"epub\" or \"rtf\""

    let verses = BibelenDkLoader.loadFromDirectory versesDirectory @ jwVerses

    builder.Services.AddSingleton<Verse list>(verses) |> ignore

    let app = builder.Build()

    let startupLogger = app.Services.GetRequiredService<ILogger<obj>>()
    startupLogger.LogInformation("Verses loaded: {Count}", verses.Length)
    startupLogger.LogInformation("CORS allowed origin: {Origin}", frontendOrigin)

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

            let candidates =
                if translation.Count = 0 then
                    verses
                else
                    let t = translation.ToString()
                    verses |> List.filter (fun v -> v.Translation = t)

            if candidates.IsEmpty then
                failwith "No verses loaded for the requested translation"
            else
                candidates[Random.Shared.Next(candidates.Length)])
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

    app.MapHub<GameHub.GameHub>("/hubs/game") |> ignore

    app.Run()

    0 // Exit code
