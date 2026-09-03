#!/usr/bin/env bash

_LOAD_LIB_BASH_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for arg in "$@"; do
  if [[ "$arg" == "--debug" || "$arg" == "-d" ]]; then
    export DEBUG=1
    break
  fi
done

# shellcheck disable=SC1091
source "${_LOAD_LIB_BASH_PATH}/utilities.sh"
# shellcheck disable=SC1091
source "${_LOAD_LIB_BASH_PATH}/logging.sh"

log::debug "Running in debug mode"

PROJECT_ROOT="$(util::find_project_root)"
export PROJECT_ROOT
# Standard paths
export LIB_DIR="${PROJECT_ROOT}/lib-bash"
export SCRIPTS_DIR="${PROJECT_ROOT}/scripts"

# shellcheck disable=SC1091
source "${LIB_DIR}/module-loader.sh"

log::info "load-lib-bash completed"
