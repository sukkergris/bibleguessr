/// Sends bug reports (see docs/SCRUM/Feature.ErrorMessageBibleLoader.md) by
/// email via a plain SMTP relay — no third-party mail provider/SDK, just
/// the BCL's System.Net.Mail.SmtpClient, so no new NuGet dependency is
/// needed for this.
module BibleGuessr.Api.MailSender

open System
open System.Net
open System.Net.Mail
open System.Text
open Microsoft.Extensions.Logging
open BibleGuessr.Domain

/// SMTP connection + addressing settings, read from configuration at
/// startup — see Program.fs's `Configuration["Smtp:..."]` reads, which
/// follow the same `Option.ofObj |> Option.defaultValue` idiom as the
/// existing Frontend:Origin/Verses:Directory config values. Local/secret
/// values (host, credentials) belong in appsettings.Development.json
/// (gitignored) rather than the tracked appsettings.json, same convention
/// as any other local-only setting in this project.
type SmtpSettings =
    { Host: string
      Port: int
      EnableSsl: bool
      Username: string
      Password: string
      /// The report email's From address — most SMTP relays require this
      /// to be a real, authorized address for the account, so it's kept
      /// separate from `To` rather than assumed to be the same value.
      From: string
      /// Where reports actually land — the developer's inbox.
      To: string }

/// Builds the report email's HTML body — a simple field/value table,
/// mirroring the shape of the reference implementation this was adapted
/// from (see the "Be inspired by" MailSender.cs shared in chat).
let private buildBody (report: BugReport) : string =
    let escape (s: string) = WebUtility.HtmlEncode(s)
    let submittedAt = report.SubmittedAt.ToString("u")

    let fileNameRow =
        match report.FileName with
        | Some name ->
            $"""
            <tr>
                <td><strong>File name</strong></td>
                <td>{escape name}</td>
            </tr>"""
        | None -> ""

    $"""
    <html>
    <body>
        <p>A player reported a problem uploading a Bible file.</p>
        <h3>Report</h3>
        <table border="1" cellpadding="5" style="border-collapse:collapse; width:100%%;">
            <tr>
                <td style="width:140px;"><strong>Submitted</strong></td>
                <td>{submittedAt}</td>
            </tr>{fileNameRow}
            <tr>
                <td><strong>Error shown</strong></td>
                <td>{escape report.ErrorMessage}</td>
            </tr>
            <tr>
                <td><strong>Player's description</strong></td>
                <td>{escape report.Description}</td>
            </tr>
        </table>
    </body>
    </html>
    """

/// Sends `report` by email. Never throws — a failed send is logged and
/// swallowed, same as the reference implementation's SendContactMessage,
/// so one broken SMTP relay can't turn into a 500 for the player (who
/// already hit one error; a second one on top of it, for a report that's
/// purely a courtesy, would be a poor experience). Returns whether the
/// send succeeded, so the endpoint can still tell the player if it didn't
/// go through.
let sendBugReport (settings: SmtpSettings) (logger: ILogger) (report: BugReport) : bool =
    use smtpClient =
        new SmtpClient(settings.Host, settings.Port, EnableSsl = settings.EnableSsl,
                        Credentials = NetworkCredential(settings.Username, settings.Password))

    use message =
        new MailMessage(
            From = MailAddress(settings.From),
            Subject = "BibleGuessr: Bible file upload report",
            IsBodyHtml = true,
            BodyEncoding = Encoding.UTF8,
            SubjectEncoding = Encoding.UTF8,
            Body = buildBody report
        )

    message.To.Add(settings.To)

    try
        smtpClient.Send(message)
        logger.LogInformation("Bug report email sent to {Recipient}", settings.To)
        true
    with ex ->
        logger.LogError(ex, "Failed to send bug report email to {Recipient}", settings.To)
        false
