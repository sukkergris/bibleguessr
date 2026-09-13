#!/usr/bin/env bash
set -u

[[ -n "${_LIB_BASH_BASE_LOADED:-}" ]] && return 0
_LIB_BASH_BASE_LOADED=1

_BASE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Must be first: exports PROJECT_ROOT, LIB_DIR, SCRIPTS_DIR
# shellcheck source=/dev/null
source "$_BASE_DIR/root-loader.sh"

# Depends on LIB_DIR; provides load_module / load_optional_module
# shellcheck source=/dev/null
source "$_BASE_DIR/module-loader.sh"

load_module error-handling
load_module logging
load_module utilities

log::info "Header module loaded"
