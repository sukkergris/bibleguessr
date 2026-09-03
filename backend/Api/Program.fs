open System
open Microsoft.AspNetCore.Builder
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open BibleGuessr.Domain
open BibleGuessr.Api
open System.Text.Json.Serialization

[<EntryPoint>]
let main args =
    let builder = WebApplication.CreateBuilder(args)

    builder.Services.ConfigureHttpJsonOptions(fun options ->
        options.SerializerOptions.Converters.Add(JsonFSharpConverter()))
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

    // Verse data lives outside the repo (bibelen-dk/Bibelen Files/ is
    // gitignored); loaded once at startup and served from memory.
    let versesDirectory =
        builder.Configuration["Verses:Directory"]
        |> Option.ofObj
        |> Option.defaultValue "../../bibelen-dk/Bibelen Files"

    let verses = BibelenDkLoader.loadFromDirectory versesDirectory
    builder.Services.AddSingleton<Verse list>(verses) |> ignore

    let app = builder.Build()

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

    app.MapPost(
        "/api/rooms",
        Func<GameHub.RoomStore, Room>(fun rooms -> rooms.CreateRoom())
    )
    |> ignore

    app.MapHub<GameHub.GameHub>("/hubs/game") |> ignore

    app.Run()

    0 // Exit code
