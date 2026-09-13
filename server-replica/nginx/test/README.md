# Tarpit tests

End-to-end tests for the scanner tarpit (`../lua/tarpit.lua`).

---

## Running the tests

### The short version

From anywhere in the repository:

```sh
server-replica/nginx/test/run-tarpit-tests.sh
```

A full run takes about **30 seconds** and ends with a line like:

```text
21/21 checks passed
```

That is the whole workflow. The rest of this section explains what is going on,
which matters mostly the first time.

### Where do I run it from?

**Anywhere.** The script works out its own location, so the directory you are
standing in does not matter. All of these do the same thing:

```sh
# from the repository root
server-replica/nginx/test/run-tarpit-tests.sh

# from inside the test folder
cd server-replica/nginx/test && ./run-tarpit-tests.sh

# from a completely unrelated directory, using an absolute path
/xyz/server-replica/nginx/test/run-tarpit-tests.sh
```

If your shell refuses to execute it (`permission denied`), run it through bash
explicitly — this also works from anywhere:

```sh
bash server-replica/nginx/test/run-tarpit-tests.sh
```

### What do I need installed?

**Only Docker.** In particular you do *not* need:

- Lua or LuaJIT on your machine — the Lua runs inside the container
- OpenResty or nginx installed locally
- the BibleGuessr backend or frontend running
- any `npm install` / `dotnet` step

The first run pulls the `openresty/openresty:alpine` image if you do not have
it yet, which adds a minute or two. Later runs reuse it.

### Does this touch my devcontainer?

**No.** This is the important part, and it is deliberate.

The tests create a **throwaway container**, copy this repository's nginx config
into it, run everything there, and delete the container when finished —
including if you press Ctrl-C. Your devcontainer's own nginx is never started,
stopped, reloaded or reconfigured, and the files in `server-replica/nginx/` are
only ever read.

So you can run this repeatedly while working, without disturbing anything.

### Reading the output

```text
Tarpit end-to-end tests
  image:  openresty/openresty:alpine
  config: /xyz/server-replica/nginx

Starting test container...
Config loads on both paths
  PASS image default config path
  PASS our nginx.conf path

Scanner paths reach the tarpit; normal paths do not
    /.env              tarpit   generic   11392 bytes
  /wp-login.php      tarpit   cms        4864 bytes
  ...
  PASS /.env is tarpitted
  ...

21/21 checks passed
```

Indented lines without `PASS`/`FAIL` are raw measurements, printed so a failure
can be diagnosed without re-running anything. A `FAIL` always prints what it
got versus what it expected.

The exit code is **0** when everything passes and **2** otherwise, so the
script can be dropped into CI or a pre-push hook as-is.

### When something fails

Failures are usually one of:

- **`docker not found`** (exit 2) — Docker is not installed or not on `PATH`.
- **`Could not start the test container`** (exit 2) — Docker is installed but
  not running, or cannot pull the image.
- **A rate check is out of range** — the assertions allow generous headroom,
  but a heavily loaded machine can still overshoot. Re-run before investigating.
- **Anything else** — a real regression. Read the raw measurement line printed
  just above the `FAIL`; it usually identifies the cause on its own.

### Useful variations

```sh
# Test against the exact image production uses, instead of the moving tag
TARPIT_TEST_IMAGE=openresty/openresty:1.31.1.1-3-alpine \
  server-replica/nginx/test/run-tarpit-tests.sh

# Give the container longer to live, if you are stepping through by hand
TARPIT_TEST_TTL=900 server-replica/nginx/test/run-tarpit-tests.sh
```

---

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

---

## How it works (and a little Lua)

You do not need to read this to run the tests.

### Layout

```text
run-tarpit-tests.sh   the runner: starts the container, asserts, reports
lib.sh                shared shell helpers (assertions, container lifecycle)
probes.lua            cosocket helpers used by every probe
test-*.lua            one probe per concern, swapped in as current-probe.lua
fixtures/*.conf       the two nginx instances used during a run
```

A run starts two nginx servers inside the container:

- **port 8095** — the tarpit itself, including the real `includes/tarpit.conf`
  rules, plus a few fixed-rate endpoints so a rate can be asserted without
  depending on path routing.
- **port 8096** — a probe server whose single endpoint executes whichever
  `test-*.lua` file the runner has just copied in as `current-probe.lua`.

The runner copies in one probe at a time, requests `/run`, and asserts on the
text that comes back.

### Why the probes are written in Lua

The tarpit response never ends — that is the entire point of a tarpit. A shell
client cannot express *"read for 4 seconds, then tell me how many bytes
arrived"*: `curl` and `wget` only have timeouts, and a timeout kills the process
along with its byte count.

Lua **cosockets** (`ngx.socket.tcp`) can. They open a raw TCP connection, read
in a loop until a deadline, then close and report. That is all `probes.lua`
does, and it is why the probes run inside nginx rather than from the shell.

Two Lua details worth knowing if you edit these files:

- `ngx.say(...)` writes a line to the HTTP response. That response *is* the test
  output the runner parses — so a probe communicates by printing.
- `require("probes")` loads `probes.lua` once and caches it. The fixture sets
  `lua_code_cache off` so the runner can swap `current-probe.lua` between
  tests; with the cache on, `content_by_lua_file` compiles once and every later
  test would silently re-run the first probe.

### Tuning

The rate assertions allow generous headroom (roughly 0.75x–1.4x of target). One
in-flight block plus socket buffering always overshoots, and CI machines are
noisy. The point is that the tiers are distinct and in the right neighbourhood,
not that they are exact.

---

## Verifying the tests actually catch things

These checks were validated by mutation: breaking the implementation on purpose
and confirming the suite goes red.

| Mutation | Caught by |
| --- | --- |
| Header template left in the repeating body | `exactly one header line` (saw 36) |
| `opts.rate` ignored | `4096 B/s endpoint`, `fast outruns slow` |
| `max_seconds` never honoured | `capped endpoint finished early` (ran the full window) |
| `\.php$` ordered above the CMS list | `CMS paths are throttled harder than generic .php` |

The last one originally slipped through — both paths still tarpitted, so every
check passed while the CMS tier was silently lost. The byte-count assertion was
added specifically to close that gap.

If you change `../lua/tarpit.lua`, do the same: break your change on purpose,
confirm a check fails, then restore it. A test that passes against broken code
looks like protection and is not.
