// Domain model behind the guess form's book grid — see
// docs/web/book-picker/index.html. Pure functions only, so the grouping
// rules can be tested without rendering anything.
//
// Book NAMES always come from the selected Bible (the translation or the
// player's own file, via VerseSource.getBooksInBibleOrder) — nothing here
// hardcodes a spelling. Grouping is by book NUMBER (1-based position in that
// Bible-order list, see book-numbers.ts), which is spelling-independent.

export type Testament = 'old' | 'new'

/** Which of the three tile shades a category is drawn in. Decorative only —
 * every category also has a visible text heading, so the shade never
 * carries information on its own (WCAG 1.4.1). */
export type BookTone = 1 | 2 | 3

export interface BookCategoryDefinition {
  id: string
  label: string
  testament: Testament
  /** First and last 1-based book number in the category, inclusive. */
  firstBook: number
  lastBook: number
  tone: BookTone
}

/** The number of books in the canon the category table below describes.
 * A source with any other count (e.g. one including deuterocanonical
 * books) gets an ungrouped grid instead of wrongly-labeled groups. */
export const STANDARD_CANON_BOOK_COUNT = 66

export const TESTAMENT_LABELS: Record<Testament, string> = {
  old: 'Old Testament',
  new: 'New Testament',
}

export const BOOK_CATEGORIES: readonly BookCategoryDefinition[] = [
  { id: 'law', label: 'Law', testament: 'old', firstBook: 1, lastBook: 5, tone: 3 },
  { id: 'history', label: 'History', testament: 'old', firstBook: 6, lastBook: 17, tone: 1 },
  { id: 'poetry', label: 'Poetry & wisdom', testament: 'old', firstBook: 18, lastBook: 22, tone: 2 },
  { id: 'major-prophets', label: 'Major prophets', testament: 'old', firstBook: 23, lastBook: 27, tone: 3 },
  { id: 'minor-prophets', label: 'Minor prophets', testament: 'old', firstBook: 28, lastBook: 39, tone: 1 },
  { id: 'gospels', label: 'Gospels', testament: 'new', firstBook: 40, lastBook: 43, tone: 3 },
  { id: 'acts', label: 'Acts', testament: 'new', firstBook: 44, lastBook: 44, tone: 1 },
  { id: 'pauline-letters', label: "Paul's letters", testament: 'new', firstBook: 45, lastBook: 58, tone: 2 },
  { id: 'general-letters', label: 'General letters', testament: 'new', firstBook: 59, lastBook: 65, tone: 3 },
  { id: 'prophecy', label: 'Prophecy', testament: 'new', firstBook: 66, lastBook: 66, tone: 1 },
]

export interface BookCategoryGroup {
  id: string
  label: string
  tone: BookTone
  books: string[]
}

export interface TestamentGroup {
  testament: Testament
  label: string
  categories: BookCategoryGroup[]
}

/** How the grid should be laid out: grouped by testament and category when
 * the source is a standard 66-book canon, or one flat Bible-order list
 * otherwise. */
export type BookLayout = { kind: 'grouped'; testaments: TestamentGroup[] } | { kind: 'flat'; books: string[] }

/** Lays out `visibleBooks` (a subset of `booksInBibleOrder`, e.g. the books
 * a Books-mode game allows) for the grid. Empty
 * categories and testaments are omitted. */
export function layoutBooks(booksInBibleOrder: string[], visibleBooks: string[]): BookLayout {
  const visible = new Set(visibleBooks.map(normalize))
  const ordered = booksInBibleOrder.filter((book) => visible.has(normalize(book)))
  const allVisibleAreKnown = ordered.length === visible.size

  if (booksInBibleOrder.length !== STANDARD_CANON_BOOK_COUNT || !allVisibleAreKnown) {
    return { kind: 'flat', books: allVisibleAreKnown ? ordered : visibleBooks }
  }

  const testaments: TestamentGroup[] = []
  for (const category of BOOK_CATEGORIES) {
    const books = booksInBibleOrder
      .slice(category.firstBook - 1, category.lastBook)
      .filter((book) => visible.has(normalize(book)))
    if (books.length === 0) continue

    let testament = testaments.find((group) => group.testament === category.testament)
    if (!testament) {
      testament = { testament: category.testament, label: TESTAMENT_LABELS[category.testament], categories: [] }
      testaments.push(testament)
    }
    testament.categories.push({ id: category.id, label: category.label, tone: category.tone, books })
  }
  return { kind: 'grouped', testaments }
}

const IGNORED_CHARACTERS = /[\s.]/g

function normalize(text: string): string {
  return text.replace(IGNORED_CHARACTERS, '').toLowerCase()
}
