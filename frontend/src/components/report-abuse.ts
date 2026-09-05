import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'

/** What the form is currently doing. An explicit state model rather than
 * separate booleans, so impossible combinations (sending AND sent, say)
 * can't be represented at all. */
type SubmitState =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }

/**
 * The "Report abuse" view — see docs/SCRUM/Feature.ReportAbuse.md. Opened
 * from the sticky report button in bg-app.ts, and shown in place of
 * whatever screen the player was on; Cancel returns them there untouched.
 *
 * Reports go to a dedicated backend endpoint that emails the application
 * owner. Nothing is stored locally: no browser storage, no game state, and
 * deliberately nothing captured automatically — only what the reporter
 * types, so a report can never carry uploaded verse text or another
 * player's data without them choosing to include it.
 *
 * Fires `report-closed` when the reporter cancels or finishes, so the
 * parent can restore the previous view and return focus to the button that
 * opened this.
 */
@customElement('bg-report-abuse')
export class ReportAbuse extends LitElement {
  @state()
  private description = ''

  @state()
  private reportedPlayer = ''

  @state()
  private replyTo = ''

  @state()
  private submitState: SubmitState = { kind: 'editing' }

  /** Set once the reporter has tried to submit — so the "please describe
   * what happened" message appears on submit rather than nagging someone
   * who simply hasn't started typing yet. */
  @state()
  private showValidation = false

  private get _descriptionError(): string | undefined {
    if (!this.showValidation) return undefined
    return this.description.trim() === '' ? 'Please describe what happened.' : undefined
  }

  render() {
    const sending = this.submitState.kind === 'sending'

    if (this.submitState.kind === 'sent') {
      return html`
        <section class="panel" aria-labelledby="report-title">
          <h1 id="report-title">Report abuse</h1>
          <p class="success" role="status">
            Thank you — your report has been sent to the application owner for review.
          </p>
          <div class="actions">
            <button type="button" @click=${this._onClose}>Back</button>
          </div>
        </section>
      `
    }

    return html`
      <section class="panel" aria-labelledby="report-title">
        <h1 id="report-title">Report abuse</h1>

        <p class="intro">
          Tell us about abusive, harassing or unsafe behaviour. Your report is sent to the application owner for
          review.
        </p>
        <p class="warning">
          Please don't include passwords, payment information or other sensitive personal details.
        </p>

        <form @submit=${this._onSubmit} novalidate>
          <label for="report-description">
            What happened? <span class="required">(required)</span>
          </label>
          <textarea
            id="report-description"
            rows="6"
            .value=${this.description}
            ?disabled=${sending}
            aria-describedby=${this._descriptionError ? 'report-description-error' : 'report-description-hint'}
            aria-invalid=${this._descriptionError ? 'true' : 'false'}
            @input=${(e: Event) => (this.description = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
          <p id="report-description-hint" class="hint">
            Describe what was said or done, and why it felt abusive or unsafe.
          </p>
          ${this._descriptionError
            ? html`<p id="report-description-error" class="error" role="alert">${this._descriptionError}</p>`
            : null}

          <label for="report-player">Who are you reporting? <span class="optional">(optional)</span></label>
          <input
            id="report-player"
            type="text"
            .value=${this.reportedPlayer}
            ?disabled=${sending}
            aria-describedby="report-player-hint"
            @input=${(e: Event) => (this.reportedPlayer = (e.target as HTMLInputElement).value)}
          />
          <p id="report-player-hint" class="hint">The name you saw them using, if you remember it.</p>

          <label for="report-reply">Your email, if you'd like a reply <span class="optional">(optional)</span></label>
          <input
            id="report-reply"
            type="email"
            .value=${this.replyTo}
            ?disabled=${sending}
            aria-describedby="report-reply-hint"
            @input=${(e: Event) => (this.replyTo = (e.target as HTMLInputElement).value)}
          />
          <p id="report-reply-hint" class="hint">Only used to reply to this report.</p>

          ${this.submitState.kind === 'failed'
            ? html`<p class="error" role="alert">${this.submitState.message}</p>`
            : null}

          <div class="actions">
            <button type="button" class="secondary" ?disabled=${sending} @click=${this._onClose}>Cancel</button>
            <button type="submit" ?disabled=${sending}>${sending ? 'Sending…' : 'Send report'}</button>
          </div>
          <p class="sending-status" role="status">${sending ? 'Sending your report…' : ''}</p>
        </form>
      </section>
    `
  }

  private _onSubmit(event: Event) {
    event.preventDefault()
    // Guard against a double submit: the button is disabled while sending,
    // but a form can also be submitted by pressing Enter in a field, which
    // a disabled button doesn't prevent.
    if (this.submitState.kind === 'sending') return

    this.showValidation = true
    const description = this.description.trim()
    if (description === '') {
      // Move focus to the field so a keyboard or screen-reader user is
      // taken to the problem rather than left at the button.
      this.updateComplete.then(() => {
        this.shadowRoot?.querySelector<HTMLTextAreaElement>('#report-description')?.focus()
      })
      return
    }

    this.submitState = { kind: 'sending' }

    api
      .submitAbuseReport({
        description,
        reportedPlayer: this.reportedPlayer.trim() || undefined,
        replyTo: this.replyTo.trim() || undefined,
      })
      .then(() => {
        this.submitState = { kind: 'sent' }
      })
      .catch((err: unknown) => {
        console.error('[bg-report-abuse] failed to send abuse report', err)
        // The entered values are deliberately left untouched so the
        // reporter can retry without retyping everything.
        this.submitState = {
          kind: 'failed',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Could not send your report. Please try again.',
        }
      })
  }

  private _onClose() {
    this.dispatchEvent(new CustomEvent('report-closed', { bubbles: true, composed: true }))
  }

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      text-align: left;
    }

    h1 {
      font-size: 1.4rem;
      margin: 0 0 0.25rem;
    }

    .intro,
    .warning,
    .hint {
      margin: 0;
      font-size: 0.85rem;
      opacity: 0.8;
    }

    .warning {
      opacity: 1;
      font-weight: 600;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-top: 0.5rem;
    }

    label {
      font-size: 0.9rem;
      font-weight: 600;
      margin-top: 0.5rem;
    }

    .required,
    .optional {
      font-weight: 400;
      opacity: 0.7;
      font-size: 0.85em;
    }

    textarea,
    input {
      font: inherit;
      padding: 0.5rem;
      border-radius: 8px;
      border: 1px solid rgba(128, 128, 128, 0.6);
      background: transparent;
      color: inherit;
      width: 100%;
      box-sizing: border-box;
    }

    /* Not colour alone: an invalid field also gets a thicker border, so
       the state is visible without relying on hue. */
    [aria-invalid='true'] {
      border-color: #d33;
      border-width: 2px;
    }

    .error {
      margin: 0;
      color: #d33;
      font-weight: 600;
      font-size: 0.85rem;
    }

    .success {
      margin: 0.5rem 0;
      font-weight: 600;
    }

    .sending-status {
      margin: 0;
      font-size: 0.85rem;
      opacity: 0.8;
      min-height: 1.2em;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
      margin-top: 0.75rem;
    }

    button {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 0.95rem;
      cursor: pointer;
    }

    button.secondary {
      background: transparent;
      color: inherit;
      border: 1px solid rgba(128, 128, 128, 0.6);
    }

    button:disabled {
      opacity: 0.6;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-report-abuse': ReportAbuse
  }
}
