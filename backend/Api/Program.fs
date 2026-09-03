open System
open Microsoft.AspNetCore.Builder
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

    // Verse data lives outside the repo (bibles/bibelen-dk/Bibelen Files/
    // and bibles/jw/src/ are both gitignored); loaded once at startup and
    // served from memory. Both translations' verses are pooled into one
    // list — the random-verse endpoint doesn't distinguish between
    // translations.
    let versesDirectory =
        builder.Configuration["Verses:Directory"]
        |> Option.ofObj
        |> Option.defaultValue "../../bibles/bibelen-dk/Bibelen Files"

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
        Func<Verse list, Verse>(fun verses ->
            if verses.IsEmpty then
                failwith "No verses loaded"
            else
                verses[Random.Shared.Next(verses.Length)])
    )
    |> ignore

    app.MapGet(
        "/api/books",
        Func<Verse list, string list>(fun verses ->
            verses |> List.map (fun v -> v.Book) |> List.distinct |> List.sort)
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
