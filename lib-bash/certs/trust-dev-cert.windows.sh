#!/usr/bin/env bash
set -u

trust_dev_cert_windows() {
  local cert_file="${1:-}"
  local domain="${2:-}"

  printf 'NotImplementedError: trust_dev_cert is not implemented for Windows yet. cert_file=%s domain=%s\n' "${cert_file}" "${domain}" >&2
  return 2
}

trust_dev_cert_windows "$@"
