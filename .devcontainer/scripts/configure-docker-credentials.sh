#!/usr/bin/env bash
set -euo pipefail

DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-$HOME/.docker}"
DOCKER_CONFIG_FILE="$DOCKER_CONFIG_DIR/config.json"

mkdir -p "$DOCKER_CONFIG_DIR"

# Dev Containers may copy a host-only credential-helper name into config.json.
# Docker cannot use that helper inside this Linux container.
if [ -f "$DOCKER_CONFIG_FILE" ] && grep -q '"credsStore"' "$DOCKER_CONFIG_FILE"; then
  cp "$DOCKER_CONFIG_FILE" "$DOCKER_CONFIG_FILE.bak"
  printf '{}\n' > "$DOCKER_CONFIG_FILE"
  echo "Reset Docker credential configuration for this container."
fi
