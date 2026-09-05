import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'

type Status = 'collapsed' | 'expanded' | 'sending' | 'sent' | 'failed'

/**
 * "Report this issue" — shown alongside a Bible-file upload error (see
 * game-setup.ts's FileState 'error' variant and
 * docs/SCRUM/Feature.ErrorMessageBibleLoader.md). Collapsed to a single
 * link by default; expanding it reveals a short description field and a
 * submit button. The error message and file name that triggered this are
 * passed in as properties — captured automatically, so the player only
 * ever has to describe what they were doing/expecting, not restate the
 * error itself.
 */
@customElement('bg-report-error')
export class ReportError extends LitElement {
  @property({ type: String })
  errorMessage = ''

  @property({ type: String })
  fileName?: string

  @state()
  private _status: Status = 'collapsed'

  @state()
  private _description = ''

  @state()
  private _failureMessage?: string

  render() {
    if (this._status === 'collapsed') {
      return html`<button type="button" class="link" @click=${() => (this._status = 'expanded')}>
        Report this issue
      </button>`
    }

    if (this._status === 'sent') {
      return html`<p class="sent">✓ Thanks — your report was sent.</p>`
    }

    const sending = this._status === 'sending'

    return html`
      <div class="report">
        <label>
          What were you trying to do, and what happened?
          <textarea
            .value=${this._description}
            @input=${(e: Event) => (this._description = (e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. Uploaded my NWT export and it just spins forever…"
            rows="3"
            ?disabled=${sending}
          ></textarea>
        </label>

        ${this._failureMessage ? html`<p class="error">${this._failureMessage}</p>` : null}

        <div class="actions">
          <button type="button" @click=${this._onSubmit} ?disabled=${sending || !this._description.trim()}>
            ${sending ? 'Sending…' : 'Send report'}
          </button>
          <button type="button" class="secondary" @click=${() => (this._status = 'collapsed')} ?disabled=${sending}>
            Cancel
          </button>
        </div>
      </div>
    `
  }

  private async _onSubmit() {
    const description = this._description.trim()
    if (!description) return

    this._status = 'sending'
    this._failureMessage = undefined

    try {
      await api.submitBibleFileUploadReport({ description, fileName: this.fileName, errorMessage: this.errorMessage })
      this._status = 'sent'
    } catch (err) {
      this._failureMessage = err instanceof Error ? err.message : 'Failed to send the report.'
      this._status = 'expanded'
    }
  }

  static styles = css`
    :host {
      display: block;
    }

    .link {
      background: none;
      border: none;
      padding: 0;
      color: var(--accent);
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: underline;
    }

    .sent {
      margin: 0;
      font-size: 0.85rem;
      color: var(--success);
    }

    .report {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.75rem;
      border: 1px solid #ccc;
      border-radius: 10px;
      text-align: left;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      font-size: 0.85rem;
    }

    textarea {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 0.9rem;
      font-family: inherit;
      resize: vertical;
    }

    .error {
      margin: 0;
      font-size: 0.8rem;
      color: #d33;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
    }

    button {
      padding: 0.45rem 1rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 0.85rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-report-error': ReportError
  }
}
