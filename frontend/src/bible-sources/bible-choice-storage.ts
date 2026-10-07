/**
 * The player's remembered Bible — one choice shared by every setup screen
 * (each singleplayer game type, multiplayer and the daily quiz) and kept
 * across visits. See docs/web/remembered-bible and
 * docs/SCRUM/DONE/Feature.RememberBibleChoiceAcrossGameTypes.md.
 *
 * Only which Bible is remembered: a server translation by name, or an
 * uploaded file by its cache fingerprint. Never verse text, and never sent
 * anywhere — a fingerprint holds the file's name.
 *
 * Every read is validated rather than trusted, like game-preferences.ts:
 * storage can be edited by hand, left over from an older version, or
 * corrupt, and an unusable value is simply no choice.
 */

const BIBLE_CHOICE_KEY = 'bibleguessr:preferences:bibleChoice:v1'

export type BibleChoice = { kind: 'server'; translation: string } | { kind: 'file'; fingerprint: string }

const isNonBlankString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** Narrows an arbitrary stored string to a Bible choice, or none. */
export function parseBibleChoice(raw: string | null): BibleChoice | undefined {
  if (!raw) return undefined

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined

  const record = value as Record<string, unknown>
  if (record.kind === 'server' && isNonBlankString(record.translation)) {
    return { kind: 'server', translation: record.translation }
  }
  if (record.kind === 'file' && isNonBlankString(record.fingerprint)) {
    return { kind: 'file', fingerprint: record.fingerprint }
  }
  return undefined
}

/** Only the choice's own fields, whatever else the value carries. */
export function serializeBibleChoice(choice: BibleChoice): string {
  return JSON.stringify(
    choice.kind === 'server'
      ? { kind: choice.kind, translation: choice.translation }
      : { kind: choice.kind, fingerprint: choice.fingerprint },
  )
}

/** The server translation to preselect: the remembered one while the
 * server still offers it, otherwise the first — or none while the server
 * offers nothing (still loading, or unreachable). */
export function translationToPreselect(remembered: BibleChoice | undefined, translations: string[]): string | undefined {
  if (remembered?.kind === 'server' && translations.includes(remembered.translation)) return remembered.translation
  return translations[0]
}

/** The cached file to preselect: the remembered one while it is still
 * cached, otherwise none. Doesn't depend on the server, so a remembered
 * file is restored even when the server is unreachable. */
export function fileToRestore(remembered: BibleChoice | undefined, cachedFingerprints: string[]): string | undefined {
  if (remembered?.kind !== 'file') return undefined
  return cachedFingerprints.includes(remembered.fingerprint) ? remembered.fingerprint : undefined
}

/** Reads the remembered choice — none when nothing usable is stored, or
 * when storage itself is unavailable, as in private browsing. */
export function loadBibleChoice(): BibleChoice | undefined {
  try {
    return parseBibleChoice(localStorage.getItem(BIBLE_CHOICE_KEY))
  } catch {
    return undefined
  }
}

/** Remembers a choice for every setup screen and later visits. */
export function saveBibleChoice(choice: BibleChoice): void {
  try {
    localStorage.setItem(BIBLE_CHOICE_KEY, serializeBibleChoice(choice))
  } catch {
    // Storage unavailable — the choice simply isn't remembered, which is
    // never worth failing setup over.
  }
}
