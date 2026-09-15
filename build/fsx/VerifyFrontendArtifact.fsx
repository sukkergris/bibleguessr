open System.IO
open System.Text.Json
open System.Text.RegularExpressions

let packageJsonPath = Path.Combine("frontend", "package.json")

let packageVersion () =
    use doc = JsonDocument.Parse(File.ReadAllText packageJsonPath)
    doc.RootElement.GetProperty("version").GetString()

let distIndexPath = Path.Combine("frontend", "dist", "index.html")

let fail (message: string) =
    eprintfn "VerifyFrontendArtifact: %s" message
    exit 1

let indexHtml =
    if not (File.Exists distIndexPath) then
        fail $"{distIndexPath} not found - artifact does not exist - maybe the build didn't run?"
    File.ReadAllText distIndexPath
let metaVersion (html: string) =
    let m = Regex.Match(html, "<meta name=\"application-version\" content=\"([^\"]*)\"")
    if m.Success then Some m.Groups.[1].Value
    else None


let placeholderVersion = "0.0.0"
let expected = packageVersion ()
let validate () =
    match metaVersion indexHtml with
        | None -> fail "Missing application-version meta tag in index.html"
        | Some v when v = placeholderVersion -> fail $"Version is still the {placeholderVersion} placeholder — injection did not run."
        | Some v when v <> expected ->
            fail $"Version mismatch: package.json says {expected}, artifact says {v}."
        | Some v ->
            printfn $"Frontend artifact verified: version {v}"

validate ()
