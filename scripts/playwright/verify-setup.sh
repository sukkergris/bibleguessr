#!/usr/bin/env bash
set -euo pipefail

usage() {
	printf 'Usage: %s <repo-folder>\n' "$(basename "$0")" >&2
	printf 'Example: %s /xyz\n' "$(basename "$0")" >&2
}

if [[ $# -ne 1 ]]; then
	usage
	exit 2
fi

TARGET_DIR="$1"
if [[ ! -d "$TARGET_DIR" ]]; then
	printf '[FAIL] Folder does not exist: %s\n' "$TARGET_DIR"
	exit 2
fi

REPO_ROOT="$(cd -- "$TARGET_DIR" && pwd)"

# Require the repository root folder, not a subproject folder.
REQUIRED_MARKERS=(
	".devcontainer/debian/.env"
	".devcontainer/debian/docker-compose.yml"
	"scripts/playwright/code-generation-from-devcontainer.sh"
	"scripts/playwright/install-dependencies.sh"
	"e2e/package.json"
)

MISSING_MARKERS=()
for marker in "${REQUIRED_MARKERS[@]}"; do
	if [[ ! -e "$REPO_ROOT/$marker" ]]; then
		MISSING_MARKERS+=("$marker")
	fi
done

if ((${#MISSING_MARKERS[@]} > 0)); then
	printf '[FAIL] Folder is not the expected repository root: %s\n' "$REPO_ROOT"
	printf '       Missing required paths:\n'
	for marker in "${MISSING_MARKERS[@]}"; do
		printf '       - %s\n' "$marker"
	done
	printf '       Tip: run with the workspace root, for example: %s /xyz\n' "$(basename "$0")"
	exit 2
fi

ENV_FILE="$REPO_ROOT/.devcontainer/debian/.env"
COMPOSE_FILE="$REPO_ROOT/.devcontainer/debian/docker-compose.yml"
PW_CODEGEN_SCRIPT="$REPO_ROOT/scripts/playwright/code-generation-from-devcontainer.sh"
INIT_SCRIPT="$REPO_ROOT/scripts/playwright/install-dependencies.sh"
E2E_PKG="$REPO_ROOT/e2e/package.json"
ROOT_PKG="$REPO_ROOT/package.json"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf '[PASS] %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf '[FAIL] %s\n' "$1"; }
warn() { WARN_COUNT=$((WARN_COUNT + 1)); printf '[WARN] %s\n' "$1"; }

check_file_exists() {
	local path="$1"
	local label="$2"
	[[ -f "$path" ]] && pass "$label exists: $path" || fail "$label missing: $path"
}

check_command_exists() {
	local cmd="$1"
	command -v "$cmd" >/dev/null 2>&1 && pass "Command available: $cmd" || fail "Command missing: $cmd"
}

check_contains() {
	local file="$1"
	local pattern="$2"
	local label="$3"
	[[ -f "$file" ]] && grep -Eq -- "$pattern" "$file" && pass "$label" || fail "$label"
}

printf 'Playwright devcontainer readiness check\n'
printf 'Repository: %s\n\n' "$REPO_ROOT"

# Core files
check_file_exists "$ENV_FILE" "Env file"
check_file_exists "$COMPOSE_FILE" "Compose file"
check_file_exists "$PW_CODEGEN_SCRIPT" "pw-codegen script"
check_file_exists "$INIT_SCRIPT" "initialize script"
check_file_exists "$E2E_PKG" "e2e package.json"
if [[ -f "$ROOT_PKG" ]]; then
	pass "root package.json exists: $ROOT_PKG"
else
	warn "root package.json missing (ok for monorepo or split setup): $ROOT_PKG"
fi

# Script syntax
bash -n "$PW_CODEGEN_SCRIPT" >/dev/null 2>&1 && pass "pw-codegen script syntax is valid" || fail "pw-codegen script has syntax errors"
bash -n "$INIT_SCRIPT" >/dev/null 2>&1 && pass "initialize script syntax is valid" || fail "initialize script has syntax errors"

# Required commands for noVNC + Playwright flow
for cmd in node npm npx playwright Xvfb x11vnc websockify; do
	check_command_exists "$cmd"
done

# noVNC web assets
[[ -f /usr/share/novnc/vnc.html ]] && pass "noVNC web assets found at /usr/share/novnc" || fail "noVNC web assets missing at /usr/share/novnc/vnc.html"

# Validate env + compose relationship
HOST_NOVNC_PORT=""
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
	HOST_NOVNC_PORT="${HOST_NOVNC_PORT:-}"
fi

if [[ -n "$HOST_NOVNC_PORT" ]]; then
	if [[ "$HOST_NOVNC_PORT" =~ ^[0-9]+$ ]] && ((HOST_NOVNC_PORT >= 1 && HOST_NOVNC_PORT <= 65535)); then
		pass "HOST_NOVNC_PORT is valid: $HOST_NOVNC_PORT"
	else
		fail "HOST_NOVNC_PORT is invalid: $HOST_NOVNC_PORT"
	fi
else
	warn "HOST_NOVNC_PORT not set in env file"
fi

check_contains "$COMPOSE_FILE" '\$\{HOST_NOVNC_PORT:(-|\?).*\}:6080' "Compose maps HOST_NOVNC_PORT to container 6080"

# Validate expected script behavior
check_contains "$PW_CODEGEN_SCRIPT" 'E2E_DIR="\$\{PROJECT_ROOT\}/e2e"' "pw-codegen defines e2e workspace path"
check_contains "$PW_CODEGEN_SCRIPT" 'cd "\$E2E_DIR"' "pw-codegen switches to e2e workspace"
check_contains "$PW_CODEGEN_SCRIPT" 'npx playwright codegen' "pw-codegen uses local Node Playwright CLI"
check_contains "$PW_CODEGEN_SCRIPT" '--target=playwright-test' "pw-codegen defaults to TypeScript Playwright Test target"
check_contains "$PW_CODEGEN_SCRIPT" 'source .*load-lib-bash\.sh' "pw-codegen loads shared lib-bash helpers"

# Validate dependency hint (not mandatory)
PKG_FILES=()
[[ -f "$ROOT_PKG" ]] && PKG_FILES+=("$ROOT_PKG")
[[ -f "$E2E_PKG" ]] && PKG_FILES+=("$E2E_PKG")
if ((${#PKG_FILES[@]} > 0)) && grep -Eq '"@playwright/test"' "${PKG_FILES[@]}" 2>/dev/null; then
	pass "@playwright/test dependency found in package manifest"
else
	warn "@playwright/test not found in package manifests"
fi

# Process/port status is informational
pgrep -x Xvfb >/dev/null 2>&1 && pass "Xvfb process is currently running" || warn "Xvfb process is not running right now (will start when pw-codegen runs)"
pgrep -x x11vnc >/dev/null 2>&1 && pass "x11vnc process is currently running" || warn "x11vnc process is not running right now (will start when pw-codegen runs)"
pgrep -f websockify >/dev/null 2>&1 && pass "websockify process is currently running" || warn "websockify process is not running right now (will start when pw-codegen runs)"

printf '\nSummary: %d pass, %d warn, %d fail\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

((FAIL_COUNT == 0)) || exit 1
