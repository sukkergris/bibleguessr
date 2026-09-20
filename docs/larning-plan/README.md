# Learning plan: writing an nginx njs module (and testing it)

A self-study path for writing the kind of plugin this repository now runs: the
scanner tarpit in [`server-replica/nginx/njs/tarpit.js`](../../server-replica/nginx/njs/tarpit.js),
plus the end-to-end suite in [`server-replica/nginx/test/`](../../server-replica/nginx/test/).

It is written to be worked through in order. Each stage says what to build,
what "done" looks like, and which trap to expect — the traps are the parts that
actually cost time, and most of them are recorded here because they cost time
during the Lua-to-njs migration.

**Prerequisites:** Docker, and enough JavaScript to read an `async` function.
No prior nginx module experience assumed.

---

## Stage 0 — Frame the problem

njs is not Node. It is a small JavaScript runtime embedded in nginx, built to
run *inside the request lifecycle*. Before writing any code, get clear on two
things, because most confusion later traces back to one of them:

- **What nginx gives you**: a request object (`r`), directives you can declare
  in config, and a place to hook in (`js_content`, `js_set`, filters).
- **What nginx does not give you**: Node's standard library. No `fs`, no `npm`
  packages, no `require`. `setTimeout` and `Promise` exist; most of what you
  reach for by reflex does not.

**Done when** you can say in one sentence why `limit_rate` cannot pace a
`js_content` handler. (Answer: it throttles nginx's own file and proxy output
filters, and a JS handler's `r.send` is neither.)

---

## Stage 1 — Get a module to run at all

Build the smallest possible thing: a location that returns `hello` from JS.

```nginx
load_module modules/ngx_http_js_module.so;   # main context only — above events/http
events { worker_connections 64; }
http {
    js_path "/etc/nginx/njs/";
    js_import hello from hello.js;
    server {
        listen 8080;
        location / { js_content hello.run; }
    }
}
```

```js
function run(r) { r.return(200, "hello\n"); }
export default { run };
```

Run it in a throwaway container rather than installing nginx:

```sh
docker run --rm -p 8080:8080 \
  -v "$PWD/hello.js:/etc/njs/hello.js:ro" \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:1.31.6-alpine
```

> **Trap — `load_module` placement.** It is only valid in the *main* context,
> above `events` and `http`. It cannot be added from an included `conf.d/`
> file. This has a real consequence in this repo: the stock nginx image's own
> default config has no `load_module` line, so the tarpit can only ever load
> via our own `nginx.conf`. OpenResty had Lua built in and needed no such line,
> which is why the migration had to change what the test suite asserts.

**Done when** `curl localhost:8080` prints `hello`, and you have deliberately
moved `load_module` inside `http {}` once to see it fail.

---

## Stage 2 — Learn the request object

Work through `r` until these are second nature:

| Task | API |
| --- | --- |
| Read a URI / arg / header | `r.uri`, `r.args`, `r.headersIn` |
| Set a response header | `r.headersOut['X-Thing'] = 'v'` |
| Whole response in one call | `r.return(status, body)` |
| Streamed response | `r.status`, `r.sendHeader()`, `r.send()`, `r.finish()` |
| Log a line | `r.log(...)`, `r.error(...)` |
| Read config from the location | `r.variables.some_var` |

That last row is the one worth dwelling on, because it is how a module becomes
*configurable* rather than hardcoded. In this repo the pattern is:

```nginx
js_var $tarpit_rate;              # declared once, http level
location ~* \.php$ {
    set $tarpit_rate 8192;        # overridden per location
    js_content tarpit.run;
}
```

```js
let rate = Number(r.variables.tarpit_rate) || defaultRateBytesPerSecond;
```

This keeps the routing rules declarative and readable in the config, with the
JS holding only behaviour. Compare `includes/tarpit.conf` before and after the
migration to see the difference: the Lua version passed a table literal inline
in every location block.

> **Trap.** `js_var` must be declared or the variable is a config error. Give
> it a default (`js_var $tarpit_max_seconds 2;`) when you want one — the test
> fixture relies on exactly this to cap the otherwise-uncapped production rules.

**Done when** you have a handler whose behaviour changes based on a `set` in
the location block, with no JS edit.

---

## Stage 3 — Streaming and pacing (the real lesson)

Write a handler that streams an endless body at a target bytes/second. This is
the core of the tarpit, and it is where the interesting mistakes live.

Two things to internalise:

**1. Pace against elapsed wall-clock time, not per block.**

```js
let elapsed = (Date.now() - started) / 1000;
let budget = elapsed * rate;
if (sent > budget) {
    await sleep(((sent - budget) / rate) * 1000);   // only when ahead
}
```

The naive alternative — sleep a little after every block — drifts well above
the target, because blocks vary in size and timers have millisecond
granularity. The budget form self-corrects.

**2. `sleep` is not built in.** njs has `setTimeout` but no `ngx.sleep`, so:

```js
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
```

Awaiting that yields the worker rather than blocking it, which is what makes a
held connection cheap — it costs a pending callback, not a worker process.

> **Trap — measuring this is harder than writing it.** While migrating, every
> timing measurement read `0ms` and looked like the pacing had silently broken.
> The pacing was fine. The measurement was not: BusyBox `date` in Alpine does
> not support `%N`, so `$(date +%s%N)` returned whole seconds and every
> computed millisecond delta was meaningless. **Before concluding that code is
> broken, confirm the instrument works** — print the raw measurement, not just
> the derived number.

**Done when** `wget` against your endpoint for 4 seconds returns roughly
`4 × rate` bytes, and you can explain why it is never exact (one in-flight
block plus socket buffering always overshoots).

---

## Stage 4 — Client aborts and caps

A tarpit that never lets go costs you more than the scanner. Two safeguards:

- **The client hangs up.** `r.send()` throws once the connection is gone.
  Catch it, log, and return — do not keep generating.
- **Nothing hangs up.** Cap the total hold with a `max_seconds`, or a wedged
  scanner holds a connection indefinitely.

**Done when** you can kill a `wget` mid-stream and see the server both stop
generating and still answer the next request.

---

## Stage 5 — Testing a streaming handler

This stage is half the work in practice and is where the repo's suite earns its
keep. Read [`test/README.md`](../../server-replica/nginx/test/README.md)
alongside it.

**The shape.** Two nginx instances in one throwaway container: the tarpit on
8095, and a probe server on 8096 whose single endpoint runs whichever
`test-*.js` was copied in as `current-probe.js`. The probe makes requests,
measures, and returns text; the shell runner parses that text and asserts.

**Why probes run inside nginx.** A probe can measure elapsed time and bytes in
one place and report both. `ngx.fetch` is the client.

> **Trap — `ngx.fetch` reads to completion.** There is no njs cosocket, so a
> probe cannot read an open-ended stream for N seconds and stop; the Lua
> version used `ngx.socket.tcp` for exactly that. Every endpoint a probe hits
> must therefore terminate on its own, which is why the test fixture sets a
> short `$tarpit_max_seconds` default while still including the real,
> deliberately uncapped production rules as written.
>
> The same limitation is why the client-abort check is the one test driven from
> the shell (`timeout 1 wget`): `ngx.fetch` cannot hang up mid-stream, and its
> `timeout` option does not cut a read short. A killed `wget` does — and is a
> truer simulation of a scanner anyway.

> **Trap — njs has no `lua_code_cache off`.** Modules compile when the config
> loads, so overwriting `current-probe.js` changes nothing until the probe
> server restarts. The runner's `use_probe` restarts it, and the two fixtures
> use **separate `pid` files** so stopping one does not signal the other.
> Symptom if you get this wrong: every test after the first reports the *first*
> test's output, and the failures look like unrelated assertion bugs.

**Done when** your suite starts clean, runs each probe, and tears the container
down even on Ctrl-C.

---

## Stage 6 — Prove the tests actually catch bugs

The most important stage, and the easiest to skip. A test that passes against
broken code looks like protection and is not.

Method: break the implementation on purpose, confirm the suite goes red,
restore, confirm green.

| Mutation | Should be caught by |
| --- | --- |
| Header emitted inside the repeating body | `exactly one header line` |
| Configured rate ignored | `4096 B/s endpoint`, `fast outruns slow` |
| `max_seconds` never honoured | `capped endpoint finished early` |
| `\.php$` ordered above the CMS list | `CMS paths are throttled harder` |

**Work the last row yourself — it is the whole lesson.** Shadowing the CMS rule
still tarpits every path, so only the *rate* differs. The original assertion
just checked that the CMS path returned fewer bytes than the `.php` path, and
during this migration it **passed against deliberately broken config** on a
35-byte difference (16560 < 16595): with both tiers served at the same rate,
the comparison was decided by run-to-run noise. The fix asserts a ratio — the
CMS tier must be under 70% of the `.php` tier, which is what a real 4096-vs-8192
split looks like.

Two transferable habits:

- **Assert the magnitude you expect, not merely the direction.** A `<`
  comparison between two noisy measurements is not a test.
- **"It went red" is not sufficient.** Check it went red *for your reason*. A
  mutation that makes the suite hang (removing `max_seconds` does) is a
  different signal than a failed assertion, and only one of them is the test
  doing its job.

**Done when** you have run each mutation yourself and seen the specific check
fail.

---

## Reference

| Topic | Where |
| --- | --- |
| Official njs docs | <https://nginx.org/en/docs/njs/> |
| njs reference | <https://nginx.org/en/docs/njs/reference.html> |
| `ngx_http_js_module` | <https://nginx.org/en/docs/http/ngx_http_js_module.html> |
| This repo's handler | `server-replica/nginx/njs/tarpit.js` |
| Its config surface | `server-replica/nginx/includes/tarpit.conf`, `includes/http-globals.conf` |
| Its tests | `server-replica/nginx/test/` |
| The security rationale | `docs/web/cyber-security/index.html` |

Run the suite any time; it needs only Docker and touches nothing else:

```sh
server-replica/nginx/test/run-tarpit-tests.sh
```
