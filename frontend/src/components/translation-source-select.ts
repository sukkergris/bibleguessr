import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { createLocalVerseSource } from '../local-verses'
import { deleteCacheEntry, fingerprintFile, listCache, writeCache, type CachedBible } from '../verse-cache'
import type { VerseSource } from '../types'
import './report-error'

/** What the player has picked: a server translation name, or a
 * client-parsed/cached local file with its own VerseSource — see
 * game-setup.ts's GameOptions, which this mirrors the shape of (minus
 * roundCount/restriction, which are scope-specific to a singleplayer
 * game and don't apply to a translation choice on its own). */
export interface TranslationChoice {
  translation: string
  verseSource: VerseSource
}

type Mode = 'server' | 'file'

type FileState =
  | { status: 'idle' }
  | { status: 'picking' }
  | { status: 'parsing'; fileName: string; processed: number; total: number }
  | { status: 'ready'; fileName: string; translation: string; verseSource: VerseSource }
  | { status: 'error'; message: string; fileName?: string }

/**
 * The "server translation" vs. "my own Bible file" picker — extracted from
 * game-setup.ts (which still owns it for singleplayer) so it can also be
 * used standalone wherever a player needs to pick a translation without
 * the rest of game-setup.ts's round-count/book-chapter-scope machinery —
 * see bg-room-setup.ts's pre-name multiplayer screen, where each player
 * picks their own translation before choosing a name (see
 * docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation
 * note). Any drift between this and game-setup.ts's copy of the same
 * dropdown/drop-zone/caching UI should be fixed in both places until
 * game-setup.ts itself is migrated to use this component directly.
 *
 * Fires `translation-changed` CustomEvent<TranslationChoice | undefined>
 * whenever the resolved choice changes (undefined while nothing valid is
 * selected yet).
 */
@customElement('bg-translation-source-select')
export class TranslationSourceSelect extends LitElement {
  @state()
  private mode: Mode = 'server'

  @state()
  private translations: string[] = []

  @state()
  private selectedTranslation = ''

  @state()
  private error?: string

  @state()
  private fileState: FileState = { status: 'idle' }

  @state()
  private cachedFiles: CachedBible[] = []

  @state()
  private dragOver = false

  connectedCallback() {
    super.connectedCallback()
    void this._loadTranslations()
    this._refreshCache()
  }

  private async _loadTranslations() {
    try {
      this.translations = await api.getTranslations()
      this.error = undefined
      if (this.translations.length > 0) {
        this.selectedTranslation = this.translations[0]
        this._emitChange()
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load translations.'
    }
  }

  private _refreshCache() {
    listCache()
      .then((cached) => (this.cachedFiles = cached))
      .catch((err) => console.error('[translation-source-select] failed to read verse cache', err))
  }

  private _onSelectServerMode = () => {
    this.mode = 'server'
    if (this.translations.length === 0) {
      void this._loadTranslations()
    }
    this._emitChange()
  }

  render() {
    return html`
      <div class="picker">
        ${this.mode === 'server' && this.error ? html`<p class="error">${this.error}</p>` : null}

        <div class="mode-switch" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected=${this.mode === 'server'}
            class=${this.mode === 'server' ? 'active' : ''}
            @click=${this._onSelectServerMode}
          >
            Server translation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected=${this.mode === 'file'}
            class=${this.mode === 'file' ? 'active' : ''}
            @click=${() => {
              this.mode = 'file'
              this._emitChange()
            }}
          >
            My own Bible file
          </button>
        </div>

        ${this.mode === 'server' ? this._renderServerMode() : this._renderFileMode()}
      </div>
    `
  }

  private _renderServerMode() {
    return html`
      <label>
        Translation
        <select
          .value=${this.selectedTranslation}
          @change=${(e: Event) => {
            this.selectedTranslation = (e.target as HTMLSelectElement).value
            this._emitChange()
          }}
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
          <button
            type="button"
            class="secondary"
            @click=${() => {
              this.fileState = { status: 'idle' }
              this._emitChange()
            }}
          >
            Choose a different file
          </button>
        </div>
      `
    }

    return html`
      ${this.fileState.status === 'error'
        ? html`
            <p class="error">${this.fileState.message}</p>
            <bg-report-error .errorMessage=${this.fileState.message} .fileName=${this.fileState.fileName}>
            </bg-report-error>
          `
        : null}
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
        <button
          type="button"
          class="secondary"
          @click=${() => {
            this.fileState = { status: 'picking' }
            this._emitChange()
          }}
        >
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
    this._emitChange()
  }

  private _removeCached(cached: CachedBible) {
    deleteCacheEntry(cached.fingerprint)
      .then(() => this._refreshCache())
      .catch((err) => console.error('[translation-source-select] failed to remove cached file', err))
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
      this.fileState = {
        status: 'error',
        message: 'Please choose a .epub or .zip (RTF export) file.',
        fileName: file.name,
      }
      return
    }

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
          fileName: file.name,
        }
        return
      }

      await writeCache(fingerprintFile(file), translation, verses)
      this._refreshCache()
      this.fileState = { status: 'ready', fileName: file.name, translation, verseSource: createLocalVerseSource(verses) }
      this._emitChange()
    } catch (err) {
      console.error('[translation-source-select] failed to parse Bible file', err)
      this.fileState = {
        status: 'error',
        message: 'This doesn’t look like a valid file (couldn’t open it as a zip).',
        fileName: file.name,
      }
    }
  }

  private _emitChange() {
    const choice: TranslationChoice | undefined =
      this.mode === 'server'
        ? this.selectedTranslation
          ? { translation: this.selectedTranslation, verseSource: api }
          : undefined
        : this.fileState.status === 'ready'
          ? { translation: this.fileState.translation, verseSource: this.fileState.verseSource }
          : undefined

    this.dispatchEvent(
      new CustomEvent<TranslationChoice | undefined>('translation-changed', {
        detail: choice,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    .picker {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .mode-switch {
      display: flex;
      gap: 0.5rem;
    }

    .mode-switch button {
      flex: 1;
      min-width: 0;
      padding: 0.5rem 0.75rem;
      border-radius: 999px;
      border: 1px solid #ccc;
      background: transparent;
      color: var(--surface-raised);
      font-size: 0.85rem;
      line-height: 1.3;
      text-align: center;
      white-space: normal;
      cursor: pointer;
    }


    .mode-switch button.active {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-text);
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

    button {
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 0.9rem;
      cursor: pointer;
    }

    button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
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
      color: var(--text-muted);
    }

    .dropzone.dragover {
      border-color: var(--accent);
      color: var(--accent);
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
      color: var(--text-muted);
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
      color: var(--text-muted);
      text-align: left;
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
      color: var(--surface-raised);
      font-size: 0.9rem;
      text-align: left;
      cursor: pointer;
    }


    .cached-entry:hover {
      border-color: var(--accent);
    }

    .cached-entry strong {
      overflow-wrap: anywhere;
    }

    .cached-entry-detail {
      font-size: 0.8rem;
      color: var(--text-muted);
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
    'bg-translation-source-select': TranslationSourceSelect
  }
}
