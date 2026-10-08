import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { createLocalVerseSource } from './local-verses'
import {
  deleteCacheEntry,
  fileNameFromFingerprint,
  fingerprintFile,
  listCache,
  writeCache,
  type CachedBible,
} from './verse-cache'
import {
  fileToRestore,
  loadBibleChoice,
  saveBibleChoice,
  translationToPreselect,
  type BibleChoice,
} from './bible-choice-storage'
import type { VerseSource } from '../shared-kernel/bible'
import type { SubmitBibleFileReport } from './server-access'
import './report-error'
import { buttonStyles } from '../shared-ui/button-styles'

/** What the player has picked: a server translation, or a
 * client-parsed/cached local file with its own VerseSource. `bible` says
 * which, in the form that is remembered — see bible-choice-storage.ts. */
export interface TranslationChoice {
  translation: string
  verseSource: VerseSource
  bible: BibleChoice
}

type Mode = 'server' | 'file'

/** Where a player can download a Bible file this picker can read — see
 * docs/web/local-bible-files. Only linked to: the app never fetches it. */
const BIBLE_DOWNLOAD_PAGE_URL = 'https://www.jw.org/en/library/bible/'

type FileState =
  | { status: 'idle' }
  | { status: 'picking' }
  | { status: 'parsing'; fileName: string; processed: number; total: number }
  | {
      status: 'ready'
      fileName: string
      fingerprint: string
      translation: string
      verseSource: VerseSource
      /** Whether the player picked the file just now or it was the
       * remembered one — only announced differently. */
      origin: 'chosen' | 'restored'
    }
  | { status: 'error'; message: string; fileName?: string }

/** Restoring the remembered Bible happens as the translation list and the
 * file cache arrive — and is abandoned the moment the player makes a
 * choice of their own, so a late answer never overrides it. */
type Restore = 'pending' | 'done'

/**
 * The one Bible picker — "Server translation" or "My own Bible file" — used
 * by every setup screen: singleplayer (game-setup.ts), multiplayer
 * (bg-room-setup.ts) and the daily quiz. Each player picks their own Bible;
 * other players don't need to match (see
 * docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation note).
 *
 * Starts on the remembered Bible (see bible-choice-storage.ts and
 * docs/web/remembered-bible): one choice shared by every screen and kept
 * across visits. Whatever the player picks here becomes that choice.
 *
 * Fires `translation-changed` CustomEvent<TranslationChoice | undefined>
 * whenever the resolved choice changes (undefined while nothing valid is
 * selected yet).
 */
@customElement('bg-translation-source-select')
export class TranslationSourceSelect extends LitElement {
  /** The server's translations — handed in by the host, so this layer
   * never imports the app's API client (see server-access.ts). */
  @property({ attribute: false })
  serverSource?: VerseSource

  /** Where a problem report about an unusable file is sent. */
  @property({ attribute: false })
  submitBibleFileReport?: SubmitBibleFileReport

  private remembered = loadBibleChoice()

  private restore: Restore = 'pending'

  // The remembered file is looked for on the first cache read only; later
  // reads (after an upload or a removal) must not bring it back.
  private rememberedFileLookedFor = false

  // A remembered file opens in file mode straight away, so its tab doesn't
  // flip over once the (local, quick) cache has been read.
  @state()
  private mode: Mode = this.remembered?.kind === 'file' ? 'file' : 'server'

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
    this._refreshCache()
  }

  // Loads the server's translations as soon as the host hands in
  // serverSource — which can be after this element is connected, so
  // connectedCallback is too early to rely on it.
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('serverSource') && this.serverSource) void this._loadTranslations()
  }

  // Never gated on mode: a player who only ever uses their own file must be
  // able to play with the server unreachable (see
  // docs/SCRUM/Feature.OflineContentGaminig.md). The error is only shown in
  // server mode, and a remembered server translation stays chosen even
  // then — the picker never switches to a file on the player's behalf.
  private async _loadTranslations() {
    if (!this.serverSource) return
    try {
      this.translations = await this.serverSource.getTranslations()
      this.error = undefined
      if (!this.selectedTranslation || !this.translations.includes(this.selectedTranslation)) {
        this.selectedTranslation =
          translationToPreselect(this.restore === 'pending' ? this.remembered : undefined, this.translations) ?? ''
      }
      if (this.mode === 'server') this._emitChange()
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load translations.'
    }
  }

  private _refreshCache() {
    listCache()
      .then((cached) => {
        this.cachedFiles = cached
        this._restoreRememberedFile()
      })
      .catch((err) => {
        console.error('[translation-source-select] failed to read verse cache', err)
        this._restoreRememberedFile()
      })
  }

  // Runs once, on the first cache read. A remembered file that's gone
  // (removed, or cached by an older parser) falls back to the server
  // translation, just as if nothing had been remembered.
  private _restoreRememberedFile() {
    if (this.rememberedFileLookedFor) return
    this.rememberedFileLookedFor = true
    if (this.restore === 'done') return

    const fingerprint = fileToRestore(
      this.remembered,
      this.cachedFiles.map((cached) => cached.fingerprint),
    )
    const cached = this.cachedFiles.find((entry) => entry.fingerprint === fingerprint)
    if (cached) {
      this._useCached(cached, 'restored')
    } else if (this.mode === 'file') {
      this.mode = 'server'
      this._emitChange()
    }
  }

  // Switches to "Server translation" mode, and retries loading the
  // translation list if it failed — the server may be back by now.
  private _onSelectServerMode = () => {
    this.restore = 'done'
    this.mode = 'server'
    if (this.translations.length === 0) {
      void this._loadTranslations()
    }
    this._rememberServerTranslation()
    this._emitChange()
  }

  private _onSelectFileMode = () => {
    this.restore = 'done'
    this.mode = 'file'
    this._emitChange()
  }

  private _rememberServerTranslation() {
    if (this.selectedTranslation) saveBibleChoice({ kind: 'server', translation: this.selectedTranslation })
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
            @click=${this._onSelectFileMode}
          >
            My own Bible file
          </button>
        </div>

        ${this.mode === 'server' ? this._renderServerMode() : this._renderFileMode()}
        ${this._renderFileStatusAnnouncement()}
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
            this.restore = 'done'
            this.selectedTranslation = (e.target as HTMLSelectElement).value
            this._rememberServerTranslation()
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

  /** A single live region carrying the file's current state, so a
   * screen-reader user is told what happened when a file is chosen,
   * parsed, restored from last time, becomes ready, or fails. The visible
   * markup conveys the same thing to sighted users, but only visually.
   *
   * Deliberately one region derived from `fileState` rather than
   * announcements scattered through the visible markup: that keeps each
   * transition announced exactly once, and never mid-parse on every
   * progress tick (see the "status announcements must not be duplicated"
   * requirement in docs/SCRUM/TODO/Feature.Accessibility.md).
   *
   * Only rendered in file mode — there is nothing to announce otherwise. A
   * restored server translation is announced by nothing at all: the select
   * itself shows and exposes it. */
  private _renderFileStatusAnnouncement() {
    if (this.mode !== 'file') return null

    const message = (() => {
      switch (this.fileState.status) {
        case 'idle':
          return ''
        case 'picking':
          return 'Reading the selected file…'
        case 'parsing':
          // Deliberately no progress numbers: this would otherwise
          // re-announce on every chapter parsed.
          return `Parsing ${this.fileState.fileName}…`
        case 'ready':
          return this.fileState.origin === 'restored'
            ? `Using ${this.fileState.fileName} from last time.`
            : `${this.fileState.fileName} is ready to play.`
        case 'error':
          return this.fileState.fileName
            ? `${this.fileState.fileName} could not be used. ${this.fileState.message}`
            : this.fileState.message
      }
    })()

    return html`<p class="visually-hidden" role="status">${message}</p>`
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
            <bg-report-error
              .errorMessage=${this.fileState.message}
              .fileName=${this.fileState.fileName}
              .submitReport=${this.submitBibleFileReport}
            >
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
        <input
          type="file"
          accept=".epub,.zip"
          aria-label="Choose a Bible file"
          aria-describedby="file-picker-hint"
          @change=${this._onFileInputChange}
        />
        <span id="file-picker-hint">Drop a .epub or .zip (RTF export) Bible file here, or click to choose one</span>
      </label>
      ${this._renderFileHelp()}
    `
  }

  // Which files work, and where to get one. Kept in step with the parsers:
  // the RTF parser only knows the Danish export's chapter headings, and
  // PDF isn't read at all.
  private _renderFileHelp() {
    return html`
      <div class="file-help">
        <p>
          <strong>Where to get a file:</strong> on
          <a href=${BIBLE_DOWNLOAD_PAGE_URL} target="_blank" rel="noopener noreferrer"
            >jw.org's Bible page<span class="visually-hidden"> (opens in a new tab)</span></a
          >, download the EPUB of the 2013 revision. We recommend it over the Study Edition, which is a much larger
          file.
        </p>
        <p>Supported files:</p>
        <ul>
          <li><strong>.epub</strong> — an EPUB Bible from jw.org, e.g. the English or Danish edition.</li>
          <li><strong>.zip</strong> — the Danish RTF export: a zip with one RTF file per Bible book.</li>
        </ul>
        <p>PDF files can't be used. Your file is read in this browser and never uploaded.</p>
      </div>
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
                <button type="button" class="cached-entry" @click=${() => this._useCached(cached, 'chosen')}>
                  <strong>${cached.translation}</strong>
                  <span class="cached-entry-detail"
                    >${fileNameFromFingerprint(cached.fingerprint)} · ${cached.verses.length} verses</span
                  >
                </button>
                <button
                  type="button"
                  class="cached-remove"
                  title="Remove this cached file"
                  aria-label="Remove ${fileNameFromFingerprint(cached.fingerprint)} from cache"
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

  private _useCached(cached: CachedBible, origin: 'chosen' | 'restored') {
    this.restore = 'done'
    this.mode = 'file'
    this.fileState = {
      status: 'ready',
      fileName: fileNameFromFingerprint(cached.fingerprint),
      fingerprint: cached.fingerprint,
      translation: cached.translation,
      verseSource: createLocalVerseSource(cached.verses),
      origin,
    }
    if (origin === 'chosen') saveBibleChoice({ kind: 'file', fingerprint: cached.fingerprint })
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
    this.restore = 'done'
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

    // Downloaded exports are frequently all named the same generic thing
    // (e.g. every JW Library EPUB export is "Bible NWT.epub" regardless of
    // language) — the filename alone can't tell two cached translations
    // apart. EPUBs carry a real title/language in their own metadata; use
    // that when available and fall back to the filename otherwise (RTF
    // exports have no equivalent metadata file to read).
    const fallbackName = file.name.replace(/\.(epub|zip)$/i, '')
    const epubParser = isEpub ? await import('./epub-parser') : undefined
    const translation = (await epubParser?.detectEpubTranslationName(file).catch(() => undefined)) ?? fallbackName

    this.fileState = { status: 'parsing', fileName: file.name, processed: 0, total: 1 }

    try {
      const verses = isEpub
        ? await epubParser!.parseEpub(file, translation, (progress) => {
            this.fileState = { status: 'parsing', fileName: file.name, ...progress }
          })
        : await (
            await import('./rtf-parser')
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

      const fingerprint = fingerprintFile(file)
      await writeCache(fingerprint, translation, verses)
      this._refreshCache()
      this.fileState = {
        status: 'ready',
        fileName: file.name,
        fingerprint,
        translation,
        verseSource: createLocalVerseSource(verses),
        origin: 'chosen',
      }
      saveBibleChoice({ kind: 'file', fingerprint })
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
        ? this.selectedTranslation && this.serverSource
          ? {
              translation: this.selectedTranslation,
              verseSource: this.serverSource,
              bible: { kind: 'server', translation: this.selectedTranslation },
            }
          : undefined
        : this.fileState.status === 'ready'
          ? {
              translation: this.fileState.translation,
              verseSource: this.fileState.verseSource,
              bible: { kind: 'file', fingerprint: this.fileState.fingerprint },
            }
          : undefined

    this.dispatchEvent(
      new CustomEvent<TranslationChoice | undefined>('translation-changed', {
        detail: choice,
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

    /* Available to screen readers, invisible on screen — see
       chat-panel.ts for the same pattern. */
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
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
      /* The unselected tab sits on the page surface, so it takes the
         foreground token. --surface-raised here rendered white-on-white in
         light theme and dark-on-dark in dark theme, hiding the label. */
      color: var(--text);
      font-size: 0.85rem;
      line-height: 1.3;
      text-align: center;
      white-space: normal;
      cursor: pointer;
    }

    .mode-switch button:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
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

    /* Full width but never wider: a long translation name would otherwise
       size the select to the name and push the page past a phone screen. */
    select {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
      text-overflow: ellipsis;
    }



    .error {
      color: var(--error);
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

    .file-help {
      text-align: left;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .file-help p,
    .file-help ul {
      margin: 0 0 0.4rem;
    }

    .file-help ul {
      padding-left: 1.25rem;
    }

    .file-help a {
      color: var(--link);
    }

    .file-help a:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
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
      /* The unselected control sits on the page surface, so it takes the
         foreground token. --surface-raised here rendered white-on-white in
         light theme and dark-on-dark in dark theme, hiding the label. */
      color: var(--text);
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
      color: var(--error);
      font-size: 0.9rem;
      cursor: pointer;
    }

    .cached-remove:hover {
      border-color: var(--error);
      background: rgba(221, 51, 51, 0.08);
    }
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-translation-source-select': TranslationSourceSelect
  }
}
