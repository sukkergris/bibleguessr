#!/usr/bin/env bash
set -u

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPTS_DIR="/xyz/.devcontainer/scripts"

bash "${SCRIPTS_DIR}/copy-ssh-files.sh"


SCRIPT="$SCRIPTS_DIR/remove-userkeychain.sh"
if [[ ! -f "$SCRIPT" ]]; then
  echo "ERROR: Script not found: $SCRIPT" >&2
  exit 1
fi

"$SCRIPT" ~/.ssh/config

bash "${SCRIPTS_DIR}/install-global-npm-tools.sh"

# Download the Chromium browser binary for @playwright/cli / @playwright/mcp
# (installed above). System-level runtime deps for it (libnspr4, libnss3,
# etc.) are installed in Dockerfile.debian; this step only fetches the
# browser itself into ~/.cache/ms-playwright, which isn't baked into the image.
if command -v playwright-cli >/dev/null 2>&1; then
  playwright-cli install-browser chromium || echo "WARNING: playwright-cli install-browser failed" >&2
else
  echo "WARNING: playwright-cli not found on PATH — skipping Chromium browser install" >&2
fi

claude --print "." > /dev/null 2>&1 || true

# Fix permissions on mounted volumes since they are owned by root when created by the container, but we want them to be owned by the container user.
sudo chown -R container-user:container-user /home/container-user/.claude \
                                             /home/container-user/.sshtemplate \
                                             /home/container-user/.ssh \
                                             /home/container-user/.continue 2>/dev/null || true

dotnet tool restore

# Install Playwright's Chromium browser and its system dependencies.
# The playwright CLI is a local dotnet tool (see .config/dotnet-tools.json), restored above,
# so it must be invoked via "dotnet tool run" rather than looked up on PATH.
if dotnet tool run playwright -- --version &> /dev/null; then
  dotnet tool run playwright -- -p /xyz/tests/Playwright.Tests/Playwright.Tests.csproj install --with-deps chromium
else
  echo "WARNING: playwright CLI not found after tool restore — skipping Chromium install" >&2
fi

echo "Post container install script done running"
