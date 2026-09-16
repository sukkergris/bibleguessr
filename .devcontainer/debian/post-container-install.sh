#!/usr/bin/env bash
# Runs once per container creation (devcontainer.json postCreateCommand).
#
# Only things that cannot be baked into the image belong here: files in
# $HOME, mounted volumes, and downloads too large for an image layer.
# Anything installable as a root apt package belongs in Dockerfile.debian.
set -u

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPTS_DIR="/xyz/.devcontainer/scripts"

# Docker creates fresh volumes owned by root, which leaves the tools that own
# these directories unable to write to them. Must run before the steps below
# that write into ~/.ssh and ~/.gh.
sudo chown -R container-user:container-user \
  "$HOME/.claude" \
  "$HOME/.continue" \
  "$HOME/.gh" \
  "$HOME/.ssh" \
  "$HOME/.sshtemplate" 2>/dev/null || true

# VS Code's Dev Containers extension copies the host's ~/.gitconfig into the
# container on (re)build. That gitconfig has no safe.directory entry for /xyz,
# so Git refuses to operate on the repo ("detected dubious ownership") whenever
# ownership/UID mapping looks even slightly off across the bind mount.
git config --global --add safe.directory /xyz || true

bash "$SCRIPTS_DIR/copy-ssh-files.sh"
bash "$SCRIPTS_DIR/remove-userkeychain.sh" "$HOME/.ssh/config"
bash "$SCRIPTS_DIR/install-global-npm-tools.sh"

# Download the Chromium browser binary for @playwright/cli / @playwright/mcp
# (installed above). System-level runtime deps for it (libnspr4, libnss3,
# etc.) are installed in Dockerfile.debian; this step only fetches the
# browser itself into ~/.cache/ms-playwright, which isn't baked into the image.
if command -v playwright-cli >/dev/null 2>&1; then
  playwright-cli install-browser chromium || echo "WARNING: playwright-cli install-browser failed" >&2
else
  echo "WARNING: playwright-cli not found on PATH — skipping Chromium browser install" >&2
fi

# The frontend e2e suite uses the repo's own `@playwright/test`, which is a
# DIFFERENT tool from the global `playwright-cli` above and pins its own
# browser revision — so the download above does not satisfy it, and
# `task frontend:test-e2e` otherwise fails on first use with "Executable
# doesn't exist ... run npx playwright install".
#
# The dependency lives in frontend/, which postCreateCommand does not install
# (that is `task frontend:install`), so install it here only if it happens to
# be present already. Missing node_modules is the normal first-build case, not
# a fault: the browser is then fetched by the install step below on demand.
FRONTEND_DIR="/xyz/frontend"
if [ -d "$FRONTEND_DIR/node_modules/@playwright/test" ]; then
  (cd "$FRONTEND_DIR" && npx --no-install playwright install chromium) \
    || echo "WARNING: npx playwright install chromium failed" >&2
else
  echo "NOTE: frontend/node_modules not present — the e2e browser will be installed"
  echo "      by 'task frontend:install'. Run that before 'task frontend:test-e2e'."
fi

claude --print "." > /dev/null 2>&1 || true

# gh itself comes from Dockerfile.debian and its credentials persist in the
# ~/.gh volume (GH_CONFIG_DIR, set in docker-compose.yml), but a token must
# never be baked into an image — so logging in stays a manual step, once per
# machine.
if ! gh auth status >/dev/null 2>&1; then
  echo "NOTE: gh is not authenticated. Run 'gh auth login' for issues, PRs and releases."
  echo "      Git push/pull already works over SSH without it."
fi

dotnet tool restore

# Chromium for the .NET Playwright tests. Kept in place ahead of those tests
# landing: until /xyz/.config/dotnet-tools.json and the Playwright.Tests
# project exist, `dotnet tool restore` finds no manifest and this step skips
# with the warning below — expected, not a fault.
#
# The playwright CLI will be a local dotnet tool, so it must be invoked via
# "dotnet tool run" rather than looked up on PATH. Unrelated to the
# npm-installed `playwright-cli` used for the frontend e2e tests above.
if dotnet tool run playwright -- --version &> /dev/null; then
  dotnet tool run playwright -- -p /xyz/tests/Playwright.Tests/Playwright.Tests.csproj install --with-deps chromium
else
  echo "WARNING: playwright CLI not found after tool restore — skipping Chromium install" >&2
fi

echo "Post container install script done running"
