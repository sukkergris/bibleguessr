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
