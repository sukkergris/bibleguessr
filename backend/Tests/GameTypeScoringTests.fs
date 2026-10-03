module BibleGuessr.Tests.GameTypeScoringTests

// Each game type owns its multiplayer scoring rule (see
// Domain/GameTypes/<Name>.fs's scoreGuess and docs/web/scoring), and
// multiplayer scores a guess exactly like singleplayer does. Both are
// spelled out once, per game type, in scoring-scenarios/<game type>.json
// at the repo root: these tests check the multiplayer points through
// GameType.scoreGuess, the server's composition point, and
// frontend/src/game-types/scoring-scenarios.test.ts checks the
// singleplayer points against the same files. Changing one game type's
// rule means changing its own module and its own scenario file only.

open System
open System.IO
open System.Text.Json
open Microsoft.FSharp.Reflection
open Xunit
open BibleGuessr.Domain

/// Reads a wire value the way the hub does (see Api/Json.fs).
let private wireOptions =
    let options = JsonSerializerOptions(JsonSerializerDefaults.Web)
    options.Converters.Add(BibleGuessr.Api.Json.converter ())
    options

let private scenarioFiles () =
    Directory.GetFiles(TestPaths.scoringScenariosDirectory, "*.json") |> Array.sort

let private optionalInt (element: JsonElement) (name: string) =
    match element.TryGetProperty name with
    | true, value -> Some(value.GetInt32())
    | _ -> None

/// The wire value of every selection in every scenario file, keyed by
/// file and selection name.
let private wires () =
    [ for path in scenarioFiles () do
          use document = JsonDocument.Parse(File.ReadAllText path)

          for selection in document.RootElement.GetProperty("selections").EnumerateObject() do
              let wire =
                  JsonSerializer.Deserialize<GameType>(selection.Value.GetProperty("wire").GetRawText(), wireOptions)

              (Path.GetFileName path, selection.Name), wire ]
    |> Map.ofList

/// One row per scenario case: a readable name, then everything needed to
/// score it. The guess carries the book number the guessing player's own
/// Bible gives the book (its position in the file's booksInBibleOrder),
/// as a real client sets it.
let scenarioCases () : obj array seq =
    let wires = wires ()

    seq {
        for path in scenarioFiles () do
            use document = JsonDocument.Parse(File.ReadAllText path)
            let root = document.RootElement
            let file = Path.GetFileName path

            let booksInBibleOrder =
                root.GetProperty("booksInBibleOrder").EnumerateArray()
                |> Seq.map (fun book -> book.GetString())
                |> List.ofSeq

            let verseJson = root.GetProperty "verse"

            let verse: VerseReference =
                { Book = verseJson.GetProperty("book").GetString()
                  BookNumber = verseJson.GetProperty("bookNumber").GetInt32()
                  Chapter = verseJson.GetProperty("chapter").GetInt32()
                  VerseNumber = verseJson.GetProperty("verseNumber").GetInt32() }

            for case in root.GetProperty("cases").EnumerateArray() do
                let selection = case.GetProperty("selection").GetString()
                let guessJson = case.GetProperty "guess"
                let book = guessJson.GetProperty("book").GetString()

                let guess: Guess =
                    { PlayerId = PlayerId(Guid.NewGuid())
                      Book = book
                      BookNumber =
                        booksInBibleOrder
                        |> List.tryFindIndex (fun candidate -> candidate = book)
                        |> Option.map ((+) 1)
                      Chapter = optionalInt guessJson "chapter"
                      VerseNumber = optionalInt guessJson "verseNumber"
                      SubmittedAt = DateTimeOffset.UtcNow }

                let expected = case.GetProperty("points").GetProperty("multiplayer").GetInt32()
                let name = $"""{file} / {selection}: {case.GetProperty("why").GetString()} ({guessJson.GetRawText()})"""
                yield [| box name; box wires[(file, selection)]; box verse; box guess; box expected |]
    }

[<Theory>]
[<MemberData(nameof scenarioCases)>]
let ``a multiplayer guess scores what its game type's scenario file says``
    (_case: string)
    (gameType: GameType)
    (verse: VerseReference)
    (guess: Guess)
    (expected: int)
    =
    Assert.Equal(expected, GameType.scoreGuess gameType verse guess)

[<Fact>]
let ``every game type has scenarios, and every scenario is a known game type`` () =
    let caseNames = FSharpType.GetUnionCases(typeof<GameType>) |> Array.map _.Name |> Set.ofArray

    let scenarioCaseNames =
        wires () |> Map.values |> Seq.map (fun wire -> (FSharpValue.GetUnionFields(wire, typeof<GameType>) |> fst).Name) |> Set.ofSeq

    Assert.Equal<Set<string>>(caseNames, scenarioCaseNames)
    Assert.True(Seq.length (scenarioCases ()) > 0)

// The rule that spans game types, which only GameType.fs may know: a game
// type that selects nothing plays as The Bible — the verses it draws and
// the points it gives. The frontend's registry applies the same rule.
[<Fact>]
let ``a game type that selects nothing plays as The Bible`` () =
    for nothing in [ Books []; Chapters Map.empty ] do
        Assert.Equal(AllVerses, GameType.playedAs nothing)
        Assert.Equal(GameType.restrictionOf AllVerses, GameType.restrictionOf nothing)

[<Fact>]
let ``a game type that selects something plays as itself`` () =
    for something in [ AllVerses; Books [ 8 ]; Chapters(Map.ofList [ 8, [ 1 ] ]) ] do
        Assert.Equal(something, GameType.playedAs something)
