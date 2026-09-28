module Common

open System.IO
open System.Text.Json
open System.Text.RegularExpressions
let placeholderRevision = "0"

let failWith (message: string) =
    eprintfn "VerifyFrontendArtifact: %s" message
    exit 1

let packageJsonPath = Path.Combine("frontend", "package.json")

let distIndexPath = Path.Combine("frontend", "dist", "index.html")

// The frontend revision is package.json's integer `revision`, not the
// semver `version` field npm reserves.
let packageRevision () =
    use doc = JsonDocument.Parse(File.ReadAllText packageJsonPath)
    doc.RootElement.GetProperty("revision").GetInt32() |> string


let indexHtml =
    if not (File.Exists distIndexPath) then
        failWith $"{distIndexPath} not found - artifact does not exist - maybe the build didn't run?"
    File.ReadAllText distIndexPath
let metaRevision (html: string) =
    let m = Regex.Match(html, "<meta name=\"application-revision\" content=\"([^\"]*)\"")
    if m.Success then Some m.Groups.[1].Value
    else None
