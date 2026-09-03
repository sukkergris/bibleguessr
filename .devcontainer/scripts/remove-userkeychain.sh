#!/usr/bin/env bash
set -u

# Remove UseKeychain (case-insensitive) from a config file if it exists
if [ -f "$1" ]; then
  sed -i '/UseKeychain/I d' "$1"
  echo "UseKeychain removed from $1."
fi
