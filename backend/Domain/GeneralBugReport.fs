namespace BibleGuessr.Domain

open System

/// A player's report of a technical problem — see
/// docs/SCRUM/TODO/Feature.BugReport.md. Emailed to the application owner
/// rather than stored anywhere, same handling as the other report types.
///
/// Deliberately its own type, distinct from both siblings: BugReport
/// describes a failed Bible-file upload and captures the file name and
/// loader error automatically, and AbuseReport is about another player's
/// behaviour. A general bug is neither, and the spec is explicit that it
/// must not be routed through the abuse flow.
///
/// Nothing here is captured automatically. A report can only ever contain
/// what the player typed, so it can never carry verse text, chat history
/// or a game transcript without them writing it themselves.
type GeneralBugReport =
    { /// What the player expected and what actually happened. Required.
      Description: string
      /// Where they were or what they had already tried. Optional.
      Context: string option
      /// Where to reply, if they want one. Optional, and never used as the
      /// sender address of the resulting email.
      ReplyTo: string option
      SubmittedAt: DateTimeOffset }

module GeneralBugReport =
    /// Maximum accepted lengths, enforced at the API boundary so an
    /// oversized request is rejected before any mail is attempted.
    let maxDescriptionLength = 5000
    let maxContextLength = 2000
    let maxReplyToLength = 320

    let private normaliseOptional (value: string option) =
        value
        |> Option.map (fun v -> v.Trim())
        |> Option.filter (fun v -> v <> "")

    /// Validates and normalises a submitted report. Shares
    /// AbuseReportRejection rather than duplicating an identical union —
    /// the reasons a report is refused are the same, only the fields
    /// differ.
    let validate
        (description: string)
        (context: string option)
        (replyTo: string option)
        (submittedAt: DateTimeOffset)
        : Result<GeneralBugReport, AbuseReportRejection> =
        let description = if isNull description then "" else description.Trim()
        let context = normaliseOptional context
        let replyTo = normaliseOptional replyTo

        let tooLong (field: string) (maxLength: int) (value: string option) =
            if value |> Option.exists (fun v -> v.Length > maxLength) then
                Some(FieldTooLong(field, maxLength))
            else
                None

        if description = "" then
            Error DescriptionMissing
        elif description.Length > maxDescriptionLength then
            Error(FieldTooLong("description", maxDescriptionLength))
        else
            match tooLong "context" maxContextLength context with
            | Some rejection -> Error rejection
            | None ->
                match tooLong "replyTo" maxReplyToLength replyTo with
                | Some rejection -> Error rejection
                | None ->
                    Ok
                        { Description = description
                          Context = context
                          ReplyTo = replyTo
                          SubmittedAt = submittedAt }
