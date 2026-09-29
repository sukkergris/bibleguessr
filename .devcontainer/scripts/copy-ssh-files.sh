#!/usr/bin/env bash
set -Eeuo pipefail
# Prerequisite: The .ssh files must be mounted to ~/.sshtemplate before running this script.
#  For remoteUser "container-user":
#  "source=${localEnv:HOME}/.ssh,target=/home/container-user/.sshtemplate,type=bind,readonly,consistency=cached"
# Copy all SSH files from template to ~/.ssh and set permissions

# Top-level entries to skip when copying from .sshtemplate (e.g. host-side agent
# socket directories whose files vanish mid-copy, causing "No such file" errors).
# Falls back to a sane default if TEMPLATE_COPY_IGNORE_LIST isn't exported by the caller.
if [ "${TEMPLATE_COPY_IGNORE_LIST+set}" != "set" ]; then
  TEMPLATE_COPY_IGNORE_LIST=("agent")
fi

if [ -d "$HOME/.sshtemplate" ]; then
  mkdir -p "$HOME/.ssh"

  # Copy entry-by-entry and skip ignored names up front, so ephemeral socket
  # files inside them are never touched by cp (avoids a copy-time race).
  shopt -s dotglob nullglob
  for entry in "$HOME/.sshtemplate"/*; do
    name="$(basename "$entry")"
    skip=0
    for ignored in "${TEMPLATE_COPY_IGNORE_LIST[@]}"; do
      [ "$name" = "$ignored" ] && { skip=1; break; }
    done
    [ "$skip" -eq 1 ] && continue
    cp -rf "$entry" "$HOME/.ssh/"
  done
  shopt -u dotglob nullglob

  chmod 700 "$HOME/.ssh"
  chmod 600 "$HOME/.ssh/"* 2>/dev/null || true
  echo "SSH files copied from .sshtemplate."
fi
