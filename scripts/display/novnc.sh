#!/usr/bin/env bash
set -euo pipefail

_DISPLAY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "${_DISPLAY_DIR}/../../lib-bash/load-lib-bash.sh" "$@"
# shellcheck source=/dev/null
source "${_DISPLAY_DIR}/env.sh"
# shellcheck source=/dev/null
source "${_DISPLAY_DIR}/x11vnc.sh"

novnc::is_running() {
    pgrep -f websockify > /dev/null 2>&1
}

novnc::status() {
    if novnc::is_running; then
        local pid
        pid="$(pgrep -f websockify)"
        log::ok "noVNC/websockify is running (PID: ${pid}, Port: ${NOVNC_PORT})"
        echo "  Web URL: http://localhost:${HOST_NOVNC_PORT}/vnc.html"
        return 0
    else
        log::warn "noVNC is not running"
        return 1
    fi
}

novnc::start() {
    if novnc::is_running; then
        log::ok "noVNC is already running on port ${NOVNC_PORT}"
        echo "  Web URL: http://localhost:${HOST_NOVNC_PORT}/vnc.html"
        return 0
    fi

    # Pre-flight: Ensure x11vnc is running first (which in turn ensures Xvfb is running)
    if ! x11vnc::is_running; then
        log::info "x11vnc is required by noVNC — starting x11vnc first..."
        x11vnc::start
    fi

    log::info "Starting noVNC (websockify) on port ${NOVNC_PORT} -> localhost:${VNC_PORT}..."
    websockify --web "${NOVNC_WEB}" "${NOVNC_PORT}" "localhost:${VNC_PORT}" &>/dev/null &
    local novnc_pid=$!

    # Wait up to 5s for noVNC port to become available using native Bash /dev/tcp
    local count=0
    while ! (echo > /dev/tcp/127.0.0.1/"${NOVNC_PORT}") 2>/dev/null; do
        sleep 0.2
        count=$((count + 1))
        if (( count > 25 )); then
            log::error "noVNC failed to start listening on port ${NOVNC_PORT} within 5 seconds"
            return 1
        fi
    done

    log::ok "noVNC started successfully (PID: ${novnc_pid})"
    echo ""
    echo "  ==============================================================="
    echo "  noVNC is ready! Open in your browser:"
    echo "  http://localhost:${HOST_NOVNC_PORT}/vnc.html"
    echo "  (Fallback if needed: http://localhost:${HOST_NOVNC_PORT}/vnc_lite.html)"
    echo "  ==============================================================="
    echo ""
}

novnc::stop() {
    if ! novnc::is_running; then
        log::info "noVNC is already stopped"
        return 0
    fi

    log::info "Stopping noVNC/websockify..."
    pkill -f websockify || true

    local count=0
    while novnc::is_running; do
        sleep 0.2
        count=$((count + 1))
        if (( count > 15 )); then
            log::warn "Force killing websockify..."
            pkill -9 -f websockify || true
            break
        fi
    done

    log::ok "noVNC stopped"
}

novnc::restart() {
    novnc::stop
    novnc::start
}

novnc::main() {
    local action="${1:-start}"
    case "$action" in
        start)   novnc::start ;;
        stop)    novnc::stop ;;
        restart) novnc::restart ;;
        status)  novnc::status ;;
        *)
            log::error "Usage: $0 {start|stop|restart|status}"
            exit 1
            ;;
    esac
}

# Run main only when executed directly from CLI
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    novnc::main "$@"
fi