#load "lib/Common.fsx"

open Common

let expected = packageVersion ()
let validate () =
    match metaVersion indexHtml with
        | None -> failWith "Missing application-version meta tag in index.html"
        | Some v when v = placeholderVersion -> failWith $"Version is still the {placeholderVersion} placeholder — injection did not run."
        | Some v when v <> expected ->
            failWith $"Version mismatch: package.json says {expected}, artifact says {v}."
        | Some v ->
            printfn $"Frontend artifact verified: version {v}"

validate ()
