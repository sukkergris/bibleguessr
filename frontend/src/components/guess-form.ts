import { LitElement, css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { api } from '../api'
import type { Guess, VerseSource } from '../types'

type ComboField = 'book' | 'chapter' | 'verseNumber'

/**
 * Fires a `guess-submitted` CustomEvent<Guess> when the player submits.
 *
 * The book, chapter, and verse fields each show a filtered suggestion list
 * as the player types — chapter suggestions are scoped to whichever book is
 * currently entered, and verse-number suggestions to the entered book +
 * chapter, so they only ever offer numbers that actually exist there. A
 * native <input list>/<datalist> pair was tried first, but `list=` lookups
 * don't reliably cross into a Lit component's shadow DOM across browsers,
 * so suggestions are rendered manually instead.
 */
@customElement('bg-guess-form')
export class GuessForm extends LitElement {
  @property({ type: Boolean })
  disabled = false

  // The translation of the verse currently being guessed. Determines which
  // book spellings are offered — see api.ts's getBooks for why this matters.
  @property({ type: String })
  translation?: string

  // Where the book/chapter/verse-number lists are loaded from: the backend
  // (default) or a Bible file the player parsed client-side — see local-verses.ts.
  @property({ attribute: false })
  verseSource: VerseSource = api

  // When set (Books-mode games — see bg-app.ts's _allowedBooksForGuessForm),
  // the Book field becomes a closed <select> restricted to exactly this
  // list instead of the usual free-text autocomplete over every book in
  // the translation — a Books-mode player shouldn't be able to type or
  // pick a book they explicitly excluded at setup. Undefined (the default,
  // for "The Bible"/"Chapters" games and multiplayer) keeps today's
  // free-text behavior, suggesting from the full book list.
  @property({ attribute: false })
  allowedBooks?: string[]

  // When set (Chapters-mode games — see bg-app.ts's _lockedBookForGuessForm),
  // the player already committed to this one book at setup, so the Book
  // field is shown as fixed, read-only text instead of any kind of input —
  // there's nothing to choose, since a Chapters-mode game only ever draws
  // verses from this single book.
  @property({ type: String })
  lockedBook?: string

  @state()
  private book = ''

  @state()
  private chapter = ''

  @state()
  private verseNumber = ''

  @state()
  private books: string[] = []

  @state()
  private chapters: number[] = []

  @state()
  private verseNumbers: number[] = []

  @state()
  private openField: ComboField | undefined

  @state()
  private activeSuggestion = -1

  // Matches whichever Book field is actually rendered — the free-text
  // combobox input, or (Books-mode games) the <select> dropdown. Not
  // present at all in Chapters-mode games (lockedBook set) — see
  // updated()'s focus logic, which falls back to chapterField then.
  @query('input[name="bg-book-guess-no-autofill"], .combo-field select')
  private bookField?: HTMLInputElement | HTMLSelectElement

  @query('input[name="bg-chapter-guess"]')
  private chapterField?: HTMLInputElement

  connectedCallback() {
    super.connectedCallback()
    if (this.lockedBook) {
      this._lockToBook(this.lockedBook)
    } else {
      this._loadBooks()
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('lockedBook') && this.lockedBook) {
      this._lockToBook(this.lockedBook)
    } else if (changedProperties.has('translation') || changedProperties.has('verseSource')) {
      this._loadBooks()
    }

    // A new question is ready as soon as the form goes from disabled (still
    // loading the verse) to enabled — put focus on whichever field is
    // actually interactive first: Chapter when the book is locked (nothing
    // to do on the read-only Book field), Book otherwise.
    if (changedProperties.has('disabled') && changedProperties.get('disabled') === true && !this.disabled) {
      if (this.lockedBook) {
        this.chapterField?.focus()
      } else {
        this.bookField?.focus()
      }
    }
  }

  // Fixes `this.book` to the one book a Chapters-mode game committed to at
  // setup, and loads its chapters immediately — there's no user
  // interaction to trigger that load the way picking a book normally does.
  private _lockToBook(book: string) {
    if (this.book === book) return
    this.book = book
    this.chapter = ''
    this.verseNumber = ''
    this.verseNumbers = []
    this._loadChapters(book)
  }

  private _loadBooks() {
    this.verseSource
      .getBooks(this.translation)
      .then((books) => (this.books = books))
      .catch((error) => console.error('[guess-form] failed to load book list', error))
  }

  private _loadChapters(book: string) {
    if (!book.trim()) {
      this.chapters = []
      return
    }
    this.verseSource
      .getChapters(book.trim(), this.translation)
      .then((chapters) => (this.chapters = chapters))
      .catch((error) => console.error('[guess-form] failed to load chapter list', error))
  }

  private _loadVerseNumbers(book: string, chapter: string) {
    const chapterNum = chapter ? Number(chapter) : undefined
    if (!book.trim() || !chapterNum) {
      this.verseNumbers = []
      return
    }
    this.verseSource
      .getVerseNumbers(book.trim(), chapterNum, this.translation)
      .then((verseNumbers) => (this.verseNumbers = verseNumbers))
      .catch((error) => console.error('[guess-form] failed to load verse-number list', error))
  }

  private get bookSuggestions(): string[] {
    const query = this.book.trim().toLowerCase()
    if (!query) return []
    return this.books.filter((book) => book.toLowerCase().includes(query)).slice(0, 8)
  }

  private get chapterSuggestions(): string[] {
    const query = this.chapter.trim()
    const candidates = this.chapters.map(String)
    if (!query) return candidates.slice(0, 8)
    return candidates.filter((chapter) => chapter.startsWith(query)).slice(0, 8)
  }

  private get verseNumberSuggestions(): string[] {
    const query = this.verseNumber.trim()
    const candidates = this.verseNumbers.map(String)
    if (!query) return candidates.slice(0, 8)
    return candidates.filter((verseNumber) => verseNumber.startsWith(query)).slice(0, 8)
  }

  private _suggestionsFor(field: ComboField): string[] {
    switch (field) {
      case 'book':
        return this.bookSuggestions
      case 'chapter':
        return this.chapterSuggestions
      case 'verseNumber':
        return this.verseNumberSuggestions
    }
  }

  render() {
    const showBookSuggestions = this.openField === 'book' && this.bookSuggestions.length > 0
    const showChapterSuggestions = this.openField === 'chapter' && this.chapterSuggestions.length > 0
    const showVerseNumberSuggestions = this.openField === 'verseNumber' && this.verseNumberSuggestions.length > 0

    return html`
      <form @submit=${this._onSubmit}>
        ${this.lockedBook
          ? this._renderLockedBook(this.lockedBook)
          : this.allowedBooks
            ? this._renderBookDropdown(this.allowedBooks)
            : this._renderBookCombobox(showBookSuggestions)}
        <label class="combo-field">
          Chapter (optional)
          <div class="combobox">
            <input
              type="number"
              name="bg-chapter-guess"
              min="1"
              role="combobox"
              aria-expanded=${showChapterSuggestions}
              aria-autocomplete="list"
              autocomplete="off"
              .value=${this.chapter}
              @input=${this._onChapterInput}
              @focus=${() => (this.openField = 'chapter')}
              @keydown=${(e: KeyboardEvent) => this._onComboKeydown(e, 'chapter')}
              @blur=${this._onComboBlur}
              ?disabled=${this.disabled}
            />
            ${showChapterSuggestions
              ? this._renderSuggestions(this.chapterSuggestions, (chapter) => this._selectChapter(chapter))
              : null}
          </div>
        </label>
        <label class="combo-field">
          Verse (optional)
          <div class="combobox">
            <input
              type="number"
              min="1"
              role="combobox"
              aria-expanded=${showVerseNumberSuggestions}
              aria-autocomplete="list"
              autocomplete="off"
              .value=${this.verseNumber}
              @input=${this._onVerseNumberInput}
              @focus=${() => (this.openField = 'verseNumber')}
              @keydown=${(e: KeyboardEvent) => this._onComboKeydown(e, 'verseNumber')}
              @blur=${this._onComboBlur}
              ?disabled=${this.disabled}
            />
            ${showVerseNumberSuggestions
              ? this._renderSuggestions(this.verseNumberSuggestions, (verseNumber) =>
                  this._selectVerseNumber(verseNumber),
                )
              : null}
          </div>
        </label>
        <button type="submit" ?disabled=${this.disabled}>Guess</button>
      </form>
    `
  }

  // Chapters-mode games only — the book was already chosen at setup (the
  // whole point of that game type), so it's shown as fixed, read-only
  // text rather than any kind of editable field: nothing to pick, nothing
  // to type over. A hidden input still carries the value into the form
  // submission the same way the other Book fields do.
  private _renderLockedBook(lockedBook: string) {
    return html`
      <label class="combo-field">
        Book
        <div class="locked-book" title="Already chosen for this game — see the setup screen">${lockedBook}</div>
        <input type="hidden" .value=${lockedBook} />
      </label>
    `
  }

  // Books-mode games only — a closed dropdown of exactly the selected
  // books, so it's impossible to submit anything but one of them (unlike
  // the free-text combobox below, which accepts arbitrary typed text).
  private _renderBookDropdown(allowedBooks: string[]) {
    return html`
      <label class="combo-field">
        Book
        <select
          .value=${this.book}
          @change=${(e: Event) => this._selectBook((e.target as HTMLSelectElement).value)}
          @keydown=${this._onBookSelectKeydown}
          ?disabled=${this.disabled}
          required
        >
          <option value="" disabled ?selected=${!this.book}>Choose a book…</option>
          ${allowedBooks.map((book) => html`<option value=${book}>${book}</option>`)}
        </select>
      </label>
    `
  }

  private _renderBookCombobox(showBookSuggestions: boolean) {
    return html`
      <label class="combo-field">
        Book
        <div class="combobox">
          <input
            type="text"
            name="bg-book-guess-no-autofill"
            placeholder="e.g. Salme"
            role="combobox"
            aria-expanded=${showBookSuggestions}
            aria-autocomplete="list"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            .value=${this.book}
            @input=${this._onBookInput}
            @focus=${() => (this.openField = 'book')}
            @keydown=${(e: KeyboardEvent) => this._onComboKeydown(e, 'book')}
            @blur=${this._onComboBlur}
            ?disabled=${this.disabled}
            required
          />
          ${showBookSuggestions ? this._renderSuggestions(this.bookSuggestions, (book) => this._selectBook(book)) : null}
        </div>
      </label>
    `
  }

  private _renderSuggestions(suggestions: string[], onSelect: (value: string) => void) {
    return html`
      <ul class="suggestions" role="listbox">
        ${suggestions.map(
          (value, i) => html`
            <li
              role="option"
              aria-selected=${i === this.activeSuggestion}
              class=${i === this.activeSuggestion ? 'active' : ''}
              @mousedown=${(e: Event) => {
                e.preventDefault()
                onSelect(value)
              }}
            >
              ${value}
            </li>
          `,
        )}
      </ul>
    `
  }

  private _onBookInput(e: Event) {
    this.book = (e.target as HTMLInputElement).value
    this.openField = 'book'
    this.activeSuggestion = -1
    // The chapter (and, transitively, verse-number) suggestions depend on
    // the book, and any previously-entered chapter/verse may no longer be
    // valid for the new book.
    this.chapter = ''
    this.verseNumber = ''
    this.verseNumbers = []
    this._loadChapters(this.book)
  }

  private _onChapterInput(e: Event) {
    this.chapter = (e.target as HTMLInputElement).value
    this.openField = 'chapter'
    this.activeSuggestion = -1
    // The verse-number field's suggestions depend on the chapter, and any
    // previously-entered verse number may no longer be valid for it.
    this.verseNumber = ''
    this._loadVerseNumbers(this.book, this.chapter)
  }

  private _onVerseNumberInput(e: Event) {
    this.verseNumber = (e.target as HTMLInputElement).value
    this.openField = 'verseNumber'
    this.activeSuggestion = -1
  }

  private _onComboKeydown(e: KeyboardEvent, field: ComboField) {
    const suggestions = this._suggestionsFor(field)
    if (this.openField !== field || suggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        this.activeSuggestion = (this.activeSuggestion + 1) % suggestions.length
        break
      case 'ArrowUp':
        e.preventDefault()
        this.activeSuggestion = (this.activeSuggestion - 1 + suggestions.length) % suggestions.length
        break
      case 'Enter':
        if (this.activeSuggestion >= 0) {
          e.preventDefault()
          this._selectForField(field, suggestions[this.activeSuggestion])
        }
        break
      case 'Tab':
        // Let focus move on to the next field as normal — just also commit
        // the highlighted suggestion first, the way Enter does.
        if (this.activeSuggestion >= 0) {
          this._selectForField(field, suggestions[this.activeSuggestion])
        }
        break
      case 'Escape':
        this.openField = undefined
        break
    }
  }

  private _selectForField(field: ComboField, value: string) {
    switch (field) {
      case 'book':
        this._selectBook(value)
        break
      case 'chapter':
        this._selectChapter(value)
        break
      case 'verseNumber':
        this._selectVerseNumber(value)
        break
    }
  }

  private _onComboBlur() {
    // Delay so a click on a suggestion (mousedown) still registers before
    // the list disappears.
    setTimeout(() => (this.openField = undefined), 100)
  }

  private _selectBook(book: string) {
    this.book = book
    this.chapter = ''
    this.verseNumber = ''
    this.verseNumbers = []
    this.openField = undefined
    this.activeSuggestion = -1
    this._loadChapters(book)
  }

  private _selectChapter(chapter: string) {
    this.chapter = chapter
    this.verseNumber = ''
    this.openField = undefined
    this.activeSuggestion = -1
    this._loadVerseNumbers(this.book, chapter)
  }

  private _selectVerseNumber(verseNumber: string) {
    this.verseNumber = verseNumber
    this.openField = undefined
    this.activeSuggestion = -1
  }

  // Unlike a text <input>, a focused native <select> doesn't submit its
  // form on Enter — it just confirms the dropdown's own selection. Submit
  // explicitly so Enter behaves the same way here as it does in every
  // other field in this form (and the rest of the app).
  private _onBookSelectKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // Stop this Enter from also bubbling up to bg-app.ts's global keydown
    // listener, which advances to the next round on Enter whenever
    // feedback is showing — without this, requestSubmit() below sets
    // feedback synchronously and then the SAME keydown event, still
    // bubbling, would immediately advance past it again before it's ever
    // visible.
    e.stopPropagation()
    this.renderRoot.querySelector('form')?.requestSubmit()
  }

  private _onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.book.trim()) return

    const guess: Guess = {
      book: this.book.trim(),
      chapter: this.chapter ? Number(this.chapter) : undefined,
      verseNumber: this.verseNumber ? Number(this.verseNumber) : undefined,
    }

    this.dispatchEvent(
      new CustomEvent<Guess>('guess-submitted', {
        detail: guess,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: flex-end;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.9rem;
    }

    .combo-field {
      position: relative;
    }

    .combobox {
      position: relative;
    }

    input,
    select {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }

    .locked-book {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      background: rgba(170, 59, 255, 0.08);
      font-size: 1rem;
      color: inherit;
    }

    .suggestions {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 10;
      margin: 0;
      padding: 0.25rem;
      list-style: none;
      background: white;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      max-height: 12rem;
      overflow-y: auto;
    }

    .suggestions li {
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.95rem;
    }

    .suggestions li.active,
    .suggestions li:hover {
      background: #aa3bff;
      color: white;
    }

    button {
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-guess-form': GuessForm
  }
}
