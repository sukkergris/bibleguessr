# Learning plan: open the local dev site from another device

A self-study path toward the backlog item
[Feature.MakeTutorialForExposingLocalPortToNetwork](../SCRUM/BACKLOG/Feature.MakeTutorialForExposingLocalPortToNetwork.md):
reaching the dev site from a phone or a second laptop on the same network,
with the dev container on an Apple Silicon Mac, Docker Desktop, and nginx as
the only way in.

Work through it in order. Each stage says what to do, what "done" looks like,
and which trap to expect. The last stage turns what you learned into the
tutorial the backlog item asks for.

The traps marked **expected** come from reading this repository's config, not
from a run on a Mac yet. Confirm each one when you get there. If one doesn't
happen, find out why before moving on: a wrong prediction means the mental
model is wrong somewhere.

**Prerequisites:** the dev container running (`dev`, `nginx` and `mailpit`
from [`.devcontainer/debian/docker-compose.yml`](../../.devcontainer/debian/docker-compose.yml)),
`task frontend:dev` and `task dotnet:dev` started, and a phone on the same
Wi-Fi as the Mac.

---

## Stage 0 — Draw the path a request takes

Before changing anything, draw the hops from the phone's browser to Vite.
There are four, and every problem in this plan is one of them refusing:

```text
phone ──Wi-Fi──▶ Mac (en0) ──Docker Desktop──▶ nginx container :80 ──internal network──▶ dev container :5173 (Vite)
```

Answer these from the files, without running anything:

- Which ports does Docker Desktop publish, and on which host addresses?
  Read the `ports:` lists in the compose file. A bare `'80:80'` means every
  address the Mac has, not just `localhost`.
- How does nginx reach Vite? Find `$frontend_upstream` in
  [`10-bibleguessr.conf`](../../server-replica/nginx/conf.d/10-bibleguessr.conf).
  `dev` is the dev container's name on the compose network.
- Why must Vite listen on more than `localhost` inside its own container?
  Find `host: true` in [`vite.config.ts`](../../frontend/vite.config.ts).

**Done when** you can point at the line in the repo that opens each of the
four hops, and you know which hop is still closed. (Hint: it isn't Docker.)

---

## Stage 1 — Find the Mac's address and try it

```sh
ipconfig getifaddr en0   # Wi-Fi on most Macs
ipconfig getifaddr en1   # try this if en0 prints nothing (e.g. on Ethernet)
```

Run these in a terminal on the Mac itself, not in the dev container. Inside
the container you'd get the container's own address, which the phone can
never reach.

Open `http://<mac-ip>` on the phone.

> **Trap (expected) — the connection just drops.** No error page, nothing.
> nginx answered with its non-standard status 444: close the connection
> without a reply. Read
> [`00-globals.conf`](../../server-replica/nginx/conf.d/00-globals.conf): any
> request whose `Host` doesn't match a `server_name` lands in the
> `default_server` catch-all, which does exactly that, on purpose (see
> `docs/web/cyber-security`). The phone sends `Host: 192.168.x.y`, and only
> `bibleguessr.single` and `www.bibleguessr.single` are known.

Prove it from the Mac before touching any config:

```sh
curl -v http://<mac-ip>/                              # "Empty reply from server"
curl -v -H 'Host: bibleguessr.single' http://<mac-ip>/   # a 301 instead
```

**Done when** you can explain why the second `curl` gets further than the
first, and why that proves Docker and the macOS firewall aren't the problem
(yet).

---

## Stage 2 — Decide how the phone names the site

The phone can't use `bibleguessr.single`: that name lives in the Mac's own
hosts file, which the phone never sees. There are three ways forward. Weigh
them before picking one:

| Option | What it takes | Watch out for |
| --- | --- | --- |
| A server block for LAN access, matching the IP | A new `server { listen 80; server_name …; }` | The IP changes between networks; a regex `server_name` avoids hardcoding it |
| A wildcard DNS name such as `<ip>.nip.io` | Only a `server_name` | Depends on an outside DNS service, and won't work offline |
| Local DNS on your router | Router access | Not something a tutorial can ask everyone to do |

> **Trap (expected) — the existing server block redirects to HTTPS.** Adding
> the IP to the current block's `server_name` sends the phone to
> `https://<mac-ip>`, which serves a certificate made out to
> `bibleguessr.single`. That gives a warning page on the phone, at best. A
> separate plain-HTTP server block for LAN access avoids it. Write down why
> that's acceptable on a home network and wouldn't be in production.

**Done when** you've chosen an option and can say what it costs if your Mac's
IP changes tomorrow.

---

## Stage 3 — Proxy the LAN server block to everything the app needs

Write the server block. It needs the same three routes as the existing one,
not just `/`:

- `/` → Vite (`$frontend_upstream`)
- `/api/` → the backend
- `/hubs/` → the backend, as a WebSocket (`proxy-websocket.conf`, and the long
  `proxy_read_timeout`)

Copy them from the existing HTTPS block, and read
`docs/web/request-routing/index.html` while you do. It explains why each one
is there.

> **Trap (expected) — Vite rejects the host.** nginx passes the phone's
> `Host` header on (`proxy_set_header Host $host;` in
> `proxy-websocket.conf`), and Vite only accepts the hosts in `allowedHosts`.
> The symptom is Vite's own "Blocked request. This host is not allowed" page.
> You can add the host to `allowedHosts`, or override the `Host` header in
> the LAN block only. Pick one, and write down why. Overriding keeps Vite's
> config untouched; adding the host is more honest about what Vite is serving.

> **Trap (expected) — the page loads but multiplayer doesn't.** If `/hubs/`
> is missing or isn't proxied as a WebSocket, the front page works and
> single-player works, but joining a room hangs. The browser's network tab on
> the phone (or Safari's Web Inspector, through the Mac) shows the failed
> upgrade.

Reload nginx without restarting the container:

```sh
docker exec <nginx-container> nginx -t && docker exec <nginx-container> nginx -s reload
```

**Done when** the phone plays a singleplayer game *and* joins a room you
created on the Mac.

---

## Stage 4 — Publish only what should be reachable

Right now Docker Desktop publishes nginx's 80 **and** 443, and Mailpit's 8073
(its web UI, with every email the dev backend has sent) and 1025 (its SMTP
port). All of them listen on every address the Mac has, so on a café's Wi-Fi
all of them are open to the room.

The backlog item asks for nginx's port 80 only. Learn the difference between
these two:

```yaml
ports:
  - '80:80'              # every address on the Mac: the LAN can reach it
  - '127.0.0.1:8073:8025' # only the Mac itself
```

Change the ports so nginx's 80 is the only one the network can reach. Then
check from the phone that `http://<mac-ip>:8073` no longer answers, and from
the Mac that `http://localhost:8073` still does.

> **Trap — compose changes need the container recreated.** Editing `ports:`
> and reloading nginx changes nothing: published ports are fixed when the
> container is created. Rebuild the dev container (or
> `docker compose up -d` the service) and check with `docker ps`, whose
> PORTS column shows the bound address.

> **Trap — Vite's 5173 was never published, and shouldn't be.** VS Code's
> port forwarding makes `localhost:5173` work on the Mac, but only for the
> Mac. If you're ever tempted to reach Vite directly from the phone, that's
> the hop you'd open, and the reason everything goes through nginx instead is
> that nginx is the only gate with security rules on it.

**Done when** `docker ps` shows only `0.0.0.0:80->80/tcp` (plus whatever you
bound to `127.0.0.1`), and the phone still works.

---

## Stage 5 — The parts that behave differently on the phone

Plain HTTP on a LAN address isn't a "secure context" to the browser. Some APIs
the app uses quietly disappear:

> **Trap (expected) — "Share invite link" and "Copy link" fail.**
> `navigator.clipboard` only exists in a secure context (HTTPS, or
> `localhost`). In [`share-or-copy.ts`](../../frontend/src/shared-ui/share-or-copy.ts)
> the clipboard fallback then fails, and the player sees "couldn't be shared
> or copied". Whether `navigator.share` fails too varies by browser; find out
> on your phone. This is a real limit of HTTP, not a bug to fix in the app.
> The tutorial should mention it, so nobody files it as one.

Also check:

- **Live reload (HMR).** Edit a component on the Mac and watch the phone
  update. If it doesn't, the HMR WebSocket isn't making it through nginx's `/`
  location. Check `proxy-websocket.conf` is included there.
- **Leaving the phone idle.** Lock the phone mid-game and unlock it. That's
  the reconnect path from the Congregation work. A real phone is the best
  test it will ever get.

**Done when** you've listed every difference you found between the Mac and
the phone, each with its cause.

---

## Stage 6 — Troubleshooting, the way the tutorial will need it

Break each hop on purpose, and note the symptom the phone shows. The tutorial's
troubleshooting section is this table:

| Break this | Symptom on the phone | How to tell from the Mac |
| --- | --- | --- |
| Phone on a different network (guest Wi-Fi, mobile data) | Times out | `ipconfig getifaddr en0` on the Mac vs. the phone's Wi-Fi details |
| macOS firewall blocking incoming connections (System Settings → Network → Firewall, with "Block all incoming") | Times out | Works with `curl http://<mac-ip>` from the Mac, fails from the phone |
| Another program already on port 80 | Container won't start | `lsof -iTCP:80 -sTCP:LISTEN` on the Mac |
| No matching `server_name` | Connection drops (444) | `curl -v http://<mac-ip>/` → empty reply |
| Vite not running | 502 Bad Gateway | `docker exec <nginx-container> wget -qO- http://dev:5173` |
| Vite's `allowedHosts` | "Blocked request" page | Vite's own message in the response |

Fill in the "Symptom" column from what you actually see, not from this table.
Some of these are guesses.

**Done when** every row has been broken and restored at least once, and the
symptoms in your table are the ones you observed.

---

## Stage 7 — Write the tutorial

Now write what the backlog item asks for, for the next developer on a Mac:

- As a page in `docs/web/` (per `CLAUDE.md`: one folder per feature, plain
  HTML), linked from `docs/web/index.html`.
- In the order someone needs it: find the IP, the one config change, open it
  on the phone, then troubleshooting (your Stage 6 table), and the
  secure-context limits (Stage 5).
- With the config change itself committed, so the tutorial describes the repo
  as it is rather than asking the reader to edit nginx.

Then move the backlog item to `DONE`.

**Done when** someone who hasn't read this plan can follow the tutorial from a
fresh dev container to a working phone, and you've watched them do it, or
done it yourself on a second network.

---

## Reference

| Topic | Where |
| --- | --- |
| How requests reach the API and the hub | `docs/web/request-routing/index.html` |
| Why unknown hosts get 444 | `docs/web/cyber-security/index.html`, `server-replica/nginx/conf.d/00-globals.conf` |
| The dev containers and published ports | `.devcontainer/debian/docker-compose.yml` |
| nginx's site config | `server-replica/nginx/conf.d/10-bibleguessr.conf`, `includes/proxy-websocket.conf` |
| Vite's server settings | `frontend/vite.config.ts` |
| Secure contexts | <https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts> |
| Vite `server.host` / `allowedHosts` | <https://vite.dev/config/server-options> |
| Docker Compose `ports` syntax | <https://docs.docker.com/reference/compose-file/services/#ports> |
