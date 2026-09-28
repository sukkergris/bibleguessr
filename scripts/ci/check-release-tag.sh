#!/usr/bin/env bash
# Fails unless the pushed tag is exactly v<release version>, where the release
# version is what load-image-version.sh returns. The tag, the GitHub release
# and both Docker image tags then always carry the same number.
set -euo pipefail

tag_prefix='v'
tag="${1:?usage: check-release-tag.sh <tag>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
expected="${tag_prefix}$("$script_dir/load-image-version.sh")"

if [[ "$tag" != "$expected" ]]; then
  echo "::error::Tag '$tag' does not match the release version '$expected' from scripts/ci/load-image-version.sh." >&2
  exit 1
fi

echo "Tag '$tag' matches the release version."
