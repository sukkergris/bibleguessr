import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { styleMap } from 'lit/directives/style-map.js'
import type { Verse } from '../shared-kernel/bible'

/**
 * Displays a Bible verse's text without revealing its reference —
 * that's the thing the player is guessing.
 */
@customElement('bg-verse-card')
export class VerseCard extends LitElement {
  @property({ attribute: false })
  verse?: Verse

  @property({ type: Boolean })
  revealed = false

  // The card's height the last time it showed a verse. While the next
  // verse loads the card keeps (at least) that height instead of
  // collapsing to one line of "Loading verse…", so the guess form below
  // doesn't jump up and back down between verses.
  private lastVerseHeight?: number

  updated() {
    if (this.verse) this.lastVerseHeight = this.getBoundingClientRect().height
  }

  render() {
    if (!this.verse) {
      const keepSize = this.lastVerseHeight ? { minHeight: `${this.lastVerseHeight}px` } : {}
      return html`
        <blockquote class="loading" style=${styleMap(keepSize)}>
          <p class="loading-text">Loading verse…</p>
        </blockquote>
      `
    }

    return html`
      <blockquote>
        <p class="text">${this.verse.text}</p>
        ${this.revealed
          ? html`<footer class="reference">${this.verse.reference} (${this.verse.translation})</footer>`
          : null}
      </blockquote>
    `
  }

  static styles = css`
    :host {
      display: block;
      --card-bg: var(--surface-raised);
      --card-text: var(--text);
      --card-border: var(--border);
      --card-muted: var(--text-muted);
    }


    blockquote {
      box-sizing: border-box;
      margin: 0;
      padding: 2rem;
      border-radius: 12px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--card-text);
    }

    /* The loading text takes the verse's own type size, so the card is the
       same shape either way. */
    .text,
    .loading-text {
      font-size: 1.35rem;
      line-height: 1.5;
      margin: 0;
    }

    .reference {
      margin-top: 1rem;
      font-size: 0.95rem;
      color: var(--card-muted);
    }

    .loading-text {
      color: var(--card-muted);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-verse-card': VerseCard
  }
}
