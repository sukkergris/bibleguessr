import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { SubmitBibleFileReport } from '../bible-sources/server-access'
import type { VerseSource } from '../shared-kernel/bible'
import './daily-quiz/daily-quiz-game'

/** Which Social screen is showing. */
type SocialView = { kind: 'home' } | { kind: 'daily-quiz' }

/**
 * The Social area — see docs/web/social. Social is its own standalone
 * part of the app: it imports only from its own folder, the shared kernel,
 * shared UI and bible sources, never from the game or the multiplayer code (enforced by
 * src/architecture.test.ts). Its first content is the daily quiz — see
 * docs/web/daily-quiz.
 */
@customElement('bg-social-home')
export class SocialHome extends LitElement {
  /** The server's translations — given by the app shell (see
   * bible-sources/server-access.ts). */
  @property({ attribute: false })
  serverSource?: VerseSource

  /** Where a problem report about an unusable Bible file is sent. */
  @property({ attribute: false })
  submitBibleFileReport?: SubmitBibleFileReport

  @state()
  private view: SocialView = { kind: 'home' }

  render() {
    switch (this.view.kind) {
      case 'daily-quiz':
        return html`
          <bg-daily-quiz
            .serverSource=${this.serverSource}
            .submitBibleFileReport=${this.submitBibleFileReport}
            @daily-quiz-closed=${() => (this.view = { kind: 'home' })}
          ></bg-daily-quiz>
        `
      case 'home':
        return html`
          <section class="social">
            <h1>Social</h1>
            <div class="group">
              <h2>Daily quiz</h2>
              <button type="button" @click=${() => (this.view = { kind: 'daily-quiz' })}>
                Play today's quiz
                <span class="hint">5 verses from the whole Bible — the same for everyone, new every day at 00:00 UTC</span>
              </button>
            </div>
          </section>
        `
    }
  }

  static styles = css`
    :host {
      display: block;
    }

    .social {
      display: flex;
      flex-direction: column;
      gap: 1.75rem;
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .group {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    h2 {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      text-align: left;
    }

    button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.15rem;
      padding: 0.9rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 1.1rem;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    .hint {
      font-size: 0.8rem;
      font-weight: 400;
      opacity: 0.85;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-social-home': SocialHome
  }
}
