import type { VerseReference } from '../types'

/** One book's famous verses, as the nerd panel lists them. */
export interface BookGroup {
  book: string
  /** "chapter:verse", in the order the server sent them. */
  references: string[]
}

/** The nerd panel's famous-verses list. Loaded the first time it's
 * opened, and again on the next opening if that failed. */
export type FamousVersesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; count: number; books: BookGroup[] }
  | { kind: 'failed'; reason: string }

/** Groups `references` by book, keeping their order — the server sends
 * them in Bible order. Grouped by book number, not name, as everywhere a
 * book's identity matters (see shared-kernel/book-numbers.ts). */
export function groupByBook(references: VerseReference[]): BookGroup[] {
  const groups: (BookGroup & { bookNumber: number })[] = []
  for (const reference of references) {
    const last = groups.at(-1)
    const text = `${reference.chapter}:${reference.verseNumber}`
    if (last && last.bookNumber === reference.bookNumber) last.references.push(text)
    else groups.push({ bookNumber: reference.bookNumber, book: reference.book, references: [text] })
  }
  return groups.map(({ book, references }) => ({ book, references }))
}

/** Whether opening the list should (re)load it. */
export function needsLoading(state: FamousVersesState): boolean {
  return state.kind === 'idle' || state.kind === 'failed'
}
