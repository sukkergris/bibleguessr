/// Chooses the level of Serilog's one-line-per-request log entry
/// (UseSerilogRequestLogging's GetLevel hook).
module BibleGuessr.Api.RequestLogging

open Microsoft.AspNetCore.Http
open Serilog.Events

/// Liveness probes poll constantly; logging each one at Information buries
/// real traffic. They drop to Verbose unless they fail, so an unhealthy
/// (503) or crashing probe still shows up.
let levelFor (probePath: string) (ctx: HttpContext) (_elapsedMs: float) (error: exn) : LogEventLevel =
    let isProbe = ctx.Request.Path.Equals(PathString probePath)

    if not (isNull error) || ctx.Response.StatusCode >= StatusCodes.Status500InternalServerError then
        LogEventLevel.Error
    elif isProbe then
        LogEventLevel.Verbose
    else
        LogEventLevel.Information
