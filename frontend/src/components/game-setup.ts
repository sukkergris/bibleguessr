import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { createLocalVerseSource } from '../local-verses'
import { deleteCacheEntry, fingerprintFile, listCache, writeCache, type CachedBible } from '../verse-cache'
import type { VerseRestriction, VerseSource } from '../types'
import type { ChapterSelection } from './chapter-selector'
import './book-selector'
import './chapter-selector'

export interface GameOptions {
  translation: string
  verseSource: VerseSource
  roundCount: number
  /** Which books/chapters to draw verses from — see
   * docs/SCRUM/Feature.BibleSelector.md. Undefined means "default ALL". */
  restriction?: VerseRestriction
}

/** Which of the three game types (see mode-select.ts) this setup screen is
 * configuring — fixed for the lifetime of one screen visit, chosen before
 * landing here rather than switched live within the screen. */
export type SetupScope = 'all' | 'books' | 'chapters'

const MIN_ROUNDS = 3
const MAX_ROUNDS = 10
const DEFAULT_ROUNDS = 5

type Mode = 'server' | 'file'

type FileState =
  | { status: 'idle' }
  | { status: 'picking' }
  | { status: 'parsing'; fileName: string; processed: number; total: number }
  | { status: 'ready'; fileName: string; translation: string; verseSource: VerseSource }
  | { status: 'error'; message: string }

/**
 * Pre-game screen: choose where verses come from (a translation the backend
 * serves, or a Bible file the player supplies and parses in their own
 * browser — see epub-parser.ts) and how many verses (3-10) the game will
 * run for. Fires a `game-started` CustomEvent<GameOptions> once ready and
 * the player confirms.
 */
@customElement('bg-game-setup')
export class GameSetup extends LitElement {
  /** Which game type this screen is configuring — see mode-select.ts.
   * Fixed for this screen visit; there's no in-screen way to switch it. */
  @property({ attribute: false })
  scope: SetupScope = 'all'

  /** Restores a selection made on an earlier visit to this same scope —
   * see bg-app.ts's per-scope restriction state. Ignored for scope 'all',
   * which has nothing to select. */
  @property({ attribute: false })
  initialRestriction?: VerseRestriction

  @state()
  private mode: Mode = 'server'

  @state()
  private translations: string[] = []

  @state()
  private selectedTranslation = ''

  @state()
  private roundCount = DEFAULT_ROUNDS

  @state()
  private error?: string

  @state()
  private fileState: FileState = { status: 'idle' }

  @state()
  private cachedFiles: CachedBible[] = []

  @state()
  private dragOver = false

  /** Undefined = no valid selection yet ('all' scope never needs one;
   * 'books'/'chapters' do). Seeded from `initialRestriction` the first
   * time a source becomes available, so returning to this scope restores
   * whatever was picked on an earlier visit — see bg-app.ts. */
  @state()
  private restriction?: VerseRestriction

  // Tracks what _currentSource/_currentTranslation resolved to as of the
  // last render, so willUpdate can tell when the underlying source has
  // actually changed (switched mode, translation, or file) and reset a
  // book/chapter selection that no longer applies to a DIFFERENT source —
  // <bg-book-selector>/<bg-chapter-selector> reset their own internal UI
  // state the same way, keyed off the same change. Undefined means "no
  // source resolved yet", which is also the state right after construction
  // — the first source to resolve is seeded from initialRestriction rather
  // than reset to undefined (see willUpdate).
  private _lastSourceKey?: string

  connectedCallback() {
    super.connectedCallback()
    api
      .getTranslations()
      .then((translations) => {
        this.translations = translations
        if (translations.length > 0) {
          this.selectedTranslation = translations[0]
        }
      })
      .catch((err) => {
        this.error = err instanceof Error ? err.message : 'Failed to load translations.'
      })

    this._refreshCache()
  }

  private _refreshCache() {
    listCache()
      .then((cached) => (this.cachedFiles = cached))
      .catch((err) => console.error('[game-setup] failed to read verse cache', err))
  }

  render() {
    return html`
      <div class="setup">
        <h1>bibleguessr</h1>
        <p class="tagline">Guess the book, chapter, and verse.</p>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <div class="mode-switch" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected=${this.mode === 'server'}
            class=${this.mode === 'server' ? 'active' : ''}
            @click=${() => (this.mode = 'server')}
          >
            Server translation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected=${this.mode === 'file'}
            class=${this.mode === 'file' ? 'active' : ''}
            @click=${() => (this.mode = 'file')}
          >
            My own Bible file
          </button>
        </div>

        <form @submit=${this._onSubmit}>
          ${this.mode === 'server' ? this._renderServerMode() : this._renderFileMode()}
          ${this._renderScopeSelector()}

          <label>
            Number of verses
            <div class="round-count">
              <input
                type="range"
                min=${MIN_ROUNDS}
                max=${MAX_ROUNDS}
                .value=${String(this.roundCount)}
                @input=${(e: Event) => (this.roundCount = Number((e.target as HTMLInputElement).value))}
              />
              <span class="round-count-value">${this.roundCount}</span>
            </div>
          </label>

          <button type="submit" ?disabled=${!this._canStart}>Start game</button>
        </form>
      </div>
    `
  }

  willUpdate() {
    const sourceKey = this._currentSource ? `${this.mode}:${this._currentTranslation ?? ''}` : undefined
    if (sourceKey !== this._lastSourceKey) {
      const isFirstSource = this._lastSourceKey === undefined
      this._lastSourceKey = sourceKey
      // The very first source to resolve restores whatever the player
      // picked on an earlier visit to this scope; switching to a
      // DIFFERENT source afterwards (changed translation/file) clears it,
      // since a book/chapter selection only makes sense for the source it
      // was made against.
      this.restriction = isFirstSource ? this.initialRestriction : undefined
    }
  }

  private get _canStart(): boolean {
    if (this.mode === 'server' ? !this.selectedTranslation : this.fileState.status !== 'ready') return false
    // 'all' has nothing to select; 'books'/'chapters' need an actual
    // selection before there's a valid game to start.
    return this.scope === 'all' || !!this.restriction
  }

  // The VerseSource + translation the book/chapter selector should query
  // right now — undefined until a translation/file is actually chosen, so
  // <bg-book-selector> stays hidden until there's something to select from.
  private get _currentSource(): VerseSource | undefined {
    if (this.mode === 'server') return this.selectedTranslation ? api : undefined
    return this.fileState.status === 'ready' ? this.fileState.verseSource : undefined
  }

  private get _currentTranslation(): string | undefined {
    return this.mode === 'server'
      ? this.selectedTranslation || undefined
      : this.fileState.status === 'ready'
        ? this.fileState.translation
        : undefined
  }

  private _renderScopeSelector() {
    if (this.scope === 'all') return null

    const source = this._currentSource
    if (!source) return null

    if (this.scope === 'books') {
      return html`
        <div class="scope-selector-block">
          <span class="scope-selector-label">Books</span>
          <bg-book-selector
            .verseSource=${source}
            .translation=${this._currentTranslation}
            .initialSelection=${this.restriction?.books}
            @restriction-changed=${this._onRestrictionChanged}
          ></bg-book-selector>
        </div>
      `
    }

    const initialChapterSelection: ChapterSelection | undefined = this.restriction?.books[0]
      ? { book: this.restriction.books[0], chapters: this.restriction.chaptersByBook[this.restriction.books[0]] ?? [] }
      : undefined

    return html`
      <div class="scope-selector-block">
        <span class="scope-selector-label">Chapters</span>
        <bg-chapter-selector
          .verseSource=${source}
          .translation=${this._currentTranslation}
          .initialSelection=${initialChapterSelection}
          @restriction-changed=${this._onRestrictionChanged}
        ></bg-chapter-selector>
      </div>
    `
  }

  private _onRestrictionChanged(event: CustomEvent<VerseRestriction | undefined>) {
    this.restriction = event.detail

    // Re-dispatch as our own event (distinct from the child selector's,
    // which doesn't cross this component's public API boundary otherwise)
    // so the parent can track the in-progress selection live — not just
    // once the player hits "Start game" — and persist it per scope across
    // visits to this screen. See bg-app.ts's booksRestriction/
    // chaptersRestriction.
    this.dispatchEvent(
      new CustomEvent<VerseRestriction | undefined>('scope-restriction-changed', {
        detail: this.restriction,
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _renderServerMode() {
    return html`
      <label>
        Translation
        <select
          .value=${this.selectedTranslation}
          @change=${(e: Event) => (this.selectedTranslation = (e.target as HTMLSelectElement).value)}
          ?disabled=${this.translations.length === 0}
          required
        >
          ${this.translations.length === 0
            ? html`<option value="">Loading…</option>`
            : this.translations.map((t) => html`<option value=${t}>${t}</option>`)}
        </select>
      </label>
    `
  }

  private _renderFileMode() {
    if (this.fileState.status === 'idle' && this.cachedFiles.length > 0) {
      return this._renderCachedList()
    }

    if (this.fileState.status === 'parsing') {
      const { fileName, processed, total } = this.fileState
      return html`
        <div class="file-status">
          <p>Parsing ${fileName}…</p>
          <progress max=${total} value=${processed}></progress>
          <p class="progress-label">${processed} / ${total} chapters</p>
        </div>
      `
    }

    if (this.fileState.status === 'ready') {
      return html`
        <div class="file-status">
          <p>✓ Using <strong>${this.fileState.fileName}</strong> (${this.fileState.translation})</p>
          <button type="button" class="secondary" @click=${() => (this.fileState = { status: 'idle' })}>
            Choose a different file
          </button>
        </div>
      `
    }

    return html`
      ${this.fileState.status === 'error' ? html`<p class="error">${this.fileState.message}</p>` : null}
      <label
        class="dropzone ${this.dragOver ? 'dragover' : ''}"
        @dragover=${(e: DragEvent) => {
          e.preventDefault()
          this.dragOver = true
        }}
        @dragleave=${() => (this.dragOver = false)}
        @drop=${this._onDrop}
      >
        <input type="file" accept=".epub,.zip" @change=${this._onFileInputChange} />
        <span>Drop a .epub or .zip (RTF export) Bible file here, or click to choose one</span>
      </label>
    `
  }

  private _renderCachedList() {
    return html`
      <div class="cached-list">
        <p class="cached-list-label">Use a Bible file you've already uploaded:</p>
        <ul>
          ${this.cachedFiles.map(
            (cached) => html`
              <li>
                <button type="button" class="cached-entry" @click=${() => this._useCached(cached)}>
                  <strong>${cached.translation}</strong>
                  <span class="cached-entry-detail"
                    >${cached.fingerprint.split(':')[0]} · ${cached.verses.length} verses</span
                  >
                </button>
                <button
                  type="button"
                  class="cached-remove"
                  title="Remove this cached file"
                  aria-label="Remove ${cached.fingerprint.split(':')[0]} from cache"
                  @click=${() => this._removeCached(cached)}
                >
                  ✕
                </button>
              </li>
            `,
          )}
        </ul>
        <button type="button" class="secondary" @click=${() => (this.fileState = { status: 'picking' })}>
          Upload a different file
        </button>
      </div>
    `
  }

  private _useCached(cached: CachedBible) {
    this.fileState = {
      status: 'ready',
      fileName: cached.fingerprint.split(':')[0],
      translation: cached.translation,
      verseSource: createLocalVerseSource(cached.verses),
    }
  }

  private _removeCached(cached: CachedBible) {
    deleteCacheEntry(cached.fingerprint)
      .then(() => this._refreshCache())
      .catch((err) => console.error('[game-setup] failed to remove cached file', err))
  }

  private _onFileInputChange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) void this._loadFile(file)
  }

  private _onDrop = (e: DragEvent) => {
    e.preventDefault()
    this.dragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) void this._loadFile(file)
  }

  private async _loadFile(file: File) {
    const lowerName = file.name.toLowerCase()
    const isEpub = lowerName.endsWith('.epub')
    const isRtfZip = lowerName.endsWith('.zip')

    if (!isEpub && !isRtfZip) {
      this.fileState = { status: 'error', message: 'Please choose a .epub or .zip (RTF export) file.' }
      return
    }

    // Downloaded exports are frequently all named the same generic thing
    // (e.g. every JW Library EPUB export is "Bible NWT.epub" regardless of
    // language) — the filename alone can't tell two cached translations
    // apart. EPUBs carry a real title/language in their own metadata; use
    // that when available and fall back to the filename otherwise (RTF
    // exports have no equivalent metadata file to read).
    const fallbackName = file.name.replace(/\.(epub|zip)$/i, '')
    const epubParser = isEpub ? await import('../epub-parser') : undefined
    const translation = (await epubParser?.detectEpubTranslationName(file).catch(() => undefined)) ?? fallbackName

    this.fileState = { status: 'parsing', fileName: file.name, processed: 0, total: 1 }

    try {
      const verses = isEpub
        ? await epubParser!.parseEpub(file, translation, (progress) => {
            this.fileState = { status: 'parsing', fileName: file.name, ...progress }
          })
        : await (
            await import('../rtf-parser')
          ).parseRtfZip(file, translation, (progress) => {
            this.fileState = { status: 'parsing', fileName: file.name, ...progress }
          })

      if (verses.length === 0) {
        this.fileState = {
          status: 'error',
          message: 'This file doesn’t look like a supported Bible export — no recognizable chapters were found.',
        }
        return
      }

      await writeCache(fingerprintFile(file), translation, verses)
      this._refreshCache()
      this.fileState = { status: 'ready', fileName: file.name, translation, verseSource: createLocalVerseSource(verses) }
    } catch (err) {
      console.error('[game-setup] failed to parse Bible file', err)
      this.fileState = {
        status: 'error',
        message: 'This doesn’t look like a valid file (couldn’t open it as a zip).',
      }
    }
  }

  private _onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this._canStart) return

    const detail: GameOptions =
      this.mode === 'server'
        ? {
            translation: this.selectedTranslation,
            verseSource: api,
            roundCount: this.roundCount,
            restriction: this.restriction,
          }
        : {
            translation: (this.fileState as Extract<FileState, { status: 'ready' }>).translation,
            verseSource: (this.fileState as Extract<FileState, { status: 'ready' }>).verseSource,
            roundCount: this.roundCount,
            restriction: this.restriction,
          }

    this.dispatchEvent(
      new CustomEvent<GameOptions>('game-started', {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    .setup {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .tagline {
      margin: 0;
      color: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      .tagline {
        color: #9ca3af;
      }
    }

    .mode-switch {
      display: flex;
      gap: 0.5rem;
      justify-content: center;
    }

    .mode-switch button {
      flex: 1;
      min-width: 0;
      padding: 0.5rem 0.75rem;
      border-radius: 999px;
      border: 1px solid #ccc;
      background: transparent;
      color: #2b2630;
      font-size: 0.85rem;
      line-height: 1.3;
      text-align: center;
      white-space: normal;
      cursor: pointer;
    }

    @media (prefers-color-scheme: dark) {
      .mode-switch button {
        color: #e5e1ea;
      }
    }

    .mode-switch button.active {
      background: #aa3bff;
      border-color: #aa3bff;
      color: white;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      margin-top: 0.5rem;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.9rem;
      text-align: left;
    }

    .scope-selector-block {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.9rem;
      text-align: left;
    }

    .scope-selector-label {
      font-weight: 500;
    }

    select {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }

    .round-count {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .round-count input[type='range'] {
      flex: 1;
    }

    .round-count-value {
      min-width: 1.5rem;
      text-align: center;
      font-weight: 600;
    }

    button {
      padding: 0.7rem 1.25rem;
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

    button.secondary {
      background: transparent;
      color: #aa3bff;
      border: 1px solid #aa3bff;
    }

    .error {
      color: #d33;
    }

    .file-status {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      text-align: center;
    }

    .dropzone {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 1.5rem 1rem;
      border: 2px dashed #ccc;
      border-radius: 12px;
      cursor: pointer;
      font-size: 0.9rem;
      color: #6b6375;
    }

    .dropzone.dragover {
      border-color: #aa3bff;
      color: #aa3bff;
    }

    .dropzone input[type='file'] {
      display: none;
    }

    progress {
      width: 100%;
    }

    .progress-label {
      margin: 0;
      font-size: 0.8rem;
      color: #6b6375;
      text-align: center;
    }

    .cached-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .cached-list-label {
      margin: 0;
      font-size: 0.85rem;
      color: #6b6375;
      text-align: left;
    }

    @media (prefers-color-scheme: dark) {
      .cached-list-label {
        color: #9ca3af;
      }
    }

    .cached-list ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .cached-list li {
      display: flex;
      align-items: stretch;
      gap: 0.4rem;
    }

    .cached-entry {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.15rem;
      padding: 0.6rem 0.8rem;
      border-radius: 10px;
      border: 1px solid #ccc;
      background: transparent;
      color: #2b2630;
      font-size: 0.9rem;
      text-align: left;
      cursor: pointer;
    }

    @media (prefers-color-scheme: dark) {
      .cached-entry {
        color: #e5e1ea;
      }
    }

    .cached-entry:hover {
      border-color: #aa3bff;
    }

    .cached-entry strong {
      overflow-wrap: anywhere;
    }

    .cached-entry-detail {
      font-size: 0.8rem;
      color: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      .cached-entry-detail {
        color: #9ca3af;
      }
    }

    .cached-remove {
      flex: 0 0 auto;
      width: 2.25rem;
      padding: 0;
      border-radius: 10px;
      border: 1px solid #ccc;
      background: transparent;
      color: #d33;
      font-size: 0.9rem;
      cursor: pointer;
    }

    .cached-remove:hover {
      border-color: #d33;
      background: rgba(221, 51, 51, 0.08);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-setup': GameSetup
  }
}
