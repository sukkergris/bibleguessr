# Bug: Missing Spaces in the Bundled bibelen-dk Text

Split out of `docs/SCRUM/DONE/Bug.VerseTextMissingSpaces.md` (its cause 2) on
2026-10-07. That bug's main cause, the client-side parsers dropping line and
paragraph breaks, is fixed. This one is about the server translation's own
text.

## What's wrong

The server translation's loader (`backend/Api/BibelenDkLoader.fs`) is not at
fault. Its `<pre>` blocks have no paragraph markup inside verses, and newlines
already become spaces. But the source text itself has spaces missing in a few
hundred places. The same typos are in the original archive
(`bibles/bibelen-dk/archive/Bibelen hela.txt`), so they come from the
digitization, not from our processing:

- Genesis 1:26: `alt Kryb,der kryber` (the same phrase is spelled
  `Kryb, der` elsewhere)
- Genesis 4:1: `Eva,og hun blev`
- First Kings 5:6: `dineFolk den Løn`
- Second Kings 5:5: `etBrevmed` (should be `et Brev med`)

A heuristic scan found about 200 "punctuation directly followed by a letter"
cases in 194 verses and about 40 "lowercase directly followed by uppercase"
cases in 37 verses. A few of these may be other typos (e.g. `IsraeLs`) rather
than missing spaces.

## Decision: split, not fixed with the parser bug

Recorded 2026-10-07, when the parser fix shipped:

- Fixing this changes the bundled text itself. The parser fix only changes
  how uploaded files are read. They are different kinds of change and are
  reviewed differently.
- The heuristic is not exact. Each case needs a human check against the
  printed text: a comma followed by a letter can be a missing space, but some
  hits are other typos or deliberate spellings.
- The text is a public-domain 1931/1907 edition. Any correction should be
  traceable, so the result is still faithful to that edition.

## Options still open

1. **Correct the source data.** Fix each confirmed case in the bundled data,
   keeping a list of corrections (reference, before, after) so they can be
   reviewed and reapplied if the data is ever regenerated from the archive.
2. **Narrow normalization in the loader.** For example, insert a space after
   `,` or `;` when a letter follows directly. This is smaller, but it can
   change text that was correct, and it won't catch cases like `dineFolk`
   without a riskier rule.

Option 1 is the safer one for a Bible text. Option 2 should only be chosen
with a test that runs it over the whole text and lists every verse it
changes, so the changes can be reviewed.

## Acceptance criteria

- [ ] An option is chosen and recorded here.
- [ ] The four examples above show a space where one is missing.
- [ ] No verse gets a new space before punctuation, and no correctly spelled
      text is changed.
- [ ] Backend `BackendRevision` is incremented when the fix ships, if the
      backend changes.
