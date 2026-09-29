module BibleGuessr.Tests.RequestLoggingTests

// Covers RequestLogging.levelFor — the GetLevel hook that keeps constantly
// polled liveness probes out of the Information-level request log, without
// hiding a probe that reports unhealthy or throws.

open System
open Microsoft.AspNetCore.Http
open Serilog.Events
open Xunit
open BibleGuessr.Api.RequestLogging

let private probePath = "/api/healthz"
let private otherPath = "/api/books"
let private elapsedMs = 1.0
let private noError: exn = null

let private request (path: string) (statusCode: int) : HttpContext =
    let ctx = DefaultHttpContext()
    ctx.Request.Path <- PathString path
    ctx.Response.StatusCode <- statusCode
    ctx

[<Fact>]
let ``a healthy probe is logged at Verbose, below the Information minimum`` () =
    let level = levelFor probePath (request probePath StatusCodes.Status200OK) elapsedMs noError
    Assert.Equal(LogEventLevel.Verbose, level)

[<Fact>]
let ``the probe path matches regardless of case, as ASP.NET Core routing does`` () =
    let level = levelFor probePath (request "/API/Healthz" StatusCodes.Status200OK) elapsedMs noError
    Assert.Equal(LogEventLevel.Verbose, level)

[<Fact>]
let ``an unhealthy probe (503) is still logged, at Error`` () =
    let level =
        levelFor probePath (request probePath StatusCodes.Status503ServiceUnavailable) elapsedMs noError

    Assert.Equal(LogEventLevel.Error, level)

[<Fact>]
let ``a probe that throws is logged at Error`` () =
    let level =
        levelFor probePath (request probePath StatusCodes.Status200OK) elapsedMs (InvalidOperationException())

    Assert.Equal(LogEventLevel.Error, level)

[<Fact>]
let ``an ordinary successful request is logged at Information`` () =
    let level = levelFor probePath (request otherPath StatusCodes.Status200OK) elapsedMs noError
    Assert.Equal(LogEventLevel.Information, level)

[<Fact>]
let ``a client error (4xx) on an ordinary request stays at Information`` () =
    let level = levelFor probePath (request otherPath StatusCodes.Status404NotFound) elapsedMs noError
    Assert.Equal(LogEventLevel.Information, level)

[<Fact>]
let ``a server error on an ordinary request is logged at Error`` () =
    let level =
        levelFor probePath (request otherPath StatusCodes.Status500InternalServerError) elapsedMs noError

    Assert.Equal(LogEventLevel.Error, level)
