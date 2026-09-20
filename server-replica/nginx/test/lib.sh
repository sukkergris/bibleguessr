#!/usr/bin/env bash
# Shared helpers for the tarpit tests.
#
# The tests run against a throwaway nginx container with the repository's
# nginx config copied in, so they never touch the devcontainer's nginx and
# never need the app running.

set -uo pipefail

IMAGE="${TARPIT_TEST_IMAGE:-nginx:1.31.6-alpine}"
NGINX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_TTL="${TARPIT_TEST_TTL:-300}"

# Ports used inside the test container.
TARPIT_PORT=8095
PROBE_PORT=8096

tests_run=0
tests_failed=0

log()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }

# ok <name> <condition-description>
pass() { tests_run=$((tests_run + 1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() {
    tests_run=$((tests_run + 1))
    tests_failed=$((tests_failed + 1))
    printf '  \033[31mFAIL\033[0m %s\n' "$1"
    [ $# -gt 1 ] && printf '       %s\n' "$2"
    return 0
}

# assert_between <name> <value> <min> <max>
assert_between() {
    local name="$1" value="$2" min="$3" max="$4"
    if [ "$value" -ge "$min" ] && [ "$value" -le "$max" ]; then
        pass "$name ($value in $min..$max)"
    else
        fail "$name" "got $value, expected $min..$max"
    fi
}

# assert_eq <name> <actual> <expected>
assert_eq() {
    if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1" "got '$2', expected '$3'"; fi
}

# assert_contains <name> <haystack> <needle>
assert_contains() {
    case "$2" in
        *"$3"*) pass "$1" ;;
        *)      fail "$1" "expected to contain '$3'" ;;
    esac
}

# Start a throwaway container with the repo's nginx config copied to /etc/nginx.
# Sets $CID. Caller must call teardown_container.
setup_container() {
    CID=$(docker create --entrypoint sleep "$IMAGE" "$CONTAINER_TTL") || return 1
    docker cp "$NGINX_DIR/." "$CID:/etc/nginx/" >/dev/null || return 1
    docker start "$CID" >/dev/null || return 1
}

teardown_container() {
    [ -n "${CID:-}" ] && docker rm -f "$CID" >/dev/null 2>&1
    CID=""
}

# Copy a file from the test dir into the container.
push() { docker cp "$1" "$CID:$2" >/dev/null; }

# Run a command in the container.
cexec() { docker exec "$CID" "$@"; }

# Start an nginx instance in the container from a config already pushed there.
start_nginx() { cexec nginx -c "$1"; }

# Stop every nginx instance in the container. njs compiles js_import modules at
# config load and has no lua_code_cache equivalent, so swapping a probe module
# means restarting the probe server rather than just overwriting the file.
stop_nginx() { cexec pkill -9 nginx >/dev/null 2>&1; sleep 1; }

# Run an njs probe served at $PROBE_PORT/run and print its output.
# Backgrounded inside the container, then polled, because these probes
# deliberately take several seconds and a foreground `docker exec` can return
# before the response is written.
run_probe() {
    local out="$1" timeout="${2:-40}"
    cexec sh -c "rm -f $out; wget -qO $out --timeout=$timeout http://127.0.0.1:$PROBE_PORT/run >/dev/null 2>&1 &" >/dev/null
    local waited=0
    while [ "$waited" -lt "$timeout" ]; do
        sleep 2
        waited=$((waited + 2))
        if cexec sh -c "test -s $out" 2>/dev/null; then
            cexec cat "$out" 2>/dev/null
            return 0
        fi
    done
    echo "PROBE TIMEOUT after ${timeout}s"
    return 1
}

summary() {
    log ""
    if [ "$tests_failed" -eq 0 ]; then
        printf '\033[32m%d/%d checks passed\033[0m\n' "$tests_run" "$tests_run"
    else
        printf '\033[31m%d/%d checks failed\033[0m\n' "$tests_failed" "$tests_run"
    fi
    return "$tests_failed"
}
