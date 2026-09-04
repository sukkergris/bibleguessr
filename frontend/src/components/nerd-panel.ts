import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'

/**
 * A slide-in debug drawer, toggled with Ctrl+Shift+N — the shell for
 * whatever "nerd stuff" ends up living here (connection diagnostics, an
 * event log, etc.). Empty for now; widgets get slotted in as they're built.
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
  private open = false

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('keydown', this._onKeydown)
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeydown)
    super.disconnectedCallback()
  }

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      this.open = !this.open
    }
  }

  render() {
    return html`
      <div class="panel ${this.open ? 'open' : ''}" aria-hidden=${!this.open}>
        <header>
          <h2>Nerd stuff</h2>
          <button type="button" class="close" @click=${() => (this.open = false)} aria-label="Close">✕</button>
        </header>
        <div class="content">
          <p class="empty">Nothing here yet.</p>
          <slot></slot>
        </div>
      </div>
    `
  }

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(22rem, 90vw);
      background: white;
      border-left: 1px solid #ddd;
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
      transform: translateX(100%);
      transition: transform 0.2s ease;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    .panel.open {
      transform: translateX(0);
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

    .empty {
      color: #6b6375;
      font-size: 0.85rem;
      text-align: center;
      margin-top: 2rem;
    }

    @media (prefers-color-scheme: dark) {
      .empty {
        color: #9ca3af;
      }
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-nerd-panel': NerdPanel
  }
}
