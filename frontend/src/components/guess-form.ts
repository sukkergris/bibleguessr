import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import type { Guess, VerseSource } from '../types'

/**
 * Fires a `guess-submitted` CustomEvent<Guess> when the player submits.
 *
 * The book field shows a filtered suggestion list as the player types.
 * A native <input list>/<datalist> pair was tried first, but `list=`
 * lookups don't reliably cross into a Lit component's shadow DOM across
 * browsers, so suggestions are rendered manually instead.
 */
@customElement('bg-guess-form')
export class GuessForm extends LitElement {
  @property({ type: Boolean })
  disabled = false

  // The translation of the verse currently being guessed. Determines which
  // book spellings are offered — see api.ts's getBooks for why this matters.
  @property({ type: String })
  translation?: string

  // Where the book list is loaded from: the backend (default) or a Bible
  // file the player parsed client-side — see local-verses.ts.
  @property({ attribute: false })
  verseSource: VerseSource = api

  @state()
  private book = ''

  @state()
  private chapter = ''

  @state()
  private verseNumber = ''

  @state()
  private books: string[] = []

  @state()
  private suggestionsOpen = false

  @state()
  private activeSuggestion = -1

  connectedCallback() {
    super.connectedCallback()
    this._loadBooks()
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('translation') || changedProperties.has('verseSource')) {
      this._loadBooks()
    }
  }

  private _loadBooks() {
    this.verseSource
      .getBooks(this.translation)
      .then((books) => (this.books = books))
      .catch((error) => console.error('[guess-form] failed to load book list', error))
  }

  private get suggestions(): string[] {
    const query = this.book.trim().toLowerCase()
    if (!query) return []
    return this.books.filter((book) => book.toLowerCase().includes(query)).slice(0, 8)
  }

  render() {
    const suggestions = this.suggestions
    const showSuggestions = this.suggestionsOpen && suggestions.length > 0

    return html`
      <form @submit=${this._onSubmit}>
        <label class="book-field">
          Book
          <div class="combobox">
            <input
              type="text"
              name="bg-book-guess-no-autofill"
              placeholder="e.g. Salme"
              role="combobox"
              aria-expanded=${showSuggestions}
              aria-autocomplete="list"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              .value=${this.book}
              @input=${this._onBookInput}
              @keydown=${this._onBookKeydown}
              @blur=${this._onBookBlur}
              ?disabled=${this.disabled}
              required
            />
            ${showSuggestions
              ? html`
                  <ul class="suggestions" role="listbox">
                    ${suggestions.map(
                      (book, i) => html`
                        <li
                          role="option"
                          aria-selected=${i === this.activeSuggestion}
                          class=${i === this.activeSuggestion ? 'active' : ''}
                          @mousedown=${(e: Event) => {
                            e.preventDefault()
                            this._selectSuggestion(book)
                          }}
                        >
                          ${book}
                        </li>
                      `,
                    )}
                  </ul>
                `
              : null}
          </div>
        </label>
        <label>
          Chapter (optional)
          <input
            type="number"
            min="1"
            .value=${this.chapter}
            @input=${(e: Event) => (this.chapter = (e.target as HTMLInputElement).value)}
            ?disabled=${this.disabled}
          />
        </label>
        <label>
          Verse (optional)
          <input
            type="number"
            min="1"
            .value=${this.verseNumber}
            @input=${(e: Event) => (this.verseNumber = (e.target as HTMLInputElement).value)}
            ?disabled=${this.disabled}
          />
        </label>
        <button type="submit" ?disabled=${this.disabled}>Guess</button>
      </form>
    `
  }

  private _onBookInput(e: Event) {
    this.book = (e.target as HTMLInputElement).value
    this.suggestionsOpen = true
    this.activeSuggestion = -1
  }

  private _onBookKeydown(e: KeyboardEvent) {
    const suggestions = this.suggestions
    if (!this.suggestionsOpen || suggestions.length === 0) return

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
          this._selectSuggestion(suggestions[this.activeSuggestion])
        }
        break
      case 'Escape':
        this.suggestionsOpen = false
        break
    }
  }

  private _onBookBlur() {
    // Delay so a click on a suggestion (mousedown) still registers before
    // the list disappears.
    setTimeout(() => (this.suggestionsOpen = false), 100)
  }

  private _selectSuggestion(book: string) {
    this.book = book
    this.suggestionsOpen = false
    this.activeSuggestion = -1
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

    .book-field {
      position: relative;
    }

    .combobox {
      position: relative;
    }

    input {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
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
