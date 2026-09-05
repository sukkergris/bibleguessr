import type { Page } from '@playwright/test'

/**
 * A small accessibility audit that runs against the rendered page.
 *
 * Everything here walks shadow roots deliberately: every component in this
 * app uses Lit's default shadow DOM, so a plain `document.querySelectorAll`
 * sees almost nothing (see docs/SCRUM/TODO/Feature.Accessibility.md's
 * "test the rendered browser experience, including Lit shadow-DOM
 * boundaries, rather than relying only on source-level attribute checks").
 *
 * These checks are deliberately conservative. They only report things that
 * are unambiguously wrong — a control with no accessible name at all, an
 * input with no label — rather than guessing at subjective questions like
 * whether wording is clear. Anything reported here is worth fixing; the
 * absence of a report is not a claim of full WCAG conformance, which still
 * needs a manual pass with a real screen reader.
 */

export interface A11yFinding {
  /** Which custom element the control lives inside. */
  host: string
  /** A short snippet, enough to identify the control in source. */
  html: string
  /** What is wrong with it. */
  problem: string
}

/** Collects accessibility problems from the page's current state. */
export async function auditA11y(page: Page): Promise<A11yFinding[]> {
  return page.evaluate(() => {
    const INTERACTIVE = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']

    const walk = (root: Document | ShadowRoot, visit: (el: Element) => void) => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        visit(el)
        const shadow = (el as HTMLElement).shadowRoot
        if (shadow) walk(shadow, visit)
      }
    }

    /** Approximates the accessible name, covering the mechanisms this
     * codebase actually uses. `title` is deliberately NOT treated as a
     * name: it is unreliable across screen readers and invisible to touch
     * users, so a control relying on it alone is reported. */
    const accessibleName = (el: Element): string => {
      const ariaLabel = el.getAttribute('aria-label')?.trim()
      if (ariaLabel) return ariaLabel

      const labelledBy = el.getAttribute('aria-labelledby')
      if (labelledBy) {
        const root = el.getRootNode() as ShadowRoot | Document
        const text = labelledBy
          .split(/\s+/)
          .map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim() ?? '')
          .join(' ')
          .trim()
        if (text) return text
      }

      const id = el.getAttribute('id')
      if (id) {
        const root = el.getRootNode() as ShadowRoot | Document
        const label = root.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (label?.textContent?.trim()) return label.textContent.trim()
      }

      const wrapping = el.closest('label')
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim()

      // Buttons and links can be named by their own content.
      if (el.tagName === 'BUTTON' || el.tagName === 'A') {
        const own = (el.textContent ?? '').trim()
        if (own) return own
      }

      const placeholder = el.getAttribute('placeholder')?.trim()
      if (placeholder) return `(placeholder: ${placeholder})`

      return ''
    }

    const findings: { host: string; html: string; problem: string }[] = []

    walk(document, (el) => {
      const host = ((el.getRootNode() as ShadowRoot).host?.tagName ?? 'DOCUMENT').toLowerCase()
      const html = el.outerHTML.slice(0, 100)

      if (!INTERACTIVE.includes(el.tagName)) return
      // Hidden controls can't be reached, so they aren't reported.
      if ((el as HTMLElement).offsetParent === null && el.tagName !== 'INPUT') return
      if (el.getAttribute('type') === 'hidden') return

      const name = accessibleName(el)

      if (name === '') {
        findings.push({ host, html, problem: 'interactive control has no accessible name' })
        return
      }

      // A placeholder disappears once the field has content, so it is not
      // a substitute for a label.
      if (name.startsWith('(placeholder:') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        findings.push({ host, html, problem: 'form field is named only by its placeholder, with no persistent label' })
      }
    })

    return findings
  })
}

/** Formats findings for a readable assertion message. */
export function formatFindings(findings: A11yFinding[]): string {
  if (findings.length === 0) return 'no accessibility findings'
  return findings.map((f) => `  in <${f.host}>: ${f.problem}\n    ${f.html}`).join('\n')
}
