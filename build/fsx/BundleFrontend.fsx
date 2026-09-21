#r "System.IO.Compression"
#load "lib/Common.fsx"
#load "lib/RootLoader.fsx"

open Common
open RootLoader
open System.IO.Compression
open System.IO

let rootDir = RootLoader.findRoot __SOURCE_DIRECTORY__

let version = packageVersion ()

let artifact = $"bibleguessr-frontend-{version}"

let artifactPath = Path.Combine( rootDir,"artifacts", artifact)

let sourcePath = Path.Combine(rootDir, "frontend", "dist")

let copyReleaseFiles(dist: string) =
    let license = "LICENSE"
    let notice = "NOTICE.md"
    File.Copy(Path.Combine(rootDir, license), Path.Combine(sourcePath, license), true)
    File.Copy( Path.Combine(rootDir, notice ), Path.Combine(sourcePath, notice), true)
    ()

let pack (source: string, dist: string) =
    if not (Directory.Exists source) then
        failwith $"{source} path doesn't exist"

    Directory.CreateDirectory(Path.GetDirectoryName dist) |> ignore

    copyReleaseFiles dist

    let archivePath = dist + ".zip"

    if File.Exists archivePath then
        File.Delete archivePath

    ZipFile.CreateFromDirectory(source, archivePath, CompressionLevel.Optimal, false)

pack( sourcePath, artifactPath)


