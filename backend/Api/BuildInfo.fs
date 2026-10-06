/// Which build the running API is — served at /api/build-info and shown in
/// the nerd panel; see docs/web/build-info. build/Dockerfile.api bakes the
/// values into the image as environment variables from its build args.
/// Outside an image (e.g. `task dotnet:dev`) they are whatever that
/// process inherited: BUILD_SHA is unset, but the devcontainer sets
/// BUILD_CONTEXT and Task exports IMAGE_TAG (Taskfile.Docker.yml).
module BibleGuessr.Api.BuildInfo

open System

type BuildInfo =
    { /// The git commit the image was built from.
      BuildSha: string option
      /// Where the image was built (the BUILD_CONTEXT workflow variable,
      /// or whatever a local build passed).
      BuildContext: string option
      /// The image's Docker tag: the release version, or "local" for a
      /// host-only build — see docs/web/versioning.
      ImageTag: string option }

let buildShaVariable = "BUILD_SHA"
let buildContextVariable = "BUILD_CONTEXT"
let imageTagVariable = "IMAGE_TAG"

/// Reads the build info through `lookup` — an environment variable lookup
/// in production, passed in so tests needn't touch the real environment.
/// An empty value counts as unset: the Dockerfile sets every variable,
/// even when its build arg wasn't given.
let read (lookup: string -> string) : BuildInfo =
    let valueOf name =
        match lookup name with
        | null -> None
        | value when String.IsNullOrWhiteSpace value -> None
        | value -> Some(value.Trim())

    { BuildSha = valueOf buildShaVariable
      BuildContext = valueOf buildContextVariable
      ImageTag = valueOf imageTagVariable }

/// The build info of this process, from its environment variables.
let fromEnvironment () : BuildInfo = read Environment.GetEnvironmentVariable
