#!/usr/bin/env bash
#
# End-to-end tests for the scanner tarpit (server-replica/nginx/lua/tarpit.lua).
#
# Spins up a throwaway OpenResty container with this repository's nginx config,
# fires real HTTP requests at the tarpit locations, and asserts on what comes
# back: routing, streaming rate, response shape, per-request uniqueness, the
# max_seconds cap, and client-abort handling.
#
# Nothing here touches the devcontainer's nginx or needs the app running.
#
# Usage:
#   server-replica/nginx/test/run-tarpit-tests.sh
#   TARPIT_TEST_IMAGE=openresty/openresty:1.31.1.1-3-alpine ...   # pin the image

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ./lib.sh

TEST_DIR="$NGINX_DIR/test"

cleanup() { teardown_container; }
trap cleanup EXIT INT TERM

log "Tarpit end-to-end tests"
log "  image:  $IMAGE"
log "  config: $NGINX_DIR"
log ""

if ! command -v docker >/dev/null 2>&1; then
    log "docker not found -- these tests need it."
    exit 2
fi

log "Starting test container..."
if ! setup_container; then
    log "Could not start the test container."
    exit 2
fi

# Both servers live in the container; the tarpit one includes the real rules.
push "$TEST_DIR/fixtures/tarpit-server.conf" /tmp/tarpit-server.conf
push "$TEST_DIR/fixtures/probe-server.conf"  /tmp/probe-server.conf

if ! start_nginx /tmp/tarpit-server.conf; then
    log "Tarpit test server failed to start:"
    cexec /usr/local/openresty/bin/openresty -c /tmp/tarpit-server.conf -t
    exit 2
fi
start_nginx /tmp/probe-server.conf >/dev/null 2>&1 || true
sleep 1

# --- config sanity ------------------------------------------------------
log "Config loads on both paths"
a_out=$(cexec sh -c 'sed -i -E "s/ ssl(;| )/\1/g; /ssl_certificate/d; /http2 on;/d; /include .*ssl-params.conf;/d" /etc/nginx/conf.d/*.conf 2>/dev/null; /usr/local/openresty/bin/openresty -t 2>&1 | tail -1')
b_out=$(cexec sh -c '/usr/local/openresty/bin/openresty -c /etc/nginx/nginx.conf -t 2>&1 | tail -1')
assert_contains "image default config path" "$a_out" "test is successful"
assert_contains "our nginx.conf path"       "$b_out" "test is successful"

# --- routing ------------------------------------------------------------
log ""
log "Scanner paths reach the tarpit; normal paths do not"
push "$TEST_DIR/test-routing.lua" /etc/nginx/test/current-probe.lua
routing=$(run_probe /tmp/routing.txt 30)
info "$(echo "$routing" | sed 's/^/  /')"
for path in "/.env" "/.git/config" "/wp-login.php" "/phpMyAdmin" "/index.php" "/dns-query"; do
    line=$(echo "$routing" | grep -F "$path " | head -1)
    case "$line" in
        *tarpit*) pass "$path is tarpitted" ;;
        *)        fail "$path is tarpitted" "got: ${line:-<no output>}" ;;
    esac
done
normal_line=$(echo "$routing" | grep -E "^/ +" | head -1)
case "$normal_line" in
    *normal*) pass "/ is served normally" ;;
    *)        fail "/ is served normally" "got: ${normal_line:-<no output>}" ;;
esac

# Rate tiering: a CMS admin path must be answered by the slow (4 KB/s) rule,
# not the generic .php rule (8 KB/s). Both tarpit, so only the byte count
# distinguishes them -- this is what catches a location-ordering mistake in
# includes/tarpit.conf, where the first matching regex location wins.
bytes_of() { echo "$routing" | grep -F "$1 " | head -1 | sed -n 's/.* \([0-9]*\) bytes/\1/p'; }
cms_bytes=$(bytes_of "/wp-login.php")
php_bytes=$(bytes_of "/index.php")
if [ -n "$cms_bytes" ] && [ -n "$php_bytes" ] && [ "$cms_bytes" -lt "$php_bytes" ]; then
    pass "CMS paths are throttled harder than generic .php ($cms_bytes < $php_bytes bytes)"
else
    fail "CMS paths are throttled harder than generic .php" \
         "wp-login.php=${cms_bytes:-?} index.php=${php_bytes:-?} -- is the .php rule shadowing the CMS list?"
fi

# --- streaming rate -----------------------------------------------------
log ""
log "Streaming rate tracks the configured bytes/second"
push "$TEST_DIR/test-rate.lua" /etc/nginx/test/current-probe.lua
rates=$(run_probe /tmp/rate.txt 30)
info "$(echo "$rates" | sed 's/^/  /')"
slow=$(echo "$rates" | grep -F "/_rate/slow" | sed -n 's/.*measured= *\([0-9]*\).*/\1/p')
fast=$(echo "$rates" | grep -F "/_rate/fast" | sed -n 's/.*measured= *\([0-9]*\).*/\1/p')
# Allow generous headroom: one in-flight block plus socket buffering always
# overshoots, and CI machines are noisy. The point is the rates are distinct
# and in the right neighbourhood, not that they are exact.
[ -n "$slow" ] && assert_between "4096 B/s endpoint" "$slow" 3000 6500 || fail "4096 B/s endpoint" "no measurement"
[ -n "$fast" ] && assert_between "10240 B/s endpoint" "$fast" 8000 14000 || fail "10240 B/s endpoint" "no measurement"
if [ -n "$slow" ] && [ -n "$fast" ] && [ "$fast" -gt "$slow" ]; then
    pass "fast endpoint outruns slow endpoint"
else
    fail "fast endpoint outruns slow endpoint" "slow=$slow fast=$fast"
fi

# --- response shape -----------------------------------------------------
log ""
log "Response is generated, chunked and unique per request"
push "$TEST_DIR/test-response.lua" /etc/nginx/test/current-probe.lua
shape=$(run_probe /tmp/shape.txt 30)
info "$(echo "$shape" | sed 's/^/  /')"
assert_eq "chunked transfer"          "$(echo "$shape" | sed -n 's/^chunked: //p')"           "true"
assert_eq "no Content-Length"         "$(echo "$shape" | sed -n 's/^no-content-length: //p')" "true"
assert_eq "attachment filename"       "$(echo "$shape" | sed -n 's/^attachment: //p')"        "true"
assert_eq "exactly one header line"   "$(echo "$shape" | sed -n 's/^generated-headers: //p')" "1"
assert_eq "bodies differ per request" "$(echo "$shape" | sed -n 's/^bodies-differ: //p')"     "true"
assert_eq "body contains bait values" "$(echo "$shape" | sed -n 's/^has-bait: //p')"          "true"

# --- max_seconds cap ----------------------------------------------------
log ""
log "max_seconds ends the response"
push "$TEST_DIR/test-cap.lua" /etc/nginx/test/current-probe.lua
cap=$(run_probe /tmp/cap.txt 30)
info "$(echo "$cap" | sed 's/^/  /')"
elapsed=$(echo "$cap" | sed -n 's/.*elapsed=\([0-9]*\)\..*/\1/p')
if [ -n "$elapsed" ] && [ "$elapsed" -lt 6 ]; then
    pass "capped endpoint finished early (${elapsed}s < 8s read window)"
else
    fail "capped endpoint finished early" "elapsed=${elapsed:-?}s"
fi

# --- client abort -------------------------------------------------------
log ""
log "Client hanging up does not wedge the server"
push "$TEST_DIR/test-abort.lua" /etc/nginx/test/current-probe.lua
abort=$(run_probe /tmp/abort.txt 30)
info "$(echo "$abort" | sed 's/^/  /')"
assert_eq "server survives an aborted read" "$(echo "$abort" | sed -n 's/^still-serving: //p')" "true"

summary
