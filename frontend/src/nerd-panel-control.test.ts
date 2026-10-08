import { describe, expect, it } from 'vitest'
import { isNerdPanelShortcut, type ShortcutKeyEvent } from './nerd-panel-control'

// The nerd panel's keyboard shortcut — see nerd-panel-control.ts and
// docs/web/keyboard-shortcuts.

/** A key event with no modifiers held, overridden per test. */
function keyEvent(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: 'n',
    code: 'KeyN',
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  }
}

describe('isNerdPanelShortcut', () => {
  it('matches Alt+Shift+N', () => {
    expect(isNerdPanelShortcut(keyEvent({ key: 'N', altKey: true, shiftKey: true }))).toBe(true)
  })

  it('no longer matches Ctrl+Shift+N, which Chrome and Edge on Windows keep for a private window', () => {
    expect(isNerdPanelShortcut(keyEvent({ key: 'N', ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('matches on a Mac, where Option+Shift+N types a symbol instead of an N', () => {
    expect(isNerdPanelShortcut(keyEvent({ key: '˜', altKey: true, shiftKey: true }))).toBe(true)
  })

  it('follows the letter, not the key position, on a layout that puts N elsewhere', () => {
    // Dvorak: the key in QWERTY's N position types a B, and N is on QWERTY's L.
    expect(isNerdPanelShortcut(keyEvent({ key: 'B', code: 'KeyN', altKey: true, shiftKey: true }))).toBe(false)
    expect(isNerdPanelShortcut(keyEvent({ key: 'N', code: 'KeyL', altKey: true, shiftKey: true }))).toBe(true)
  })

  it('needs both Alt and Shift', () => {
    expect(isNerdPanelShortcut(keyEvent({ key: 'n', altKey: true }))).toBe(false)
    expect(isNerdPanelShortcut(keyEvent({ key: 'N', shiftKey: true }))).toBe(false)
  })

  it('ignores the chord with Ctrl or Cmd held as well, so other shortcuts are left alone', () => {
    expect(isNerdPanelShortcut(keyEvent({ key: 'N', altKey: true, shiftKey: true, ctrlKey: true }))).toBe(false)
    expect(isNerdPanelShortcut(keyEvent({ key: 'N', altKey: true, shiftKey: true, metaKey: true }))).toBe(false)
  })

  it('ignores other letters', () => {
    expect(isNerdPanelShortcut(keyEvent({ key: 'M', code: 'KeyM', altKey: true, shiftKey: true }))).toBe(false)
  })
})
