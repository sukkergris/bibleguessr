module BibleGuessr.Tests.BuildInfoTests

// Which build the API is — see Api/BuildInfo.fs and docs/web/build-info.
// The values come from environment variables the API image bakes in; the
// lookup is passed in, so these tests never touch the real environment.

open System.Text.Json
open Xunit
open BibleGuessr.Api

let private lookupIn (variables: Map<string, string>) (name: string) : string =
    variables |> Map.tryFind name |> Option.toObj

/// Serializes a value the way the HTTP endpoints do (see Api/Json.fs).
let private toWire (value: 'T) =
    let options = JsonSerializerOptions(JsonSerializerDefaults.Web)
    options.Converters.Add(Json.converter ())
    JsonSerializer.Serialize(value, options)

[<Fact>]
let ``reads all three values from their variables`` () =
    let info =
        BuildInfo.read (
            lookupIn (
                Map.ofList
                    [ "BUILD_SHA", "e99dae2"
                      "BUILD_CONTEXT", "github"
                      "IMAGE_TAG", "0.0.7" ]
            )
        )

    Assert.Equal(
        { BuildInfo.BuildSha = Some "e99dae2"
          BuildInfo.BuildContext = Some "github"
          BuildInfo.ImageTag = Some "0.0.7" },
        info
    )

[<Fact>]
let ``a variable that isn't set is None`` () =
    let info = BuildInfo.read (lookupIn Map.empty)
    Assert.Equal({ BuildInfo.BuildSha = None; BuildInfo.BuildContext = None; BuildInfo.ImageTag = None }, info)

[<Fact>]
let ``an empty variable counts as unset`` () =
    // The Dockerfile sets every variable, even when its build arg wasn't
    // passed — then it's empty, not missing.
    let info = BuildInfo.read (lookupIn (Map.ofList [ "BUILD_SHA", ""; "BUILD_CONTEXT", "  " ]))
    Assert.Equal(None, info.BuildSha)
    Assert.Equal(None, info.BuildContext)

[<Fact>]
let ``surrounding whitespace is trimmed`` () =
    let info = BuildInfo.read (lookupIn (Map.ofList [ "IMAGE_TAG", " 0.0.7\n" ]))
    Assert.Equal(Some "0.0.7", info.ImageTag)

[<Fact>]
let ``on the wire, fields are camelCase and an unset value is null`` () =
    // The shape frontend/src/api.ts's BuildInfo expects.
    let info =
        { BuildInfo.BuildSha = Some "e99dae2"
          BuildInfo.BuildContext = None
          BuildInfo.ImageTag = Some "local" }

    Assert.Equal("""{"buildSha":"e99dae2","buildContext":null,"imageTag":"local"}""", toWire info)
