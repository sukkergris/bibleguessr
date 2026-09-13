# Tarpit tests

End-to-end tests for the scanner tarpit (`../lua/tarpit.lua`).

```sh
server-replica/nginx/test/run-tarpit-tests.sh
```

Needs Docker. Nothing else: the tests spin up a throwaway OpenResty container
with this repository's nginx config copied in, so they never touch the
devcontainer's nginx and do not need the app running. The container is removed
on exit, including on Ctrl-C.

## What is covered

| Check | Why it matters |
| --- | --- |
| Config loads on both paths | `conf.d/` is loaded both by our `nginx.conf` and by the image's built-in default config. A definition reachable from only one path is an outage on the other. |
| Scanner paths are tarpitted | `/.env`, `/.git/config`, `/wp-login.php`, `/phpMyAdmin`, `/index.php`, `/dns-query` all reach the handler; `/` does not. |
| CMS paths throttled hardest | nginx uses the *first* matching regex location. If the generic `\.php$` rule is ordered above the CMS list it silently shadows it, and `wp-login.php` gets the faster tier. Only the byte count reveals this. |
| Streaming rate | The measured bytes/second tracks the configured `rate`, and the fast endpoint outruns the slow one. |
| Response shape | Chunked, no `Content-Length`, `Content-Disposition` attachment, exactly one generated header line. |
| Unique per request | Two requests never return byte-identical bodies. |
| `max_seconds` | A capped endpoint stops early instead of streaming forever. |
| Client abort | Hanging up mid-stream leaves the server responsive. |

## Layout

```text
run-tarpit-tests.sh   the runner: starts the container, asserts, reports
lib.sh                shared shell helpers (assertions, container lifecycle)
probes.lua            cosocket helpers used by every probe
test-*.lua            one probe per concern, swapped in as current-probe.lua
fixtures/*.conf       the two nginx instances used during a run
```

Probes are Lua rather than `curl`/`wget` because the tarpit response is
open-ended: a shell client cannot read "for N seconds, then report how much
arrived" without its own timeout destroying the byte count. A cosocket can.

`fixtures/probe-server.conf` sets `lua_code_cache off` so the runner can swap
`current-probe.lua` between tests — with the cache on, `content_by_lua_file`
compiles once and every later test silently re-runs the first probe.

## Tuning

The rate assertions allow generous headroom (roughly 0.75x-1.4x of target).
One in-flight block plus socket buffering always overshoots slightly, and CI
machines are noisy. The point is that the tiers are distinct and in the right
neighbourhood, not that they are exact.

Override the image with `TARPIT_TEST_IMAGE`, e.g. to match production:

```sh
TARPIT_TEST_IMAGE=openresty/openresty:1.31.1.1-3-alpine \
  server-replica/nginx/test/run-tarpit-tests.sh
```

## Verifying the tests actually catch things

These checks were validated by mutation: breaking the implementation on
purpose and confirming the suite goes red.

| Mutation | Caught by |
| --- | --- |
| Header template left in the repeating body | `exactly one header line` (saw 36) |
| `opts.rate` ignored | `4096 B/s endpoint`, `fast outruns slow` |
| `max_seconds` never honoured | `capped endpoint finished early` (ran the full window) |
| `\.php$` ordered above the CMS list | `CMS paths are throttled harder than generic .php` |

The last one originally slipped through — both paths still tarpitted, so every
check passed while the CMS tier was silently lost. The byte-count assertion was
added specifically to close that gap.
