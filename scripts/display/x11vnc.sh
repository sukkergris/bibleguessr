#!/usr/bin/env bash
set -euo pipefail

_DISPLAY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "${_DISPLAY_DIR}/../../lib-bash/load-lib-bash.sh" "$@"
# shellcheck source=/dev/null
source "${_DISPLAY_DIR}/env.sh"
# shellcheck source=/dev/null
source "${_DISPLAY_DIR}/xvfb.sh"

x11vnc::is_running() {
    pgrep -x x11vnc > /dev/null 2>&1
}

x11vnc::status() {
    if x11vnc::is_running; then
        local pid
        pid="$(pgrep -x x11vnc)"
        log::ok "x11vnc is running (PID: ${pid}, Port: ${VNC_PORT}, DISPLAY=:${DISPLAY_NUM})"
        return 0
    else
        log::warn "x11vnc is not running"
        return 1
    fi
}

x11vnc::start() {
    if x11vnc::is_running; then
        log::ok "x11vnc is already running on port ${VNC_PORT}"
        return 0
    fi

    # Pre-flight: Ensure Xvfb is running first
    if ! xvfb::is_running; then
        log::info "Xvfb is required by x11vnc — starting Xvfb first..."
        xvfb::start
    fi

    log::info "Starting x11vnc on display :${DISPLAY_NUM} (Port: ${VNC_PORT})..."
    x11vnc -display ":${DISPLAY_NUM}" -rfbport "${VNC_PORT}" -nopw -listen localhost -xkb -forever -quiet &
    local vnc_pid=$!

    # Wait up to 5s for VNC port using native Bash /dev/tcp
    local count=0
    while ! (echo > /dev/tcp/127.0.0.1/"${VNC_PORT}") 2>/dev/null; do
        sleep 0.2
        count=$((count + 1))
        if (( count > 25 )); then
            log::error "x11vnc failed to start listening on port ${VNC_PORT} within 5 seconds"
            return 1
        fi
    done

    log::ok "x11vnc started successfully (PID: ${vnc_pid})"
}

x11vnc::stop() {
    if ! x11vnc::is_running; then
        log::info "x11vnc is already stopped"
        return 0
    fi

    log::info "Stopping x11vnc..."
    pkill -x x11vnc || true

    local count=0
    while x11vnc::is_running; do
        sleep 0.2
        count=$((count + 1))
        if (( count > 15 )); then
            log::warn "Force killing x11vnc..."
            pkill -9 -x x11vnc || true
            break
        fi
    done

    log::ok "x11vnc stopped"
}

x11vnc::restart() {
    x11vnc::stop
    x11vnc::start
}

x11vnc::main() {
    local action="${1:-start}"
    case "$action" in
        start)   x11vnc::start ;;
        stop)    x11vnc::stop ;;
        restart) x11vnc::restart ;;
        status)  x11vnc::status ;;
        *)
            log::error "Usage: $0 {start|stop|restart|status}"
            exit 1
            ;;
    esac
}

# Run main only when executed directly from CLI
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    x11vnc::main "$@"
fi
