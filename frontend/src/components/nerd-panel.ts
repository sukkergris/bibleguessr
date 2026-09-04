import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'

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

  // Reflects `open` onto a host attribute so the :host([data-open]) width
  // rule (see styles below) can react to it — plain CSS has no way to
  // style a shadow host based on its own internal @state.
  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('open')) {
      this.toggleAttribute('data-open', this.open)
    }
  }

  render() {
    return html`
      <div class="panel" aria-hidden=${!this.open}>
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
