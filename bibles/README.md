# bibles/

This folder holds the Bible translation data the backend loads at startup
and serves to players. See [NOTICE.md](../NOTICE.md) for the full legal
picture — the short version:

- **Only public-domain (or otherwise freely redistributable) translations
  belong here, tracked in git.** Copyrighted translations — e.g. Jehovah's
  Witnesses' Ny Verden-Oversættelsen (NWT) — must **never** be committed to
  this repository, in this folder or anywhere else. They are used only
  through the app's "bring your own file" mode, parsed entirely in the
  player's browser; verse text never reaches the server. See
  [docs/jw.org/README.md](../docs/jw.org/README.md) for how that local-only
  workflow is handled.
- One subfolder per translation, named after its source (e.g.
  `bibelen-dk/`).

## Folder layout per translation

```text
bibles/<translation-name>/
├── src/          the file(s) the backend loader actually reads (tracked)
├── archive/      raw source material kept for provenance, not read by any loader (tracked)
└── <working copy># gitignored — any files a loader unzips/extracts locally
```

Only commit what you have the right to redistribute, and record where it
came from in [NOTICE.md](../NOTICE.md) — provenance matters even for
public-domain text.

## Currently bundled

- **`bibelen-dk/`** — Danish, 1931/1907 (Det Danske Bibelselskab), public
  domain. See [NOTICE.md](../NOTICE.md#bundled-bible-text) for the full
  attribution.

## Adding a new translation

Before adding a translation for a new language, verify it is actually
public domain or explicitly licensed for redistribution — don't assume a
"free" or "free to read" Bible site means free to bundle. Always check the
source's own license/terms page, not just its marketing copy. Some
starting points to check (verify the license per book/edition before
committing anything):

| Language | Source to check | Notes |
| --- | --- | --- |
| Danish (da) | [Project Runeberg](https://runeberg.org/bibel/) | Same source as the bundled `bibelen-dk/` (1931/1907 edition). |
| English (en) | [World English Bible via ebible.org](https://ebible.org/find/show.php?id=eng-web) | WEB is explicitly public domain. |
| English (en) | [King James Version](https://www.gutenberg.org/ebooks/10) | Public domain in most jurisdictions (Crown Copyright applies only in the UK). |
| Multiple | [eBible.org](https://ebible.org/find/) | Aggregates many translations; check each entry's own license — not all are public domain, some are CC-BY or more restrictive. |
| Multiple | [unfoldingWord (Door43)](https://www.unfoldingword.org/) | Unlocked/open-licensed translations (CC-BY-SA), built for redistribution — still check the specific license per resource. |
| Multiple | [Wikisource](https://www.wikisource.org/) | Hosts many out-of-copyright translations; check the individual work's copyright status page. |

Once you've confirmed a source is safe to bundle:

1. Create `bibles/<translation-name>/src/` and drop in the original
   file(s) as downloaded (zip, txt, whatever the source provides).
2. Write a loader (see `backend/Api/BibelenDkLoader.fs` for the pattern).
   bibelen-dk's archive is unpacked on startup into a data folder outside
   the tracked tree (the gitignored `bibles/.data/` locally, a volume in
   the Docker image) by `backend/Api/BibleArchiveUnpacker.fs`, and loaded
   from there; see `docs/web/bible-data-volume/`. The image copies each
   archive explicitly, so a new one also needs its own line in
   `build/Dockerfile.api`.
3. Add an entry to [NOTICE.md](../NOTICE.md) recording the translation,
   edition, original source, and why it's redistributable.
4. Update the table above and the "Currently bundled" list in this file.
