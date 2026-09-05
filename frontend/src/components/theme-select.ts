import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { applyTheme, loadTheme, saveTheme, type Theme } from '../theme'

/**
 * Light / Dark / System — see
 * docs/SCRUM/TODO/Feature.EnableDarkmode.md.
 *
 * Native radio inputs rather than buttons with `aria-pressed`: a theme is
 * one choice among three, which is exactly what a radio group means, and
 * native semantics give arrow-key navigation and the correct
 * announcement for free.
 */
@customElement('bg-theme-select')
export class ThemeSelect extends LitElement {
  @state()
  private theme: Theme = loadTheme()

  /** Stops the previous preference following the OS. Only a `system`
   * preference registers such a listener, but replacing the theme must
   * still tear down whatever the last one left behind. */
  private _stopFollowingSystem?: () => void

  connectedCallback() {
    super.connectedCallback()
    this._stopFollowingSystem = applyTheme(this.theme)
  }

  disconnectedCallback() {
    this._stopFollowingSystem?.()
    super.disconnectedCallback()
  }

  render() {
    const options: { value: Theme; label: string }[] = [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' },
    ]

    return html`
      <fieldset>
        <legend>Theme</legend>
        ${options.map(
          (option) => html`
            <label>
              <input
                type="radio"
                name="theme"
                value=${option.value}
                .checked=${this.theme === option.value}
                @change=${() => this._select(option.value)}
              />
              ${option.label}
            </label>
          `,
        )}
        <p class="hint">System follows your device's appearance setting.</p>
      </fieldset>
    `
  }

  private _select(theme: Theme) {
    this.theme = theme
    saveTheme(theme)
    // Replace the OS listener rather than adding another: switching
    // between System and an explicit choice repeatedly would otherwise
    // leave a stack of listeners all repainting.
    this._stopFollowingSystem?.()
    this._stopFollowingSystem = applyTheme(theme)
  }

  static styles = css`
    :host {
      display: block;
    }

    fieldset {
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 0;
      padding: 0.5rem 0.75rem 0.75rem;
      color: var(--text);
    }

    legend {
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0 0.25rem;
    }

    label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.9rem;
      padding: 0.15rem 0;
      cursor: pointer;
    }

    .hint {
      margin: 0.4rem 0 0;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    input:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-theme-select': ThemeSelect
  }
}
