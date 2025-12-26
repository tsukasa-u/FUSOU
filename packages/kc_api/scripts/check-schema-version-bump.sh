#!/usr/bin/env bash
set -euo pipefail

# Guard: ensure we are in a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[check-schema-version-bump] Not a git repository; skipping check." >&2
  exit 0
fi

# Collect staged changes (pre-commit) or working tree changes if not staged
changed_files=$(git diff --cached --name-only)
if [ -z "$changed_files" ]; then
  # fallback to unstaged for manual runs
  changed_files=$(git diff --name-only)
fi

if [ -z "$changed_files" ]; then
  echo "[check-schema-version-bump] No changes detected; skipping." >&2
  exit 0
fi

# Paths that indicate schema changes in kc-api-database
schema_touch_regex='^kc_api/crates/kc-api-database/src/(models/|table.rs|encode.rs|decode.rs|integrate.rs|batch_upload.rs|avro_to_parquet.rs|bin/print_schema.rs)'
needs_bump=$(printf "%s\n" "$changed_files" | grep -E "$schema_touch_regex" || true)

if [ -z "$needs_bump" ]; then
  echo "[check-schema-version-bump] No schema-impacting files staged; skipping." >&2
  exit 0
fi

# Was schema_version.rs updated?
schema_version_changed=$(printf "%s\n" "$changed_files" | grep -E '^kc_api/crates/kc-api-database/src/schema_version.rs' || true)

if [ -n "$schema_version_changed" ]; then
  echo "[check-schema-version-bump] schema_version.rs updated ✅" >&2
  exit 0
fi

echo "[check-schema-version-bump] ERROR: Detected schema-related changes but schema_version.rs was not updated." >&2
echo "Files impacting schema:" >&2
printf "  %s\n" $needs_bump >&2
echo "Please bump DATABASE_TABLE_VERSION and/or SCHEMA_VERSION feature set as appropriate." >&2
exit 1
