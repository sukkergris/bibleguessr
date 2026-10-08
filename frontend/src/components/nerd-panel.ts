import { LitElement, css, html } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import './theme-select'
import { api } from '../api';
import { buildInfoText, type BuildInfoState } from './build-info';
import { groupByBook, needsLoading, type FamousVersesState } from './famous-verses';
import { healthText, nextCheckText, serverHealth, type ServerHealthSnapshot } from '../server-health';
import {
  NERD_PANEL_SHORTCUT_KEYS,
  NERD_PANEL_SHORTCUT_TEXT,
  isNerdPanelShortcut,
  onNerdPanelOpenRequest,
  type NerdPanelOpenRequest,
} from '../nerd-panel-control';

/** The focused element, looking inside shadow roots — document.activeElement
 * only reports the outermost host. */
function deepActiveElement(): HTMLElement | undefined {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : undefined;
}

/**
 * A debug drawer along the right edge, toggled with Alt+Shift+N or opened
 * from the connection menu's Nerd panel button (see nerd-panel-control.ts)
 * — the shell for whatever "nerd stuff" ends up living here (connection
 * diagnostics, an event log, etc.).
 *
 * Takes real layout space rather than floating over the page: bg-app.ts
 * renders this as a flex sibling of <main>, so opening it narrows the main
 * column instead of covering part of it — the width transition below is
 * what makes that widen/narrow read as a slide rather than a jump cut.
 *
 * The shortcut used to be Ctrl+Shift+N, until it turned out Chrome and
 * Edge on Windows open a private window on it before the page sees the
 * keys — see nerd-panel-control.ts for why Alt+Shift+N.
 *
 * Closed, the panel is inert as well as aria-hidden: it is only narrowed
 * to nothing, so without inert its controls would still take Tab stops.
 */
@customElement('bg-nerd-panel')
export class NerdPanel extends LitElement {
  @state()
  private open = false;

  @state()
  private backendRevision?: number;

  @state()
  private revisionError?: string;

  /** /api/build-info — see _loadBuildInfo. */
  @state()
  private buildInfo: BuildInfoState = { kind: 'loading' };

  /** /api/famous-verses — see _onFamousVersesToggle. */
  @state()
  private famousVerses: FamousVersesState = { kind: 'idle' };

  /** The app's shared /api/healthz check — see server-health.ts. The
   * connection indicator shows the same one. */
  @state()
  private health: ServerHealthSnapshot = { check: { status: 'checking' }, secondsToNextCheck: 0 };

  private _unsubscribeHealth?: () => void;
  private _unsubscribeOpenRequests?: () => void;

  /** Where focus was when the panel opened, and goes back to when it
   * closes with focus inside it — otherwise focus would be left on a
   * control that just turned inert. */
  private _returnFocusTo?: HTMLElement;

  /** Set by an open request, which moves focus into the panel once it has
   * rendered open. */
  private _focusOnOpen = false;

  @query('h2')
  private _heading!: HTMLHeadingElement;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeydown);
    void this._loadRevisions();
    void this._loadBuildInfo();
    this._unsubscribeHealth = serverHealth.subscribe((health) => (this.health = health));
    this._unsubscribeOpenRequests = onNerdPanelOpenRequest(this._onOpenRequest);

    // Deliberate, permanent console hint — keep this even when trimming
    // other logging elsewhere. Besides this hint, only the About page's
    // "Nerd stuff" section tells anyone the shortcut exists.
    console.log(`[bg-nerd-panel] Open the nerd panel with ${NERD_PANEL_SHORTCUT_TEXT}`);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeydown);
    this._unsubscribeHealth?.();
    this._unsubscribeOpenRequests?.();
    super.disconnectedCallback();
  }

  private _onKeydown = (e: KeyboardEvent) => {
    if (!isNerdPanelShortcut(e)) return;
    // Never while the player is typing: a global chord that fires inside a
    // text field interrupts ordinary input, which is exactly what
    // docs/SCRUM/TODO/Feature.ShortcutDescriptions.md forbids. Checked
    // through composedPath because focus is usually inside a component's
    // shadow root, where document.activeElement only reports the host.
    if (this._isTypingTarget(e)) return;
    e.preventDefault();
    if (this.open) this._close();
    else this._open(deepActiveElement());
  };

  private _onOpenRequest = (request: NerdPanelOpenRequest) => {
    this._focusOnOpen = true;
    this._open(request.returnFocusTo);
  };

  private _open(returnFocusTo: HTMLElement | undefined) {
    this._returnFocusTo = returnFocusTo;
    this.open = true;
  }

  private _close() {
    const focusWasInside = this.shadowRoot?.activeElement != null;
    this.open = false;
    if (focusWasInside && this._returnFocusTo?.isConnected) this._returnFocusTo.focus();
    this._returnFocusTo = undefined;
  }

  /** Whether this key event originated in something the player types into. */
  private _isTypingTarget(e: KeyboardEvent): boolean {
    const target = e.composedPath()[0];
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }

  private async _loadRevisions() {
    try {
      const response = await api.getRevision();
      this.backendRevision = response.revision;
      this.revisionError = undefined;
    } catch (error) {
      this.revisionError =
        error instanceof Error ? error.message : 'Backend revision unavailable.';
    }
  }

  /** Which build the API image is. Loaded once: it can't change while
   * the page is open. */
  private async _loadBuildInfo() {
    try {
      this.buildInfo = { kind: 'loaded', info: await api.getBuildInfo() };
    } catch (error) {
      this.buildInfo = {
        kind: 'failed',
        reason: error instanceof Error ? error.message : 'Build info unavailable.',
      };
    }
  }

  /** Loads the famous verses the first time the list is opened (and
   * again after a failure) — nobody needs them until then. */
  private _onFamousVersesToggle = async (e: Event) => {
    if (!(e.target as HTMLDetailsElement).open || !needsLoading(this.famousVerses)) return;
    this.famousVerses = { kind: 'loading' };
    try {
      const references = await api.getFamousVerses();
      this.famousVerses = { kind: 'loaded', count: references.length, books: groupByBook(references) };
    } catch (error) {
      this.famousVerses = {
        kind: 'failed',
        reason: error instanceof Error ? error.message : 'Famous verses unavailable.',
      };
    }
  };

  private _famousVersesContent() {
    switch (this.famousVerses.kind) {
      case 'idle':
      case 'loading':
        return html`<p class="note">Loading…</p>`;
      case 'failed':
        return html`<p class="error">${this.famousVerses.reason}</p>`;
      case 'loaded':
        return html`
          <p class="note">${this.famousVerses.count} verses, in Bible order.</p>
          <dl>
            ${this.famousVerses.books.map(
              (group) => html`
                <div>
                  <dt>${group.book}</dt>
                  <dd>${group.references.join(', ')}</dd>
                </div>
              `,
            )}
          </dl>
        `;
    }
  }

  private _frontendRevision() {
    return (
      document
        .querySelector('meta[name="application-revision"]')
        ?.getAttribute('content') ?? 'Unknown'
    );
  }

  // Reflects `open` onto a host attribute so the :host([data-open]) width
  // rule (see styles below) can react to it — plain CSS has no way to
  // style a shadow host based on its own internal @state.
  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('open')) {
      this.toggleAttribute('data-open', this.open);
    }
    if (this.open && this._focusOnOpen) {
      this._focusOnOpen = false;
      this._heading.focus();
    }
  }

  render() {
    return html`
      <div class="panel" aria-hidden=${!this.open} ?inert=${!this.open}>
        <header>
          <!-- tabindex="-1": an open request from the connection menu
               moves focus here, so the panel's name is the first thing
               read out. Not a Tab stop. -->
          <h2 tabindex="-1">Nerd stuff</h2>
          <button
            type="button"
            class="close"
            @click=${() => this._close()}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div class="content">
          <section class="theme" aria-labelledby="theme-heading">
            <h3 id="theme-heading">Appearance</h3>
            <bg-theme-select></bg-theme-select>
          </section>

          <section class="shortcuts" aria-labelledby="shortcuts-heading">
            <h3 id="shortcuts-heading">Keyboard shortcuts</h3>
            <dl>
              <div>
                <dt>${NERD_PANEL_SHORTCUT_KEYS.map((key, i) => html`${i > 0 ? ' + ' : ''}<kbd>${key}</kbd>`)}</dt>
                <dd>
                  Show or hide this panel. Hold all three keys together. On a Mac, Alt is the Option key.
                  <p class="caveat">
                    The shortcut is a convenience, not the only way in or out: the connection menu (the dot in the
                    top-right corner) has a Nerd panel button, and the panel has a Close button.
                  </p>
                </dd>
              </div>
            </dl>
            <p class="note">
              Shortcuts are ignored while you are typing in a text field, so they cannot interrupt a message or a
              name you are entering.
            </p>
          </section>

          <!-- The same health check as the connection indicator (see
               server-health.ts). Not a live region: it changes every
               second, and announcing each check or tick would drown
               everything else out. The countdown is a role="timer", whose
               implicit aria-live is off. -->
          <section class="server" aria-labelledby="server-heading">
            <h3 id="server-heading">Server</h3>
            <dl>
              <div>
                <dt>Is alive</dt>
                <dd>${healthText(this.health.check)}</dd>
              </div>
              <div>
                <dt>Next check</dt>
                <dd><span role="timer">${nextCheckText(this.health.secondsToNextCheck)}</span></dd>
              </div>
            </dl>
          </section>

          <section class="revisions" aria-labelledby="revisions-heading">
            <h3 id="revisions-heading">Revisions</h3>
            <dl>
              <div>
                <dt>Frontend</dt>
                <dd>${this._frontendRevision()}</dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd>
                  ${this.backendRevision ??
                  (this.revisionError ? 'Unavailable' : 'Loading…')}
                </dd>
              </div>
            </dl>
            ${this.revisionError
              ? html`
                  <p class="error">${this.revisionError}</p>
                `
              : null}
          </section>

          <section class="build" aria-labelledby="build-heading">
            <h3 id="build-heading">API image</h3>
            <dl>
              <div>
                <dt>Image tag</dt>
                <dd>${buildInfoText(this.buildInfo, 'imageTag')}</dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd>${buildInfoText(this.buildInfo, 'buildSha')}</dd>
              </div>
              <div>
                <dt>Build context</dt>
                <dd>${buildInfoText(this.buildInfo, 'buildContext')}</dd>
              </div>
            </dl>
            ${this.buildInfo.kind === 'failed'
              ? html`
                  <p class="error">${this.buildInfo.reason}</p>
                `
              : null}
          </section>

          <section class="famous" aria-labelledby="famous-heading">
            <h3 id="famous-heading">Famous verses</h3>
            <p class="note">Draws from the whole Bible favor these verses.</p>
            <details @toggle=${this._onFamousVersesToggle}>
              <summary>Show the list</summary>
              ${this._famousVersesContent()}
            </details>
          </section>
          <slot></slot>
        </div>
      </div>
    `;
  }

  static styles = css`
    /* Each shortcut: its keys on one line, what it does below them — side
       by side, the keys got squeezed into a column and broke apart. */
    .shortcuts dl > div {
      display: block;
      padding: 0;
    }

    .shortcuts dt {
      white-space: nowrap;
      color: inherit;
    }

    .shortcuts dd {
      margin-top: 0.5rem;
      font-family: inherit;
      line-height: 1.4;
    }

    .shortcuts kbd {
      display: inline-block;
      min-width: 1.6em;
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85em;
      padding: 0.1rem 0.4rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-bottom-width: 2px;
      border-radius: 4px;
      /* The border and monospace face carry the meaning; the guide still
         reads correctly without any of this styling. */
    }

    .shortcuts .caveat {
      margin: 0.5rem 0 0;
      padding-left: 0.6rem;
      border-left: 2px solid var(--border);
      font-size: 0.85em;
      color: var(--text-muted);
    }

    .shortcuts .note {
      margin: 0.75rem 0 0;
      font-size: 0.85em;
      color: var(--text-muted);
    }

    /* :host itself is the thing that widens/narrows — the flex sibling in
       bg-app.ts's .layout — so main's width visibly changes as this opens
       and closes, instead of this panel floating on top of it. */
    :host {
      display: block;
      flex-shrink: 0;
      width: 0;
      overflow: hidden;
      transition: width 0.2s ease;
      align-self: stretch;
    }

    :host([data-open]) {
      width: min(22rem, 90vw);
    }

    .panel {
      width: min(22rem, 90vw);
      height: 100%;
      background: var(--surface-raised);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }


    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      border-bottom: 1px solid var(--border);
    }


    h2 {
      font-size: 1rem;
      margin: 0;
    }

    h2:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    .close {
      background: transparent;
      border: none;
      font-size: 1rem;
      cursor: pointer;
      color: inherit;
      padding: 0.25rem 0.5rem;
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }

    .shortcuts,
    .server,
    .revisions,
    .build,
    .famous {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.8rem;
    }

    .shortcuts,
    .server,
    .revisions,
    .build {
      margin-bottom: 0.75rem;
    }

    .shortcuts {
      margin-top: 0.75rem;
    }

    /* A full 40-character commit SHA is wider than the panel: let it wrap
       rather than push the row out of view. */
    .build dd {
      min-width: 0;
      overflow-wrap: anywhere;
      text-align: right;
    }

    h3 {
      font-size: 0.9rem;
      margin: 0 0 0.7rem;
    }

    dl {
      margin: 0;
    }

    dl > div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.3rem 0;
    }

    dt {
      color: var(--text-muted);
    }

    dd {
      margin: 0;
      font-family: monospace;
    }

    .famous .note {
      margin: 0 0 0.5rem;
      font-size: 0.85em;
      opacity: 0.85;
    }

    .famous summary {
      cursor: pointer;
    }

    /* Book above its references: a long book name and a long list of
       references don't fit side by side in the panel. */
    .famous dl > div {
      display: block;
    }

    .famous dd {
      overflow-wrap: anywhere;
    }

    .error {
      color: var(--error);
      font-size: 0.8rem;
      margin: 0.7rem 0 0;
    }

  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-nerd-panel': NerdPanel
  }
}
