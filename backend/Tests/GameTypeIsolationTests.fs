module BibleGuessr.Tests.GameTypeIsolationTests

// Each game type is its own bounded context (see docs/web/game-types):
// Domain/GameTypes/<Name>.fs must never reference a sibling game type.
// Only GameType.fs, the composition point, may know all of them. F#'s
// compile order alone doesn't prevent this — a later file can freely use
// an earlier one — so it's checked here instead.

open System.IO
open System.Text.RegularExpressions
open Xunit

/// The file that composes the game types; exempt by design.
let private compositionFileName = "GameType.fs"

let private commentLine = Regex(@"^\s*//")

let private domainFiles () =
    Directory.GetFiles(TestPaths.gameTypesDirectory, "*.fs")
    |> Array.filter (fun path -> Path.GetFileName path <> compositionFileName)
    |> Array.sort

let private moduleNameOf (path: string) = Path.GetFileNameWithoutExtension path

/// Source lines with comments dropped, so a doc comment may still mention
/// another game type by name.
let private codeLines (path: string) =
    File.ReadAllLines path
    |> Array.filter (fun line -> not (commentLine.IsMatch line))

/// Lines in `path` that reference `otherModule` — a qualified use
/// (`Books.restriction`) or an `open` of it.
let referencesTo (otherModule: string) (lines: string array) =
    let qualified = Regex($@"\b{Regex.Escape otherModule}\.")
    let opened = Regex($@"^\s*open\s+.*\b{Regex.Escape otherModule}\s*$")
    lines |> Array.filter (fun line -> qualified.IsMatch line || opened.IsMatch line)

[<Fact>]
let ``there are game type modules to check`` () =
    // Guards against the check below passing vacuously if the folder moves.
    Assert.True(domainFiles().Length >= 3)

[<Fact>]
let ``no game type module references another game type`` () =
    let files = domainFiles ()
    let modules = files |> Array.map moduleNameOf

    let violations =
        [ for file in files do
              let lines = codeLines file
              for other in modules do
                  if other <> moduleNameOf file then
                      for line in referencesTo other lines do
                          $"{Path.GetFileName file} references {other}: {line.Trim()}" ]

    Assert.Empty(violations)

[<Fact>]
let ``the reference check catches a qualified use and an open`` () =
    let lines =
        [| "let x = Books.restriction [ 1 ]"
           "open BibleGuessr.Domain.GameTypes.Books"
           "let books = Set.empty" |]

    Assert.Equal(2, (referencesTo "Books" lines).Length)
