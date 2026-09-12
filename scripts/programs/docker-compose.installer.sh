#!/bin/bash
# Docker Compose v2 CLI plugin installer for ARM64 Linux (Ubuntu 24.04+)
set -Eeuo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/../../lib-bash/header.sh"

COMPOSE_VERSION="v2.35.1"  # Update to latest if needed
COMPOSE_URL="https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-aarch64"
PLUGIN_DIR="/usr/lib/docker/cli-plugins"
PLUGIN_BIN="${PLUGIN_DIR}/docker-compose"

if docker compose version 2>/dev/null | grep -qF "${COMPOSE_VERSION}"; then
  log_info "Docker Compose ${COMPOSE_VERSION} already installed, skipping."
  exit 0
fi

log_info "Installing Docker Compose ${COMPOSE_VERSION} from GitHub"
mkdir -p "${PLUGIN_DIR}"
curl -sSL -o "${PLUGIN_BIN}" "${COMPOSE_URL}"
chmod +x "${PLUGIN_BIN}"

docker compose version
