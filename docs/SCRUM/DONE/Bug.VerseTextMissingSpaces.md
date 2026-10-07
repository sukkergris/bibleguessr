# Bug: Words Run Together in Displayed Verse Text

Some verses are displayed with two words glued together where there should be
a space between them, e.g. `first lineSecond line` or `end of line,next`. The verse
card renders `verse.text` exactly as stored (`src/shared-ui/verse-card.ts`), so
the space is already missing when the verse is parsed.

There are two separate causes. The first is a parser bug that affects about one
verse in five in every uploaded Bible file. The second is a few hundred typos in
the bundled server text.

## Cause 1: Uploaded files lose line and paragraph breaks (main cause)

Poetry, and verses that span several paragraphs, are split over several
paragraphs in the source file. Both client-side parsers remove the paragraph
markup without putting anything in its place, so the last word of one line is
joined to the first word of the next.

### EPUB (`frontend/src/bible-sources/epub-parser.ts`)

`stripTags` replaces every tag with an empty string. A verse split over
several `<p>` elements looks like this (text replaced with placeholders):

```html
<span id="chapter2_verse23"></span><strong><sup>23</sup></strong> Intro:</p>
<p class="p21 sz">"First line</p><p class="p21 sz">Second line.</p>
```

Between two lines on the same source row there is no whitespace at all
(`</p><p …>`), so the result is `"First lineSecond line.`. When the lines are
on separate source rows, the newline happens to survive as a space, which is
why the bug only shows up some of the time.

### RTF (`frontend/src/bible-sources/rtf-parser.ts`)

`stripControlWords` removes `\par` the same way. A paragraph break inside a
verse looks like:

```rtf
…\f2\cf11 end of first paragraph.\par}{\rtlch…\f2\cf11 Next paragraph…
```

The single space after `\cf11` is consumed as part of the control word's own
syntax (correctly), and nothing replaces `\par`, so the text becomes
`paragraph.Next`.

### How much is affected

Measured against the local test files in `docs/jw.org/` (local only, not in
git) by comparing the current parser output with a version that turns
paragraph and line breaks into a space:

| File                    | Verses | Verses with glued words |
| ----------------------- | -----: | ----------------------: |
| Danish EPUB             | 31,078 |           6,331 (20.4%) |
| English EPUB            | 31,078 |           6,285 (20.2%) |
| Ukrainian EPUB          | 31,078 |           6,323 (20.3%) |
| Danish RTF (zip export) | 31,077 |           7,582 (24.4%) |

Example references (no verse text is quoted here, for licensing reasons):
Genesis 2:23, 4:23, 14:19, 14:20.

In English, poetic lines start with a capital letter, so the joins are easy to
spot (`lowercaseUppercase`). In Danish, a new line usually starts in lowercase,
so many joins read as one long word that isn't real (`ordog`). That makes the
bug easy to miss when testing with Danish files.

## Cause 2: Typos in the bundled server text (bibelen-dk)

The bundled server text has spaces missing in a few hundred places (e.g.
`etBrevmed` in Second Kings 5:5). The typos come from the digitization, not
from our processing. Split into its own bug, with the decision recorded:
`docs/SCRUM/BUGS/Bug.BibelenDkSourceTypos.md`.

## Expected behavior

- A line or paragraph break inside a verse is shown as exactly one space.
- Inline markup (`<span>`, `<strong>`, `<em>`, footnote markers, RTF character
  formatting) still adds no space. A word with inline formatting in the middle
  must stay one word, and no space may appear before punctuation.
- Verses parsed by the old parser are not reused from the browser cache.

## Possible fix (cause 1)

- EPUB: before `stripTags`, replace block-level boundaries (`</p>`, `<br>`)
  with a space. Leave inline tags as they are.
- RTF: before stripping control words, replace `\par` and `\line` with a
  space.
- `collapseWhitespace` already folds the extra spaces into one.
- Bump `PARSER_VERSION` in `frontend/src/bible-sources/verse-cache.ts`, as both
  parsers' header comments require. Otherwise players who already uploaded a
  file keep seeing the glued text. The downside is that they have to select
  their file again once after the update.

A trial run of exactly this change on the four files above fixed the verses
counted in the table. It added no new "space before punctuation" cases.

## Regression tests

- `rtf-parser.test.ts`: add a verse whose text contains a paragraph break
  (`\par}{\f2\cf1` plus its delimiter space) between two words, and assert
  that a single space separates them.
- `epub-parser.ts` has no unit tests yet. Add `epub-parser.test.ts` covering
  `parseChapterEntry` with a verse split over two `<p>` elements on the same
  source row. Note that `decodeEntities` uses `document`, and vitest runs in
  the `node` environment (`vitest.config.ts`). The test therefore needs a DOM
  environment for that file, or a small shim.
- Use only synthetic placeholder text in fixtures. Never copy real text from
  an uploaded translation into the repository (see `NOTICE.md`).
- As `CLAUDE.md` requires, confirm that each new test fails against the
  current parser before the fix, and passes after it.

## Resolution

Cause 1 is fixed as proposed above:

- `epub-parser.ts`: `</p>` and `<br>` become a space before the other tags
  are stripped.
- `rtf-parser.ts`: `\par` and `\line` become a space before the other
  control words are stripped. Only whole control words match, so `\pard` (a
  paragraph formatting reset) adds nothing.
- `PARSER_VERSION` is now 2.

Regression tests are in `epub-parser.test.ts` (new, with a small `document`
shim) and `rtf-parser.test.ts`. They use placeholder text only. Both "break
becomes a space" tests in each file failed against the old parsers and pass
now. The "inline markup adds no space" tests pass both before and after, and
guard against overcorrecting.

A check against the four local test files in `docs/jw.org/` (comparing old and
new output, printing only counts) gave exactly the numbers in the table above:
6,331, 6,285, 6,323 and 7,582 verses changed. In every changed verse only
spaces were added, no verse got a new space before punctuation, and verse
counts are unchanged.

Cause 2 is split into `docs/SCRUM/BUGS/Bug.BibelenDkSourceTypos.md`.

## Acceptance criteria

- [x] Verses split over several paragraphs in an EPUB upload show a space
      between the lines.
- [x] Verses split over several paragraphs in an RTF upload show a space
      between the lines.
- [x] Inline markup does not add a space inside words or before punctuation.
- [x] `PARSER_VERSION` is bumped, so old cached parses are not used.
- [x] Regression tests for both parsers fail without the fix and pass with
      it.
- [x] Cause 2 (bibelen-dk source typos) is either fixed or split into its own
      bug with a decision recorded.
- [x] Frontend `revision` is incremented when the fix ships.
