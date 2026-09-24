#!/usr/bin/env bash

# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/../../lib-bash/header.sh"

log::info "Running under act"

status=0

workflow="$1"
shift

output="$(act -W "${PROJECT_ROOT}"/.github/workflows/"${workflow}".yml "$@" 2>&1 | tee /dev/tty)" || status=$?

if grep -q "Skipping unsupported platform" <<<"$output"; then
    log::error "A job was skipped — .actrc is out of sync with runs-on in ci.yml"
    exit 1
fi

exit "${status}"
