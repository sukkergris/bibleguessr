module BibleGuessr.Tests.CongregationRulesConfigTests

open System
open Xunit
open BibleGuessr.Domain

let private configOf (pairs: (string * string) list) =
    let map = Map.ofList pairs
    fun key -> map.TryFind key

[<Fact>]
let ``unset settings fall back to the defaults`` () =
    Assert.Equal(Ok CongregationRules.defaults, CongregationRules.fromConfig (configOf []))

[<Fact>]
let ``configured settings override the defaults`` () =
    let result =
        CongregationRules.fromConfig (
            configOf
                [ CongregationRules.minPlayersKey, "2"
                  CongregationRules.maxPlayersKey, "8"
                  CongregationRules.revealKey, "3" ]
        )

    match result with
    | Ok rules ->
        Assert.Equal(2, rules.MinPlayers)
        Assert.Equal(8, rules.MaxPlayers)
        Assert.Equal(TimeSpan.FromSeconds 3.0, rules.RevealPause)
    | Error e -> failwith e

[<Theory>]
[<InlineData("Congregation:MinPlayers", "1")>]
[<InlineData("Congregation:MinPlayers", "many")>]
[<InlineData("Congregation:MaxPlayers", "2")>]
[<InlineData("Congregation:MinTimeLimitSeconds", "0")>]
[<InlineData("Congregation:MaxTimeLimitSeconds", "5")>]
[<InlineData("Congregation:RevealSeconds", "-1")>]
let ``an impossible setting is rejected`` (key: string, value: string) =
    match CongregationRules.fromConfig (configOf [ key, value ]) with
    | Error _ -> ()
    | Ok rules -> failwith $"expected {key}={value} to be rejected, got %A{rules}"
