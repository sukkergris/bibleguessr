module BibleGuessr.Tests.TestPaths

// Tests run from the build output folder (bin/<config>/<tfm>), not from the
// project folder, so repo files are found by walking up to the repo root
// rather than by a fixed relative path. A fixed "../../bibles" path used to
// resolve to nothing there, and the test using it silently did nothing.

open System.IO

let private archiveRelativePath = Path.Combine("bibles", "bibelen-dk", "src", "Bibelen Files.zip")

/// The tracked, public-domain bibelen-dk archive. Fails loudly if it can't
/// be found: it is committed to git, so a missing file is a real problem.
let bibelenDkArchive =
    let rec search (directory: DirectoryInfo) =
        match directory with
        | null -> failwith $"Could not find {archiveRelativePath} above {System.AppContext.BaseDirectory}"
        | d when File.Exists(Path.Combine(d.FullName, archiveRelativePath)) ->
            Path.Combine(d.FullName, archiveRelativePath)
        | d -> search d.Parent

    search (DirectoryInfo(System.AppContext.BaseDirectory))

let private apiProjectRelativePath = Path.Combine("backend", "Api")

/// The API project folder, where the tracked appsettings*.json files live.
/// Found the same way as bibelenDkArchive, for the same reason.
let apiProjectDirectory =
    let rec search (directory: DirectoryInfo) =
        match directory with
        | null -> failwith $"Could not find {apiProjectRelativePath} above {System.AppContext.BaseDirectory}"
        | d when File.Exists(Path.Combine(d.FullName, apiProjectRelativePath, "appsettings.json")) ->
            Path.Combine(d.FullName, apiProjectRelativePath)
        | d -> search d.Parent

    search (DirectoryInfo(System.AppContext.BaseDirectory))

let private gameTypesRelativePath = Path.Combine("backend", "Domain", "GameTypes")

/// The folder holding one module per game type — see
/// GameTypeIsolationTests.fs. Found the same way as bibelenDkArchive.
let gameTypesDirectory =
    let rec search (directory: DirectoryInfo) =
        match directory with
        | null -> failwith $"Could not find {gameTypesRelativePath} above {System.AppContext.BaseDirectory}"
        | d when File.Exists(Path.Combine(d.FullName, gameTypesRelativePath, "GameType.fs")) ->
            Path.Combine(d.FullName, gameTypesRelativePath)
        | d -> search d.Parent

    search (DirectoryInfo(System.AppContext.BaseDirectory))
