#!/usr/bin/env bash
# --- Cross-platform Bash Error Handling Module ---

set -Eeuo pipefail


# Global error trap handler
__on_error() {
    local exit_code="$1"
    local cmd="$2"
    local line="$3"

    printf "\033[0;31m[ERROR]\033[0m Exit code %s at line %s: %s\n" \
        "$exit_code" "$line" "$cmd" >&2

    exit "$exit_code"
}

# Install trap (uses BASH_LINENO[0] for accurate error line)
trap '__on_error "$?" "$BASH_COMMAND" "${BASH_LINENO[0]}"' ERR
