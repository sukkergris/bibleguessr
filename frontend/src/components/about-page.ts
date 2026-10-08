import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { NERD_PANEL_SHORTCUT_KEYS } from '../nerd-panel-control'

const PROJECT_RUNEBERG_URL = 'https://runeberg.org/'

/**
 * The About screen — see docs/web/about. Static text about the game, how
 * the player's own Bible file is kept private, and where the bundled Bible
 * text comes from (the full picture is in NOTICE.md), and how to open the
 * nerd panel.
 */
@customElement('bg-about-page')
export class AboutPage extends LitElement {
  render() {
    return html`
      <article class="about">
        <h1>About</h1>

        <section aria-labelledby="about-game">
          <h2 id="about-game">The game</h2>
          <p>
            BibleGuessr shows you a verse from the Bible, and you guess where it comes from: the book, the chapter and
            the verse. A correct book earns points, a correct chapter earns more, and hitting the exact verse earns the
            most.
          </p>
          <p>
            Play on your own, live with friends in a multiplayer room, or take the daily quiz — the same five verses
            for everyone, new every day.
          </p>
        </section>

        <section aria-labelledby="about-privacy">
          <h2 id="about-privacy">Your own Bible stays with you</h2>
          <p>
            You can play with your own Bible file. It is read entirely in your browser and is never uploaded — not to
            our server, and not to other players. Only book, chapter and verse numbers ever leave your device.
          </p>
        </section>

        <section aria-labelledby="about-text">
          <h2 id="about-text">The Bible text</h2>
          <p>
            The built-in Bible is the Danish 1933 Bible (Old Testament from 1931, New Testament from 1907), a
            public-domain text. Its electronic edition was prepared by Søren Hornstrup for
            <a href=${PROJECT_RUNEBERG_URL}>Project Runeberg</a>.
          </p>
        </section>

        <section aria-labelledby="about-source">
          <h2 id="about-source">Open source</h2>
          <p>BibleGuessr's source code is released under the MIT license.</p>
        </section>

        <section aria-labelledby="about-nerd">
          <h2 id="about-nerd">Nerd stuff</h2>
          <p>
            Curious what is going on behind the scenes? The nerd panel shows whether the server is up, which version of
            the app you are running, the list of famous verses the game draws from, and the appearance setting.
          </p>
          <p>
            To open it, tap the small dot in the top-right corner and choose <strong>Nerd panel</strong>. With a
            keyboard, press ${NERD_PANEL_SHORTCUT_KEYS.map((key, i) => html`${i > 0 ? ' + ' : ''}<kbd>${key}</kbd>`)}
            (on a Mac, Alt is the Option key). Press the same keys again, or use the panel's Close button, to hide it.
          </p>
        </section>
      </article>
    `
  }

  static styles = css`
    :host {
      display: block;
    }

    .about {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
      text-align: center;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    h2 {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    p {
      margin: 0;
      line-height: 1.5;
    }

    a {
      color: var(--link);
    }

    /* Matches the nerd panel's own shortcut guide. */
    kbd {
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
    }

    a:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-about-page': AboutPage
  }
}
