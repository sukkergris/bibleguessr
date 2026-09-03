#!/usr/bin/env bash
set -u

[[ -n "${_OS_DETECTION_LOADED:-}" ]] && return 0
_OS_DETECTION_LOADED=1


detect_kernel_name() {
    if [[ -n "${OS_DETECTION_UNAME_S:-}" ]]; then
        printf '%s\n' "${OS_DETECTION_UNAME_S}"
        return 0
    fi

    uname -s
}

# Returns the CPU architecture from `uname -m` (for example `x86_64` or `arm64`)
detect_arch() {
    if [[ -n "${OS_DETECTION_UNAME_M:-}" ]]; then
        printf '%s\n' "${OS_DETECTION_UNAME_M}"
        return 0
    fi

    uname -m
}
is_docker() {
    [[ -f "/.dockerenv" ]] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null
}
is_wsl() {
    if [[ -n "${OS_DETECTION_PROC_VERSION:-}" ]]; then
        [[ "${OS_DETECTION_PROC_VERSION}" =~ [Mm]icrosoft ]]
        return
    fi

    grep -qi "microsoft" /proc/version 2>/dev/null
}

detect_os_family() {
    local kernel_name
    kernel_name="$(detect_kernel_name)"

    case "${kernel_name}" in
        Darwin) printf 'macos\n' ;;
        Linux) printf 'linux\n' ;;
        CYGWIN*|MINGW*|MSYS*) printf 'windows\n' ;;
        *) printf 'unknown\n' ;;
    esac
}

detect_os() {
    local os_family
    os_family="$(detect_os_family)"

    if [[ "${os_family}" == "linux" ]] && is_wsl; then
        printf 'wsl\n'
        return 0
    fi

    printf '%s\n' "${os_family}"
}

is_macos() {
    [[ "${OS_FAMILY:-$(detect_os_family)}" == "macos" ]]
}

is_linux() {
    [[ "${OS_FAMILY:-$(detect_os_family)}" == "linux" ]]
}

is_windows() {
    [[ "${OS_FAMILY:-$(detect_os_family)}" == "windows" ]]
}

is_container_runtime() {
    if [[ -f "/.dockerenv" || -f "/run/.containerenv" ]]; then
        return 0
    fi

    if grep -Eqa '(docker|containerd|podman|kubepods|lxc)' /proc/1/cgroup 2>/dev/null; then
        return 0
    fi

    if [[ "${container:-}" == "docker" || "${container:-}" == "podman" ]]; then
        return 0
    fi

    return 1
}

OS_FAMILY="$(detect_os_family)"
IS_WSL=false
if [[ "${OS_FAMILY}" == "linux" ]] && is_wsl; then
    IS_WSL=true
fi

# Backward-compatible alias for older callers that expect a single OS label.
OS="${OS_FAMILY}"
if [[ "${IS_WSL}" == "true" ]]; then
    OS="wsl"
fi

ARCH="$(detect_arch)"
IN_CONTAINER=false
if is_container_runtime; then
    IN_CONTAINER=true
fi

export OS_FAMILY
export IS_WSL
export OS
export ARCH
export IN_CONTAINER