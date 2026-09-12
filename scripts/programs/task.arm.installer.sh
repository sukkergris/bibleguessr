#!/bin/bash
# Task (Go-Task) installer for ARM64 Linux (Ubuntu 24.04+)
set -u

# shellcheck source=/dev/null
source "$(dirname -- "${BASH_SOURCE[0]}")/../../lib-bash/header.sh"

# shellcheck source=/dev/null
source "$(dirname -- "${BASH_SOURCE[0]}")/../../lib-bash/root-loader.sh"

TASK_VERSION="v3.37.2"  # Update to latest if needed
TASK_URL="https://github.com/go-task/task/releases/download/${TASK_VERSION}/task_linux_arm64.tar.gz"

if task --version 2>/dev/null | grep -qF "${TASK_VERSION}"; then
  log::info "Task ${TASK_VERSION} already installed, skipping."
  exit 0
fi

log::info "Installing Task from $TASK_URL"
cd /tmp
curl -sSL -o task_linux_arm64.tar.gz "$TASK_URL"
tar -xzf task_linux_arm64.tar.gz
sudo mv task /usr/local/bin/
rm -rf task_linux_arm64.tar.gz README.md LICENSE

# Verify installation
task --version
cd -
