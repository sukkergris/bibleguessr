import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api';

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
  private backendVersion?: string;

  @state()
  private versionError?: string;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeydown);
    void this._loadVersions();

    // Deliberate, permanent console hint — keep this even when trimming
    // other logging elsewhere. The nerd panel has no visible on-page
    // affordance (no button, no menu entry), so the console is the only
    // place a developer/tester learns the shortcut exists at all.
    console.log('[bg-nerd-panel] Open the nerd panel with Ctrl+Shift+N');
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeydown);
    super.disconnectedCallback();
  }

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      this.open = !this.open;
    }
  };

  private async _loadVersions() {
    try {
      const response = await api.getVersion();
      this.backendVersion = response.version;
      this.versionError = undefined;
    } catch (error) {
      this.versionError =
        error instanceof Error ? error.message : 'Backend version unavailable.';
    }
  }

  private _frontendVersion() {
    return (
      document
        .querySelector('meta[name="application-version"]')
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
          <section class="versions" aria-labelledby="versions-heading">
            <h3 id="versions-heading">Versions</h3>
            <dl>
              <div>
                <dt>Frontend</dt>
                <dd>${this._frontendVersion()}</dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd>
                  ${this.backendVersion ??
                  (this.versionError ? 'Unavailable' : 'Loading…')}
                </dd>
              </div>
            </dl>
            ${this.versionError
              ? html`
                  <p class="error">${this.versionError}</p>
                `
              : null}
          </section>
          <slot></slot>
        </div>
      </div>
    `;
  }

  static styles = css`
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
      background: white;
      border-left: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      .panel {
        background: #1f1b24;
        border-left-color: #3a3440;
      }
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      border-bottom: 1px solid #eee;
    }

    @media (prefers-color-scheme: dark) {
      header {
        border-bottom-color: #3a3440;
      }
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

    .versions {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 0.8rem;
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
      color: #6b6375;
    }

    dd {
      margin: 0;
      font-family: monospace;
    }

    .error {
      color: #b42318;
      font-size: 0.8rem;
      margin: 0.7rem 0 0;
    }

    @media (prefers-color-scheme: dark) {
      .versions {
        border-color: #3a3440;
      }

      dt {
        color: #9ca3af;
      }

      .error {
        color: #fca5a5;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-nerd-panel': NerdPanel
  }
}
