# Security Policy

## Reporting a vulnerability

Please report security issues privately, by email, to
**<sukkerfrit@gmail.com>** — not as a public issue or pull request, so the
problem can be fixed before it is widely known.

Please include, as far as you are able:

- What the issue is and roughly how severe you think it is.
- Steps to reproduce it, or a proof of concept.
- The affected version — the frontend version is in
  `frontend/package.json`, the backend version in `backend/Api/Program.fs`,
  and both are served from `/api/version`.

This is a hobby project maintained by one person, so please do not expect
an enterprise response time. I will confirm receipt when I can, and keep
you informed as a fix progresses. If you would like credit for a report,
say so and you will get it.

Please do not run automated scanners, load tests, or denial-of-service
attempts against any hosted instance you do not own. Testing against your
own local instance is welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for how to run one.

## Supported versions

Only the latest `main` is supported. There are no long-lived release
branches, and fixes land on `main` rather than being backported.

## Areas worth particular attention

If you are looking for somewhere useful to point your attention, these are
the parts of the project where a bug would matter most.

### The verse-text privacy boundary

This is the project's most important invariant:

> Uploaded verse text must never be sent to the server or to other
> players. Only the book number, chapter number, and verse number may be
> transmitted.

When a player uses **"My own Bible file"**, their file is parsed entirely
in the browser and cached locally in IndexedDB. This exists so people can
play with translations they are entitled to use privately but not to
redistribute or serve to others.

**Any path by which verse text reaches the server, the SignalR hub, another
player, an error report, or a log is a security bug**, and I would very much
like to hear about it. Relevant code: `frontend/src/epub-parser.ts`,
`frontend/src/rtf-parser.ts`, and the multiplayer message types shared
between `frontend/src/types.ts` and `backend/Api/GameHub.fs`.

### The issue-report flow

A failed Bible-file upload offers a "report this issue" button, which sends
mail through a configured SMTP relay. Two classes of problem to watch for:

- **Content leaking into a report.** Reports must never carry Bible file
  content, verse text, chat history, or game transcripts.
- **Abuse of the relay.** The endpoints are rate-limited per IP and
  globally (`Reports:PerIpDailyLimit`, `Reports:GlobalDailyLimit`). A way
  to bypass those, or to use the endpoints to send arbitrary mail, is a
  bug worth reporting.

Relevant code: `backend/Api/MailSender.fs` and the report endpoints in
`backend/Api/Program.fs`.

### The multiplayer hub

`backend/Api/GameHub.fs` accepts input from any connected client. Anything
that lets a player affect another player's game beyond the documented
rules — scoring for a round they did not play, reading an opponent's
in-flight guess, forcing a disconnect, occupying or hijacking someone
else's player name or room — is in scope.

## Configuration and deployment notes

No credentials are committed to this repository, and none appear anywhere
in its history. SMTP settings are read from configuration with empty
defaults, and `appsettings.Development.json` is gitignored.

If you deploy this yourself, supply `Smtp:*` configuration through your own
environment or secret store, and do not commit it. Reports of a
_misconfiguration_ in your own deployment are not vulnerabilities in this
project, but if the project makes such a misconfiguration easy or hard to
notice, that is worth raising.
