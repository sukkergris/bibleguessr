module BibleGuessr.Tests.GeneralBugReportTests

open System
open Xunit
open BibleGuessr.Domain

let private submittedAt = DateTimeOffset(2026, 9, 5, 12, 0, 0, TimeSpan.Zero)

let private validate description context replyTo =
    GeneralBugReport.validate description context replyTo submittedAt

[<Fact>]
let ``a report with a description is accepted`` () =
    match validate "The timer froze at 3 seconds." None None with
    | Ok report -> Assert.Equal("The timer froze at 3 seconds.", report.Description)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

[<Fact>]
let ``an empty description is refused`` () =
    Assert.Equal(Error DescriptionMissing, validate "" None None)

[<Fact>]
let ``a whitespace-only description is refused`` () =
    Assert.Equal(Error DescriptionMissing, validate "   \t  " None None)

[<Fact>]
let ``a null description is refused rather than throwing`` () =
    Assert.Equal(Error DescriptionMissing, validate null None None)

[<Fact>]
let ``surrounding whitespace is trimmed`` () =
    match validate "  it froze  " (Some "  the results screen  ") None with
    | Ok report ->
        Assert.Equal("it froze", report.Description)
        Assert.Equal(Some "the results screen", report.Context)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

[<Fact>]
let ``blank optional fields are treated as absent`` () =
    match validate "it froze" (Some "  ") (Some "") with
    | Ok report ->
        Assert.True(report.Context.IsNone)
        Assert.True(report.ReplyTo.IsNone)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"

[<Fact>]
let ``an overlong description is refused`` () =
    let tooLong = String('a', GeneralBugReport.maxDescriptionLength + 1)
    Assert.Equal(Error(FieldTooLong("description", GeneralBugReport.maxDescriptionLength)), validate tooLong None None)

[<Fact>]
let ``an overlong context is refused`` () =
    let tooLong = String('b', GeneralBugReport.maxContextLength + 1)
    Assert.Equal(Error(FieldTooLong("context", GeneralBugReport.maxContextLength)), validate "it froze" (Some tooLong) None)

[<Fact>]
let ``an overlong reply address is refused`` () =
    let tooLong = String('c', GeneralBugReport.maxReplyToLength + 1)
    Assert.Equal(Error(FieldTooLong("replyTo", GeneralBugReport.maxReplyToLength)), validate "it froze" None (Some tooLong))

// Trimming happens before the length check, so padding cannot push an
// otherwise acceptable report over the limit.
[<Fact>]
let ``whitespace is trimmed before the length limit applies`` () =
    let padded = "   " + String('a', GeneralBugReport.maxDescriptionLength) + "   "
    match validate padded None None with
    | Ok report -> Assert.Equal(GeneralBugReport.maxDescriptionLength, report.Description.Length)
    | Error rejection -> failwith $"expected acceptance, got %A{rejection}"
