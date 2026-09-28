#!/usr/bin/env bash
# Step 5 of a release: confirms the release workflow produced everything for
# the given tag — a GitHub release carrying the frontend zip, and both Docker
# images published under the release version. Reports every problem it finds
# rather than stopping at the first.
set -euo pipefail

tag_prefix='v'
frontend_asset_prefix='bibleguessr-frontend-r'
images=(bibleguessr-api bibleguessr-nginx)

tag="${1:?usage: check-github-release.sh <tag>}"
docker_username="${DOCKER_USERNAME:?DOCKER_USERNAME must be set}"
image_tag="${tag#"$tag_prefix"}"

failures=0
pass() { echo "✓ $1"; }
fail() { echo "✗ $1" >&2; failures=$((failures + 1)); }

if is_draft="$(gh release view "$tag" --json isDraft --jq .isDraft 2>/dev/null)"; then
  if [[ "$is_draft" == "true" ]]; then
    pass "GitHub release $tag exists (draft — not yet public)"
  else
    pass "GitHub release $tag exists (published)"
  fi

  assets="$(gh release view "$tag" --json assets --jq '.assets[].name')"
  if grep -q "^${frontend_asset_prefix}[0-9][0-9]*\.zip$" <<<"$assets"; then
    pass "Frontend asset attached: $(grep "^${frontend_asset_prefix}" <<<"$assets")"
  else
    fail "No ${frontend_asset_prefix}<n>.zip attached to $tag (assets: ${assets:-none})"
  fi
else
  fail "No GitHub release named $tag — did the release workflow run? (gh run list)"
fi

for image in "${images[@]}"; do
  ref="$docker_username/$image:$image_tag"
  if docker manifest inspect "$ref" >/dev/null 2>&1; then
    pass "Docker image $ref exists"
  else
    fail "Docker image $ref not found on Docker Hub"
  fi
done

if ((failures > 0)); then
  echo "$failures problem(s) found for $tag." >&2
  exit 1
fi
