import { LitElement, css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { api } from '../api'
import { layoutBooks, type BookCategoryGroup } from '../book-picker'
import type { Guess, VerseSource } from '../types'

type ComboField = 'chapter' | 'verseNumber'

/**
 * Fires a `guess-submitted` CustomEvent<Guess> when the player submits.
 *
 * The book is picked from a grid of tiles grouped by testament and
 * category (see book-picker.ts and docs/web/book-picker) — no typing
 * needed. Tile names always come from the selected Bible via
 * VerseSource.getBooksInBibleOrder.
 *
 * The chapter and verse fields each show a filtered suggestion list as the
 * player types — chapter suggestions are scoped to whichever book is
 * selected, and verse-number suggestions to the book + chapter, so they
 * only ever offer numbers that actually exist there. A
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
  // the book grid shows exactly these books instead of every book in the
  // translation — a Books-mode player shouldn't be able to pick a book
  // they explicitly excluded at setup. Undefined (the default, for "The
  // Bible" games and unrestricted multiplayer) shows the full book list.
  @property({ attribute: false })
  allowedBooks?: string[]

  // When set (Chapters-mode games — see bg-app.ts's _lockedBookForGuessForm),
  // the player already committed to this one book at setup, so the Book
  // field is shown as fixed, read-only text instead of any kind of input —
  // there's nothing to choose, since a Chapters-mode game only ever draws
  // verses from this single book.
  @property({ type: String })
  lockedBook?: string

  // When set (Chapters-mode games — see bg-app.ts's
  // _allowedChaptersForGuessForm), the Chapter field becomes a closed
  // <select> restricted to exactly this list instead of the usual
  // free-text autocomplete over every chapter of the locked book — a
  // Chapters-mode player shouldn't be able to type or pick a chapter they
  // explicitly excluded at setup.
  @property({ attribute: false })
  allowedChapters?: number[]

  @state()
  private book = ''

  @state()
  private chapter = ''

  @state()
  private verseNumber = ''

  // The selected Bible's own book names, in Bible order — the grid's
  // tiles, and what book-picker.ts groups by position.
  @state()
  private booksInBibleOrder: string[] = []

  @state()
  private chapters: number[] = []

  @state()
  private verseNumbers: number[] = []

  @state()
  private openField: ComboField | undefined

  @state()
  private activeSuggestion = -1

  // The book grid's tile to focus for a new question: the selected one if
  // any, otherwise the first — the same tile Tab would land on, so the
  // arrow keys work straight away. Not present at all in Chapters-mode
  // games (lockedBook set) — see updated()'s focus logic, which falls back
  // to chapterField then.
  @query('input[name="bg-book-guess"]:checked')
  private checkedBookTile?: HTMLInputElement

  @query('input[name="bg-book-guess"]')
  private firstBookTile?: HTMLInputElement

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
        const bookTile = this.checkedBookTile ?? this.firstBookTile
        bookTile?.focus()
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
      .getBooksInBibleOrder(this.translation)
      .then((books) => (this.booksInBibleOrder = books))
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
      case 'chapter':
        return this.chapterSuggestions
      case 'verseNumber':
        return this.verseNumberSuggestions
    }
  }

  render() {
    const showChapterSuggestions = this.openField === 'chapter' && this.chapterSuggestions.length > 0
    const showVerseNumberSuggestions = this.openField === 'verseNumber' && this.verseNumberSuggestions.length > 0

    return html`
      <form @submit=${this._onSubmit}>
        ${this.lockedBook
          ? this._renderLockedBook(this.lockedBook)
          : this._renderBookPicker()}
        ${this.allowedChapters ? this._renderChapterDropdown(this.allowedChapters) : this._renderChapterCombobox(showChapterSuggestions)}
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

  // The books a guess may name: the Books-mode restriction when there is
  // one, otherwise every book of the selected Bible.
  private get availableBooks(): string[] {
    return this.allowedBooks ?? this.booksInBibleOrder
  }

  // A grid of radio tiles (native radio-group keyboard behavior: Tab in,
  // arrow keys to move and select). Grouped by testament/category when the selected Bible is a
  // standard 66-book canon, one flat list otherwise — see book-picker.ts.
  private _renderBookPicker() {
    const layout = layoutBooks(this.booksInBibleOrder, this.availableBooks)

    return html`
      <fieldset class="book-picker" ?disabled=${this.disabled}>
        <legend>Book</legend>
        <p class="book-status" role="status">${this._bookStatus()}</p>
        <div class="book-grid-scroll">
          ${layout.kind === 'grouped'
            ? layout.testaments.map(
                (testament) => html`
                  <fieldset class="testament">
                    <legend>${testament.label}</legend>
                    ${testament.categories.map((category) => this._renderBookCategory(category))}
                  </fieldset>
                `,
              )
            : html`<div class="book-grid">${layout.books.map((book) => this._renderBookTile(book))}</div>`}
        </div>
      </fieldset>
    `
  }

  private _renderBookCategory(category: BookCategoryGroup) {
    return html`
      <fieldset class="category tone-${category.tone}">
        <legend>${category.label}</legend>
        <div class="book-grid">${category.books.map((book) => this._renderBookTile(book))}</div>
      </fieldset>
    `
  }

  private _renderBookTile(book: string) {
    const checked = this.book === book
    return html`
      <label class="book-tile ${checked ? 'checked' : ''}">
        <input
          type="radio"
          name="bg-book-guess"
          .value=${book}
          .checked=${checked}
          @change=${() => this._selectBook(book)}
          @keydown=${this._onSelectFieldKeydown}
          required
        />
        <span class="book-tile-name">${book}</span>
        ${checked ? html`<span class="book-tile-mark" aria-hidden="true">✓</span>` : null}
      </label>
    `
  }

  private _bookStatus(): string {
    return this.book ? `Selected: ${this.book}` : 'Pick a book.'
  }

  // Chapters-mode games only — a closed dropdown of exactly the selected
  // chapters, so it's impossible to submit anything but one of them (or
  // leave it blank, same as today's optional combobox — a Chapters-mode
  // guess doesn't have to include a chapter any more than any other mode's
  // does).
  private _renderChapterDropdown(allowedChapters: number[]) {
    return html`
      <label class="combo-field">
        Chapter (optional)
        <select
          .value=${this.chapter}
          @change=${(e: Event) => this._selectChapter((e.target as HTMLSelectElement).value)}
          @keydown=${this._onSelectFieldKeydown}
          ?disabled=${this.disabled}
        >
          <option value="" ?selected=${!this.chapter}>Any chapter</option>
          ${allowedChapters.map((chapter) => html`<option value=${chapter}>${chapter}</option>`)}
        </select>
      </label>
    `
  }

  private _renderChapterCombobox(showChapterSuggestions: boolean) {
    return html`
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

  // Unlike a text <input>, a focused native <select> or radio doesn't
  // reliably submit its form on Enter. Submit explicitly so Enter behaves
  // the same way here as it does in every other field in this form (and
  // the rest of the app). Shared by the book tiles and the Chapter
  // dropdown (Chapters-mode games).
  private _onSelectFieldKeydown(e: KeyboardEvent) {
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

    /* Book grid — see docs/web/book-picker. Takes the whole first row of
       the form; chapter/verse/Guess wrap onto the row below it. */
    .book-picker {
      flex: 1 1 100%;
      min-width: 0;
      margin: 0;
      padding: 0;
      border: none;
    }

    .book-picker > legend {
      padding: 0;
      margin-bottom: 0.25rem;
      font-size: 0.9rem;
    }

    .book-status {
      margin: 0.35rem 0;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Capped so the Guess button stays on screen below a 66-book grid. */
    .book-grid-scroll {
      --book-grid-max-height: min(24rem, 55vh);
      max-height: var(--book-grid-max-height);
      overflow-y: auto;
      padding: 0.25rem;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .testament,
    .category {
      margin: 0;
      padding: 0;
      border: none;
      min-width: 0;
    }

    .testament + .testament {
      margin-top: 0.75rem;
    }

    .testament > legend {
      padding: 0;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .category {
      margin-top: 0.35rem;
    }

    .category > legend {
      padding: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .book-grid {
      --book-tile-min-width: 6.75rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--book-tile-min-width), 1fr));
      gap: 4px;
    }

    .book-tile {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      min-height: 2.75rem;
      padding: 0.35rem 0.5rem;
      box-sizing: border-box;
      background: var(--book-tile-1);
      color: var(--book-tile-text);
      font-size: 0.85rem;
      line-height: 1.2;
      cursor: pointer;
    }

    .tone-2 .book-tile {
      background: var(--book-tile-2);
    }

    .tone-3 .book-tile {
      background: var(--book-tile-3);
    }

    .book-tile:hover {
      text-decoration: underline;
    }

    /* The radio stays in the accessibility tree and keyboard order; only
       its circle is hidden, the tile itself shows the state. */
    .book-tile input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
    }

    .book-tile:has(input:focus-visible) {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
      z-index: 1;
    }

    /* Selected = accent fill + a check mark + a bold name, so the state
       never rests on color alone. */
    .book-tile.checked,
    .tone-2 .book-tile.checked,
    .tone-3 .book-tile.checked {
      background: var(--accent);
      color: var(--accent-text);
      font-weight: 700;
    }

    /* Top-right corner, out of the name's way. */
    .book-tile-mark {
      position: absolute;
      top: 0.1rem;
      right: 0.25rem;
      font-size: 0.7rem;
    }

    .book-tile-name {
      min-width: 0;
      overflow-wrap: break-word;
    }

    .book-picker:disabled .book-tile {
      opacity: 0.5;
      cursor: not-allowed;
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
      background: var(--surface-raised);
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
      background: var(--accent);
      color: var(--accent-text);
    }

    button {
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
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
