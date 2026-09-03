#!/usr/bin/env bash
set -Eeuo pipefail

# Extract a .jwpub file (JW Library publication package) into its component
# files, most importantly the SQLite .db that holds the publication content.
#
# A .jwpub is a zip archive containing a manifest.json and a nested zip
# (named "contents", no extension) which in turn holds the .db plus any
# images/svgs bundled with the publication.
#
# Usage:
#   .devcontainer/scripts/extract-jwpub.sh [path/to/file.jwpub] [output-dir]
#
# Defaults:
#   path/to/file.jwpub  first *.jwpub found under jw/ (recursive)
#   output-dir          jw/extract/<basename-without-extension>
#
# Output is written under jw/, which is gitignored — extracted publication
# content is for local/private use only and is never intended to be committed.

usage() {
  echo "Usage: $0 [path/to/file.jwpub] [output-dir]" >&2
}

JWPUB_PATH="${1:-}"

if [ -z "${JWPUB_PATH}" ]; then
  JWPUB_PATH="$(find jw -type f -name '*.jwpub' 2>/dev/null | head -n1 || true)"
  if [ -z "${JWPUB_PATH}" ]; then
    echo "ERROR: no .jwpub file given and none found under jw/." >&2
    usage
    exit 1
  fi
  echo "No path given, using: ${JWPUB_PATH}"
fi

if [ ! -f "${JWPUB_PATH}" ]; then
  echo "ERROR: file not found: ${JWPUB_PATH}" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "ERROR: unzip is required but not installed." >&2
  exit 1
fi

BASENAME="$(basename "${JWPUB_PATH}")"
BASENAME_NOEXT="${BASENAME%.*}"
OUT_DIR="${2:-jw/extract/${BASENAME_NOEXT}}"
CONTENTS_DIR="${OUT_DIR}/contents_extract"

mkdir -p "${OUT_DIR}"

echo "Extracting outer package: ${JWPUB_PATH} -> ${OUT_DIR}"
unzip -oq "${JWPUB_PATH}" -d "${OUT_DIR}"

if [ ! -f "${OUT_DIR}/contents" ]; then
  echo "ERROR: expected nested 'contents' archive not found in ${OUT_DIR}." >&2
  exit 1
fi

mkdir -p "${CONTENTS_DIR}"
echo "Extracting nested contents archive -> ${CONTENTS_DIR}"
unzip -oq "${OUT_DIR}/contents" -d "${CONTENTS_DIR}"

echo
echo "Done. Extracted to: ${OUT_DIR}"

if [ -f "${OUT_DIR}/manifest.json" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "${OUT_DIR}/manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)

pub = manifest.get("publication", {})
print(f"  Title:          {pub.get('displayTitle', pub.get('title', '?'))}")
print(f"  Symbol:         {pub.get('symbol', '?')}")
print(f"  Schema version: {pub.get('schemaVersion', '?')}")
print(f"  DB file:        {pub.get('fileName', '?')}")

content_format = manifest.get("contentFormat")
print(f"  contentFormat:  {content_format}")
if content_format and content_format != "z":
    print()
    print("  NOTE: contentFormat is not the plain 'z' (zlib) format.")
    print("  Newer publications (e.g. 'z-a') obfuscate/encrypt the Content")
    print("  BLOB columns in the .db, so verse/document text will not be")
    print("  readable by simply decompressing it. See .claude/memory/start.md.")
PY
fi

DB_FILES=$(find "${CONTENTS_DIR}" -maxdepth 1 -type f -name '*.db')
if [ -n "${DB_FILES}" ]; then
  echo
  echo "  SQLite database(s):"
  while IFS= read -r db; do
    echo "    ${db}"
  done <<< "${DB_FILES}"
fi
