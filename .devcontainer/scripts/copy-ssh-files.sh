#!/usr/bin/env bash
set -Eeuo pipefail
# Prerequisite: The .ssh files must be mounted to ~/.sshtemplate before running this script.
#  "source=${localEnv:HOME}/.ssh,target=/home/container-user/.sshtemplate,type=bind,readonly,consistency=cached"
# Copy all SSH files from template to ~/.ssh and set permissions

TEMPLATE_DIR="${HOME}/.sshtemplate"
SSH_DIR="${HOME}/.ssh"

if command -v tree >/dev/null 2>&1; then
  tree "${TEMPLATE_DIR}" || true
else
  ls -la "${TEMPLATE_DIR}" || true
fi

if [ ! -d "${TEMPLATE_DIR}" ]; then
  echo "Template dir not found: ${TEMPLATE_DIR}"
  exit 1
fi

if [ ! -f "${TEMPLATE_DIR}/config" ]; then
  echo "Can't find your ./sshtemplate/config file"
  exit 1
fi

mkdir -p "${SSH_DIR}" || {
  echo "ERROR: creating SSH dir failed" >&2
  exit 1
}
# Entries under TEMPLATE_DIR to skip when copying, e.g. "agent" holds live
# ssh-agent sockets that don't survive the bind mount and make cp/stat fail.
IGNORE_LIST=("agent")

shopt -s dotglob nullglob
for item in "${TEMPLATE_DIR}"/*; do
  base="$(basename "${item}")"
  skip=false
  for ignored in "${IGNORE_LIST[@]}"; do
    if [ "${base}" = "${ignored}" ]; then
      skip=true
      break
    fi
  done
  if [ "${skip}" = true ]; then
    continue
  fi
  cp -rf "${item}" "${SSH_DIR}/" || {
    echo "ERROR: copying SSH template failed" >&2
    exit 1
  }
done
shopt -u dotglob nullglob

chmod 700 "${SSH_DIR}"
find "${SSH_DIR}" -mindepth 1 -type d -exec chmod 700 {} + 2>/dev/null || true
find "${SSH_DIR}" -mindepth 1 -type f -exec chmod 600 {} + 2>/dev/null || true
echo "SSH files copied from .sshtemplate."
