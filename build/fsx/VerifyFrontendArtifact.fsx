#load "lib/Common.fsx"

open Common

let expected = packageRevision ()
let validate () =
    match metaRevision indexHtml with
        | None -> failWith "Missing application-revision meta tag in index.html"
        | Some v when v = placeholderRevision -> failWith $"Revision is still the {placeholderRevision} placeholder — injection did not run."
        | Some v when v <> expected ->
            failWith $"Revision mismatch: package.json says {expected}, artifact says {v}."
        | Some v ->
            printfn $"Frontend artifact verified: revision {v}"

validate ()
