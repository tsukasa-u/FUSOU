#!/bin/bash
set -euo pipefail

# Path to proxy data directory
PROXY_DATA_DIR="$(dirname "$0")/../../FUSOU-PROXY-DATA"
SCRIPT_DIR="$(dirname "$0")"

if [ ! -d "$PROXY_DATA_DIR" ]; then
  echo "Error: $PROXY_DATA_DIR not found!"
  exit 1
fi

ENV_SCAN_AST_MAX_OLD_SPACE_MB="${SCAN_AST_MAX_OLD_SPACE_MB-}"
ENV_SCAN_AST_STRICT_NMINUS1="${SCAN_AST_STRICT_NMINUS1-}"
ENV_SCAN_AST_ALLOW_DUPLICATE_ITEMS="${SCAN_AST_ALLOW_DUPLICATE_ITEMS-}"
ENV_SCAN_AST_MAX_COMBO_SIZE="${SCAN_AST_MAX_COMBO_SIZE-}"
ENV_SCAN_AST_THREADS="${SCAN_AST_THREADS-}"
ENV_SCAN_AST_SHIPS="${SCAN_AST_SHIPS-}"
ENV_SCAN_AST_PROGRESS_INTERVAL_MS="${SCAN_AST_PROGRESS_INTERVAL_MS-}"
ENV_SCAN_AST_SCHEDULE_SHARDS="${SCAN_AST_SCHEDULE_SHARDS-}"
ENV_SCAN_AST_SHIP_RANGE="${SCAN_AST_SHIP_RANGE-}"
ENV_SCAN_AST_AST_CANDIDATE_SHIPS="${SCAN_AST_AST_CANDIDATE_SHIPS-}"
ENV_SCAN_AST_DISABLE_CANDIDATE_FILTER="${SCAN_AST_DISABLE_CANDIDATE_FILTER-}"
ENV_SCAN_PERIOD_TAG="${SCAN_PERIOD_TAG-}"
ENV_FUSOU_SCAN_NODE_BIN="${FUSOU_SCAN_NODE_BIN-}"

resolve_node_bin() {
  if [[ -n "$ENV_FUSOU_SCAN_NODE_BIN" ]]; then
    printf '%s\n' "$ENV_FUSOU_SCAN_NODE_BIN"
    return 0
  fi
  if [[ -x "$HOME/.nvm/versions/node/v24.18.0/bin/node" ]]; then
    printf '%s\n' "$HOME/.nvm/versions/node/v24.18.0/bin/node"
    return 0
  fi
  command -v node
}

SCAN_NODE_BIN="$(resolve_node_bin)"

SCAN_AST_MAX_OLD_SPACE_MB="${ENV_SCAN_AST_MAX_OLD_SPACE_MB:-8192}"

# Arg-first defaults (strict + duplicate mode by default)
if command -v nproc >/dev/null 2>&1; then
  SCAN_AST_THREADS="$(nproc)"
elif command -v getconf >/dev/null 2>&1; then
  SCAN_AST_THREADS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
else
  SCAN_AST_THREADS=1
fi
if [[ "$SCAN_AST_THREADS" -gt 8 ]]; then
  SCAN_AST_THREADS=8
fi
SCAN_AST_MAX_COMBO_SIZE=6
SCAN_AST_SHIPS=""
SCAN_AST_SHIP_RANGE=""
SCAN_AST_STRICT_NMINUS1=1
SCAN_AST_ALLOW_DUPLICATE_ITEMS=1
SCAN_AST_PROGRESS_INTERVAL_MS=2000
SCAN_AST_SCHEDULE_SHARDS=256
SCAN_AST_AST_CANDIDATE_SHIPS="all"
SCAN_AST_DISABLE_CANDIDATE_FILTER=0
SCAN_PERIOD_TAG=""
SCAN_AST_V8_FLAGS=""
SCAN_AST_PROFILE_V8=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --threads)
      SCAN_AST_THREADS="$2"; shift 2 ;;
    --max-combo-size)
      SCAN_AST_MAX_COMBO_SIZE="$2"; shift 2 ;;
    --ships)
      SCAN_AST_SHIPS="$2"; shift 2 ;;
    --ship-range)
      SCAN_AST_SHIP_RANGE="$2"; shift 2 ;;
    --period-tag)
      SCAN_PERIOD_TAG="$2"; shift 2 ;;
    --ast-candidate-ships)
      SCAN_AST_AST_CANDIDATE_SHIPS="$2"; shift 2 ;;
    --no-ast-candidate-ships)
      SCAN_AST_DISABLE_CANDIDATE_FILTER=1
      SCAN_AST_AST_CANDIDATE_SHIPS=""
      shift ;;
    --strict-nminus1)
      SCAN_AST_STRICT_NMINUS1=1; shift ;;
    --no-strict-nminus1)
      SCAN_AST_STRICT_NMINUS1=0; shift ;;
    --allow-duplicate-items)
      SCAN_AST_ALLOW_DUPLICATE_ITEMS=1; shift ;;
    --no-allow-duplicate-items)
      SCAN_AST_ALLOW_DUPLICATE_ITEMS=0; shift ;;
    --progress-interval-ms)
      SCAN_AST_PROGRESS_INTERVAL_MS="$2"; shift 2 ;;
    --schedule-shards)
      SCAN_AST_SCHEDULE_SHARDS="$2"; shift 2 ;;
    --v8-flags)
      SCAN_AST_V8_FLAGS="$2"; shift 2 ;;
    --profile-v8)
      SCAN_AST_PROFILE_V8=1; shift ;;
    --max-old-space-mb)
      SCAN_AST_MAX_OLD_SPACE_MB="$2"; shift 2 ;;
    *)
      echo "Error: unknown option: $1"
      exit 1 ;;
  esac
done

# Compatibility fallback: environment variables still work when explicitly set.
if [[ -n "$ENV_SCAN_AST_STRICT_NMINUS1" ]]; then SCAN_AST_STRICT_NMINUS1="$ENV_SCAN_AST_STRICT_NMINUS1"; fi
if [[ -n "$ENV_SCAN_AST_ALLOW_DUPLICATE_ITEMS" ]]; then SCAN_AST_ALLOW_DUPLICATE_ITEMS="$ENV_SCAN_AST_ALLOW_DUPLICATE_ITEMS"; fi
if [[ -n "$ENV_SCAN_AST_MAX_COMBO_SIZE" ]]; then SCAN_AST_MAX_COMBO_SIZE="$ENV_SCAN_AST_MAX_COMBO_SIZE"; fi
if [[ -n "$ENV_SCAN_AST_THREADS" ]]; then SCAN_AST_THREADS="$ENV_SCAN_AST_THREADS"; fi
if [[ -n "$ENV_SCAN_AST_SHIPS" ]]; then SCAN_AST_SHIPS="$ENV_SCAN_AST_SHIPS"; fi
if [[ -n "$ENV_SCAN_AST_PROGRESS_INTERVAL_MS" ]]; then SCAN_AST_PROGRESS_INTERVAL_MS="$ENV_SCAN_AST_PROGRESS_INTERVAL_MS"; fi
if [[ -n "$ENV_SCAN_AST_SCHEDULE_SHARDS" ]]; then SCAN_AST_SCHEDULE_SHARDS="$ENV_SCAN_AST_SCHEDULE_SHARDS"; fi
if [[ -n "$ENV_SCAN_AST_SHIP_RANGE" ]]; then SCAN_AST_SHIP_RANGE="$ENV_SCAN_AST_SHIP_RANGE"; fi
if [[ -n "$ENV_SCAN_AST_AST_CANDIDATE_SHIPS" ]]; then SCAN_AST_AST_CANDIDATE_SHIPS="$ENV_SCAN_AST_AST_CANDIDATE_SHIPS"; fi
if [[ -n "$ENV_SCAN_AST_DISABLE_CANDIDATE_FILTER" ]]; then SCAN_AST_DISABLE_CANDIDATE_FILTER="$ENV_SCAN_AST_DISABLE_CANDIDATE_FILTER"; fi
if [[ -n "$ENV_SCAN_PERIOD_TAG" ]]; then SCAN_PERIOD_TAG="$ENV_SCAN_PERIOD_TAG"; fi

if [[ "$SCAN_AST_DISABLE_CANDIDATE_FILTER" = "1" ]]; then
  SCAN_AST_AST_CANDIDATE_SHIPS=""
fi

echo "=== FUSOU Synergy Generator (Latest) ==="

# Resolve period tag
if [[ -n "$SCAN_PERIOD_TAG" ]]; then
  if [[ ! "$SCAN_PERIOD_TAG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Error: --period-tag must be YYYY-MM-DD, got: $SCAN_PERIOD_TAG"
    exit 1
  fi
  if [[ ! -d "$PROXY_DATA_DIR/$SCAN_PERIOD_TAG" ]]; then
    echo "Error: period tag directory not found: $PROXY_DATA_DIR/$SCAN_PERIOD_TAG"
    exit 1
  fi
  tag="$SCAN_PERIOD_TAG"
else
  # Get the latest directory that matches YYYY-MM-DD
  tag=$(find "$PROXY_DATA_DIR" -maxdepth 1 -type d -name "20*" -exec basename {} \; | sort -r | head -n 1)
fi

if [ -z "$tag" ]; then
  echo "No period tags found."
  exit 0
fi

echo "----------------------------------------"
echo "Processing latest period_tag: $tag"
echo "----------------------------------------"
echo "[scan] node binary: $SCAN_NODE_BIN"

# 1. Deobfuscate
echo "[1/3] Deobfuscating..."
"$SCAN_NODE_BIN" "$SCRIPT_DIR/core/deobfuscate.js" --period-tag "$tag"

# 2. Extract AST
echo "[2/3] Extracting AST..."
"$SCAN_NODE_BIN" "$SCRIPT_DIR/core/extract-ast.js" --period-tag "$tag"

# 3. Scan Synergy
echo "[3/3] Scanning Synergy..."
echo "[3/3] scan-ast heap limit: ${SCAN_AST_MAX_OLD_SPACE_MB} MB"
echo "[3/3] max combo size: ${SCAN_AST_MAX_COMBO_SIZE}"
if [ "$SCAN_AST_THREADS" -gt 1 ] 2>/dev/null; then
  echo "[3/3] parallel workers: ${SCAN_AST_THREADS}"
fi
if [ "$SCAN_AST_THREADS" -gt 8 ] 2>/dev/null; then
  echo "[3/3] WARNING: workers > 8 was observed to diverge from the validated reference output."
fi
echo "[3/3] strict N-1 mode: $( [ "$SCAN_AST_STRICT_NMINUS1" = "1" ] && echo enabled || echo disabled )"
echo "[3/3] duplicate-item mode: $( [ "$SCAN_AST_ALLOW_DUPLICATE_ITEMS" = "1" ] && echo enabled || echo disabled )"
echo "[3/3] schedule shards: ${SCAN_AST_SCHEDULE_SHARDS}"
echo "[3/3] period tag override: $( [ -n "$SCAN_PERIOD_TAG" ] && echo enabled || echo disabled )"
if [ -n "$SCAN_AST_AST_CANDIDATE_SHIPS" ]; then
  echo "[3/3] AST candidate ships: ${SCAN_AST_AST_CANDIDATE_SHIPS}"
else
  echo "[3/3] AST candidate filter: disabled"
fi

SCAN_ARGS=(--period-tag "$tag" --max-combo-size "$SCAN_AST_MAX_COMBO_SIZE")
if [ -n "$SCAN_AST_SHIPS" ]; then
  echo "[3/3] target ships: ${SCAN_AST_SHIPS}"
  SCAN_ARGS+=(--ships "$SCAN_AST_SHIPS")
elif [ -n "$SCAN_AST_SHIP_RANGE" ]; then
  echo "[3/3] target ship range: ${SCAN_AST_SHIP_RANGE}"
  SCAN_ARGS+=(--ship-range "$SCAN_AST_SHIP_RANGE")
fi
if [ -n "$SCAN_AST_AST_CANDIDATE_SHIPS" ]; then
  SCAN_ARGS+=(--ast-candidate-ships "$SCAN_AST_AST_CANDIDATE_SHIPS")
fi
if [ -n "$SCAN_AST_V8_FLAGS" ]; then
  echo "[3/3] V8 flags: ${SCAN_AST_V8_FLAGS}"
fi
if [ "$SCAN_AST_PROFILE_V8" = "1" ]; then
  echo "[3/3] V8 profiler: enabled"
fi

if [ "$SCAN_AST_STRICT_NMINUS1" = "1" ]; then
  SCAN_ARGS+=(--strict-nminus1)
else
  SCAN_ARGS+=(--no-strict-nminus1)
fi
if [ "$SCAN_AST_ALLOW_DUPLICATE_ITEMS" = "1" ]; then
  SCAN_ARGS+=(--allow-duplicate-items)
else
  SCAN_ARGS+=(--no-allow-duplicate-items)
fi

SCAN_ENV=("SCAN_AST_MAX_OLD_SPACE_MB=$SCAN_AST_MAX_OLD_SPACE_MB")

if [ "$SCAN_AST_THREADS" -gt 1 ] 2>/dev/null; then
  EXTRA_PARALLEL_ARGS=()
  if [ -n "$SCAN_AST_V8_FLAGS" ]; then EXTRA_PARALLEL_ARGS+=(--v8-flags "$SCAN_AST_V8_FLAGS"); fi
  if [ "$SCAN_AST_PROFILE_V8" = "1" ]; then EXTRA_PARALLEL_ARGS+=(--profile-v8); fi
  env "${SCAN_ENV[@]}" "$SCAN_NODE_BIN" "$SCRIPT_DIR/core/scan-ast-parallel.js" --workers "$SCAN_AST_THREADS" --progress-interval-ms "$SCAN_AST_PROGRESS_INTERVAL_MS" --schedule-shards "$SCAN_AST_SCHEDULE_SHARDS" "${EXTRA_PARALLEL_ARGS[@]}" "${SCAN_ARGS[@]}"
else
  NODE_ARGS=()
  if [ -n "$SCAN_AST_V8_FLAGS" ]; then
    read -r -a NODE_ARGS <<< "$SCAN_AST_V8_FLAGS"
  fi
  if [ "$SCAN_AST_PROFILE_V8" = "1" ]; then NODE_ARGS+=(--prof); fi
  env "${SCAN_ENV[@]}" "$SCAN_NODE_BIN" "${NODE_ARGS[@]}" "$SCRIPT_DIR/core/scan-ast.js" "${SCAN_ARGS[@]}"
fi

echo "Finished $tag successfully!"
