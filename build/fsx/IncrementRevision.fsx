// Increments the frontend and/or backend revision by one.
//
//   dotnet fsi build/fsx/IncrementRevision.fsx <frontend|backend> [<frontend|backend>]
//   task release:revision -- <frontend|backend> [<frontend|backend>]
//
// The revisions are plain integer counters (see "Versioning" in CLAUDE.md):
// the frontend's is `revision` in frontend/package.json, the backend's is the
// `BackendRevision` literal in backend/Api/Program.fs. Only the number is
// rewritten, so the rest of each file keeps its formatting.
//
// Every target is checked before anything is written: if one file cannot be
// updated, neither is.
#load "lib/RootLoader.fsx"

open System.IO
open System.Text.RegularExpressions
open RootLoader

type Target =
    | Frontend
    | Backend

type RevisionFile =
    { Target: Target
      Path: string
      // Group "revision" captures the number and nothing else.
      Pattern: Regex }

type Plan =
    | Ready of file: RevisionFile * current: int * next: int * updated: string
    | Refused of message: string

let exitFailure = 1
let revisionGroup = "revision"
let usage = "usage: IncrementRevision.fsx <frontend|backend> [<frontend|backend>]"

let rootDir = RootLoader.findRoot __SOURCE_DIRECTORY__

let name target =
    match target with
    | Frontend -> "frontend"
    | Backend -> "backend"

let parseTarget (arg: string) =
    match arg.Trim().ToLowerInvariant() with
    | "frontend" -> Ok Frontend
    | "backend" -> Ok Backend
    | other -> Error $"Unknown target '{other}'."

let revisionFile target =
    match target with
    | Frontend ->
        { Target = Frontend
          Path = Path.Combine(rootDir, "frontend", "package.json")
          Pattern = Regex($"\"revision\"\\s*:\\s*(?<{revisionGroup}>\\d+)") }
    | Backend ->
        { Target = Backend
          Path = Path.Combine(rootDir, "backend", "Api", "Program.fs")
          Pattern =
            Regex($"^let BackendRevision = (?<{revisionGroup}>\\d+)(?=\\s*$)", RegexOptions.Multiline) }

let plan (file: RevisionFile) =
    let content = File.ReadAllText file.Path

    match file.Pattern.Matches content |> List.ofSeq with
    | [ m ] ->
        let number = m.Groups.[revisionGroup]
        let current = int number.Value
        let next = current + 1

        let updated =
            content.Substring(0, number.Index)
            + string next
            + content.Substring(number.Index + number.Length)

        Ready(file, current, next, updated)
    | [] -> Refused $"No {name file.Target} revision found in {file.Path} (expected a match for {file.Pattern})."
    | matches ->
        Refused $"Found {matches.Length} {name file.Target} revisions in {file.Path}, expected exactly one."

let fail (message: string) =
    eprintfn "IncrementRevision: %s" message
    exit exitFailure

let args = fsi.CommandLineArgs |> Array.skip 1 |> List.ofArray

if List.isEmpty args then
    fail usage

let parsed = args |> List.map parseTarget

match parsed |> List.choose (function Error e -> Some e | Ok _ -> None) with
| [] -> ()
| errors -> fail (String.concat " " errors + " " + usage)

let plans =
    parsed
    |> List.choose (function Ok t -> Some t | Error _ -> None)
    |> List.distinct
    |> List.map (revisionFile >> plan)

match plans |> List.choose (function Refused m -> Some m | Ready _ -> None) with
| [] -> ()
| refusals -> fail (String.concat " " refusals + " Nothing was changed.")

for p in plans do
    match p with
    | Ready(file, current, next, updated) ->
        File.WriteAllText(file.Path, updated)
        printfn $"{name file.Target} revision {current} -> {next}"
    | Refused _ -> ()
