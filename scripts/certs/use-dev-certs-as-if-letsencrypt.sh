#!/usr/bin/env bash
set -u

throw_not_implemented() {
    echo "FATAL: Not implemented" >&2
    exit 42
}

throw_not_implemented

# Brug: ./scripts/use-dev-certs-as-if-letsencrypt.sh <domain>
# Kopierer dev-certs til letsencrypt-stien, så nginx kan bruge dem som "rigtige" certs

if [ $# -lt 1 ]; then
  echo "Usage: $0 <domain>"
  exit 1
fi
DOMAIN="$1"

sudo mkdir -p /etc/letsencrypt/live/"$DOMAIN"/
sudo cp dev/certs/live/"$DOMAIN"/fullchain.pem /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem
sudo cp dev/certs/live/"$DOMAIN"/privkey.pem /etc/letsencrypt/live/"$DOMAIN"/privkey.pem
echo "Dev certs kopieret til /etc/letsencrypt/live/$DOMAIN/"
