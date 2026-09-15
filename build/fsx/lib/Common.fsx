module Common

open System.IO
open System.Text.Json
open System.Text.RegularExpressions
let placeholderVersion = "0.0.0"

let failWith (message: string) =
    eprintfn "VerifyFrontendArtifact: %s" message
    exit 1

let packageJsonPath = Path.Combine("frontend", "package.json")

let distIndexPath = Path.Combine("frontend", "dist", "index.html")

let packageVersion () =
    use doc = JsonDocument.Parse(File.ReadAllText packageJsonPath)
    doc.RootElement.GetProperty("version").GetString()


let indexHtml =
    if not (File.Exists distIndexPath) then
        failWith $"{distIndexPath} not found - artifact does not exist - maybe the build didn't run?"
    File.ReadAllText distIndexPath
let metaVersion (html: string) =
    let m = Regex.Match(html, "<meta name=\"application-version\" content=\"([^\"]*)\"")
    if m.Success then Some m.Groups.[1].Value
    else None
