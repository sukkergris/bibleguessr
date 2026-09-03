import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { Verse } from '../types'

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

  render() {
    if (!this.verse) {
      return html`<p class="loading">Loading verse…</p>`
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
      --card-bg: #fff;
      --card-text: #1a1a1a;
      --card-border: #e5e4e7;
      --card-muted: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --card-bg: #1f2028;
        --card-text: #f3f4f6;
        --card-border: #2e303a;
        --card-muted: #9ca3af;
      }
    }

    blockquote {
      margin: 0;
      padding: 2rem;
      border-radius: 12px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--card-text);
    }

    .text {
      font-size: 1.35rem;
      line-height: 1.5;
      margin: 0;
    }

    .reference {
      margin-top: 1rem;
      font-size: 0.95rem;
      color: var(--card-muted);
    }

    .loading {
      color: var(--card-muted);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-verse-card': VerseCard
  }
}
