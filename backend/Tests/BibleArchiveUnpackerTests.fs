module BibleGuessr.Tests.BibleArchiveUnpackerTests

// Covers BibleArchiveUnpacker — unpacks the Bible archive shipped in the
// API image into a data folder (a Docker volume in production) on startup.
// See docs/SCRUM/DONE/Feature.ShipBibleWithApiImage.md. Each guard here
// (marker comparison, crash-debris cleanup, the zip-slip check) protects
// against a specific failure: a stale unpack surviving an image upgrade, a
// half-written folder being trusted, or an archive writing outside its
// folder.

open System
open System.IO
open System.IO.Compression
open Xunit
open BibleGuessr.Api.BibleArchiveUnpacker

let private translationFolder = "bibelen-dk"

/// A throwaway root holding the archive and the data folder, deleted on
/// Dispose so each test starts from nothing.
type private Sandbox() =
    let root = Path.Combine(Path.GetTempPath(), $"bibleguessr-unpack-{Guid.NewGuid():N}")
    do Directory.CreateDirectory(root) |> ignore

    member _.Root = root
    member _.ArchivePath = Path.Combine(root, "archive.zip")
    member _.DataDirectory = Path.Combine(root, "data")
    member this.Target = Path.Combine(this.DataDirectory, translationFolder)

    member this.Settings =
        { ArchivePath = this.ArchivePath
          DataDirectory = this.DataDirectory
          TranslationFolder = translationFolder }

    /// Writes the archive with the given (entry name, content) pairs.
    member this.WriteArchive(entries: (string * string) list) =
        File.Delete(this.ArchivePath)
        use archive = ZipFile.Open(this.ArchivePath, ZipArchiveMode.Create)

        for name, content in entries do
            use writer = new StreamWriter(archive.CreateEntry(name).Open())
            writer.Write(content)

    interface IDisposable with
        member _.Dispose() = Directory.Delete(root, true)

let private sha = "aaaa"
let private otherSha = "bbbb"

// --- decide: the pure unpack decision --------------------------------------

[<Fact>]
let ``decide unpacks when the target folder is missing`` () =
    Assert.Equal(Unpack FirstRun, decide sha Missing)

[<Fact>]
let ``decide does nothing when the marker matches the archive`` () =
    Assert.Equal(UpToDate, decide sha (MarkedWith sha))

[<Fact>]
let ``decide re-unpacks when the marker names a different archive`` () =
    Assert.Equal(Unpack(ArchiveChanged(otherSha, sha)), decide sha (MarkedWith otherSha))

[<Fact>]
let ``decide re-unpacks a folder with no marker instead of trusting it`` () =
    Assert.Equal(Unpack NoMarker, decide sha Unmarked)

// --- ensureUnpacked: against the file system -------------------------------

[<Fact>]
let ``first run unpacks the archive into the translation folder`` () =
    use sandbox = new Sandbox()
    sandbox.WriteArchive([ "01_01.html", "genesis"; "sub/02_01.html", "exodus" ])

    let outcome = ensureUnpacked sandbox.Settings

    Assert.Equal(Unpacked FirstRun, outcome)
    Assert.Equal("genesis", File.ReadAllText(Path.Combine(sandbox.Target, "01_01.html")))
    Assert.Equal("exodus", File.ReadAllText(Path.Combine(sandbox.Target, "sub", "02_01.html")))

[<Fact>]
let ``a second run with the same archive does not unpack again`` () =
    use sandbox = new Sandbox()
    sandbox.WriteArchive([ "01_01.html", "genesis" ])
    ensureUnpacked sandbox.Settings |> ignore
    // Anything unpack would overwrite; it must survive an up-to-date start.
    File.WriteAllText(Path.Combine(sandbox.Target, "01_01.html"), "patched by an operator")

    let outcome = ensureUnpacked sandbox.Settings

    Assert.Equal(AlreadyUpToDate, outcome)
    Assert.Equal("patched by an operator", File.ReadAllText(Path.Combine(sandbox.Target, "01_01.html")))

[<Fact>]
let ``a different archive replaces the previously unpacked contents`` () =
    use sandbox = new Sandbox()
    sandbox.WriteArchive([ "old.html", "old" ])
    ensureUnpacked sandbox.Settings |> ignore
    sandbox.WriteArchive([ "new.html", "new" ])

    let outcome = ensureUnpacked sandbox.Settings

    Assert.True(
        (match outcome with
         | Unpacked(ArchiveChanged _) -> true
         | _ -> false),
        $"Expected a re-unpack for a changed archive, got {outcome}"
    )
    Assert.True(File.Exists(Path.Combine(sandbox.Target, "new.html")))
    Assert.False(File.Exists(Path.Combine(sandbox.Target, "old.html")))

[<Fact>]
let ``an interrupted unpack leaves debris that the next start removes and redoes`` () =
    use sandbox = new Sandbox()
    sandbox.WriteArchive([ "01_01.html", "genesis"; "01_02.html", "genesis 2" ])
    // What a crash mid-extraction leaves behind: a half-filled temp folder
    // and a half-swapped old folder, but no target folder.
    let tempDebris = Path.Combine(sandbox.DataDirectory, $".{translationFolder}.tmp-crashed")
    let oldDebris = Path.Combine(sandbox.DataDirectory, $".{translationFolder}.old-crashed")
    Directory.CreateDirectory(tempDebris) |> ignore
    Directory.CreateDirectory(oldDebris) |> ignore
    File.WriteAllText(Path.Combine(tempDebris, "01_01.html"), "genes")

    let outcome = ensureUnpacked sandbox.Settings

    Assert.Equal(Unpacked FirstRun, outcome)
    Assert.False(Directory.Exists(tempDebris), "temp debris should be removed")
    Assert.False(Directory.Exists(oldDebris), "old debris should be removed")
    Assert.Equal("genesis 2", File.ReadAllText(Path.Combine(sandbox.Target, "01_02.html")))

[<Fact>]
let ``a target folder without a marker is unpacked again`` () =
    use sandbox = new Sandbox()
    sandbox.WriteArchive([ "01_01.html", "genesis" ])
    Directory.CreateDirectory(sandbox.Target) |> ignore
    File.WriteAllText(Path.Combine(sandbox.Target, "01_01.html"), "partial")

    let outcome = ensureUnpacked sandbox.Settings

    Assert.Equal(Unpacked NoMarker, outcome)
    Assert.Equal("genesis", File.ReadAllText(Path.Combine(sandbox.Target, "01_01.html")))

[<Fact>]
let ``an entry escaping the folder is rejected and nothing is written outside it`` () =
    use sandbox = new Sandbox()
    // "../" lands in the data folder next to the temp folder, and "../../"
    // lands outside the data folder altogether; both escape the target.
    sandbox.WriteArchive([ "01_01.html", "genesis"; "../evil.html", "evil"; "../../evil.html", "evil" ])

    let outcome = ensureUnpacked sandbox.Settings

    Assert.True(
        (match outcome with
         | Failed _ -> true
         | _ -> false),
        $"Expected the archive to be rejected, got {outcome}"
    )
    Assert.False(File.Exists(Path.Combine(sandbox.DataDirectory, "evil.html")))
    Assert.False(File.Exists(Path.Combine(sandbox.Root, "evil.html")))
    Assert.False(Directory.Exists(sandbox.Target), "a rejected archive must not become the target")
    Assert.Empty(Directory.GetDirectories(sandbox.DataDirectory))

[<Fact>]
let ``a missing archive is reported and leaves the data folder alone`` () =
    use sandbox = new Sandbox()

    let outcome = ensureUnpacked sandbox.Settings

    Assert.Equal(NoArchive, outcome)
    Assert.False(Directory.Exists(sandbox.Target))

[<Fact>]
let ``the real bibelen-dk archive unpacks into a folder that loads exactly the zip's verses`` () =
    // End to end over the shipped data. Equal lists, in the same order,
    // matter beyond the text: book numbers come from first-encounter order
    // (see Verse.bookNumbers), so reading the unpacked files in a different
    // order than the zip's entries would renumber books.
    use sandbox = new Sandbox()
    let settings = { sandbox.Settings with ArchivePath = TestPaths.bibelenDkArchive }

    Assert.Equal(Unpacked FirstRun, ensureUnpacked settings)

    let fromFolder = BibleGuessr.Api.BibelenDkLoader.loadFromHtmlDirectory sandbox.Target
    let fromZip = BibleGuessr.Api.BibelenDkLoader.loadFromZip TestPaths.bibelenDkArchive

    Assert.NotEmpty(fromZip)
    Assert.Equal<BibleGuessr.Domain.Verse list>(fromZip, fromFolder)
