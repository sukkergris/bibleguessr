import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { Guess, VerseSource } from '../shared-kernel/bible'
import { ANY_BOOK, type GuessConstraint } from '../shared-kernel/guess-constraint'
import { layoutBooks, type BookCategoryGroup, type BookLayout } from './book-picker'
import { buttonStyles } from './button-styles'
import { positionAtPoint } from './slider-position'

const BOOK_FIELD = 'bg-book-guess'
const CHAPTER_FIELD = 'bg-chapter-guess'
const VERSE_FIELD = 'bg-verse-guess'

/** The slider position that picks nothing: no book yet, or "any"
 * chapter/verse (those two are optional). */
const NONE_POSITION = 0

/** Browsers don't expose the size of a native slider's thumb; this is
 * close to the common one. It only matters for the tap fallback (see
 * _onSliderPointerUp), and only shifts a tap near either end by a few
 * pixels. */
const ESTIMATED_THUMB_WIDTH_PX = 16

/** PointerEvent.button for a touch, a pen tip or the main mouse button. */
const MAIN_BUTTON = 0

/** A press on a slider that hasn't been let go yet — see
 * _onSliderPointerUp. */
interface SliderPress {
  pointerId: number
  /** The slider's value when pressed, to tell whether the browser moved
   * the slider itself. */
  valueAtPress: string
}

/** One slider in the guess bar: the book, the chapter or the verse. */
interface SliderSpec<T> {
  label: string
  name: string
  /** What NONE_POSITION reads as to a screen reader, e.g. "Any chapter". */
  noneValueText: string
  /** What a value reads as to a screen reader, e.g. "Chapter 12". */
  valueText: (value: T) => string
  /** Why the slider is disabled: the step before isn't done yet, or its
   * options are still loading. */
  waitingFor?: string
  options: T[]
  selected: T | undefined
  onSelect: (value: T | undefined) => void
}

/** Each source's book list per translation, shared by every guess form.
 * A new form is created for every verse, and without this it would start
 * with an empty book grid and grow once the list had loaded again —
 * making the screen jump on every verse. The list never changes for a
 * given source and translation. */
const booksInBibleOrderCache = new WeakMap<VerseSource, Map<string, string[]>>()
const NO_TRANSLATION_KEY = ''

/** Every book in a layout, in the order the grid shows them. */
function booksInLayoutOrder(layout: BookLayout): string[] {
  return layout.kind === 'flat'
    ? layout.books
    : layout.testaments.flatMap((testament) => testament.categories.flatMap((category) => category.books))
}

/**
 * Fires a `guess-submitted` CustomEvent<Guess> when the player submits.
 *
 * The book is picked from a grid of tiles grouped by testament and
 * category (see book-picker.ts and docs/web/book-picker) — no typing
 * needed. Tile names always come from the selected Bible via
 * VerseSource.getBooksInBibleOrder.
 *
 * Below the grid, a bar pinned to the bottom of the screen holds, always
 * stacked in this order: a summary of the guess so far, a book slider (an
 * alternative to the tiles, kept in sync with them), a chapter slider, a
 * verse slider and the Guess button — so none of it ever scrolls out of
 * reach below the book grid. The chapter slider runs over the selected
 * book's chapters, the verse slider over the selected chapter's verses, so
 * they only ever offer numbers that exist. Both are optional — the
 * leftmost position is "Any …", which leaves that part out of the guess.
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
  // or a Bible file the player parsed client-side — see local-verses.ts.
  // Always given by the host screen; this shared component never reaches
  // for the app's own API client itself (see shared-ui's rules in
  // architecture.test.ts). Nothing loads until it is set.
  @property({ attribute: false })
  verseSource?: VerseSource

  // What this game lets the player guess — decided by the game type (see
  // game-types/registry.ts's guessConstraintOf/guessConstraintForWire),
  // never by this form. 'any-book' shows every book of the translation;
  // 'one-of-books' (Books games) shows only those, since a player shouldn't
  // be able to pick a book they excluded at setup; 'fixed-book' (Chapters
  // games) shows the already-chosen book as read-only text and offers
  // exactly the chosen chapters.
  @property({ attribute: false })
  constraint: GuessConstraint = ANY_BOOK

  @state()
  private book = ''

  @state()
  private chapter?: number

  @state()
  private verseNumber?: number

  // The selected Bible's own book names, in Bible order — the grid's
  // tiles, and what book-picker.ts groups by position.
  @state()
  private booksInBibleOrder: string[] = []

  @state()
  private chapters: number[] = []

  @state()
  private verseNumbers: number[] = []

  // The book grid's tile to focus for a new question: the selected one if
  // any, otherwise the first — the same tile Tab would land on, so the
  // arrow keys work straight away. Not present at all for a fixed book
  // (Chapters games) — see updated()'s focus logic, which uses the
  // chapter slider then.
  @query(`input[name="${BOOK_FIELD}"]:checked`)
  private checkedBookTile?: HTMLInputElement

  @query(`input[name="${BOOK_FIELD}"]`)
  private firstBookTile?: HTMLInputElement

  @query(`input[name="${CHAPTER_FIELD}"]`)
  private chapterSlider?: HTMLInputElement

  // Set when a new question becomes ready, cleared once focus has been
  // placed. Needed because the book tiles render only after the book list
  // has loaded, which can be after the form is enabled — focusing then
  // would find nothing. Cleared again if the form is disabled first, so a
  // late-loading list never pulls focus into a form that isn't active.
  private focusPending = false

  // Set when the book slider picks a book, so updated() can bring that
  // book's tile into view in the grid — the two controls show one choice.
  private revealBookTile = false

  // Each slider's press in progress, if any — see _onSliderPointerUp.
  private sliderPresses = new WeakMap<HTMLInputElement, SliderPress>()

  connectedCallback() {
    super.connectedCallback()
    if (this.constraint.kind === 'fixed-book') {
      this._lockToBook(this.constraint.book, this.constraint.chapters)
    } else {
      this._loadBooks()
      this._selectLoneBook()
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('constraint') && this.constraint.kind === 'fixed-book') {
      this._lockToBook(this.constraint.book, this.constraint.chapters)
    } else if (changedProperties.has('translation') || changedProperties.has('verseSource')) {
      this._loadBooks()
      this._selectLoneBook()
    } else if (changedProperties.has('constraint')) {
      this._selectLoneBook()
    }

    // A new question is ready as soon as the form goes from disabled (still
    // loading the verse) to enabled — put focus on whichever field is
    // actually interactive first: the chapter slider when the book is locked
    // (nothing to do on the read-only Book field), the book tiles otherwise.
    if (changedProperties.has('disabled')) {
      this.focusPending = changedProperties.get('disabled') === true && !this.disabled
    }
    if (this.revealBookTile) {
      this.revealBookTile = false
      this._scrollCheckedBookTileIntoView()
    }
    if (this.focusPending) {
      const target =
        this.constraint.kind === 'fixed-book' || this._loneBook() !== undefined
          ? this.chapterSlider
          : (this.checkedBookTile ?? this.firstBookTile)
      // A slider still waiting for its options is disabled and can't take
      // focus yet; the update that brings them retries.
      if (target && !target.disabled) {
        this.focusPending = false
        target.focus()
      }
    }
  }

  // Fixes `this.book` to the one book a Chapters game committed to at
  // setup. When only one chapter was picked, that chapter is just as fixed,
  // so it's selected too — the verse can then be picked straight away,
  // rather than first moving the chapter slider to its only possible
  // value.
  private _lockToBook(book: string, chapters: number[]) {
    if (this.book === book) return
    this._selectBook(book)
    if (chapters.length === 1) this._selectChapter(chapters[0])
  }

  // The book a Books game gives when only one was picked (the game type
  // decides — see GuessConstraint): just like a Chapters game's fixed
  // book, it's selected from the start and the chapter can be picked
  // straight away.
  private _loneBook(): string | undefined {
    return this.constraint.kind === 'one-of-books' ? this.constraint.givenBook : undefined
  }

  // Also called when the source arrives, since the chapter list can only
  // load once there's a source to load it from.
  private _selectLoneBook() {
    const book = this._loneBook()
    if (book === undefined) return
    if (this.book !== book) this._selectBook(book)
    else if (this.chapters.length === 0) this._loadChapters(book)
  }

  private _loadBooks() {
    const source = this.verseSource
    if (!source) return
    const key = this.translation ?? NO_TRANSLATION_KEY
    const cached = booksInBibleOrderCache.get(source)?.get(key)
    if (cached) {
      this.booksInBibleOrder = cached
      return
    }

    source
      .getBooksInBibleOrder(this.translation)
      .then((books) => {
        const bySource = booksInBibleOrderCache.get(source) ?? new Map<string, string[]>()
        bySource.set(key, books)
        booksInBibleOrderCache.set(source, bySource)
        if (this.verseSource === source && (this.translation ?? NO_TRANSLATION_KEY) === key) {
          this.booksInBibleOrder = books
        }
      })
      .catch((error) => console.error('[guess-form] failed to load book list', error))
  }

  // Each load checks the selection is still the one it was started for,
  // so a slow response for a book or chapter the player has already moved
  // on from can't replace the tiles they're looking at.
  private _loadChapters(book: string) {
    if (!this.verseSource) return
    this.verseSource
      .getChapters(book, this.translation)
      .then((chapters) => {
        if (this.book === book) this.chapters = chapters
      })
      .catch((error) => console.error('[guess-form] failed to load chapter list', error))
  }

  private _loadVerseNumbers(book: string, chapter: number) {
    if (!this.verseSource) return
    this.verseSource
      .getVerseNumbers(book, chapter, this.translation)
      .then((verseNumbers) => {
        if (this.book === book && this.chapter === chapter) this.verseNumbers = verseNumbers
      })
      .catch((error) => console.error('[guess-form] failed to load verse-number list', error))
  }

  render() {
    const fixedBook = this.constraint.kind === 'fixed-book'
    const layout = layoutBooks(this.booksInBibleOrder, this.availableBooks)
    const chapterOptions = this.constraint.kind === 'fixed-book' ? this.constraint.chapters : this.chapters
    return html`
      <form @submit=${this._onSubmit}>
        ${fixedBook ? null : this._renderBookPicker(layout)}
        <div class="guess-bar">
          <p class="guess-summary">${this._summary()}</p>
          ${this.constraint.kind === 'fixed-book'
            ? this._renderLockedBook(this.constraint.book)
            : this._renderSlider<string>({
                label: 'Book',
                name: `${BOOK_FIELD}-slider`,
                noneValueText: 'No book picked',
                valueText: (book) => book,
                waitingFor: this.booksInBibleOrder.length === 0 ? 'Loading books…' : undefined,
                options: booksInLayoutOrder(layout),
                selected: this.book || undefined,
                onSelect: (book) => {
                  this._selectBook(book ?? '')
                  this.revealBookTile = book !== undefined
                },
              })}
          ${this._renderSlider<number>({
            label: 'Chapter (optional)',
            name: CHAPTER_FIELD,
            noneValueText: 'Any chapter',
            valueText: (chapter) => `Chapter ${chapter}`,
            waitingFor: !this.book ? 'Pick a book first.' : chapterOptions.length === 0 ? 'Loading chapters…' : undefined,
            options: chapterOptions,
            selected: this.chapter,
            onSelect: (chapter) => this._selectChapter(chapter),
          })}
          ${this._renderSlider<number>({
            label: 'Verse (optional)',
            name: VERSE_FIELD,
            noneValueText: 'Any verse',
            valueText: (verseNumber) => `Verse ${verseNumber}`,
            waitingFor:
              this.chapter === undefined
                ? 'Pick a chapter first.'
                : this.verseNumbers.length === 0
                  ? 'Loading verses…'
                  : undefined,
            options: this.verseNumbers,
            selected: this.verseNumber,
            onSelect: (verseNumber) => (this.verseNumber = verseNumber),
          })}
          <div class="guess-actions">
            <button type="submit" ?disabled=${this.disabled}>Guess</button>
          </div>
        </div>
      </form>
    `
  }

  // The guess so far, in the same "Book chapter:verse" form the feedback
  // uses. Deliberately not a live region: every control that changes it
  // already announces its own new value, so announcing this too would say
  // everything twice.
  private _summary(): string {
    if (!this.book) return 'Your guess: pick a book'
    if (this.chapter === undefined) return `Your guess: ${this.book}`
    if (this.verseNumber === undefined) return `Your guess: ${this.book} ${this.chapter}`
    return `Your guess: ${this.book} ${this.chapter}:${this.verseNumber}`
  }

  // Chapters-mode games only — the book was already chosen at setup (the
  // whole point of that game type), so the Book row shows it as fixed,
  // read-only text rather than any kind of control: nothing to pick.
  private _renderLockedBook(lockedBook: string) {
    return html`
      <div class="slider-row">
        <span class="slider-label">Book</span>
        <span class="locked-book" title="Already chosen for this game — see the setup screen">${lockedBook}</span>
      </div>
    `
  }

  // The books a guess may name: only the listed ones in a Books game,
  // otherwise every book of the selected Bible.
  private get availableBooks(): string[] {
    return this.constraint.kind === 'one-of-books' ? this.constraint.books : this.booksInBibleOrder
  }

  // A grid of radio tiles (native radio-group keyboard behavior: Tab in,
  // arrow keys to move and select). Grouped by testament/category when the selected Bible is a
  // standard 66-book canon, one flat list otherwise — see book-picker.ts.
  private _renderBookPicker(layout: BookLayout) {
    return html`
      <fieldset class="book-picker" ?disabled=${this.disabled}>
        <legend>Book</legend>
        <div class="grid-scroll book-grid-scroll">
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
      <label class="tile book-tile ${checked ? 'checked' : ''}">
        <input
          type="radio"
          name=${BOOK_FIELD}
          .value=${book}
          .checked=${checked}
          @change=${() => this._selectBook(book)}
          @keydown=${this._onSelectFieldKeydown}
          required
        />
        <span class="book-tile-name">${book}</span>
        ${checked ? html`<span class="tile-mark" aria-hidden="true">✓</span>` : null}
      </label>
    `
  }

  // Brings the selected tile into view inside the grid's own scroll box
  // only — never scrolls the page itself, which would yank the screen
  // around while the player is dragging the book slider.
  private _scrollCheckedBookTileIntoView() {
    const box = this.renderRoot.querySelector<HTMLElement>('.book-grid-scroll')
    const tile = this.checkedBookTile?.closest('label')
    if (!box || !tile) return

    const boxRect = box.getBoundingClientRect()
    const tileRect = tile.getBoundingClientRect()
    if (tileRect.top < boxRect.top) box.scrollTop += tileRect.top - boxRect.top
    else if (tileRect.bottom > boxRect.bottom) box.scrollTop += tileRect.bottom - boxRect.bottom
  }

  // The slider runs over POSITIONS, not the values themselves: position
  // NONE_POSITION picks nothing, position k is options[k - 1]. That keeps
  // it correct for book names and for numbers that aren't 1..n (a
  // Chapters game may allow, say, only chapters 3 and 7), and
  // aria-valuetext tells a screen reader the actual book, chapter or verse
  // rather than the position.
  private _renderSlider<T>(spec: SliderSpec<T>) {
    const position = spec.selected === undefined ? NONE_POSITION : spec.options.indexOf(spec.selected) + 1
    const valueText = spec.selected === undefined ? spec.noneValueText : spec.valueText(spec.selected)
    const hintId = `${spec.name}-hint`
    const disabled = this.disabled || !!spec.waitingFor
    const selectPosition = (next: number) =>
      spec.onSelect(next === NONE_POSITION ? undefined : spec.options[next - 1])

    return html`
      <div class="slider-row">
        <label class="slider-label" for=${spec.name}>${spec.label}</label>
        <div class="slider-track">
        <input
          id=${spec.name}
          name=${spec.name}
          type="range"
          min=${NONE_POSITION}
          max=${spec.options.length}
          step="1"
          .value=${String(position)}
          aria-valuetext=${valueText}
          aria-describedby=${spec.waitingFor ? hintId : nothing}
          ?disabled=${disabled}
          @input=${(event: Event) => selectPosition(Number((event.target as HTMLInputElement).value))}
          @keydown=${this._onSelectFieldKeydown}
          @pointerdown=${this._onSliderPointerDown}
          @pointerup=${(event: PointerEvent) => this._onSliderPointerUp(event, spec.options.length, selectPosition)}
          @pointercancel=${this._onSliderPointerCancel}
        />
        ${spec.waitingFor ? html`<p id=${hintId} class="picker-hint">${spec.waitingFor}</p>` : null}
        </div>
      </div>
    `
  }

  // iPhone Safari moves a range slider only when a drag starts on its
  // thumb: a tap anywhere else on the track leaves it where it is. Every
  // slider starts at the far left, so there a chapter or verse seemed
  // impossible to pick. So when a press ends without the browser having
  // moved the slider itself, the point where it ended picks the position.
  // Browsers that do move the slider for a tap are left alone. This also
  // means a slider never needs dragging (WCAG 2.2 SC 2.5.7).
  private _onSliderPointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== MAIN_BUTTON) return
    const input = event.currentTarget as HTMLInputElement
    this.sliderPresses.set(input, { pointerId: event.pointerId, valueAtPress: input.value })
  }

  private _onSliderPointerUp(event: PointerEvent, maxPosition: number, selectPosition: (position: number) => void) {
    const input = event.currentTarget as HTMLInputElement
    const press = this.sliderPresses.get(input)
    this.sliderPresses.delete(input)
    if (!press || press.pointerId !== event.pointerId) return
    if (input.disabled || input.value !== press.valueAtPress) return

    const box = input.getBoundingClientRect()
    const slider = { left: box.left, width: box.width, thumbWidth: ESTIMATED_THUMB_WIDTH_PX }
    const position = positionAtPoint(event.clientX, slider, maxPosition)
    if (String(position) !== input.value) selectPosition(position)
  }

  // The browser took the press over, e.g. to scroll the page — not a tap.
  private _onSliderPointerCancel(event: PointerEvent) {
    this.sliderPresses.delete(event.currentTarget as HTMLInputElement)
  }

  private _selectBook(book: string) {
    this.book = book
    this.chapters = []
    this._selectChapter(undefined)
    if (book) this._loadChapters(book)
  }

  private _selectChapter(chapter: number | undefined) {
    this.chapter = chapter
    this.verseNumber = undefined
    this.verseNumbers = []
    if (chapter !== undefined) this._loadVerseNumbers(this.book, chapter)
  }

  // Unlike a text <input>, a focused radio or range slider doesn't submit
  // its form on Enter. Submit explicitly so Enter guesses from any tile or
  // slider, the same as Enter does in the rest of the app.
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
    if (!this.book) return

    const guess: Guess = { book: this.book, chapter: this.chapter, verseNumber: this.verseNumber }

    this.dispatchEvent(
      new CustomEvent<Guess>('guess-submitted', {
        detail: guess,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = [
    buttonStyles,
    css`
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

    .locked-book {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      background: rgba(170, 59, 255, 0.08);
      font-size: 1rem;
      color: inherit;
    }

    /* Book grid — see docs/web/book-picker. Takes the whole first row of
       the form; the guess bar sits below it. */
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

    .picker-hint {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Capped so the grid doesn't push the rest of the round far down the
       page; the guess bar below stays reachable either way. */
    .grid-scroll {
      max-height: var(--grid-max-height);
      overflow-y: auto;
      padding: 0.25rem;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .book-grid-scroll {
      --grid-max-height: min(24rem, 55vh);
    }

    /* The guess bar — summary, book, chapter, verse, Guess — pinned to
       the bottom of the screen while the form is in view, so none of it
       ever scrolls out of reach below the book grid. Always one row per
       control, in that order, whatever the width. Opaque, so the grid
       doesn't show through behind it. */
    .guess-bar {
      position: sticky;
      bottom: 0;
      z-index: 2;
      flex: 1 1 100%;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.6rem 0 calc(var(--corner-button-inset) + env(safe-area-inset-bottom, 0px));
      background: var(--bg);
      border-top: 1px solid var(--border);
    }

    .guess-summary {
      margin: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    /* label | slider. The current values aren't repeated next to the
       sliders: the summary at the top of the bar shows the whole guess. */
    .slider-row {
      display: grid;
      grid-template-columns: var(--slider-label-width) minmax(0, 1fr);
      align-items: center;
      column-gap: 0.75rem;
      --slider-label-width: 8.5rem;
    }

    .slider-label {
      font-size: 0.9rem;
    }

    .slider-row input[type='range'] {
      width: 100%;
      min-height: 1.75rem;
      margin: 0;
      accent-color: var(--accent);
    }

    .slider-row input[type='range']:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    .slider-row input[type='range']:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* The "why disabled" hint is laid over the (faded) slider rather than
       on a line of its own, so it appearing and disappearing — e.g. while
       chapters load — never changes the bar's height. */
    .slider-track {
      position: relative;
      min-width: 0;
    }

    .slider-track .picker-hint {
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      transform: translateY(-50%);
      width: fit-content;
      max-width: 100%;
      margin-inline: auto;
      box-sizing: border-box;
      margin-block: 0;
      padding: 0 0.5rem;
      border-radius: 999px;
      background: var(--bg);
      text-align: center;
      pointer-events: none;
    }

    .slider-row .locked-book {
      grid-column: 2 / -1;
    }

    /* Narrow screens: the label goes above its slider instead of beside
       it, so the slider keeps a usable width (also at 200% zoom). */
    @media (max-width: 30rem) {
      .slider-row {
        grid-template-columns: minmax(0, 1fr);
      }

      .slider-label {
        grid-column: 1 / -1;
      }
    }

    /* The Guess button shares the bottom line with the round report
       buttons fixed in the screen's corners (see index.css), so it is
       inset from both sides by their width instead of the bar reserving a
       whole empty row for them. */
    .guess-actions {
      display: flex;
      padding-inline: var(--corner-controls-inline-clearance);
    }

    .guess-actions button {
      flex: 1;
      min-height: var(--corner-button-size);
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
      --tile-min-width: 6.75rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--tile-min-width), 1fr));
      gap: 4px;
    }

    /* min-height keeps every tile a comfortable touch target. */
    .tile {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      min-height: 2.75rem;
      padding: 0.35rem 0.5rem;
      box-sizing: border-box;
      background: var(--tile-1);
      color: var(--tile-text);
      font-size: 0.85rem;
      line-height: 1.2;
      cursor: pointer;
    }

    .tone-2 .tile {
      background: var(--tile-2);
    }

    .tone-3 .tile {
      background: var(--tile-3);
    }

    .tile:hover {
      text-decoration: underline;
    }

    /* The radio stays in the accessibility tree and keyboard order; only
       its circle is hidden, the tile itself shows the state. */
    .tile input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
    }

    .tile:has(input:focus-visible) {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
      z-index: 1;
    }

    /* Selected = accent fill + a check mark + bold text, so the state
       never rests on color alone. */
    .tile.checked,
    .tone-2 .tile.checked,
    .tone-3 .tile.checked {
      background: var(--accent);
      color: var(--accent-text);
      font-weight: 700;
    }

    /* Top-right corner, out of the name's way. */
    .tile-mark {
      position: absolute;
      top: 0.1rem;
      right: 0.25rem;
      font-size: 0.7rem;
    }

    .book-tile-name {
      min-width: 0;
      overflow-wrap: break-word;
    }

    fieldset:disabled .tile {
      opacity: 0.5;
      cursor: not-allowed;
    }


  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-guess-form': GuessForm
  }
}
