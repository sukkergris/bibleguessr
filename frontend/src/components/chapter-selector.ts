import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { VerseRestriction, VerseSource } from '../types'

/** What the player has picked in "Chapters" mode, for restoring a
 * selection made earlier — see bg-app.ts's chapterRestriction state. */
export interface ChapterSelection {
  book: string
  chapters: number[]
}

/**
 * Pick one book, then a checkbox grid of just that book's chapters — the
 * "Chapters" game type, see docs/SCRUM/Feature.BibleSelector.md.
 *
 * Fires `restriction-changed` CustomEvent<VerseRestriction | undefined>
 * whenever the selection changes — undefined until a book is chosen AND at
 * least one of its chapters is checked, so the parent knows there's not
 * yet a valid selection to start a game with.
 */
@customElement('bg-chapter-selector')
export class ChapterSelector extends LitElement {
  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  /** Restores a selection made earlier (e.g. the player left this screen
   * and came back) — read on connect/when the source changes only. */
  @property({ attribute: false })
  initialSelection?: ChapterSelection

  @state()
  private _books: string[] = []

  @state()
  private _loading = false

  @state()
  private _error?: string

  @state()
  private _selectedBook?: string

  @state()
  private _selectedChapters = new Set<number>()

  @state()
  private _chapterOptions: number[] = []

  @state()
  private _loadingChapters = false

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('verseSource') || changed.has('translation')) {
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
      this._books = await this.verseSource.getBooks(this.translation)
      if (this.initialSelection && this._books.includes(this.initialSelection.book)) {
        this._selectBook(this.initialSelection.book, new Set(this.initialSelection.chapters))
      }
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
      <label>
        Book
        <select .value=${this._selectedBook ?? ''} @change=${this._onBookChange}>
          <option value="" disabled>Choose a book…</option>
          ${this._books.map((book) => html`<option value=${book}>${book}</option>`)}
        </select>
      </label>

      ${this._selectedBook
        ? this._loadingChapters
          ? html`<p class="hint">Loading chapters…</p>`
          : html`
              <div class="grid">
                ${this._chapterOptions.map((chapter) => {
                  const checked = this._selectedChapters.has(chapter)
                  return html`
                    <label class="chapter ${checked ? 'checked' : ''}">
                      <input type="checkbox" .checked=${checked} @change=${() => this._toggleChapter(chapter)} />
                      ${chapter}
                    </label>
                  `
                })}
              </div>
              <p class="hint">
                ${this._selectedChapters.size === 0
                  ? 'No chapters checked yet — pick at least one to start.'
                  : `${this._selectedChapters.size} chapter${this._selectedChapters.size === 1 ? '' : 's'} of ${this._selectedBook} selected.`}
              </p>
            `
        : null}
    `
  }

  private _onBookChange = (e: Event) => {
    this._selectBook((e.target as HTMLSelectElement).value, new Set())
  }

  private _selectBook(book: string, preselectedChapters: Set<number>) {
    this._selectedBook = book
    this._selectedChapters = preselectedChapters
    this._chapterOptions = []
    this._emitChange()

    if (!this.verseSource) return
    this._loadingChapters = true
    this.verseSource
      .getChapters(book, this.translation)
      .then((chapters) => {
        this._chapterOptions = chapters
      })
      .catch((err) => console.error('[chapter-selector] failed to load chapters', err))
      .finally(() => {
        this._loadingChapters = false
      })
  }

  private _toggleChapter(chapter: number) {
    const next = new Set(this._selectedChapters)
    if (next.has(chapter)) next.delete(chapter)
    else next.add(chapter)
    this._selectedChapters = next
    this._emitChange()
  }

  private _emitChange() {
    const restriction: VerseRestriction | undefined =
      this._selectedBook && this._selectedChapters.size > 0
        ? {
            books: [this._selectedBook],
            chaptersByBook: { [this._selectedBook]: [...this._selectedChapters].sort((a, b) => a - b) },
          }
        : undefined

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

    label {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.9rem;
      text-align: left;
    }

    select {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
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
      grid-template-columns: repeat(auto-fill, minmax(3.5rem, 1fr));
      gap: 0.4rem;
      max-height: 16rem;
      overflow-y: auto;
      padding: 0.6rem;
      margin-top: 0.75rem;
      border: 1px solid #ccc;
      border-radius: 10px;
    }

    .chapter {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.5rem;
      border-radius: 8px;
      background: transparent;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .chapter.checked {
      background: rgba(170, 59, 255, 0.1);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-chapter-selector': ChapterSelector
  }
}
