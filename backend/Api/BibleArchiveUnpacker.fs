/// Unpacks the Bible archive shipped in the API image into a data folder
/// (a Docker volume in production, a gitignored local folder in
/// development) on startup, before verses are loaded. An infrastructure
/// concern only: the domain keeps receiving a `Verse list`.
///
/// Layout under the data directory, for a translation folder "bibelen-dk":
///
///   <DataDirectory>/bibelen-dk/                the unpacked archive
///   <DataDirectory>/bibelen-dk/.archive.sha256 the marker: which archive
///   <DataDirectory>/.bibelen-dk.tmp-<id>/      extraction in progress
///   <DataDirectory>/.bibelen-dk.old-<id>/      previous unpack, mid-swap
///
/// The data directory itself is never renamed, since it may be a volume
/// mount point; the swap renames a folder INSIDE it, on the same volume.
///
/// - Idempotent: the marker holds the archive's SHA-256, so an image
///   upgrade with a changed archive re-unpacks, while a restart does not.
/// - Atomic: extraction goes to a temp folder that is renamed into place
///   only once complete, so a crash never leaves a half-populated target
///   that looks finished. Leftover temp/old folders are deleted on start.
/// - Zip-slip safe: an entry whose path resolves outside the temp folder
///   rejects the whole archive.
///
/// See docs/SCRUM/DONE/Feature.ShipBibleWithApiImage.md and
/// docs/web/bible-data-volume/.
module BibleGuessr.Api.BibleArchiveUnpacker

open System
open System.IO
open System.IO.Compression
open System.Security.Cryptography

[<Literal>]
let MarkerFileName = ".archive.sha256"

let private tempInfix = ".tmp-"
let private oldInfix = ".old-"

type UnpackSettings =
    { ArchivePath: string
      DataDirectory: string
      TranslationFolder: string }

/// What the target folder holds, as far as unpacking is concerned.
type TargetState =
    /// No folder: a first start, or a crash between the two swap renames.
    | Missing
    /// A folder with no marker: partial or foreign contents, not trusted.
    | Unmarked
    /// A complete unpack of the archive with this SHA-256.
    | MarkedWith of sha256: string

type UnpackReason =
    | FirstRun
    | NoMarker
    | ArchiveChanged of previousSha256: string * currentSha256: string

/// A one-line, log-friendly description of why an unpack happened.
let describeReason (reason: UnpackReason) =
    match reason with
    | FirstRun -> "first run: nothing unpacked yet"
    | NoMarker -> "the folder has no marker, so its contents are not trusted"
    | ArchiveChanged(previous, current) -> $"archive changed from sha256 {previous} to {current}"

type UnpackDecision =
    | UpToDate
    | Unpack of UnpackReason

type UnpackOutcome =
    | AlreadyUpToDate
    | Unpacked of UnpackReason
    /// No archive at ArchivePath; whatever is already unpacked is used.
    | NoArchive
    | Failed of message: string

/// The unpack decision, kept pure so it can be tested without a disk.
/// Only an exact marker match skips the unpack; "the folder is non-empty"
/// is deliberately not enough.
let decide (archiveSha256: string) (state: TargetState) : UnpackDecision =
    match state with
    | Missing -> Unpack FirstRun
    | Unmarked -> Unpack NoMarker
    | MarkedWith previous when previous = archiveSha256 -> UpToDate
    | MarkedWith previous -> Unpack(ArchiveChanged(previous, archiveSha256))

let targetDirectory (settings: UnpackSettings) =
    Path.Combine(settings.DataDirectory, settings.TranslationFolder)

let readTargetState (target: string) : TargetState =
    let marker = Path.Combine(target, MarkerFileName)

    if not (Directory.Exists target) then Missing
    elif File.Exists marker then MarkedWith(File.ReadAllText(marker).Trim())
    else Unmarked

let private sha256Of (path: string) =
    use stream = File.OpenRead(path)
    Convert.ToHexStringLower(SHA256.HashData(stream))

/// Deletes temp/old folders a crashed unpack or swap left behind. They are
/// never reused: a temp folder may be incomplete, and an old folder is by
/// definition superseded.
let private removeDebris (settings: UnpackSettings) =
    let prefix infix = $".{settings.TranslationFolder}{infix}*"

    for infix in [ tempInfix; oldInfix ] do
        for debris in Directory.GetDirectories(settings.DataDirectory, prefix infix) do
            Directory.Delete(debris, true)

exception private ZipSlip of entry: string

/// Extracts every entry into `destination`, rejecting any entry whose
/// resolved path escapes it (e.g. "../evil.html" or an absolute path).
let private extractSafely (archivePath: string) (destination: string) =
    let root = Path.GetFullPath(destination) + string Path.DirectorySeparatorChar
    use archive = ZipFile.OpenRead(archivePath)

    for entry in archive.Entries do
        let path = Path.GetFullPath(Path.Combine(root, entry.FullName))

        if not (path.StartsWith(root, StringComparison.Ordinal)) then
            raise (ZipSlip entry.FullName)

        if entry.FullName.EndsWith("/") then
            Directory.CreateDirectory(path) |> ignore
        else
            Directory.CreateDirectory(Path.GetDirectoryName(path)) |> ignore
            entry.ExtractToFile(path, overwrite = false)

/// Extracts to a temp folder next to the target, then swaps it in.
let private unpackAndSwap (settings: UnpackSettings) (archiveSha256: string) =
    let target = targetDirectory settings
    let id = Guid.NewGuid().ToString("N")
    let temp = Path.Combine(settings.DataDirectory, $".{settings.TranslationFolder}{tempInfix}{id}")
    let old = Path.Combine(settings.DataDirectory, $".{settings.TranslationFolder}{oldInfix}{id}")

    try
        Directory.CreateDirectory(temp) |> ignore
        extractSafely settings.ArchivePath temp
        File.WriteAllText(Path.Combine(temp, MarkerFileName), archiveSha256)
    with _ ->
        Directory.Delete(temp, true)
        reraise ()

    if Directory.Exists target then
        Directory.Move(target, old)

    Directory.Move(temp, target)

    if Directory.Exists old then
        Directory.Delete(old, true)

/// Makes sure the target folder holds the archive at ArchivePath, unpacking
/// it only when needed. Never throws: failures come back as `Failed`, so
/// startup can log them and let the health check report no verses.
let ensureUnpacked (settings: UnpackSettings) : UnpackOutcome =
    try
        Directory.CreateDirectory(settings.DataDirectory) |> ignore
        removeDebris settings

        if not (File.Exists settings.ArchivePath) then
            NoArchive
        else
            let archiveSha256 = sha256Of settings.ArchivePath

            match decide archiveSha256 (readTargetState (targetDirectory settings)) with
            | UpToDate -> AlreadyUpToDate
            | Unpack reason ->
                unpackAndSwap settings archiveSha256
                Unpacked reason
    with
    | ZipSlip entry -> Failed $"Archive entry '{entry}' would be written outside the data folder; archive rejected"
    | ex -> Failed ex.Message
