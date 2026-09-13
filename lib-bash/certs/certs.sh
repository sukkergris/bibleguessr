#!/usr/bin/env bash

# Bash version of pragma once
[[ -n "${_CERTS_LOADED:-}" ]] && return 0
_CERTS_LOADED=1

_CERTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$_CERTS_DIR/../header.sh"

load_module "os-detection"

create_dummy_cert() {
  local out_dir="${1:-$PROJECT_ROOT/nginx/ssl}"

  mkdir -p "$out_dir"
  openssl req -x509 -nodes \
    -newkey rsa:2048 \
    -days 3650 \
    -out "$out_dir/dummy.crt" \
    -keyout "$out_dir/dummy.key" \
    -subj "/CN=_"
}

# Crate selfsigned certs letsencrypt style
create_selfsigned_letsencrypt_files() {
  local domain="${1:?domain required}"
  local req_cnf="${2:-$PROJECT_ROOT/server-replica/letsencrypt/live/$domain/req.cnf}"
  local days="${3:-825}"
  local live_dir="${PROJECT_ROOT}/server-replica/letsencrypt/live/${domain}"

  util::folder_exists "${live_dir}"
  log::info "Folder exists: ${live_dir}"

  local key_file="${live_dir}/privkey.pem"
  local cert_file="${live_dir}/cert.pem"
  local fullchain_file="${live_dir}/fullchain.pem"

  if [[ ! -f "${req_cnf}" ]]; then
    printf 'Missing req.cnf: %s\n' "${req_cnf}" >&2
    return 1
  fi

  mkdir -p "${live_dir}"

  openssl genrsa -out "${key_file}" 2048 || return 1

  openssl req -x509 -new \
    -key "${key_file}" \
    -sha256 -days "${days}" \
    -out "${cert_file}" \
    -config "${req_cnf}" \
    -extensions v3_req || return 1

  # For self-signed dev certs, fullchain is just the leaf cert.
  cp "${cert_file}" "${fullchain_file}" || return 1

  chmod 600 "${key_file}"
  chmod 644 "${cert_file}" "${fullchain_file}"

  printf '%s\n' "${cert_file}"
}

trust_dev_cert() {
  local cert_file="$1"
  local domain="$2"

  # Trust-store installation is host-level and should not run from containers.
  if [[ -f "/.dockerenv" ]] || [[ -f "/run/.containerenv" ]]; then
    printf 'Refusing to trust cert inside container runtime. Run this step on host instead.\n' >&2
    printf 'Detected container while processing domain: %s\n' "$domain" >&2
    return 1
  fi

  if is_macos; then
    bash "$_CERTS_DIR/trust-dev-cert.macos.sh" "$cert_file" "$domain"
    return $?
  fi

  if [[ "${IS_WSL:-false}" == "true" ]]; then
    bash "$_CERTS_DIR/trust-dev-cert.windows.sh" "$cert_file" "$domain"
    return $?
  fi

  if is_linux; then
    bash "$_CERTS_DIR/trust-dev-cert.linux.sh" "$cert_file" "$domain"
    return $?
  fi

  if is_windows; then
    bash "$_CERTS_DIR/trust-dev-cert.windows.sh" "$cert_file" "$domain"
    return $?
  fi

  printf 'Unsupported OS: %s\n' "${OS:-unknown}" >&2
  return 1
}
