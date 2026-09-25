/// Whether the API has any verses to serve. An API with no verses must not
/// look healthy: every game would be unplayable, yet nothing else fails.
module BibleGuessr.Api.VerseHealth

type VerseHealth =
    | Healthy of count: int
    | NoVerses

let evaluate (versesLoaded: int) : VerseHealth =
    if versesLoaded > 0 then Healthy versesLoaded else NoVerses
