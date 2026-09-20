#!/usr/bin/env bash
#
# End-to-end tests for the scanner tarpit (server-replica/nginx/njs/tarpit.js).
#
# Spins up a throwaway nginx container with this repository's nginx config,
# fires real HTTP requests at the tarpit locations, and asserts on what comes
# back: routing, streaming rate, response shape, per-request uniqueness, the
# max_seconds cap, and client-abort handling.
#
# Nothing here touches the devcontainer's nginx or needs the app running.
#
# Usage:
#   server-replica/nginx/test/run-tarpit-tests.sh
#   TARPIT_TEST_IMAGE=nginx:1.31.6-alpine ...                     # pin the image

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
push "$TEST_DIR/probes.js"                   /etc/nginx/njs/probes.js

if ! start_nginx /tmp/tarpit-server.conf; then
    log "Tarpit test server failed to start:"
    cexec nginx -c /tmp/tarpit-server.conf -t
    exit 2
fi
sleep 1

# Swap in a probe module and (re)start the probe server on it. njs compiles
# js_import modules when the config loads, so a probe change needs a restart:
# overwriting the file alone would keep serving the previously compiled one.
use_probe() {
    # -s stop addresses this instance by its own pid file, so the tarpit
    # server running alongside it is left untouched.
    cexec nginx -c /tmp/probe-server.conf -s stop >/dev/null 2>&1
    sleep 1
    push "$TEST_DIR/$1" /etc/nginx/njs/current-probe.js
    start_nginx /tmp/probe-server.conf >/dev/null 2>&1 || true
    sleep 1
}

# --- config sanity ------------------------------------------------------
log "Config loads"
# Only our nginx.conf is checked here. The stock nginx image's own default
# config has no `load_module`, and load_module is only valid in the main
# context, so the njs tarpit can only ever load via our nginx.conf -- which is
# what both the devcontainer (it mounts over /etc/nginx) and the production
# image use. See includes/http-globals.conf.
b_out=$(cexec sh -c 'sed -i -E "s/ ssl(;| )/\1/g; /ssl_certificate/d; /http2 on;/d; /include .*ssl-params.conf;/d" /etc/nginx/conf.d/*.conf 2>/dev/null; nginx -c /etc/nginx/nginx.conf -t 2>&1 | tail -1')
assert_contains "our nginx.conf path" "$b_out" "test is successful"

# --- routing ------------------------------------------------------------
log ""
log "Scanner paths reach the tarpit; normal paths do not"
use_probe test-routing.js
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
# Assert the ratio, not just "fewer bytes": the CMS tier is 4096 B/s against
# the .php tier's 8192, so a correctly routed CMS path serves about half as
# much. Merely testing cms < php passes on a 30-byte difference, which is
# within run-to-run noise -- it stays green even when the .php rule shadows
# the CMS list and both are served at the same rate.
if [ -n "$cms_bytes" ] && [ -n "$php_bytes" ] && [ "$php_bytes" -gt 0 ] \
   && [ $(( cms_bytes * 100 / php_bytes )) -lt 70 ]; then
    pass "CMS paths are throttled harder than generic .php ($cms_bytes vs $php_bytes bytes)"
else
    fail "CMS paths are throttled harder than generic .php" \
         "wp-login.php=${cms_bytes:-?} index.php=${php_bytes:-?} -- expected the CMS tier near half; is the .php rule shadowing the CMS list?"
fi

# --- streaming rate -----------------------------------------------------
log ""
log "Streaming rate tracks the configured bytes/second"
use_probe test-rate.js
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
use_probe test-response.js
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
use_probe test-cap.js
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
# Driven from the shell rather than from a probe module: ngx.fetch reads a
# response to completion and its `timeout` option does not cut a read short, so
# njs cannot hang up mid-stream. `timeout` on wget does exactly that, and it is
# a truer simulation of a scanner dropping the connection anyway.
# Run detached and poll for the result file, the same way run_probe does: a
# foreground `docker exec` can return before this several-second sequence has
# written its output.
docker exec -d "$CID" sh -c 'rm -f /tmp/abort.txt
timeout 1 wget -qO /tmp/partial http://127.0.0.1:8095/_rate/slow >/dev/null 2>&1
sleep 2
{ echo "partial-bytes: $(wc -c < /tmp/partial 2>/dev/null || echo 0)"
  if wget -qO /tmp/after --timeout=5 http://127.0.0.1:8095/ >/dev/null 2>&1; then
      echo "still-serving: true"
  else
      echo "still-serving: false"
  fi
} > /tmp/abort.txt 2>&1' >/dev/null 2>&1

abort=""
waited=0
while [ "$waited" -lt 30 ]; do
    sleep 2
    waited=$((waited + 2))
    if cexec sh -c 'test -s /tmp/abort.txt' 2>/dev/null; then
        abort=$(cexec cat /tmp/abort.txt 2>/dev/null)
        break
    fi
done
info "$(echo "$abort" | sed 's/^/  /')"

partial=$(echo "$abort" | sed -n 's/^partial-bytes: //p')
if [ -n "$partial" ] && [ "$partial" -gt 0 ]; then
    pass "client read part of the stream before hanging up ($partial bytes)"
else
    fail "client read part of the stream before hanging up" "got ${partial:-?} bytes"
fi
assert_eq "server survives an aborted read" "$(echo "$abort" | sed -n 's/^still-serving: //p')" "true"

summary
