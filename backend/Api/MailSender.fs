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

/// Builds the abuse-report email's HTML body. Same field/value table shape
/// as buildBody above, but its own function: an abuse report has different
/// fields, and merging the two would mean one body full of conditionals
/// that half apply to each kind of report.
///
/// Every player-supplied value goes through `escape` — these fields are
/// untrusted input (see docs/SCRUM/Feature.ReportAbuse.md), and this body
/// is sent as HTML, so unescaped text would let a reporter inject markup
/// into the reviewer's inbox.
let private buildAbuseBody (report: AbuseReport) : string =
    let escape (s: string) = WebUtility.HtmlEncode(s)
    let submittedAt = report.SubmittedAt.ToString("u")

    let optionalRow (label: string) (value: string option) =
        match value with
        | Some v ->
            $"""
            <tr>
                <td><strong>{escape label}</strong></td>
                <td>{escape v}</td>
            </tr>"""
        | None -> ""

    let reportedPlayerRow = optionalRow "Reported player" report.ReportedPlayer
    let replyToRow = optionalRow "Reporter's reply address" report.ReplyTo

    $"""
    <html>
    <body>
        <p>A player reported abusive or unsafe behaviour.</p>
        <h3>Report</h3>
        <table border="1" cellpadding="5" style="border-collapse:collapse; width:100%%;">
            <tr>
                <td style="width:180px;"><strong>Submitted</strong></td>
                <td>{submittedAt}</td>
            </tr>{reportedPlayerRow}{replyToRow}
            <tr>
                <td><strong>What happened</strong></td>
                <td>{escape report.Description}</td>
            </tr>
        </table>
    </body>
    </html>
    """

/// Sends an abuse report by email. Same never-throws contract as
/// sendBugReport — the endpoint turns a false return into a retryable
/// error for the reporter rather than a 500.
///
/// The reporter's own address is NEVER used as the sender (see
/// docs/SCRUM/Feature.ReportAbuse.md): the From address stays the
/// configured, relay-authorised one, and their address goes on Reply-To
/// instead, which is what actually lets the owner answer them.
let sendAbuseReport (settings: SmtpSettings) (logger: ILogger) (report: AbuseReport) : bool =
    use smtpClient =
        new SmtpClient(settings.Host, settings.Port, EnableSsl = settings.EnableSsl,
                        Credentials = NetworkCredential(settings.Username, settings.Password))

    use message =
        new MailMessage(
            From = MailAddress(settings.From),
            Subject = "BibleGuessr: Abuse report",
            IsBodyHtml = true,
            BodyEncoding = Encoding.UTF8,
            SubjectEncoding = Encoding.UTF8,
            Body = buildAbuseBody report
        )

    message.To.Add(settings.To)

    // Best-effort: a reporter can type anything into the optional reply
    // field, so an unparseable address must not stop the report itself
    // reaching the owner.
    match report.ReplyTo with
    | Some address ->
        try
            message.ReplyToList.Add(MailAddress(address))
        with _ ->
            logger.LogInformation("Abuse report had an unusable reply address; sending without Reply-To")
    | None -> ()

    try
        smtpClient.Send(message)
        // Deliberately logs no report content or contact details — see the
        // spec's "log delivery failures for operators without logging
        // report content" requirement.
        logger.LogInformation("Abuse report email sent to {Recipient}", settings.To)
        true
    with ex ->
        logger.LogError(ex, "Failed to send abuse report email to {Recipient}", settings.To)
        false
