/// How the API turns F# values into JSON and back — shared by the HTTP
/// endpoints and the SignalR hub (see Program.fs), and by tests that must
/// read a value exactly as the server would (see
/// Tests/GameTypeScoringTests.fs).
module BibleGuessr.Api.Json

open System.Text.Json.Serialization

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
let fsharpOptions = JsonFSharpOptions.Default().WithMapFormat(MapFormat.Object)

/// The converter every serializer in the API registers.
let converter () = JsonFSharpConverter(fsharpOptions)
