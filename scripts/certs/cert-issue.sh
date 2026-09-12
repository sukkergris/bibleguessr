#!/usr/bin/env bash
set -u

_CERT_ISSUE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$_CERT_ISSUE_DIR/../../lib-bash/header.sh"

load_module "certs"
load_module "add-domain-to-hosts"
load_module "os-detection"

setup_certs() {

  if is_docker; then
    printf 'Skipping setup_certs: running inside Docker container.\n'
    return 1
  fi
  local domains=("biblegessr.single")
  local domain cert_file

  for domain in "${domains[@]}"; do
    cert_file="$(create_selfsigned_letsencrypt_files "${domain}")" || return 1
    trust_dev_cert "${cert_file}" "${domain}" || return 1
    add_domain_to_hostfile "${domain}"
    add_domain_to_hostfile www."${domain}"
    add_domain_to_hostfile squidex."${domain}"
    add_domain_to_hostfile www.squidex."${domain}"
  done
}

setup_certs || exit 1
create_dummy_cert
