import { css } from 'lit'

/**
 * The app's one set of button styles — see docs/web/accessibility. Every
 * component with ordinary buttons includes this first in its `static
 * styles` (shadow DOM keeps page CSS out, so each needs its own copy of
 * the rules), instead of writing its own: they used to drift into four
 * heights, four font sizes and two secondary looks.
 *
 *   <button>                  the main action — filled accent
 *   class="secondary"         a second choice — accent outline
 *   class="danger"            a destructive choice — red outline
 *   class="danger-solid"      confirming a destructive choice — filled red
 *   class="compact"           a smaller size of any of the above, for
 *                             buttons inside lists, small forms and status lines
 *
 * Every variant has the same 1px border, so filled and outlined buttons
 * are exactly the same height side by side. Special controls (tabs, tiles,
 * the start screen's big menu buttons, icon buttons) keep their own styles.
 */
export const buttonStyles = css`
  button {
    padding: 0.7rem 1.25rem;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-text);
    font-family: inherit;
    font-size: 1rem;
    line-height: 1.2;
    cursor: pointer;
  }

  button.secondary {
    background: transparent;
    color: var(--accent);
  }

  button.danger {
    background: transparent;
    border-color: var(--error);
    color: var(--error);
  }

  button.danger-solid {
    background: var(--danger-solid);
    border-color: var(--danger-solid);
    color: var(--danger-solid-text);
  }

  button.compact {
    padding: 0.4rem 0.9rem;
    font-size: 0.9rem;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
`
