#!/usr/bin/env bash
# Offline check proof helper for verify-mfdoctor.
# Copies a showcase fixture to a temp dir, runs mfdoctor check with
# --output - --no-write, writes evidence, then removes the temp copy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "${MFDOCTOR_VERIFY_REPO:-$SKILL_DIR/../../..}" && pwd)"
EVIDENCE_DIR="${MFDOCTOR_VERIFY_EVIDENCE:-$SKILL_DIR/evidence/check}"
FIXTURE_SRC="${MFDOCTOR_VERIFY_FIXTURE:-$REPO_ROOT/examples/showcase/config/remote-http-insecure}"
CLI="${MFDOCTOR_VERIFY_CLI:-$REPO_ROOT/dist/cli.js}"
RUN_ID="${MFDOCTOR_VERIFY_RUN_ID:-$$}"
TMP_ROOT="${MFDOCTOR_VERIFY_TMP:-/tmp/mfdoctor-verify-$RUN_ID}"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$EVIDENCE_DIR"

if [[ ! -f "$CLI" ]]; then
  echo "missing $CLI — run: pnpm install && pnpm build" >&2
  exit 2
fi

# Doctor
doctor_out="$(mktemp)"
set +e
node "$CLI" capabilities >"$doctor_out" 2>"$EVIDENCE_DIR/doctor-stderr.txt"
doctor_ec=$?
set -e
if [[ "$doctor_ec" -ne 0 ]]; then
  echo "doctor failed (exit $doctor_ec)" >&2
  cat "$EVIDENCE_DIR/doctor-stderr.txt" >&2 || true
  exit 2
fi
# Keep a small doctor snippet in evidence (full capabilities is large but useful)
cp "$doctor_out" "$EVIDENCE_DIR/doctor-stdout.json"

mkdir -p "$TMP_ROOT"
FIXTURE_DST="$TMP_ROOT/fixture"
cp -a "$FIXTURE_SRC" "$FIXTURE_DST"

CMD=(node "$CLI" check "$FIXTURE_DST" --ci --format json --output - --no-write)
printf '%q ' "${CMD[@]}" >"$EVIDENCE_DIR/command.txt"
echo >>"$EVIDENCE_DIR/command.txt"
pwd >"$EVIDENCE_DIR/cwd.txt"
echo "$FIXTURE_DST" >"$EVIDENCE_DIR/fixture-cwd.txt"

set +e
"${CMD[@]}" >"$EVIDENCE_DIR/stdout.json" 2>"$EVIDENCE_DIR/stderr.txt"
ec=$?
set -e
echo "$ec" >"$EVIDENCE_DIR/exit-code.txt"

# Side-effect observation: --no-write must not create .mf/doctor
if [[ -d "$FIXTURE_DST/.mf" ]]; then
  echo "FAIL: --no-write still created $FIXTURE_DST/.mf" >"$EVIDENCE_DIR/notes.txt"
  exit 1
fi

# Extract at least one finding / status field
NOTES="$EVIDENCE_DIR/notes.txt"
{
  echo "feature-id: check"
  echo "entry-point: node dist/cli.js check <disposable-showcase-fixture> --ci --format json --output - --no-write"
  echo "fixture-src: $FIXTURE_SRC"
  echo "no-write-side-effect: .mf absent under fixture copy (observed)"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$EVIDENCE_DIR/stdout.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
status = data.get("status")
findings = data.get("findings") or []
rule_ids = [f.get("ruleId") for f in findings if isinstance(f, dict)]
print(f"status: {status!r}")
print(f"finding-count: {len(findings)}")
print(f"rule-ids: {rule_ids[:20]}")
if not findings:
    raise SystemExit("expected at least one finding in check proof")
PY
  else
    echo "python3 unavailable; inspect stdout.json manually for findings/status"
  fi
} >"$NOTES"

echo "ok check proof → $EVIDENCE_DIR (exit $ec)"
# Non-zero check exit can still be a successful proof (policy fail on purpose).
# Helper exits 0 when evidence was captured and findings were observed.
exit 0
