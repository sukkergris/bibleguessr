#!/usr/bin/env bash
# Starts the noVNC/x11vnc/Xvfb display stack, then runs `playwright codegen` against it.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "${script_dir}/../../lib-bash/load-lib-bash.sh" "$@"
# shellcheck source=/dev/null
source "${SCRIPTS_DIR}/display/novnc.sh"

E2E_DIR="${PROJECT_ROOT}/e2e"

if [[ ! -x "${E2E_DIR}/node_modules/.bin/playwright" ]]; then
    log::error "Playwright dependencies are missing in ${E2E_DIR}"
    echo "Run one of the following, then try again:"
    echo "  - bash ./scripts/playwright/install-dependencies.sh"
    echo "  - task startup:setup"
    exit 1
fi

# Rewrite a localhost target URL to host.docker.internal if it's unreachable from inside the devcontainer.
target_url=""
for arg in "$@"; do
    if [[ "$arg" =~ ^https?:// ]]; then
        target_url="$arg"
        break
    fi
done

if [[ -n "$target_url" ]] && command -v curl >/dev/null 2>&1; then
    host_url=""
    if [[ "$target_url" =~ ^(https?://)(localhost|127\.0\.0\.1)(:[0-9]+)?(/.*)?$ ]]; then
        host_url="${BASH_REMATCH[1]}host.docker.internal${BASH_REMATCH[3]}${BASH_REMATCH[4]}"
    fi

    if ! curl -ksS -m 3 -o /dev/null "$target_url"; then
        if [[ -n "$host_url" ]] && curl -ksS -m 3 -o /dev/null "$host_url"; then
            args=("$@")
            for i in "${!args[@]}"; do
                [[ "${args[$i]}" == "$target_url" ]] && args[$i]="$host_url"
            done
            set -- "${args[@]}"
            log::info "localhost is unreachable from inside the devcontainer, using ${host_url} instead"
        else
            log::error "Cannot reach URL from devcontainer: $target_url"
            echo "Tip: localhost inside the container is not your host machine."
            echo "  - Start the app inside the devcontainer on the port you're using"
            echo "  - If the app runs on the host, use: http://host.docker.internal:5252"
            exit 1
        fi
    fi
fi

novnc::start

# Save the recorded test under e2e/tests by default, unless -o/--output was already given.
has_output=false
for arg in "$@"; do
    if [[ "$arg" == "-o" || "$arg" == "--output" || "$arg" == --output=* ]]; then
        has_output=true
        break
    fi
done

codegen_args=("$@")
if [[ "$has_output" == false ]]; then
    mkdir -p "${E2E_DIR}/tests"
    default_output="tests/recorded-$(date +%Y%m%d-%H%M%S).spec.ts"
    codegen_args+=(-o "$default_output")
    log::info "Recording will be saved to: e2e/${default_output}"
fi

cd "$E2E_DIR"
DISPLAY=":${DISPLAY_NUM}" npx playwright codegen --target=playwright-test "${codegen_args[@]}"
