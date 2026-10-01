import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './theme-select'
import { api } from '../api';

/** How often the "Is alive" row pings the server while the panel is open. */
const PING_INTERVAL_MS = 5_000;
/** How long one ping may take before it counts as no answer. */
const PING_TIMEOUT_MS = 5_000;

/** The latest /api/healthz ping, as the "Is alive" row shows it. */
type PingState =
  | { kind: 'checking' }
  | { kind: 'alive'; ms: number }
  | { kind: 'down'; reason: string };

/**
 * A debug drawer along the right edge, toggled with Ctrl+Shift+N — the
 * shell for whatever "nerd stuff" ends up living here (connection
 * diagnostics, an event log, etc.). Empty for now; widgets get slotted in
 * as they're built.
 *
 * Takes real layout space rather than floating over the page: bg-app.ts
 * renders this as a flex sibling of <main>, so opening it narrows the main
 * column instead of covering part of it — the width transition below is
 * what makes that widen/narrow read as a slide rather than a jump cut.
 *
 * Note: Ctrl+Shift+N is "new incognito window" in some browsers (Chrome).
 * preventDefault() on the keydown stops the browser handling it *while
 * this page has focus*, so the shortcut works here — but a browser that
 * intercepts the chord at a level above the page (some do, for this
 * specific one) may still win. If that turns out to bite in practice, the
 * fix is picking a different chord, not fighting the browser further.
 */
@customElement('bg-nerd-panel')
export class NerdPanel extends LitElement {
  @state()
  private open = false;

  @state()
  private backendRevision?: number;

  @state()
  private revisionError?: string;

  /** The latest /api/healthz ping — see _ping. */
  @state()
  private ping: PingState = { kind: 'checking' };

  private _pingTimer?: ReturnType<typeof setInterval>;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeydown);
    void this._loadRevisions();

    // Deliberate, permanent console hint — keep this even when trimming
    // other logging elsewhere. The nerd panel has no visible on-page
    // affordance (no button, no menu entry), so the console is the only
    // place a developer/tester learns the shortcut exists at all.
    console.log('[bg-nerd-panel] Open the nerd panel with Ctrl+Shift+N');
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeydown);
    this._stopPinging();
    super.disconnectedCallback();
  }

  private _onKeydown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n')) return;
    // Never while the player is typing: a global chord that fires inside a
    // text field interrupts ordinary input, which is exactly what
    // docs/SCRUM/TODO/Feature.ShortcutDescriptions.md forbids. Checked
    // through composedPath because focus is usually inside a component's
    // shadow root, where document.activeElement only reports the host.
    if (this._isTypingTarget(e)) return;
    e.preventDefault();
    this.open = !this.open;
  };

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
      if (this.open) this._startPinging();
      else this._stopPinging();
    }
  }

  // Only while the panel is open: nobody sees the result otherwise.
  private _startPinging() {
    this._stopPinging();
    this.ping = { kind: 'checking' };
    void this._ping();
    this._pingTimer = setInterval(() => void this._ping(), PING_INTERVAL_MS);
  }

  private _stopPinging() {
    clearInterval(this._pingTimer);
    this._pingTimer = undefined;
  }

  /** Times one round trip to /api/healthz — the same check the connection
   * dot uses (see connection-status.ts), shown here with its number. */
  private async _ping() {
    const start = performance.now();
    try {
      const response = await fetch(`${api.baseUrl}/api/healthz`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      const ms = Math.round(performance.now() - start);
      this.ping = response.ok
        ? { kind: 'alive', ms }
        : { kind: 'down', reason: `server answered ${response.status}` };
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === 'TimeoutError'
          ? `no answer within ${PING_TIMEOUT_MS / 1000}s`
          : 'could not reach the server';
      this.ping = { kind: 'down', reason };
    }
  }

  private _pingText(): string {
    switch (this.ping.kind) {
      case 'checking':
        return 'Checking…';
      case 'alive':
        return `Yes · ${this.ping.ms} ms`;
      case 'down':
        return `No — ${this.ping.reason}`;
    }
  }

  render() {
    return html`
      <div class="panel" aria-hidden=${!this.open}>
        <header>
          <h2>Nerd stuff</h2>
          <button
            type="button"
            class="close"
            @click=${() => (this.open = false)}
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
                <dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd></dt>
                <dd>
                  Show or hide this panel. Hold all three keys together.
                  <p class="caveat">
                    Some browsers reserve this combination for a new private or incognito window and never pass it to
                    the page. Where that happens, use the panel's Close button — the shortcut is a convenience, not
                    the only way in or out.
                  </p>
                </dd>
              </div>
            </dl>
            <p class="note">
              Shortcuts are ignored while you are typing in a text field, so they cannot interrupt a message or a
              name you are entering.
            </p>
          </section>

          <!-- Not a live region: it changes every few seconds, and
               announcing each ping would drown everything else out. -->
          <section class="server" aria-labelledby="server-heading">
            <h3 id="server-heading">Server</h3>
            <dl>
              <div>
                <dt>Is alive</dt>
                <dd>${this._pingText()}</dd>
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
          <slot></slot>
        </div>
      </div>
    `;
  }

  static styles = css`
    .shortcuts kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85em;
      padding: 0.1rem 0.35rem;
      border: 1px solid rgba(128, 128, 128, 0.6);
      border-radius: 4px;
      /* The border and monospace face carry the meaning; the guide still
         reads correctly without any of this styling. */
    }

    .shortcuts .caveat,
    .shortcuts .note {
      margin: 0.35rem 0 0;
      font-size: 0.85em;
      opacity: 0.85;
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
      border-left: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }


    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      border-bottom: 1px solid #eee;
    }


    h2 {
      font-size: 1rem;
      margin: 0;
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

    .server,
    .revisions {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 0.8rem;
    }

    .server {
      margin-bottom: 0.75rem;
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
