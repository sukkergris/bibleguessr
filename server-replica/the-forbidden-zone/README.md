# the-forbidden-zone

Decoy material for the scanner tarpit.

## What this folder is for

Requests to paths only a vulnerability scanner would ask for (`/.env`,
`/wp-login.php`, `/.git/config`, any `.php` URL) are answered with worthless
bait instead of a fast `403`, so the scanner's connection is held open rather
than freed up for its next target. See
[`docs/web/cyber-security/index.html`](../../docs/web/cyber-security/index.html)
for how the tarpit fits into the rest of the edge defenses.

## The tarpit body is generated, not stored

Nothing in this folder is served any more.

The tarpit body now comes from
[`server-replica/nginx/njs/tarpit.js`](../nginx/njs/tarpit.js), which
generates a fake configuration file on the fly and streams it at a few KB/s.
Generating it has three advantages over serving a file from disk:

- **Nothing large is committed.** The previous decoy, `production.conf`, was
  100 MB of random bytes tracked in git — paid for by every clone, forever.
- **Nothing has to be mounted.** The old setup depended on a bind mount that
  was commented out in the devcontainer and absent from the production image,
  so the tarpit silently returned `404` instead of tarpitting anything.
- **Every response differs.** Bait values are randomized per request, so two
  scanners never receive byte-identical bodies.

`production.conf` was therefore deleted. It is still reachable in git history
if it is ever needed:

```sh
git show 78293a2:server-replica/the-forbidden-zone/production.conf > /tmp/production.conf
```

Deleting it from the working tree does not shrink the repository, because the
blob remains in history. Reclaiming that space needs a history rewrite
(`git filter-repo`), which rewrites commit hashes and has to be coordinated
with everyone who has a clone — so it is deliberately not done here.

## What is left

| File | Tracked | Purpose |
| --- | --- | --- |
| `fake-admin.conf` | yes | Small bait config. Not currently served; kept as sample bait text. |
| `Protected.jpeg` | no | Untracked local file, not referenced by any config. |

Neither is read by nginx. If you add a file here that is meant to be served,
wire it up explicitly and check its size before committing it — this folder is
exactly where a large binary slips into history unnoticed.

## Testing the tarpit

`server-replica/nginx/test/` holds scripts that exercise the tarpit end to end
against a throwaway container — routing, streaming rate, chunked encoding,
per-request uniqueness and client-abort handling. Run:

```sh
server-replica/nginx/test/run-tarpit-tests.sh
```
