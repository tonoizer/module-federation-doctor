#!/usr/bin/env bash
# Fail loudly when SARIF upload was requested but did not succeed.
#
# Env:
#   MFDOCTOR_UPLOAD_SARIF   Must be "true" to enforce (otherwise no-op).
#   MFDOCTOR_SARIF_OUTCOME  GitHub step outcome: success | failure | skipped | cancelled.
set -euo pipefail

if [ "${MFDOCTOR_UPLOAD_SARIF:-false}" != "true" ]; then
  exit 0
fi

outcome="${MFDOCTOR_SARIF_OUTCOME:-}"
case "${outcome}" in
  success | skipped)
    exit 0
    ;;
  failure | cancelled | "")
    echo "::error title=SARIF upload failed::upload-sarif requires \`permissions.security-events: write\` on this job (and code scanning enabled for the repository). Add:

permissions:
  contents: read
  security-events: write

Or set upload-sarif: \"false\" if you do not need a code scanning upload. (upload step outcome: ${outcome:-missing})"
    exit 1
    ;;
  *)
    echo "::error title=SARIF upload failed::Unexpected upload-sarif step outcome \`${outcome}\`. Treat this as a failed upload; ensure \`permissions.security-events: write\` is set or disable upload-sarif."
    exit 1
    ;;
esac
