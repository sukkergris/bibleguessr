#!/bin/bash
# Task (Go-Task) installer for ARM64 Linux (Ubuntu 24.04+)
set -u

# shellcheck source=/dev/null
source "$(dirname -- "${BASH_SOURCE[0]}")/../../lib-bash/header.sh"

# shellcheck source=/dev/null
source "$(dirname -- "${BASH_SOURCE[0]}")/../../lib-bash/root-loader.sh"


VERSION="1.7.12"
URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_linux_arm64.tar.gz"

cd /tmp
curl -sSL -o actionlint.tar.gz "$URL"
mkdir -p actionlint-extract
tar -xzf actionlint.tar.gz -C actionlint-extract
sudo mv actionlint-extract/actionlint /usr/local/bin/
rm -rf actionlint.tar.gz actionlint-extract
actionlint --version
