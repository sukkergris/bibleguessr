#!/usr/bin/env bash

# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/../../lib-bash/header.sh"

github_workflows="${PROJECT_ROOT}"/.github/workflows

# vars_file="${github_workflows}"/.vars
# secrets_file="${github_workflows}"/.secrets

cd "${github_workflows}" || exit

act -W test-dockerhub-login.yml \
    --var-file .vars \
    --secret-file .secrets \
    -P ubuntu-24.04=catthehacker/ubuntu:act-24.04
