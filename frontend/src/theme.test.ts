import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, parseTheme, resolveTheme } from './theme'

// Stored preferences are untrusted — hand-edited, left over from an older
// version, or corrupt — and none of that may stop the application
// starting. See docs/SCRUM/TODO/Feature.EnableDarkmode.md.

describe('parseTheme', () => {
  it('accepts each valid theme', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('system')).toBe('system')
  })

  it('falls back to following the system when nothing is stored', () => {
    expect(parseTheme(null)).toBe(DEFAULT_THEME)
    expect(parseTheme('')).toBe(DEFAULT_THEME)
  })

  it('falls back rather than trusting an unrecognised value', () => {
    expect(parseTheme('midnight')).toBe(DEFAULT_THEME)
    expect(parseTheme('{"theme":"dark"}')).toBe(DEFAULT_THEME)
    expect(parseTheme('DARK')).toBe(DEFAULT_THEME)
  })

  it('defaults to system, not to a fixed palette', () => {
    // A returning user who has never chosen should follow their OS rather
    // than being forced into whichever palette we happened to pick.
    expect(DEFAULT_THEME).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('honours an explicit choice regardless of the system setting', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system setting when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
