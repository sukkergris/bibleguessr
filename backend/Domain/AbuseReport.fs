namespace BibleGuessr.Domain

open System

/// A player's report of abusive, harassing or otherwise unsafe behaviour by
/// another player — see docs/SCRUM/Feature.ReportAbuse.md. Emailed to the
/// application owner (see Api/MailSender.fs) rather than stored anywhere,
/// same handling as BibleFileUploadReport.
///
/// Deliberately its own type rather than a reuse of BibleFileUploadReport: that one
/// describes a failed Bible-file upload and captures the file name and the
/// error text automatically, none of which is meaningful here. The two
/// contracts are kept separate so neither drifts to accommodate the other.
///
/// Every field is untrusted player input and must be treated as such
/// wherever it is rendered — see MailSender's HTML encoding.
type AbuseReport =
    { /// What happened and why the reporter considers it abusive or
      /// unsafe. The only required field.
      Description: string
      /// The reported player's visible name, or other non-sensitive
      /// context identifying who is being reported. Optional: a reporter
      /// may not know or remember it.
      ReportedPlayer: string option
      /// Where the reporter would like a reply, if they want one. Optional,
      /// and never used as the sender address of the resulting email — see
      /// SmtpSettings.From.
      ReplyTo: string option
      SubmittedAt: DateTimeOffset }

/// Why a submitted abuse report was refused. A named case per rule rather
/// than a bare string so the API layer decides the wording and status code,
/// and so every rule is visible in one place.
type AbuseReportRejection =
    /// The description was empty, or nothing but whitespace.
    | DescriptionMissing
    /// A field exceeded the maximum length accepted at the API boundary.
    | FieldTooLong of field: string * maxLength: int

module AbuseReport =
    /// Maximum accepted lengths, enforced at the API boundary so an
    /// oversized request is rejected before any mail is attempted (see
    /// docs/SCRUM/Feature.ReportAbuse.md). Generous enough for a genuine
    /// account of what happened, bounded enough that the endpoint can't be
    /// used to push arbitrary volumes of text through the mail relay.
    let maxDescriptionLength = 5000
    let maxReportedPlayerLength = 200
    let maxReplyToLength = 320

    /// Normalises optional free text: trims it, and treats blank as absent
    /// so an empty box and an untouched box are the same thing.
    let private normaliseOptional (value: string option) =
        value
        |> Option.map (fun v -> v.Trim())
        |> Option.filter (fun v -> v <> "")

    /// Validates and normalises a submitted report, returning either the
    /// report to send or the reason it was refused.
    ///
    /// Trimming happens BEFORE the empty check, so a description of only
    /// spaces is refused rather than sent as blank; and before the length
    /// checks, so surrounding whitespace can't push an otherwise
    /// acceptable report over the limit.
    let validate
        (description: string)
        (reportedPlayer: string option)
        (replyTo: string option)
        (submittedAt: DateTimeOffset)
        : Result<AbuseReport, AbuseReportRejection> =
        let description = if isNull description then "" else description.Trim()
        let reportedPlayer = normaliseOptional reportedPlayer
        let replyTo = normaliseOptional replyTo

        let tooLong (field: string) (maxLength: int) (value: string option) =
            value |> Option.exists (fun v -> v.Length > maxLength) |> function
                | true -> Some(FieldTooLong(field, maxLength))
                | false -> None

        if description = "" then
            Error DescriptionMissing
        elif description.Length > maxDescriptionLength then
            Error(FieldTooLong("description", maxDescriptionLength))
        else
            match tooLong "reportedPlayer" maxReportedPlayerLength reportedPlayer with
            | Some rejection -> Error rejection
            | None ->
                match tooLong "replyTo" maxReplyToLength replyTo with
                | Some rejection -> Error rejection
                | None ->
                    Ok
                        { Description = description
                          ReportedPlayer = reportedPlayer
                          ReplyTo = replyTo
                          SubmittedAt = submittedAt }
