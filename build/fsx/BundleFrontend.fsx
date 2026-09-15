#r "System.IO.Compression"
#load "lib/Common.fsx"
#load "lib/Rootloader.fsx"

open Common
open Rootloader
open System.IO.Compression
open System.IO

let rootDir = RootLoader.findRoot __SOURCE_DIRECTORY__
let version = packageVersion ()

let artifact = $"bibleguessr-frontend-{version}"

let artifactPath = Path.Combine( rootDir,"artifacts", artifact)

let sourcePath = Path.Combine(rootDir, "frontend", "")

let pack (source: string, dist: string) =
    if not (Directory.Exists source) then
        failwith $"{source} path doesn't exist"

    Directory.CreateDirectory(Path.GetDirectoryName dist) |> ignore

    ZipFile.CreateFromDirectory(source, dist + ".zip", CompressionLevel.Optimal, false)

pack( sourcePath, artifactPath)


