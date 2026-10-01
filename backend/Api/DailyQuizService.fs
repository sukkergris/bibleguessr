/// Creates each UTC day's quiz — see docs/web/daily-quiz. A background job
/// makes it at 00:00 UTC (and at startup); if that ever didn't happen — the
/// server was down at midnight, say — the first request for the day makes
/// it instead. Either way a day gets exactly one quiz: storing it is
/// refused once that day has one (see DailyQuizStore.tryAdd).
module BibleGuessr.Api.DailyQuizService

open System
open System.Threading
open System.Threading.Tasks
open Microsoft.Extensions.Hosting
open Microsoft.Extensions.Logging
open BibleGuessr.Domain

type Settings =
    { /// How many verses a quiz has.
      VerseCount: int }

/// The quiz for `date`, creating it from `verses` if that day has none
/// yet. None only when there are no verses to make one from. `nextIndex`
/// supplies the randomness — see DailyQuiz.pick.
let getOrCreate
    (connectionString: string)
    (settings: Settings)
    (verses: Verse list)
    (nextIndex: int -> int)
    (now: DateTimeOffset)
    (date: DateOnly)
    : DailyQuiz option =
    match DailyQuizStore.tryGet connectionString date with
    | Some quiz -> Some quiz
    | None ->
        match DailyQuiz.pick nextIndex settings.VerseCount verses with
        | [] -> None
        | picked ->
            // If another caller stored this day's quiz in the meantime,
            // ours is refused and theirs is the one everyone gets.
            DailyQuizStore.tryAdd connectionString now { Date = date; Verses = picked } |> ignore
            DailyQuizStore.tryGet connectionString date

/// Today's quiz (UTC), creating it if needed.
let today (connectionString: string) (settings: Settings) (verses: Verse list) (timeProvider: TimeProvider) =
    let now = timeProvider.GetUtcNow()
    getOrCreate connectionString settings verses Random.Shared.Next now (DailyQuiz.dateOf now)

/// Makes the day's quiz at startup and then at every 00:00 UTC.
type DailyQuizScheduler
    (
        database: Database.Settings,
        settings: Settings,
        verses: Verse list,
        timeProvider: TimeProvider,
        logger: ILogger<DailyQuizScheduler>
    ) =
    inherit BackgroundService()

    let connectionString = Database.connectionString database

    let ensureToday () =
        // Guarded: a failure (a locked or full disk, say) must only cost
        // this attempt. Unguarded it would end ExecuteAsync and no quiz
        // would ever be made ahead of time again — the request-time
        // fallback would still cover it, but late.
        try
            match today connectionString settings verses timeProvider with
            | Some quiz -> logger.LogInformation("Daily quiz ready for {Date}", quiz.Date)
            | None -> logger.LogWarning("No verses loaded; no daily quiz could be made")
        with ex ->
            logger.LogError(ex, "Failed to make the daily quiz")

    override _.ExecuteAsync(stoppingToken: CancellationToken) : Task =
        task {
            ensureToday ()

            while not stoppingToken.IsCancellationRequested do
                let now = timeProvider.GetUtcNow()
                let untilMidnight = DailyQuiz.nextMidnightUtc now - now

                try
                    do! Task.Delay(untilMidnight, timeProvider, stoppingToken)
                    ensureToday ()
                with :? OperationCanceledException ->
                    ()
        }
