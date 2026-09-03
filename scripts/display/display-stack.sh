#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=/dev/null
source "${SCRIPTS_DIR}/xvfb.sh"

# shellcheck source=/dev/null
source "${SCRIPTS_DIR}/x11vnc.sh"

# shellcheck source=/dev/null
source "${SCRIPTS_DIR}/novnc.sh"
display_stack::start() {
    xvfb::start
    x11vnc::start
    novnc::start
}