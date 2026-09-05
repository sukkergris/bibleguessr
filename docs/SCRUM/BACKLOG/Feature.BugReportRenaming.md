# Rename the Bible-File Error Report Type

The name `BugReport.fs` is too general. This type is specifically used for
reports about broken Bible files, failed uploads, and shortcomings in the
Bible-file parser. General technical bug reports now have their own
`GeneralBugReport` type and must not be conflated with this specialized flow.

Rename the specialized domain file and its public F# symbols to a name that
describes the actual contract. Preferred name:

- File: `BibleFileUploadReport.fs`
- Type: `BibleFileUploadReport`
- Module: `BibleFileUploadReport` or an equally specific project convention

If implementation experience shows that parser failures are broader than
uploads, use `BibleFileParserReport` consistently instead. Choose one name and
apply it everywhere; do not leave `BugReport` as an alias or public duplicate.

## Scope

- Rename the domain source file currently named `BugReport.fs`.
- Rename the contained record type and module references from `BugReport` to
  the selected specific name.
- Update the Domain project compile include and preserve F# compile order.
- Update the API request mapping, `/api/reports` endpoint comments, and mail
  sender functions that handle Bible-file upload/parser reports.
- Update frontend API comments and the specialized `bg-report-error` flow
  documentation where it refers to the old generic name.
- Update tests, XML/documentation comments, and any feature documentation or
  generated references that use `BugReport` for this specialized report.
- Keep `GeneralBugReport` and `AbuseReport` names and contracts unchanged.

## Naming boundaries

- `BibleFileUploadReport` (or the selected equivalent) means a report tied to
  a Bible-file name and parser/loader error.
- `GeneralBugReport` means a player-reported technical problem with the
  application and its general bug-report panel.
- `AbuseReport` means a report about abusive, harassing, or unsafe behavior.
- The three types must remain distinct even if they share SMTP configuration,
  rate limiting, or mail-sending helpers.

## Compatibility and behavior

- Preserve the existing `/api/reports` route and JSON field names unless a
  separate API migration is explicitly approved.
- Preserve the existing Bible-file report email subject, recipient behavior,
  rate limits, validation, sanitization, and retryable frontend errors.
- Do not change the report payload's data-security boundary: only the file
  name, parser error, and user-entered description belong in this flow; never
  upload the Bible file or its verse text.
- Do not rename the general `/api/bug-reports` route or
  `submitGeneralBugReport`, because those belong to `GeneralBugReport`.
- This is a source/API naming refactor, not a behavior change. Any changed
  behavior must be tracked in a separate feature or bug item.

## Acceptance criteria

- No production source file uses the generic `BugReport` symbol for the
  Bible-file upload/parser report after the rename.
- The Domain project builds with the renamed file included in the correct F#
  order.
- The API still accepts the existing Bible-file report request and sends the
  same kind of email through `/api/reports`.
- General bug reports continue to use `GeneralBugReport` and their separate
  endpoint/mail path.
- Abuse reports continue to use `AbuseReport` and their separate endpoint/mail
  path.
- Tests compile and pass after all references are renamed.
- Repository-wide searches confirm that remaining `BugReport` references are
  either historical migration notes or intentionally unrelated text, not the
  specialized domain type.
