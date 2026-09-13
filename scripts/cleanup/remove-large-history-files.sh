#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_SIZE_LIMIT='60M'
readonly SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [size-limit] --yes

Remove Git objects larger than size-limit from this repository's complete history.

Arguments:
  size-limit  Maximum retained object size accepted by git-filter-repo.
              Default: ${DEFAULT_SIZE_LIMIT}
  --yes       Required acknowledgement that this rewrites Git history.

Example:
  ${SCRIPT_NAME} 60M --yes
EOF
}

size_limit="${DEFAULT_SIZE_LIMIT}"
confirmed=false

for argument in "$@"; do
  case "${argument}" in
    --yes)
      confirmed=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n\n' "${argument}" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ "${size_limit}" != "${DEFAULT_SIZE_LIMIT}" ]]; then
        printf 'Only one size limit may be supplied.\n\n' >&2
        usage >&2
        exit 2
      fi

      size_limit="${argument}"
      ;;
  esac
done

if ! command -v git-filter-repo >/dev/null 2>&1; then
  printf 'git-filter-repo is required. Install it, then run this script again.\n' >&2
  printf 'Debian/Ubuntu: sudo apt install git-filter-repo\n' >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'Run this script from inside the Git repository to clean.\n' >&2
  exit 1
fi

if [[ "${confirmed}" != true ]]; then
  printf 'Refusing to rewrite Git history without --yes.\n\n' >&2
  usage >&2
  exit 2
fi

git filter-repo --strip-blobs-bigger-than "${size_limit}"
