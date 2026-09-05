import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'

/** What the form is currently doing — an explicit state model, so
 * impossible combinations cannot be represented. */
type SubmitState =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }

/**
 * The "Report a bug" panel — see docs/SCRUM/DONE/Feature.BugReport.md.
 * Opened from the sticky bug button in bg-app.ts, shown in place of
 * whatever screen the player was on; Cancel returns them there untouched.
 *
 * Deliberately separate from both sibling flows: the Bible-file error
 * reporter captures a filename and loader error automatically, and abuse
 * reports concern another player's behaviour. This one is for technical
 * problems and must not be routed through either.
 *
 * Nothing is captured automatically — no Bible file, verse text, chat
 * history or game transcript. A report contains only what the player
 * typed.
 *
 * Fires `report-closed` when the reporter cancels or finishes, and
 * `report-sending-changed` so the shell can keep its toggle from tearing
 * this view down mid-request.
 */
@customElement('bg-bug-report')
export class BugReport extends LitElement {
  @state()
  private description = ''

  @state()
  private context = ''

  @state()
  private replyTo = ''

  @state()
  private submitState: SubmitState = { kind: 'editing' }

  /** Set once the reporter has tried to submit, so validation appears on
   * submit rather than nagging someone who hasn't started typing. */
  @state()
  private showValidation = false

  get isSending(): boolean {
    return this.submitState.kind === 'sending'
  }

  private get _descriptionError(): string | undefined {
    if (!this.showValidation) return undefined
    return this.description.trim() === '' ? 'Please describe what happened.' : undefined
  }

  render() {
    const sending = this.submitState.kind === 'sending'

    if (this.submitState.kind === 'sent') {
      return html`
        <section class="panel" aria-labelledby="bug-title">
          <h1 id="bug-title">Report a bug</h1>
          <p class="success" role="status">Thank you — your report has been sent for review.</p>
          <div class="actions">
            <button type="button" @click=${this._onClose}>Back</button>
          </div>
        </section>
      `
    }

    return html`
      <section class="panel" aria-labelledby="bug-title">
        <h1 id="bug-title">Report a bug</h1>

        <p class="intro">
          Something not working as it should? Tell us what happened and we'll take a look.
        </p>
        <p class="warning">
          Please don't include passwords, payment information, private Bible text or other sensitive personal
          details.
        </p>

        <form @submit=${this._onSubmit} novalidate>
          <label for="bug-description">What happened? <span class="required">(required)</span></label>
          <textarea
            id="bug-description"
            rows="6"
            .value=${this.description}
            ?disabled=${sending}
            aria-describedby=${this._descriptionError ? 'bug-description-error' : 'bug-description-hint'}
            aria-invalid=${this._descriptionError ? 'true' : 'false'}
            @input=${(e: Event) => (this.description = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
          <p id="bug-description-hint" class="hint">What did you expect, and what happened instead?</p>
          ${this._descriptionError
            ? html`<p id="bug-description-error" class="error" role="alert">${this._descriptionError}</p>`
            : null}

          <label for="bug-context">Where were you? <span class="optional">(optional)</span></label>
          <input
            id="bug-context"
            type="text"
            .value=${this.context}
            ?disabled=${sending}
            aria-describedby="bug-context-hint"
            @input=${(e: Event) => (this.context = (e.target as HTMLInputElement).value)}
          />
          <p id="bug-context-hint" class="hint">The screen you were on, or anything you already tried.</p>

          <label for="bug-reply">Your email, if you'd like a reply <span class="optional">(optional)</span></label>
          <input
            id="bug-reply"
            type="email"
            .value=${this.replyTo}
            ?disabled=${sending}
            aria-describedby="bug-reply-hint"
            @input=${(e: Event) => (this.replyTo = (e.target as HTMLInputElement).value)}
          />
          <p id="bug-reply-hint" class="hint">Only used to reply to this report.</p>

          ${this.submitState.kind === 'failed'
            ? html`<p class="error" role="alert">${this.submitState.message}</p>`
            : null}

          <div class="actions">
            <button type="button" class="secondary" ?disabled=${sending} @click=${this._onClose}>Cancel</button>
            <button type="submit" ?disabled=${sending}>${sending ? 'Sending…' : 'Send bug report'}</button>
          </div>
          <p class="sending-status" role="status">${sending ? 'Sending your report…' : ''}</p>
        </form>
      </section>
    `
  }

  protected updated(changed: Map<string, unknown>) {
    if (!changed.has('submitState')) return
    this.dispatchEvent(
      new CustomEvent<boolean>('report-sending-changed', {
        detail: this.isSending,
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _onSubmit(event: Event) {
    event.preventDefault()
    // A form can also be submitted with Enter in a field, which a disabled
    // button does not prevent — so the guard is here, not only on the
    // button.
    if (this.submitState.kind === 'sending') return

    this.showValidation = true
    const description = this.description.trim()
    if (description === '') {
      this.updateComplete.then(() => {
        this.shadowRoot?.querySelector<HTMLTextAreaElement>('#bug-description')?.focus()
      })
      return
    }

    this.submitState = { kind: 'sending' }

    api
      .submitGeneralBugReport({
        description,
        context: this.context.trim() || undefined,
        replyTo: this.replyTo.trim() || undefined,
      })
      .then(() => {
        this.submitState = { kind: 'sent' }
      })
      .catch((err: unknown) => {
        console.error('[bg-bug-report] failed to send bug report', err)
        // Entered values are left untouched so the report can be retried
        // without retyping.
        this.submitState = {
          kind: 'failed',
          message:
            err instanceof Error && err.message ? err.message : 'Could not send your report. Please try again.',
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

    /* Not colour alone: an invalid field also thickens its border. */
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
    'bg-bug-report': BugReport
  }
}
