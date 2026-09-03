# Session notes: jwpub Bible data + SQLite devcontainer service

## Context

The project has a source file `jw/Bible Online jwpub.jwpub` — a `.jwpub` package
(JW Library's publication format) containing the **Danish New World Translation
Study Bible** ("Studiebibelen" / `nwtsty`). This is likely the intended Bible-text
data source for `bibleguessr`.

## What a `.jwpub` file actually is

It's a ZIP archive, nested two levels deep:

```
Bible Online jwpub.jwpub  (zip)
├── manifest.json          — metadata: title, hash, publication info
└── contents               (nested zip, no extension)
    ├── nwtsty_D.db         — SQLite DB: full Bible text, verses, study notes
    └── *.jpg / *.svg       — cover art, maps, illustration images
```

`manifest.json` confirms: `title: "Ny Verden-Oversættelsen af Bibelen (Studieudgave)"`,
symbol `nwtsty`, language 54 (Danish), publicationType `Bible`.

### How to extract it (on Linux/devcontainer)

```bash
mkdir -p jwpub_extract
unzip -o "jw/Bible Online jwpub.jwpub" -d jwpub_extract
mkdir -p jwpub_extract/contents_extract
unzip -o jwpub_extract/contents -d jwpub_extract/contents_extract
# Bible text ends up in: jwpub_extract/contents_extract/nwtsty_D.db
```

The `.db` is a standard SQLite file — inspect with `sqlite3 nwtsty_D.db ".tables"`.
Expect JW Library's typical schema (tables like `Verse`, `BibleBook`, `Publication`,
`DocumentMultimedia`, etc.) — not yet explored in this session.

## docker-compose.yml change: sqlite-web service

Added a `sqlite-web` service to `.devcontainer/debian/docker-compose.yml` so the
extracted `.db` can be browsed/queried from a browser instead of only via CLI.

- Image: `coleifer/sqlite-web:latest`
- Mounts the whole workspace (`../..`) into `/data` (same as the `dev` service)
- Port: host `8081` → container `8080`
- `SQLITE_DATABASE: nwtsty_D.db` — **placeholder**, needs updating to the real
  relative path once extracted, e.g. `jw/contents_extract/nwtsty_D.db`

Run it with:

```bash
docker compose -f .devcontainer/debian/docker-compose.yml up sqlite-web
```

Then open http://localhost:8081.

## Still TODO / open thread

- The `.jwpub` has not yet been extracted into the repo itself — only into a
  session scratchpad dir that no longer exists. Re-extract inside the
  devcontainer using the steps above before `sqlite-web` has anything to show.
- Consider adding an extraction script (e.g. `scripts/extract-jwpub.sh`) so the
  `SQLITE_DATABASE` path in docker-compose.yml resolves to a real file
  automatically, rather than being a manual one-off step.
- Haven't yet inspected `nwtsty_D.db`'s schema/tables — do that next to figure
  out how to pull verse text programmatically for the guessing-game feature.
