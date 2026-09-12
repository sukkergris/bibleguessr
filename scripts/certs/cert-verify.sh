#!/usr/bin/env bash
set -u

_CERT_VERIFY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$_CERT_VERIFY_DIR/../../lib-bash/header.sh"

# ------------------------------------------------------------------
# verify_cert DOMAIN
#
# Checks that the cert files for a domain exist, are not expired,
# and that the CN in the cert matches the domain.
# Returns 1 on any failure.
# ------------------------------------------------------------------
verify_cert() {
  local domain="${1:?domain required}"
  local live_dir="${PROJECT_ROOT}/letsencrypt/live/${domain}"
  local cert_file="${live_dir}/cert.pem"
  local key_file="${live_dir}/privkey.pem"
  local fullchain_file="${live_dir}/fullchain.pem"
  local exit_code=0

  log::info "Verifying certs for ${domain} ..."

  # File existence checks
  for f in "${cert_file}" "${key_file}" "${fullchain_file}"; do
    if [[ ! -f "${f}" ]]; then
      log::error "Missing file: ${f}"
      exit_code=1
    fi
  done

  if [[ "${exit_code}" -ne 0 ]]; then
    return "${exit_code}"
  fi

  # Expiry check
  if ! openssl x509 -in "${cert_file}" -noout -checkend 0 2>/dev/null; then
    log::error "Certificate is expired or invalid: ${cert_file}"
    exit_code=1
  fi

  # CN match check
  local cn
  cn="$(openssl x509 -in "${cert_file}" -noout -subject 2>/dev/null \
    | sed -n 's/.*CN\s*=\s*//p' \
    | tr -d ' ')"

  if [[ "${cn}" != "${domain}" ]]; then
    log::error "CN mismatch for ${domain}: got '${cn}'"
    exit_code=1
  fi

  # Key/cert pair consistency check
  local cert_modulus key_modulus
  cert_modulus="$(openssl x509 -in "${cert_file}" -noout -modulus 2>/dev/null | md5)"
  key_modulus="$(openssl rsa -in "${key_file}" -noout -modulus 2>/dev/null | md5)"

  if [[ "${cert_modulus}" != "${key_modulus}" ]]; then
    log::error "Key and certificate do not match for ${domain}"
    exit_code=1
  fi

  if [[ "${exit_code}" -eq 0 ]]; then
    log::ok "${domain}: cert, key and fullchain OK"
  fi

  return "${exit_code}"
}

verify_all_certs() {
  local overall=0
  local req_file domain

  while IFS= read -r req_file; do
    domain="$(basename "$(dirname "${req_file}")")"
    verify_cert "${domain}" || overall=1
  done < <(find "${PROJECT_ROOT}/letsencrypt/live" -type f -name req.cnf | sort)

  if [[ "${overall}" -ne 0 ]]; then
    log::error "One or more certificate verifications failed."
    return 1
  fi

  log::ok "All certificates verified successfully."
}

verify_all_certs
