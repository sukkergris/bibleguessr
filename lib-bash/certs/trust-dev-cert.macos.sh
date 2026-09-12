#!/usr/bin/env bash
set -u

trust_dev_cert_macos() {
  local cert_file="${1:-}"
  local domain="${2:-}"
  local keychain="/Library/Keychains/System.keychain"

  if [[ -z "${cert_file}" || -z "${domain}" ]]; then
    echo "Usage: $0 <certificate-file> <domain>" >&2
    return 1
  fi

  if [[ ! -f "${cert_file}" ]]; then
    echo "Certificate file not found: ${cert_file}" >&2
    return 1
  fi

  sudo security delete-certificate -c "${domain}" "${keychain}" 2>/dev/null || true

  sudo security add-trusted-cert \
    -d \
    -r trustRoot \
    -k "${keychain}" \
    "${cert_file}"
}

trust_dev_cert_macos "$@"