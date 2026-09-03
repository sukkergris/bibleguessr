#!/usr/bin/env bash

[[ -n "${_LOGGING_LOADED:-}" ]] && return 0
_LOGGING_LOADED=1

COLOR_RESET="\033[0m"
COLOR_INFO="\033[0;36m"
COLOR_WARN="\033[0;33m"
COLOR_ERROR="\033[0;31m"
COLOR_OK="\033[0;32m"
COLOR_DEBUG="\033[0;90m"

log::info()  { printf "${COLOR_INFO}[INFO]${COLOR_RESET}  %s\n" "$*"; }
log::warn()  { printf "${COLOR_WARN}[WARN]${COLOR_RESET}  %s\n" "$*"; }
log::error() { printf "${COLOR_ERROR}[ERROR]${COLOR_RESET} %s\n" "$*"; }
log::ok()    { printf "${COLOR_OK}[OK]${COLOR_RESET}    %s\n" "$*"; }

log::debug() {
  [[ "${DEBUG:-0}" == "1" || "${DEBUG:-false}" == "true" ]] || return 0
  printf "${COLOR_DEBUG}[DEBUG]${COLOR_RESET} %s\n" "$*"
}
