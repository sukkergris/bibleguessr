import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

// The revision shown in the Nerd tab comes from index.html's
// `application-revision` meta tag, which vite.config.ts injects from
// package.json's `revision` at build time. This test asserts the two agree.
//
// It exists because they silently disagreed once already: package.json said
// 0.8.3 while the hand-maintained tag still said 0.7.2, so users saw a
// version that had not been current for several releases. Nothing caught it.
//
// The assertion deliberately runs against build output rather than the
// source file. index.html only holds the placeholder `0`; checking it
// would prove the placeholder is present, not that injection works.
const frontendDir = fileURLToPath(new URL('..', import.meta.url));
const placeholderRevision = '0';

function readPackageRevision(): unknown {
  const raw = readFileSync(
    new URL('../package.json', import.meta.url),
    'utf-8'
  );
  return JSON.parse(raw).revision;
}

function readMetaRevision(html: string): string | undefined {
  return html.match(/<meta name="application-revision" content="([^"]*)"/)?.[1];
}

describe('application revision', () => {
  let builtHtml: string;

  // Builds rather than reading an existing dist/, which is gitignored and so
  // may be absent, stale, or left over from a different revision. A build is
  // ~0.5s, cheap enough to make the test self-contained.
  beforeAll(async () => {
    await build({ root: frontendDir, logLevel: 'silent' });
    builtHtml = readFileSync(
      new URL('../dist/index.html', import.meta.url),
      'utf-8'
    );
  }, 60_000);

  // The revision is a counter, not a semantic version: a positive integer.
  it('keeps package.json revision a positive integer', () => {
    const revision = readPackageRevision();
    expect(Number.isInteger(revision)).toBe(true);
    expect(revision as number).toBeGreaterThan(0);
  });

  it('injects package.json revision into the meta tag', () => {
    expect(readMetaRevision(builtHtml)).toBe(String(readPackageRevision()));
  });

  // The injected value replaces index.html's `0` placeholder. Seeing it
  // survive into the build means the regex in vite.config.ts stopped
  // matching — the exact failure this placeholder exists to make visible.
  it('does not leave the placeholder in the build output', () => {
    expect(readMetaRevision(builtHtml)).not.toBe(placeholderRevision);
  });
});
