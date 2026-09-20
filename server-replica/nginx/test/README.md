# Tarpit tests

End-to-end tests for the scanner tarpit (`../njs/tarpit.js`).

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

- njs or Node on your machine — the JavaScript runs inside the container
- nginx installed locally
- the BibleGuessr backend or frontend running
- any `npm install` / `dotnet` step

The first run pulls the `nginx:1.31.6-alpine` image if you do not have it yet,
which adds a minute or two. Later runs reuse it.

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
  image:  nginx:1.31.6-alpine
  config: /xyz/server-replica/nginx

Starting test container...
Config loads
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
# Test against a different nginx image than the default
TARPIT_TEST_IMAGE=nginx:1.31.6-alpine \
  server-replica/nginx/test/run-tarpit-tests.sh

# Give the container longer to live, if you are stepping through by hand
TARPIT_TEST_TTL=900 server-replica/nginx/test/run-tarpit-tests.sh
```

---

## What is covered

| Check | Why it matters |
| --- | --- |
| Config loads | The whole `conf.d/` tree parses under stock nginx with the njs module loaded. Unlike OpenResty, where Lua was built in, `load_module` is only valid in the main context — so the tarpit loads via our `nginx.conf` only, which is what both the devcontainer and the production image use. |
| Scanner paths are tarpitted | `/.env`, `/.git/config`, `/wp-login.php`, `/phpMyAdmin`, `/index.php`, `/dns-query` all reach the handler; `/` does not. |
| CMS paths throttled hardest | nginx uses the *first* matching regex location. If the generic `\.php$` rule is ordered above the CMS list it silently shadows it, and `wp-login.php` gets the faster tier. Only the byte count reveals this. |
| Streaming rate | The measured bytes/second tracks the configured `rate`, and the fast endpoint outruns the slow one. |
| Response shape | Chunked, no `Content-Length`, `Content-Disposition` attachment, exactly one generated header line. |
| Unique per request | Two requests never return byte-identical bodies. |
| `max_seconds` | A capped endpoint stops early instead of streaming forever. |
| Client abort | Hanging up mid-stream leaves the server responsive. |

---

## How it works (and a little njs)

You do not need to read this to run the tests.

### Layout

```text
run-tarpit-tests.sh   the runner: starts the container, asserts, reports
lib.sh                shared shell helpers (assertions, container lifecycle)
probes.js             ngx.fetch helpers used by every probe
test-*.js             one probe per concern, swapped in as current-probe.js
fixtures/*.conf       the two nginx instances used during a run
```

A run starts two nginx servers inside the container:

- **port 8095** — the tarpit itself, including the real `includes/tarpit.conf`
  rules, plus a few fixed-rate endpoints so a rate can be asserted without
  depending on path routing.
- **port 8096** — a probe server whose single endpoint executes whichever
  `test-*.js` file the runner has just copied in as `current-probe.js`.

The runner copies in one probe at a time, requests `/run`, and asserts on the
text that comes back.

### Why the probes run inside nginx

The probes issue their requests with `ngx.fetch` from inside the test nginx,
rather than with `curl`/`wget` from the shell, so a probe can measure elapsed
time and byte counts in one place and report them as its response body.

njs has no cosocket API (the Lua version used `ngx.socket.tcp` to read an
open-ended stream for N seconds and then stop). `ngx.fetch` instead reads a
response **to completion**, so every endpoint a probe requests must terminate on
its own. That is why `fixtures/tarpit-server.conf` sets a short
`$tarpit_max_seconds` default: the production rules in `includes/tarpit.conf`
are deliberately uncapped, and are included under test exactly as written, but
the cap lets each request finish.

Two njs details worth knowing if you edit these files:

- `r.return(200, text)` sends the probe's result. That response *is* the test
  output the runner parses — so a probe communicates by returning text.
- njs compiles `js_import` modules when the config loads, and has no
  `lua_code_cache off` equivalent. The runner therefore **restarts** the probe
  server after swapping `current-probe.js` (`use_probe`); overwriting the file
  alone would keep serving the previously compiled module. The two fixtures use
  separate `pid` files so one can be stopped without signalling the other.

### The one probe that is not njs

The client-abort check runs from the shell (`timeout 1 wget`), because
`ngx.fetch` reads to completion and its `timeout` option does not cut a read
short — njs cannot hang up mid-stream. A killed `wget` does exactly that, and is
a truer simulation of a scanner dropping the connection anyway.

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
| Configured `rate` ignored | `4096 B/s endpoint`, `fast outruns slow` |
| `max_seconds` never honoured | `capped endpoint finished early` (the run never terminates) |
| `\.php$` ordered above the CMS list | `CMS paths are throttled harder than generic .php` |

The last one has now slipped through **twice**, in both the Lua and njs
versions, and is worth understanding before you trust it.

Both paths still tarpit when the rule is shadowed, so the only difference is the
rate — and the check originally just asserted `cms_bytes < php_bytes`. During
the njs migration that comparison passed against deliberately shadowed config on
a 35-byte difference (16560 < 16595): with both tiers served at the same rate,
the winner was decided by run-to-run noise. The assertion now requires the CMS
tier to be **under 70% of** the `.php` tier, which is what a genuine 4096-vs-8192
split looks like, and it fails on the shadowed config as it should.

If you change `../njs/tarpit.js`, do the same: break your change on purpose,
confirm a check fails, then restore it. A test that passes against broken code
looks like protection and is not — and "it went red" is not enough on its own,
because a check can go red for a reason unrelated to the bug you introduced.
