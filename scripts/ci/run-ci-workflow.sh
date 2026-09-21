#!/usr/bin/env bash

# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/../../lib-bash/header.sh"

log::info "Running ci.yml under act"

status=0

act_env="${PROJECT_ROOT}/.env"

if [ -n "${act_env}" ] && [ -f "${act_env}" ]; then
  set -a
  . "${act_env}"
  set +a
else
  log::error "Missing ${act_env:-.env} — cannot continue"
  exit 1
fi

output="$(act -W .github/workflows/ci.yml "$@" 2>&1 | tee /dev/tty)" || status=$?

if grep -q "Skipping unsupported platform" <<<"$output"; then
    log::error "A job was skipped — .actrc is out of sync with runs-on in ci.yml"
    exit 1
fi

exit "${status}"
