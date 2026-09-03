#!/usr/bin/env bash

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Load lib-bash
# shellcheck source=/dev/null
source "${script_dir}/../../lib-bash/load-lib-bash.sh" "$@"

# Load display environment
# shellcheck source=/dev/null
source "${script_dir}/env.sh"

SOCKET_PATH="/tmp/.X11-unix/X${DISPLAY_NUM}"

xvfb::is_running() {
    pgrep -x Xvfb > /dev/null 2>&1
}

xvfb::status() {
    if xvfb::is_running; then
        local pid
        pid="$(pgrep -x Xvfb)"
        log::ok "Xvfb is running (PID: ${pid}, DISPLAY=:${DISPLAY_NUM})"
        return 0
    else
        log::warn "Xvfb is not running"
        return 1
    fi
}

xvfb::start() {
    if xvfb::is_running; then
        log::ok "Xvfb is already running on :${DISPLAY_NUM}"
        return 0
    fi
    if [[ -e "$SOCKET_PATH" ]]; then
        log::warn "Cleaning up stale lock for display :${DISPLAY_NUM}"
        rm -f "$SOCKET_PATH" "/tmp/.X${DISPLAY_NUM}-lock" 2>/dev/null || true
    fi
    log::info "Starting Xvfb on display :${DISPLAY_NUM} (${SCREEN_RES})..."
    Xvfb ":${DISPLAY_NUM}" -screen 0 "${SCREEN_RES}" &
    local xvfb_pid=$!
    local count=0
    while [[ ! -S "$SOCKET_PATH" ]]; do
        sleep 0.2
        count=$((count + 1))
        if (( count > 25 )); then
            log::error "Xvfb failed to start within 5 seconds"
            return 1
        fi
    done
    log::ok "Xvfb started successfully (PID: ${xvfb_pid})"
}

xvfb::stop() {
    if ! xvfb::is_running; then
        log::info "Xvfb is already stopped"
        return 0
    fi
    log::info "Stopping Xvfb..."
    pkill -x Xvfb || true
    local count=0
    while xvfb::is_running; do
        sleep 0.2
        count=$((count + 1))
        if (( count > 15 )); then
            log::warn "Force killing Xvfb..."
            pkill -9 -x Xvfb || true
            break
        fi
    done
    rm -f "$SOCKET_PATH" "/tmp/.X${DISPLAY_NUM}-lock" 2>/dev/null || true
    log::ok "Xvfb stopped"
}

xvfb::restart() {
    xvfb::stop
    xvfb::start
}

xvfb::main() {
    local action="${1:-start}"
    case "$action" in
        start)   xvfb::start ;;
        stop)    xvfb::stop ;;
        restart) xvfb::restart ;;
        status)  xvfb::status ;;
        *)
            log::error "Usage: $0 {start|stop|restart|status}"
            exit 1
            ;;
    esac
}

# Run main only when executed directly from CLI
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    xvfb::main "$@"
fi
