import { describe, expect, it } from 'vitest'
import { fileNameFromFingerprint, fingerprintFile } from './verse-cache'

describe('fileNameFromFingerprint', () => {
  // The player must see the filename they chose, with its extension, and
  // never the opaque cache id — see the file-name requirements in
  // docs/SCRUM/TODO/Feature.Accessibility.md.
  it('recovers the original filename from a fingerprint', () => {
    const file = new File(['x'], 'my-bible.epub', { lastModified: 1 })
    expect(fileNameFromFingerprint(fingerprintFile(file))).toBe('my-bible.epub')
  })

  it('keeps the extension', () => {
    const file = new File(['x'], 'export.zip', { lastModified: 2 })
    expect(fileNameFromFingerprint(fingerprintFile(file))).toMatch(/\.zip$/)
  })

  it('handles a filename containing a colon rather than truncating oddly', () => {
    // Not typical, but a name is user-supplied and must not produce an
    // empty or misleading label.
    expect(fileNameFromFingerprint('a:b.epub:100:5')).toBe('a')
  })

  it('falls back to the whole value when there is no separator', () => {
    expect(fileNameFromFingerprint('plain')).toBe('plain')
  })
})
