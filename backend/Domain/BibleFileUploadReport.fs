namespace BibleGuessr.Domain

open System

/// A player's report of a Bible-file upload or parser failure — see
/// docs/SCRUM/DONE/Feature.ErrorMessageBibleLoader.md. Sent by the frontend
/// when a player hits an upload/parse failure in game-setup.ts and chooses
/// to describe what went wrong; the backend emails it out (see
/// Api/MailSender.fs) rather than storing it anywhere.
///
/// Named for what it actually is rather than the generic "bug report" it
/// used to be called: this flow is tied to a file name and a loader error,
/// and is distinct from GeneralBugReport (a player-reported technical
/// problem) and AbuseReport (another player's behaviour). The three share
/// SMTP configuration and rate limiting but must never share a contract.
type BibleFileUploadReport =
    { /// What the player typed describing the problem — the only field
      /// they actually fill in; everything else is captured automatically
      /// from the failed upload.
      Description: string
      /// The uploaded file's name, if the browser exposed one (it always
      /// should for a real file picker/drop, but this stays optional
      /// rather than assumed).
      FileName: string option
      /// The error message actually shown to the player at the time they
      /// hit "Report this issue" — see game-setup.ts's FileState 'error'
      /// variant. Included so the report is self-contained without
      /// needing the player to describe the symptom themselves.
      ErrorMessage: string
      SubmittedAt: DateTimeOffset }
