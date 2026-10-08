import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { SubmitBibleFileReport } from '../bible-sources/server-access'
import type { VerseSource } from '../shared-kernel/bible'
import './daily-quiz/daily-quiz-game'

/** Which Social screen is showing. */
export type SocialView = 'home' | 'daily-quiz'

/**
 * The Social area — see docs/web/social. Social is its own standalone
 * part of the app: it imports only from its own folder, the shared kernel,
 * shared UI and bible sources, never from the game or the multiplayer code (enforced by
 * src/architecture.test.ts). Its first content is the daily quiz — see
 * docs/web/daily-quiz.
 *
 * Which screen shows is decided by the app's address (/social or
 * /social/daily-quiz — see docs/web/url-routing), so the app shell owns it:
 * this element shows `view` and asks for another with a
 * `social-view-requested` CustomEvent<SocialView>. That keeps Social free
 * of the app's routing while its screens still have their own links.
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

  @property({ attribute: false })
  view: SocialView = 'home'

  /** The daily quiz's own address, for the link in a shared result — so
   * whoever follows it lands straight in the quiz. */
  @property({ attribute: false })
  dailyQuizUrl?: string

  private request(view: SocialView) {
    this.dispatchEvent(
      new CustomEvent<SocialView>('social-view-requested', { detail: view, bubbles: true, composed: true }),
    )
  }

  render() {
    switch (this.view) {
      case 'daily-quiz':
        return html`
          <bg-daily-quiz
            .serverSource=${this.serverSource}
            .submitBibleFileReport=${this.submitBibleFileReport}
            .shareUrl=${this.dailyQuizUrl}
            @daily-quiz-closed=${() => this.request('home')}
          ></bg-daily-quiz>
        `
      case 'home':
        return html`
          <section class="social">
            <h1>Social</h1>
            <div class="group">
              <h2>Daily quiz</h2>
              <button type="button" @click=${() => this.request('daily-quiz')}>
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
