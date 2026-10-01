module BibleGuessr.Tests.ReportLoggingConfigTests

// Guards that report emails stay visible in the production log. The base
// appsettings.json raises the whole "BibleGuessr" namespace to Warning, which
// silently swallowed MailSender's Information-level "report email sent"
// lines in production — so an operator could not tell a report had arrived.

open Microsoft.Extensions.Configuration
open Serilog
open Serilog.Core
open Serilog.Events
open Xunit
open BibleGuessr.Tests.TestPaths

let private baseSettingsFile = "appsettings.json"
let private productionSettingsFile = "appsettings.Production.json"

/// Builds a Serilog logger the way Program.fs does in production: the base
/// settings overlaid with the Production environment's file.
let private productionLogger () : ILogger =
    let configuration =
        ConfigurationBuilder()
            .SetBasePath(apiProjectDirectory)
            .AddJsonFile(baseSettingsFile, optional = false)
            .AddJsonFile(productionSettingsFile, optional = false)
            .Build()

    LoggerConfiguration().ReadFrom.Configuration(configuration).CreateLogger()

let private loggerFor (category: string) =
    productionLogger().ForContext(Constants.SourceContextPropertyName, category)

[<Fact>]
let ``report emails are logged at Information in production`` () =
    let logger = loggerFor Program.ReportsLogCategory
    Assert.True(logger.IsEnabled(LogEventLevel.Information))

[<Fact>]
let ``the rest of the BibleGuessr namespace stays at Warning in production`` () =
    let logger = loggerFor Program.StartupLogCategory
    Assert.False(logger.IsEnabled(LogEventLevel.Information))
