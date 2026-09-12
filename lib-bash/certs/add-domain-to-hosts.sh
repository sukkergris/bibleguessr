#!/usr/bin/env bash
set -u

[[ -n "${_HOSTFILE_ADD_DOMAIN_LOADED:-}" ]] && return 0 2>/dev/null || true
_HOSTFILE_ADD_DOMAIN_LOADED=1

_HOSTFILE_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$_HOSTFILE_SCRIPT_DIR/../header.sh"

load_module "os-detection"

add_domain_to_hostfile_macos() {
	local domain="${1:-}"
	local ip_address="${2:-127.0.0.1}"
	local hosts_file="/etc/hosts"

	if [[ -z "${domain}" ]]; then
		printf 'Usage: add_domain_to_hostfile_macos <domain> [ip]\n' >&2
		return 1
	fi

	if grep -Eq "^[[:space:]]*${ip_address}[[:space:]]+.*\b${domain}\b" "${hosts_file}"; then
		printf 'Host entry already exists: %s -> %s\n' "${domain}" "${ip_address}"
		return 0
	fi

	printf 'Adding host entry: %s -> %s\n' "${domain}" "${ip_address}"
	printf '%s\t%s\n' "${ip_address}" "${domain}" | sudo tee -a "${hosts_file}" >/dev/null
}

add_domain_to_hostfile_linux() {
	local domain="${1:-}"
	local ip_address="${2:-127.0.0.1}"

	printf 'NotImplementedError: add_domain_to_hostfile is not implemented for Linux yet. domain=%s ip=%s\n' "${domain}" "${ip_address}" >&2
	return 2
}

add_domain_to_hostfile_windows() {
	local domain="${1:-}"
	local ip_address="${2:-127.0.0.1}"

	printf 'NotImplementedError: add_domain_to_hostfile is not implemented for Windows yet. domain=%s ip=%s\n' "${domain}" "${ip_address}" >&2
	return 2
}

add_domain_to_hostfile() {
	local domain="${1:-}"
	local ip_address="${2:-127.0.0.1}"

	if is_macos; then
		add_domain_to_hostfile_macos "${domain}" "${ip_address}"
		return $?
	fi

	if is_linux; then
		add_domain_to_hostfile_linux "${domain}" "${ip_address}"
		return $?
	fi

	if is_windows; then
		add_domain_to_hostfile_windows "${domain}" "${ip_address}"
		return $?
	fi

	printf 'Unsupported OS: %s\n' "${OS:-unknown}" >&2
	return 1
}

# Allow direct script usage while still supporting source-as-module usage.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	add_domain_to_hostfile "$@"
fi
