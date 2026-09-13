<!-- markdownlint-disable MD024 -- repeated ### npm / pnpm / bun subheadings under each point are intentional -->

# Enhansed security

If you install npm packages, you're a target — hundreds of packages have been compromised in the last few months alone. These are the seven config/tooling changes plus three habits from the video below, adapted for npm, pnpm, and bun.

## Inspiration

[youtube](https://www.youtube.com/watch?v=Wq6yMdt11LM)

## 1. Minimum Release Age

Most supply-chain attacks get caught within hours of publishing. If you simply don't install a version the second it drops, you dodge the majority of them for free.

### npm

Set in **days**, in `.npmrc`:

```.npmrc
# .npmrc
min-release-age=3
```

### pnpm

Set in **minutes**, either globally (`~/.config/pnpm/config.yaml`) or per-project in `pnpm-workspace.yaml`. Since pnpm 11 this defaults to `1440` (1 day) even if you never set it yourself:

```yaml
# pnpm-workspace.yaml
minimumReleaseAge: 4320 # 3 days
```

### bun

Set in **seconds**, in `bunfig.toml` (global or per-project):

```toml
# bunfig.toml
[install]
minimumReleaseAge = 259200 # 3 days
```

> Three package managers, three different units (days / minutes / seconds) for the exact same setting — a good summary of this ecosystem.

**Watch out for:**

- If you ever genuinely need the latest version (e.g. a security fix just dropped), you can still install it explicitly from the command line — but watch out for LLMs/coding agents doing this to "just make the install work" and silently bypassing your protection.
- `npx` and `bunx` **do not** respect this setting — they always fetch the latest version regardless of your config. (There's an open PR to fix this in bun.)

## 2. Disable install scripts

When you install a package, it's allowed to run its own code immediately after install (`postinstall`/`preinstall`) — meant for legitimate things like compiling native bindings, but it's also the mechanism nearly every supply-chain attack uses to execute malicious code on your machine.

### npm

pnpm and bun disable this by default; npm doesn't, so turn it off explicitly:

```.npmrc
# .npmrc
ignore-scripts=true
```

Honestly, just don't use npm for this — use pnpm instead. But if you must stick with npm, you can get pnpm/bun-style allow-list behavior with the [`@lavamoat/allow-scripts`](https://www.npmjs.com/package/@lavamoat/allow-scripts) package, which maintains an explicit allow-list in your `package.json` instead of an all-or-nothing switch.

### pnpm

Blocks install scripts by default. When a package wants to run one (e.g. `esbuild`), pnpm tells you, and you choose what to allow:

```bash
pnpm approve-builds
```

This sets `allowBuilds` in `pnpm-workspace.yaml` for you — or set/extend it directly, or pass `--allow-build` on the install command itself:

```yaml
# pnpm-workspace.yaml
allowBuilds:
  esbuild: true
```

### bun

Blocks install scripts by default too, but ships a **curated default allow-list** of common packages (e.g. `esbuild`) that are already trusted. To take full control, add `trustedDependencies` to `package.json` — only packages listed there will be allowed to run scripts:

```json
// package.json
{
  "trustedDependencies": ["esbuild"]
}
```

See which packages want to run scripts but aren't yet trusted:

```bash
bun pm untrusted
```

Then trust one:

```bash
bun pm trust <pkg>
```

> The docs say setting `trustedDependencies: []` should override the default allow-list entirely, but this currently appears to be a bug (doesn't take effect) — the workaround is to put at least one real value in the array, which then causes the default list to be ignored.

To disable install scripts entirely in bun (no allow-list at all):

```toml
# bunfig.toml (global)
[install]
installScripts = false
```

## 3. Block git-based dependencies

A dependency can be declared as a git URL instead of coming from the registry — which bypasses normal registry protections, and a malicious git dependency can even ship its own `.npmrc` that re-enables lifecycle scripts. This was one of the tricks used in the npm supply-chain attack that hit tanstack.

### npm

```.npmrc
# .npmrc
allow-git=none   # block git-based dependencies entirely
# or
allow-git=root   # only allow them if declared directly in your root package.json
```

### pnpm

The equivalent setting is `blockExoticSubdeps`. When `true`, only **direct** dependencies (declared in your root `package.json`) may use exotic sources like git repos or direct tarball URLs — a dependency can no longer smuggle in its own exotic sub-dependency:

```yaml
# pnpm-workspace.yaml
blockExoticSubdeps: true
```

- ✅ direct deps (root `package.json`) — git & tarball URLs still allowed
- ❌ sub-dependencies — exotic sources blocked

### bun

No equivalent option yet — there's an open PR to add one, so this may land soon.

### Bonus: pnpm trust policy

pnpm also has a `trustPolicy` setting. Set to `no-downgrade`, pnpm will fail the install if a package's trust level has _decreased_ since its previous release — e.g. it used to be published by a verified/trusted publisher but the new version only has provenance (or no trust evidence at all). This helps catch attacks that find a way around a project's usual publishing process (e.g. via a compromised maintainer account):

```yaml
# pnpm-workspace.yaml
trustPolicy: no-downgrade
```

## 4. Scan dependencies before install

The most powerful tip: use a tool that actually audits a package _before_ it ever touches your machine, rather than after. Two free options:

### npq

Works as an alias in front of npm, pnpm, or bun. On every install it:

- Checks known vulnerabilities against Snyk's database
- Flags any package published less than ~22 days ago
- Catches typosquatting (e.g. `expres` instead of `express`)
- Verifies registry signature & build provenance
- Warns on pre/post-install scripts
- Checks basics: download count, README, license, repo URL, maintainer email domain still registered

Gives you an interactive report and still lets you decide whether to proceed.

```bash
npx npq install <package>
```

### Socket Firewall

Also aliases in front of your package manager(s), and additionally covers non-JS ecosystems (Python's `uv`/`pip`, Rust's `cargo`). Blocks human-confirmed malicious packages outright and warns on AI-detected (not-yet-human-reviewed) threats. Socket has caught a number of recent real-world attacks — reportedly attackers themselves have said Socket would catch their malware before it even reaches your machine.

> If you adopt either tool, clear your package manager's cache afterwards so every already-installed package actually gets checked by the firewall going forward.

## 5. Review your lockfile

The lockfile holds the actual resolved download URL + integrity hash for every package. Almost nobody reviews lockfile diffs in a PR — so a malicious PR can quietly repoint a `resolved` URL at an attacker-controlled server and update the integrity hash to match, and nothing looks obviously wrong.

### pnpm

Not vulnerable to this by design — pnpm doesn't keep swappable tarball sources in the same way, and it refuses to install anything present in the lockfile but not actually declared in `package.json`.

### npm / bun

Use [`lockfile-lint`](https://www.npmjs.com/package/lockfile-lint) as a dev dependency. It validates that every package resolves from a trusted host (e.g. the npm registry), that resolved URLs actually match the package name, and that integrity hashes are well-formed — failing the check if anything looks tampered with. (No concrete information on whether bun's lockfile is vulnerable to this class of issue — treat it as unverified and use `lockfile-lint` there too.)

## 6. Use clean install commands in CI/production

Never use a mutating install command in CI. Use the frozen/clean variant, which installs _exactly_ what's in the lockfile and hard-fails if the lockfile and `package.json` disagree, instead of silently resolving new versions:

```bash
# npm
npm ci

# pnpm
pnpm install --frozen-lockfile
# (pnpm does this automatically when it detects it's running in CI)

# bun
bun install --frozen-lockfile
```

None of this matters if your lockfile isn't committed — make sure it's in version control, not `.gitignore`.

## 7. Build better habits

Config and tooling only get you so far — a few habits matter just as much:

1. **Stop blindly updating everything.** Running `npm update`/equivalent to bump every dependency at once is exactly the behavior attackers hope for. Review _why_ you need each upgrade instead of updating in bulk.
2. **Use fewer packages.** Every dependency is more attack surface, and most attacks spread through a dependency-of-a-dependency, not something you added directly. Ask whether you need the library at all — e.g. lodash for something a small snippet could do, or axios when `fetch` suffices. This is easier than ever with AI coding assistants able to just write the small function for you.
3. **Pin dependencies to exact versions.** This makes upgrading a deliberate choice — but note it only locks _your own_ declared versions; your dependencies' own dependencies can still use loose ranges, which is exactly why minimum release age (tip 1) still matters even with pinning.

## 8. Develop inside a dev container

The ultimate tip, and genuinely the strongest mitigation of all of these: do your day-to-day development inside a hardened dev container rather than directly on your host machine.

Why it helps specifically against the attacks above: every tip so far reduces the _chance_ a malicious package's install script or payload runs. A dev container limits the _blast radius_ if one gets through anyway — a compromised `postinstall` script or a supply-chain worm (e.g. Shai-Hulud) that would otherwise read your SSH keys, cloud credentials, browser cookies, or other repos on your host instead only ever sees the container's filesystem. Concretely:

- Your host's `~/.ssh`, `~/.aws`, browser profile, and other projects aren't reachable unless you explicitly mount them in — so don't mount them in, or mount only what's strictly needed, read-only where possible.
- Secrets/env vars used by the project should be injected into the container at runtime rather than baked into an image or mounted from your host's dotfiles.
- A compromised container is disposable — rebuild it — whereas a compromised host machine is a much bigger cleanup (and a much bigger question of _what else_ it touched).

This is more friction than working locally, which is why it's listed last rather than as tip 1 — but combined with the config changes above (min release age, disabled scripts, git-dep blocking, pre-install scanning, lockfile integrity, clean CI installs, and sane update habits), it's the closest you get to "assume a package will eventually be malicious, and make sure that doesn't matter."

## Migrating an existing npm project to pnpm

Several of the protections above (script blocking, `blockExoticSubdeps`, lockfile integrity) are pnpm defaults rather than something you have to configure — which is the main security argument for switching. Steps for a project currently using npm, e.g. [`frontend/omnia-lit`](../frontend/omnia-lit):

1. **Install pnpm** (if not already):

   ```bash
   corepack enable
   corepack use pnpm@latest
   # or: npm install -g pnpm
   ```

2. **Remove npm's artifacts** from the project:

   ```bash
   rm -rf node_modules package-lock.json
   ```

3. **Import the existing lockfile** so you keep the exact same resolved dependency versions instead of letting pnpm re-resolve everything from your version ranges:

   ```bash
   pnpm import
   ```

   This reads `package-lock.json` (if still present — run this _before_ deleting it in step 2, or restore it from git first) and generates an equivalent `pnpm-lock.yaml`. Order matters: run `pnpm import` first, then remove `package-lock.json`.

4. **Install with pnpm:**

   ```bash
   pnpm install
   ```

   pnpm will likely report packages wanting to run install scripts (e.g. `esbuild`) that it's blocking by default — this is expected, see tip 2. Review and approve the ones you actually need:

   ```bash
   pnpm approve-builds
   ```

5. **Add the security settings from this doc** to a new `pnpm-workspace.yaml` at the project root (or repo root, if shared across projects):

   ```yaml
   # pnpm-workspace.yaml
   minimumReleaseAge: 4320 # 3 days
   blockExoticSubdeps: true
   trustPolicy: no-downgrade
   ```

6. **Update scripts and docs that reference npm** — `package.json` scripts calling `npm run x` internally, README setup instructions, editor tasks, etc. pnpm scripts are invoked the same way (`pnpm run dev` / `pnpm dev`), so most call sites just need `npm` swapped for `pnpm`.

7. **Update CI** to install pnpm and use a frozen install (tip 6):

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```

   pnpm detects most CI environments automatically and applies `--frozen-lockfile` on its own, but setting it explicitly is clearer and doesn't rely on that detection.

8. **Commit `pnpm-lock.yaml`** and delete `package-lock.json` from version control (and add it to `.gitignore` so it doesn't silently reappear if someone runs `npm install` by habit).

9. **Sanity check**: delete `node_modules` one more time and run `pnpm install --frozen-lockfile` to confirm the committed lockfile alone reproduces a working install, then run the project's build/test scripts.

> If anything in the project relies on npm/Node's "flat" `node_modules` (phantom dependencies — importing a package that's only a transitive dependency, never declared directly), pnpm's strict `node_modules` structure will break it. That's usually a sign of a pre-existing bug worth fixing (declare the dependency directly), not a reason to disable pnpm's isolation.
