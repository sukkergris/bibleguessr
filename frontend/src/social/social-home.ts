import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

/**
 * The Social area's start screen — see docs/web/social. Social is its own
 * standalone part of the app: it imports only from its own folder and the
 * shared kernel, never from the game or the multiplayer code (enforced by
 * architecture.test.ts next to this file). Only a placeholder for now.
 */
@customElement('bg-social-home')
export class SocialHome extends LitElement {
  render() {
    return html`
      <section class="social">
        <h1>Social</h1>
        <p class="placeholder">Coming soon.</p>
      </section>
    `
  }

  static styles = css`
    :host {
      display: block;
    }

    .social {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .placeholder {
      margin: 0;
      color: var(--text-muted);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-social-home': SocialHome
  }
}
