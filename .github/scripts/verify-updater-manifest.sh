#!/usr/bin/env bash
set -euo pipefail

# Cleanup trap to ensure tmp files are removed even on early exit
cleanup() {
  local exit_code=$?
  rm -f /tmp/release.json /tmp/release-assets.json /tmp/release-assets.jsonl /tmp/release-assets-page.json /tmp/latest.json
  rm -f /tmp/updater-assets/*
  exit "${exit_code}"
}
trap cleanup EXIT

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN is required"
  exit 1
fi

if [[ -z "${RELEASE_ID:-}" ]]; then
  echo "Error: RELEASE_ID is required"
  exit 1
fi

if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "Error: GITHUB_REPOSITORY is required"
  exit 1
fi

RELEASE_API="https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}"
ASSETS_API="https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}/assets"

curl_json() {
  curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "$@"
}

curl_asset() {
  curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/octet-stream" \
    "$@"
}

refresh_release_assets() {
  : > /tmp/release-assets.jsonl
  local page=1
  while true; do
    curl_json "${ASSETS_API}?per_page=100&page=${page}" -o /tmp/release-assets-page.json

    local count
    count=$(jq 'length' /tmp/release-assets-page.json)
    if [[ "${count}" -eq 0 ]]; then
      break
    fi

    jq -c '.[]' /tmp/release-assets-page.json >> /tmp/release-assets.jsonl
    if [[ "${count}" -lt 100 ]]; then
      break
    fi
    page=$((page + 1))
  done

  if [[ -s /tmp/release-assets.jsonl ]]; then
    jq -s '.' /tmp/release-assets.jsonl > /tmp/release-assets.json
  else
    echo '[]' > /tmp/release-assets.json
  fi
}

find_asset_id_from_manifest_url() {
  local manifest_url="$1"
  local normalized_url="${manifest_url%%\?*}"
  local asset_id

  asset_id=$(jq -r --arg u "${manifest_url}" '
    .[] | select($u == .browser_download_url) | .id
  ' /tmp/release-assets.json | head -n1 || true)
  if [[ -n "${asset_id}" ]]; then
    echo "${asset_id}"
    return 0
  fi

  asset_id=$(jq -r --arg u "${normalized_url}" '
    .[] as $asset | select(
      ($u | endswith("/" + $asset.name)) or
      ($u | endswith("/" + ($asset.name | @uri)))
    ) | $asset.id
  ' /tmp/release-assets.json | head -n1 || true)

  if [[ -n "${asset_id}" ]]; then
    echo "${asset_id}"
    return 0
  fi
  return 1
}

validate_manifest_url_shape() {
  local url="$1"

  local repo_prefix="https://github.com/${GITHUB_REPOSITORY}/releases/"
  if [[ "${url}" != ${repo_prefix}* ]]; then
    return 1
  fi

  # Tauri updater manifests commonly use either:
  # - /releases/latest/download/<asset>
  # - /releases/download/<tag>/<asset>
  if [[ "${url}" == *"/releases/latest/download/"* ]]; then
    return 0
  fi
  if [[ "${url}" == *"/releases/download/"* ]]; then
    return 0
  fi

  return 1
}

LATEST_JSON_ASSET_ID=""
for attempt in $(seq 1 30); do
  curl_json "${RELEASE_API}" -o /tmp/release.json

  refresh_release_assets
  LATEST_JSON_ASSET_ID=$(jq -r '.[] | select(.name == "latest.json") | .id' /tmp/release-assets.json | head -n1 || true)
  if [[ -n "${LATEST_JSON_ASSET_ID}" ]]; then
    echo "Found latest.json asset (id=${LATEST_JSON_ASSET_ID}) on attempt ${attempt}"
    break
  fi

  echo "latest.json not found yet (attempt ${attempt}/30); waiting 10s..."
  sleep 10
done

if [[ -z "${LATEST_JSON_ASSET_ID}" ]]; then
  echo "Error: latest.json asset not found in release ${RELEASE_ID} after retries"
  exit 1
fi

curl_asset "https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/assets/${LATEST_JSON_ASSET_ID}" -o /tmp/latest.json

jq -e '.version and (.version | type == "string") and .version != ""' /tmp/latest.json >/dev/null
jq -e '.platforms and (.platforms | type == "object") and (.platforms | length > 0)' /tmp/latest.json >/dev/null
jq -e '.platforms | to_entries | all(.key != "" and .value.url and (.value.url | type == "string") and .value.signature and (.value.signature | type == "string"))' /tmp/latest.json >/dev/null

APP_VERSION=$(jq -r '.version' ./packages/FUSOU-APP/package.json)
MANIFEST_VERSION=$(jq -r '.version' /tmp/latest.json)
if [[ "${APP_VERSION}" != "${MANIFEST_VERSION}" ]]; then
  echo "Error: package version (${APP_VERSION}) and latest.json version (${MANIFEST_VERSION}) mismatch"
  exit 1
fi

ENCODED_PUBKEY=$(jq -r '.plugins.updater.pubkey' ./packages/FUSOU-APP/src-tauri/tauri.conf.json)
if [[ -z "${ENCODED_PUBKEY}" ]]; then
  echo "Error: updater pubkey not found in tauri.conf.json"
  exit 1
fi

# Decode base64 pubkey carefully: capture both stdout and stderr separately
# First try to decode; if it fails, capture the error
DECODE_TMP=$(mktemp)
if echo "${ENCODED_PUBKEY}" | base64 -d > "${DECODE_TMP}" 2>&1; then
  PUBKEY=$(tail -n1 "${DECODE_TMP}")
  rm "${DECODE_TMP}"
else
  echo "Error: failed to decode updater pubkey"
  cat "${DECODE_TMP}"
  rm "${DECODE_TMP}"
  exit 1
fi
if [[ -z "${PUBKEY}" ]]; then
  echo "Error: updater pubkey decoded to empty"
  exit 1
fi

mkdir -p /tmp/updater-assets
declare -A SEEN_ASSET_IDS  # asset_id → url of first platform that used it
declare -A SEEN_URLS       # url → platform name of first platform that used it

while IFS=$'\t' read -r platform url sig_b64; do
  echo "Validating platform: ${platform}"

  if ! validate_manifest_url_shape "${url}"; then
    echo "Error: manifest URL for ${platform} has unexpected shape"
    echo "  expected: https://github.com/${GITHUB_REPOSITORY}/releases/(latest/download|download/<tag>)/<asset>"
    echo "  actual: ${url}"
    exit 1
  fi

  # Tauri v2 can legitimately emit multiple platform keys (e.g. linux-x86_64 and
  # linux-x86_64-appimage) that reference the same asset URL. When the URL has
  # already been verified for a previous platform, skip re-downloading and
  # re-verifying; just confirm the signature matches and move on.
  if [[ -n "${SEEN_URLS[${url}]:-}" ]]; then
    echo "Platform ${platform} shares URL with ${SEEN_URLS[${url}]}; skipping re-download, verifying signature"
    first_platform="${SEEN_URLS[${url}]}"
    artifact_path="/tmp/updater-assets/${first_platform}--asset"
    sig_path="/tmp/updater-assets/${platform}--asset.minisig"
    if ! echo "${sig_b64}" | base64 -d > "${sig_path}"; then
      echo "Error: failed to decode signature for platform ${platform}"
      exit 1
    fi
    if ! minisign -Vm "${artifact_path}" -x "${sig_path}" -P "${PUBKEY}"; then
      echo "Error: minisign verification failed for platform ${platform}"
      exit 1
    fi
    continue
  fi

  asset_id=""
  for attempt in $(seq 1 20); do
    asset_id=$(find_asset_id_from_manifest_url "${url}" || true)
    if [[ -n "${asset_id}" ]]; then
      break
    fi

    echo "Asset for ${platform} not found yet (attempt ${attempt}/20); refreshing release assets..."
    curl_json "${RELEASE_API}" -o /tmp/release.json
    refresh_release_assets
    sleep 5
  done

  if [[ -z "${asset_id}" ]]; then
    echo "Error: release asset not found for platform ${platform} (manifest url: ${url})"
    exit 1
  fi

  # Two different URLs resolving to the same asset ID would indicate a real bug
  # in the manifest (e.g. a copy-paste error where distinct platforms got the
  # same filename by mistake).
  if [[ -n "${SEEN_ASSET_IDS[${asset_id}]:-}" ]]; then
    echo "Error: platforms ${platform} and ${SEEN_ASSET_IDS[${asset_id}]} have different URLs but resolved to the same release asset id: ${asset_id}"
    exit 1
  fi
  SEEN_ASSET_IDS["${asset_id}"]="${platform}"
  SEEN_URLS["${url}"]="${platform}"

  artifact_path="/tmp/updater-assets/${platform}--asset"
  sig_path="${artifact_path}.minisig"

  curl_asset "https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/assets/${asset_id}" -o "${artifact_path}"

  if ! echo "${sig_b64}" | base64 -d > "${sig_path}"; then
    echo "Error: failed to decode signature for platform ${platform}"
    exit 1
  fi

  if ! minisign -Vm "${artifact_path}" -x "${sig_path}" -P "${PUBKEY}"; then
    echo "Error: minisign verification failed for platform ${platform}"
    exit 1
  fi
done < <(jq -r '.platforms | to_entries[] | [.key, .value.url, .value.signature] | @tsv' /tmp/latest.json)

echo "Updater manifest verification completed successfully"
