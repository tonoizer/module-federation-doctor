#!/usr/bin/env bash
# Require a runnable mfdoctor CLI (or install @tonoizer/mfdoctor first).
#
# Env:
#   MFDOCTOR_CLI          Command used to invoke mfdoctor (required).
#   MFDOCTOR_INSTALL      When "true", install MFDOCTOR_PACKAGE_SPEC via npm first.
#   MFDOCTOR_PACKAGE_SPEC npm package specifier (default: @tonoizer/mfdoctor).
set -euo pipefail

cli="${MFDOCTOR_CLI:-}"
if [ -z "${cli}" ]; then
  echo "::error title=mfdoctor CLI missing::The \`cli\` input is empty. Set it to a runnable command such as \`mfdoctor\`, \`npx mfdoctor\`, or \`node path/to/cli.js\`."
  exit 1
fi

if [ "${MFDOCTOR_INSTALL:-false}" = "true" ]; then
  package_spec="${MFDOCTOR_PACKAGE_SPEC:-@tonoizer/mfdoctor}"
  echo "Installing ${package_spec}…"
  npm install --no-save "${package_spec}"
  bin_dir="$(pwd)/node_modules/.bin"
  if [ -d "${bin_dir}" ]; then
    export PATH="${bin_dir}:${PATH}"
    if [ -n "${GITHUB_PATH:-}" ]; then
      echo "${bin_dir}" >> "${GITHUB_PATH}"
    fi
  fi
fi

set +e
# Intentional word-splitting: cli may be multi-token (e.g. "vp exec mfdoctor").
# shellcheck disable=SC2086
${cli} >/dev/null 2>&1
code=$?
set -e

if [ "${code}" -ne 0 ]; then
  echo "::error title=mfdoctor CLI missing::Configured cli \`${cli}\` is not runnable (exit ${code}). Install \`@tonoizer/mfdoctor\` in this job, set \`install: true\`, or point the \`cli\` input at a working command such as \`npx mfdoctor\` / \`node path/to/cli.js\`."
  exit 1
fi
