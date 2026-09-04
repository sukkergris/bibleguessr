import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { createLocalVerseSource } from '../local-verses'
import { fingerprintFile, readCache, writeCache, type CachedBible } from '../verse-cache'
import type { VerseSource } from '../types'

export interface GameOptions {
  translation: string
  verseSource: VerseSource
  roundCount: number
}

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
  private cached?: CachedBible

  @state()
  private dragOver = false

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

    readCache()
      .then((cached) => (this.cached = cached))
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

  private get _canStart(): boolean {
    return this.mode === 'server' ? !!this.selectedTranslation : this.fileState.status === 'ready'
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
    if (this.fileState.status === 'idle' && this.cached) {
      return this._renderCachedCard(this.cached)
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
          <button type="button" class="secondary" @click=${() => (this.fileState = { status: 'picking' })}>
            Use a different file
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

  private _renderCachedCard(cached: CachedBible) {
    return html`
      <div class="file-status">
        <p>Continue with <strong>${cached.fingerprint.split(':')[0]}</strong> — ${cached.verses.length} verses cached</p>
        <button type="button" @click=${() => this._useCached(cached)}>Continue</button>
        <button type="button" class="secondary" @click=${() => (this.fileState = { status: 'picking' })}>
          Use a different file
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

    const translation = file.name.replace(/\.(epub|zip)$/i, '')
    this.fileState = { status: 'parsing', fileName: file.name, processed: 0, total: 1 }

    try {
      const verses = isEpub
        ? await (
            await import('../epub-parser')
          ).parseEpub(file, translation, (progress) => {
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
        ? { translation: this.selectedTranslation, verseSource: api, roundCount: this.roundCount }
        : {
            translation: (this.fileState as Extract<FileState, { status: 'ready' }>).translation,
            verseSource: (this.fileState as Extract<FileState, { status: 'ready' }>).verseSource,
            roundCount: this.roundCount,
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
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-setup': GameSetup
  }
}
