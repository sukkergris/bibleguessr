#!/usr/bin/env bash

set -u

# --- Project Utility Functions (2026 Edition) ---

# Logging and error handling should be sourced by the caller if needed.

# --- Utility: util::find_project_root ---
# Usage: ROOT=$(util::find_project_root) OR ROOT=$(util::find_project_root "/start/dir" "root-marker")
# Searches upward from given dir (or $PWD) for a marker file (default: root-marker).
# On success: echoes root dir and returns 0. On failure: logs error and exits 1.

util::find_project_root() {
    local dir="${1:-$PWD}"
    local marker="${2:-root-marker}"
    while [ "$dir" != "/" ]; do
        if [ -e "$dir/$marker" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    if command -v log_error >/dev/null 2>&1; then
        log_error "Project root marker '$marker' not found upward from ${1:-$PWD}"
    else
        echo "[ERROR] Project root marker '$marker' not found upward from ${1:-$PWD}" >&2
    fi
    exit 1
}

util::folder_exists() {
  local folder="${1:?Error: folder path is required}"
  [[ -d "$folder" ]]
}

util::spot_duplicate_file_names() {
    local search_dir="${1:-}"
    local pattern="$2:-*.sh"

    if [[ -z "$searhc_dir" ]]; then
        echo "";
    fi
}