#!/usr/bin/env bash

set -u

[[ -n "${_MODULE_LOADER_LOADED:-}" ]] && return 0
_MODULE_LOADER_LOADED=1

_MODULE_LOADER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${_MODULE_LOADER_DIR}/logging.sh"

declare -A LOADED_MODULES=()

find_file_or_exit() {
  local file="$1"
  [[ "$file" != *.sh ]] && file="${file}.sh"
  local folder="$2"
  local result
  result=$(find "$folder" -type f -name "$file" -print -quit 2>/dev/null)

  if [[ -z "$result" ]]; then
    log::error "No match for: $file in $folder"
    return 1
  fi

  printf '%s\n' "$result"
}

load_module() {
  local name="$1"
  local normalized="${name%.sh}"

  if [[ -n "${LOADED_MODULES[$normalized]:-}" ]]; then
    return 0
  fi

  local file
  file=$(find_file_or_exit "$name" "$LIB_DIR") || return 1

  # shellcheck source=/dev/null
  source "$file"
  log::debug "Just sourced ${file}"
  LOADED_MODULES["$normalized"]=1
}
