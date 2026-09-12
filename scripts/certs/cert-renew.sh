#!/usr/bin/env bash
set -u

_CERT_RENEW_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$_CERT_RENEW_DIR/../../lib-bash/header.sh"

load_module "certs"

# ------------------------------------------------------------------
# renew_cert DOMAIN
#
# Re-generates cert files if the cert is missing or expires within
# RENEW_BEFORE_DAYS days (default: 30). Trusts the new cert afterward.
# ------------------------------------------------------------------
renew_cert() {
  local domain="${1:?domain required}"
  local renew_before_days="${RENEW_BEFORE_DAYS:-30}"
  local live_dir="${PROJECT_ROOT}/letsencrypt/live/${domain}"
  local cert_file="${live_dir}/cert.pem"
  local renew_before_seconds=$(( renew_before_days * 86400 ))

  if [[ -f "${cert_file}" ]]; then
    if openssl x509 -in "${cert_file}" -noout -checkend "${renew_before_seconds}" 2>/dev/null; then
      log::info "${domain}: cert valid for more than ${renew_before_days} days, skipping renewal."
      return 0
    fi
    log::info "${domain}: cert expires within ${renew_before_days} days, renewing ..."
  else
    log::info "${domain}: no existing cert found, issuing new ..."
  fi

  local new_cert_file
  new_cert_file="$(create_selfsigned_letsencrypt_files "${domain}")" || return 1

  trust_dev_cert "${new_cert_file}" "${domain}" || return 1

  log::ok "${domain}: cert renewed and trusted."
}

renew_all_certs() {
  local overall=0
  local req_file domain

  while IFS= read -r req_file; do
    domain="$(basename "$(dirname "${req_file}")")"
    renew_cert "${domain}" || overall=1
  done < <(find "${PROJECT_ROOT}/letsencrypt/live" -type f -name req.cnf | sort)

  if [[ "${overall}" -ne 0 ]]; then
    log::error "One or more cert renewals failed."
    return 1
  fi

  log::ok "All certs are up to date."
}

renew_all_certs
