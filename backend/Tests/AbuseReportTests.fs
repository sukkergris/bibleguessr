module BibleGuessr.Tests.AbuseReportTests

open System
open Xunit
open BibleGuessr.Domain

let private submittedAt = DateTimeOffset(2026, 9, 5, 12, 0, 0, TimeSpan.Zero)

let private validate description reportedPlayer replyTo =
    AbuseReport.validate description reportedPlayer replyTo submittedAt

[<Fact>]
let ``a report with a description is accepted`` () =
    match validate "They kept sending abusive messages in chat." None None with
    | Ok report ->
        Assert.Equal("They kept sending abusive messages in chat.", report.Description)
        Assert.Equal(submittedAt, report.SubmittedAt)
    | Error rejection -> failwith $"expected the report to be accepted, got %A{rejection}"

[<Fact>]
let ``an empty description is refused`` () =
    Assert.Equal(Error DescriptionMissing, validate "" None None)

// A description of only spaces looks filled in to the caller but carries
// nothing for whoever reviews the report, so it's refused like an empty
// one rather than sent as blank.
[<Fact>]
let ``a whitespace-only description is refused`` () =
    Assert.Equal(Error DescriptionMissing, validate "    \t\n  " None None)

[<Fact>]
let ``a null description is refused rather than throwing`` () =
    Assert.Equal(Error DescriptionMissing, validate null None None)

[<Fact>]
let ``surrounding whitespace is trimmed from the description`` () =
    match validate "  they harassed me  " None None with
    | Ok report -> Assert.Equal("they harassed me", report.Description)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

// Both optional fields are genuinely optional: an untouched box and a box
// containing only spaces mean the same thing, and neither should show up
// in the report as an empty value.
[<Fact>]
let ``blank optional fields are treated as absent`` () =
    match validate "abusive language" (Some "   ") (Some "") with
    | Ok report ->
        Assert.True(report.ReportedPlayer.IsNone)
        Assert.True(report.ReplyTo.IsNone)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

[<Fact>]
let ``optional fields are trimmed when present`` () =
    match validate "abusive language" (Some "  Bob  ") (Some " bob@example.com ") with
    | Ok report ->
        Assert.Equal(Some "Bob", report.ReportedPlayer)
        Assert.Equal(Some "bob@example.com", report.ReplyTo)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

// Length caps exist so the endpoint can't be used to push arbitrary
// volumes of text through the mail relay — see the spec's abuse-prevention
// section. They're checked at the boundary, before any mail is attempted.
[<Fact>]
let ``an overlong description is refused`` () =
    let tooLong = String('a', AbuseReport.maxDescriptionLength + 1)

    Assert.Equal(Error(FieldTooLong("description", AbuseReport.maxDescriptionLength)), validate tooLong None None)

[<Fact>]
let ``a description exactly at the limit is accepted`` () =
    let atLimit = String('a', AbuseReport.maxDescriptionLength)

    match validate atLimit None None with
    | Ok report -> Assert.Equal(AbuseReport.maxDescriptionLength, report.Description.Length)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

[<Fact>]
let ``an overlong reported-player field is refused`` () =
    let tooLong = String('b', AbuseReport.maxReportedPlayerLength + 1)

    Assert.Equal(
        Error(FieldTooLong("reportedPlayer", AbuseReport.maxReportedPlayerLength)),
        validate "abusive language" (Some tooLong) None
    )

[<Fact>]
let ``an overlong reply-to field is refused`` () =
    let tooLong = String('c', AbuseReport.maxReplyToLength + 1)

    Assert.Equal(
        Error(FieldTooLong("replyTo", AbuseReport.maxReplyToLength)),
        validate "abusive language" None (Some tooLong)
    )

// Trimming happens before the length check, so trailing whitespace can't
// push an otherwise acceptable report over the limit.
[<Fact>]
let ``whitespace is trimmed before the length limit is applied`` () =
    let atLimitWithPadding = "   " + String('a', AbuseReport.maxDescriptionLength) + "   "

    match validate atLimitWithPadding None None with
    | Ok report -> Assert.Equal(AbuseReport.maxDescriptionLength, report.Description.Length)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"
