#!/usr/bin/env bash
set -u

find_project_root() {
    local dir
    local depth=0
    dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

    while [[ "$dir" != "/" && $depth -lt 5 ]]; do
        if [[ -f "$dir/root-marker" ]]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
        depth=$((depth + 1))
    done

    printf "ERROR: Could not find project root within %d levels" depth  >&2
    exit 1
}

PROJECT_ROOT="$(find_project_root)"
export PROJECT_ROOT
# Standard paths
export LIB_DIR="$PROJECT_ROOT/lib-bash"
export SCRIPTS_DIR="$PROJECT_ROOT/scripts"
