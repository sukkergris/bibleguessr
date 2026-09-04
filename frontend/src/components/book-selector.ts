import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { VerseRestriction, VerseSource } from '../types'

/**
 * A checkbox grid to pick which books a game draws verses from — the
 * "Books" game type, see docs/SCRUM/Feature.BibleSelector.md. Used
 * standalone (not as a sub-mode of a shared selector — each of the three
 * game types is its own entry point, see mode-select.ts) so its selection
 * can be owned and persisted independently by the parent (bg-app.ts).
 *
 * Uses the translation's own full book name text as-is — the spec calls
 * for "acronyms" for the labels, but this codebase has no
 * book-acronym/abbreviation data anywhere (confirmed absent from the
 * domain model, every parser, and every translation source), so there's no
 * canonical short label to derive one from.
 *
 * Books are listed in Bible order (Genesis..Revelation), not alphabetically
 * — see docs/SCRUM/Feature.BooksGameSorting.md and
 * VerseSource.getBooksInBibleOrder.
 *
 * Fires `restriction-changed` CustomEvent<VerseRestriction | undefined>
 * whenever the selection changes — undefined when nothing is checked, so
 * the parent knows there's not yet a valid selection to start a game with.
 */
@customElement('bg-book-selector')
export class BookSelector extends LitElement {
  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  /** The selection to render as already-checked — lets the parent restore
   * a selection made earlier (e.g. the player left this screen and came
   * back). Only read on connect/when the source changes, not on every
   * update, since after that this component owns the checked state itself
   * and echoes changes back out via restriction-changed. */
  @property({ attribute: false })
  initialSelection?: string[]

  @state()
  private _books: string[] = []

  @state()
  private _loading = false

  @state()
  private _error?: string

  @state()
  private _selectedBooks = new Set<string>()

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('verseSource') || changed.has('translation')) {
      this._selectedBooks = new Set(this.initialSelection ?? [])
      this._error = undefined
      void this._loadBooks()
    }
  }

  private async _loadBooks() {
    if (!this.verseSource) {
      this._books = []
      return
    }

    this._loading = true
    try {
      this._books = await this.verseSource.getBooksInBibleOrder(this.translation)
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load the list of books.'
      this._books = []
    } finally {
      this._loading = false
    }
  }

  render() {
    if (this._loading) {
      return html`<p class="hint">Loading books…</p>`
    }
    if (this._error) {
      return html`<p class="error">${this._error}</p>`
    }
    if (this._books.length === 0) {
      return null
    }

    return html`
      <div class="grid">
        ${this._books.map((book) => {
          const checked = this._selectedBooks.has(book)
          return html`
            <label class="book ${checked ? 'checked' : ''}" title=${book}>
              <input type="checkbox" .checked=${checked} @change=${() => this._toggleBook(book)} />
              <span class="book-name">${book}</span>
            </label>
          `
        })}
      </div>
      <p class="hint">
        ${this._selectedBooks.size === 0
          ? 'No books checked yet — pick at least one to start.'
          : `${this._selectedBooks.size} book${this._selectedBooks.size === 1 ? '' : 's'} selected.`}
      </p>
    `
  }

  private _toggleBook(book: string) {
    const next = new Set(this._selectedBooks)
    if (next.has(book)) next.delete(book)
    else next.add(book)
    this._selectedBooks = next
    this._emitChange()
  }

  private _emitChange() {
    const restriction: VerseRestriction | undefined =
      this._selectedBooks.size === 0 ? undefined : { books: [...this._selectedBooks], chaptersByBook: {} }

    this.dispatchEvent(
      new CustomEvent<VerseRestriction | undefined>('restriction-changed', {
        detail: restriction,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    .hint {
      margin: 0.5rem 0 0;
      font-size: 0.8rem;
      color: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      .hint {
        color: #9ca3af;
      }
    }

    .error {
      margin: 0;
      font-size: 0.85rem;
      color: #d33;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      gap: 0.4rem;
      max-height: 16rem;
      overflow-y: auto;
      padding: 0.6rem;
      border: 1px solid #ccc;
      border-radius: 10px;
    }

    .book {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.5rem;
      border-radius: 8px;
      background: transparent;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .book.checked {
      background: rgba(170, 59, 255, 0.1);
    }

    .book-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-book-selector': BookSelector
  }
}
