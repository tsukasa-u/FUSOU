#!/usr/bin/env node

import { spawnSync } from "child_process";
import { brotliDecompressSync } from "zlib";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SRC_MAP_ROOT = join(PROJECT_ROOT, "src", "assets", "map");
const PUBLIC_MAP_ROOT = join(PROJECT_ROOT, "public", "battle-maps");
const TMP_ROOT = join(PROJECT_ROOT, ".sync-battle-maps-tmp");

const MAP_KEY_RE = /^\d+-\d+$/;
const IMAGE_JSON_RE = /^\d+_(?:image|imgae)\.json$/i;
const IMAGE_PNG_RE = /^\d+_(?:image|imgae)\.png$/i;
const INFO_JSON_RE = /^\d+_info\.json$/i;
const LABELS_JSON_RE = /^cell_labels\.json$/i;

const DEFAULT_PREFIX_CANDIDATES = [
  // "battle-maps/",
  // "assets/battle-maps/",
  // "assets/map/",
  // "maps/",
  // "map/",
  "assets/kcs2/resources/map/",
  // "kcs2/resources/map/",
];

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function parseArgs(argv) {
  const parsed = {
    prefix: null,
    version: null,
    tag: null,
    dryRun: false,
    keepTemp: false,
    downloadOnly: false,
    previewOnly: false,
    buildOnly: false,
    maps: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--keep-temp") {
      parsed.keepTemp = true;
      continue;
    }
    if (arg === "--download-only") {
      parsed.downloadOnly = true;
      continue;
    }
    if (arg === "--preview-only") {
      parsed.previewOnly = true;
      continue;
    }
    if (arg === "--build-only") {
      parsed.buildOnly = true;
      continue;
    }
    if (arg === "--prefix") {
      parsed.prefix = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--version") {
      parsed.version = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--tag") {
      parsed.tag = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--map") {
      const map = argv[i + 1] || "";
      if (MAP_KEY_RE.test(map)) parsed.maps.push(map);
      i += 1;
      continue;
    }
  }

  return parsed;
}

function parseWranglerBucketName(bindingName) {
  const wranglerPath = join(PROJECT_ROOT, "wrangler.toml");
  const content = readFileSync(wranglerPath, "utf8");
  const pattern = new RegExp(
    String.raw`\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"${bindingName}"[\s\S]*?bucket_name\s*=\s*"([^"]+)"`,
    "m",
  );
  const matched = content.match(pattern);
  if (!matched) {
    throw new Error(
      `Could not resolve bucket_name for binding ${bindingName} in wrangler.toml`,
    );
  }
  return matched[1];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed\n${stderr || stdout}`.trim(),
    );
  }
  return result.stdout;
}

function runWrangler(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return run(process.execPath, [npmExecPath, "exec", "wrangler", ...args]);
  }

  const fallback = process.platform === "win32" ? "npx.cmd" : "npx";
  return run(fallback, ["wrangler", ...args]);
}

function readWranglerOauthToken() {
  const candidates = [];
  const home = os.homedir();

  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(
      join(process.env.APPDATA, ".wrangler", "config", "default.toml"),
    );
    candidates.push(
      join(
        process.env.APPDATA,
        "xdg.config",
        ".wrangler",
        "config",
        "default.toml",
      ),
    );
  }

  const xdgHome = process.env.XDG_CONFIG_HOME || join(home, ".config");
  candidates.push(join(xdgHome, ".wrangler", "config", "default.toml"));
  candidates.push(join(home, ".wrangler", "config", "default.toml"));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const raw = readFileSync(candidate, "utf8");
    const matched = raw.match(/oauth_token\s*=\s*"([^"]+)"/);
    if (matched) return matched[1];
  }

  return null;
}

function readWranglerAccountId() {
  try {
    const raw = runWrangler(["whoami", "--json"]);
    const payload = JSON.parse(raw);
    const account = payload?.accounts?.[0];
    if (account?.id && typeof account.id === "string") {
      return account.id;
    }
  } catch {
    // Ignore and fall through to null. Caller will throw a clear error.
  }

  return null;
}

function getCloudflareAuth() {
  const accountId =
    process.env.CF_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    readWranglerAccountId();
  if (!accountId) {
    throw new Error("CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID is required");
  }

  const token =
    process.env.CF_API_TOKEN ||
    process.env.CLOUDFLARE_API_TOKEN ||
    readWranglerOauthToken();
  if (!token) {
    throw new Error(
      "Cloudflare API token not found. Set CF_API_TOKEN/CLOUDFLARE_API_TOKEN or run npx wrangler login",
    );
  }

  return { accountId, token };
}

async function listR2Keys(bucket, prefix) {
  const { accountId, token } = getCloudflareAuth();
  const keys = [];
  let cursor = null;

  while (true) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`,
    );
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max_keys", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `R2 list API failed: ${response.status} ${await response.text()}`,
      );
    }

    const payload = await response.json();
    const pageKeys = (payload.result || [])
      .map((obj) => obj.key)
      .filter((k) => typeof k === "string");
    keys.push(...pageKeys);

    cursor = payload.result_info?.cursor || null;
    if (!cursor) break;
  }

  return keys;
}

function toNormalizedPrefix(prefix) {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function extractMapFileInfo(prefix, key) {
  if (!key.startsWith(prefix)) return null;
  const rel = key.slice(prefix.length);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  let mapKey = null;
  let mapIndex = -1;
  let worldIndex = -1;
  const fileName = parts.at(-1);

  // Pattern A: keys that already include map key path segments such as "5-3/..."
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (MAP_KEY_RE.test(parts[i])) {
      mapKey = parts[i];
      mapIndex = i;
      break;
    }
  }

  // Pattern B: kcs2 map keys such as "005/03_image.json" -> "5-3"
  if (!mapKey) {
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!/^\d{3}$/.test(parts[i])) continue;
      const matched = fileName.match(/^(\d+)_/);
      if (!matched) continue;

      const worldNo = Number.parseInt(parts[i], 10);
      const mapNo = Number.parseInt(matched[1], 10);
      if (!Number.isFinite(worldNo) || !Number.isFinite(mapNo)) continue;

      mapKey = `${worldNo}-${mapNo}`;
      worldIndex = i;
      break;
    }
  }

  if (!mapKey) return null;

  if (
    !IMAGE_JSON_RE.test(fileName) &&
    !IMAGE_PNG_RE.test(fileName) &&
    !INFO_JSON_RE.test(fileName) &&
    !LABELS_JSON_RE.test(fileName)
  ) {
    return null;
  }

  let version = "";
  let tag = "";
  const indexForGrouping = mapIndex >= 0 ? mapIndex : worldIndex;
  if (indexForGrouping === 1) {
    tag = parts[0];
  } else if (indexForGrouping >= 2) {
    version = parts[indexForGrouping - 2];
    tag = parts[indexForGrouping - 1];
  }

  return {
    key,
    mapKey,
    fileName,
    version,
    tag,
  };
}

function compareLatest(a, b) {
  const v = collator.compare(a.version, b.version);
  if (v !== 0) return v;
  return collator.compare(a.tag, b.tag);
}

function chooseLatestTarget(items, args) {
  const groups = new Map();
  for (const item of items) {
    if (args.version && item.version !== args.version) continue;
    if (args.tag && item.tag !== args.tag) continue;
    const id = `${item.version}::${item.tag}`;
    if (!groups.has(id)) {
      groups.set(id, {
        version: item.version,
        tag: item.tag,
        count: 0,
      });
    }
    groups.get(id).count += 1;
  }

  if (groups.size === 0) return null;

  const sorted = [...groups.values()].sort((a, b) => {
    const latest = compareLatest(a, b);
    if (latest !== 0) return latest;
    return a.count - b.count;
  });

  return sorted.at(-1);
}

function classifyMapFiles(items) {
  const byMap = new Map();
  for (const item of items) {
    const current = byMap.get(item.mapKey) || {
      imageJson: null,
      imagePng: null,
      infoJson: null,
      labelsJson: null,
    };

    if (IMAGE_JSON_RE.test(item.fileName)) current.imageJson = item;
    if (IMAGE_PNG_RE.test(item.fileName)) current.imagePng = item;
    if (INFO_JSON_RE.test(item.fileName)) current.infoJson = item;
    if (LABELS_JSON_RE.test(item.fileName)) current.labelsJson = item;

    byMap.set(item.mapKey, current);
  }
  return byMap;
}

function expectedSuffix(mapKey) {
  const mapInfoNo = Number(mapKey.split("-")[1] || NaN);
  if (!Number.isFinite(mapInfoNo)) return "01";
  return String(mapInfoNo).padStart(2, "0");
}

function alphaCellLabel(cellId) {
  if (!Number.isFinite(cellId) || cellId < 1) return "";
  let value = Math.floor(cellId);
  let label = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function parseJsonFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isNonEmptyLabelsPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return Object.entries(payload).some(([rawId, label]) => {
    const id = Number(rawId);
    return Number.isFinite(id) && typeof label === "string" && label.length > 0;
  });
}

function buildLabelsFromInfoJson(infoJsonPath) {
  const info = parseJsonFile(infoJsonPath);
  if (!info || typeof info !== "object") return {};

  const spots = Array.isArray(info.spots) ? info.spots : [];
  const labels = {};

  for (const spot of spots) {
    const cellId = Number(spot?.no ?? NaN);
    if (!Number.isFinite(cellId) || cellId < 0) continue;
    if (cellId === 0) {
      labels[cellId] = "港";
      continue;
    }
    labels[cellId] = alphaCellLabel(cellId);
  }

  return labels;
}

function ensureCellLabelsJson(labelsJsonPath, infoJsonPath) {
  const existing = parseJsonFile(labelsJsonPath);
  if (isNonEmptyLabelsPayload(existing)) return;

  const generated = buildLabelsFromInfoJson(infoJsonPath);
  if (!isNonEmptyLabelsPayload(generated)) {
    throw new Error(
      `Could not build non-empty cell labels from ${infoJsonPath}`,
    );
  }

  writeFileSync(labelsJsonPath, JSON.stringify(generated, null, 2), "utf8");
}

function hasCompletePublicAssets(mapKey) {
  const suffix = expectedSuffix(mapKey);
  const mapDir = join(PUBLIC_MAP_ROOT, mapKey);
  const imageJson = join(mapDir, `${suffix}_image.json`);
  const infoJson = join(mapDir, `${suffix}_info.json`);
  const labelsJson = join(mapDir, "cell_labels.json");
  const lightPng = join(mapDir, `${mapKey}_light.png`);
  const darkPng = join(mapDir, `${mapKey}_dark.png`);

  if (
    !existsSync(imageJson) ||
    !existsSync(infoJson) ||
    !existsSync(labelsJson) ||
    !existsSync(lightPng) ||
    !existsSync(darkPng)
  ) {
    return false;
  }

  const labelsPayload = parseJsonFile(labelsJson);
  return isNonEmptyLabelsPayload(labelsPayload);
}

function clearMapDirectoryIfExists(rootDir, mapKey) {
  const targetDir = join(rootDir, mapKey);
  if (!existsSync(targetDir)) return;
  rmSync(targetDir, { recursive: true, force: true });
}

function cleanDirectoryForSync(rootDir) {
  if (!existsSync(rootDir)) return;
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!MAP_KEY_RE.test(entry.name)) continue;
    rmSync(join(rootDir, entry.name), { recursive: true, force: true });
  }
}

function downloadRemoteObject(bucket, key, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  runWrangler([
    "r2",
    "object",
    "get",
    `${bucket}/${key}`,
    "--file",
    destination,
    "--remote",
  ]);
}

function copyIfExists(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function resolvePythonCommand() {
  const candidates = [
    ["python", ["--version"]],
    ["python3", ["--version"]],
    ["py", ["-3", "--version"]],
  ];

  for (const [cmd, args] of candidates) {
    const result = spawnSync(cmd, args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return { cmd, argsPrefix: args[0] === "-3" ? ["-3"] : [] };
    }
  }

  return null;
}

function isLikelyTextJson(buffer) {
  const sample = buffer
    .subarray(0, Math.min(buffer.length, 256))
    .toString("utf8");
  const normalized = sample.replace(/^\uFEFF/, "").trimStart();
  return normalized.startsWith("{") || normalized.startsWith("[");
}

function decodeSpriteJsonFile(filePath) {
  const py = resolvePythonCommand();
  if (!py) {
    throw new Error("Python interpreter was not found (python/python3/py -3)");
  }

  const decoderPath = join(PROJECT_ROOT, "scripts", "_decode_sprite.py");
  const args = [...py.argsPrefix, decoderPath, filePath];
  const result = spawnSync(py.cmd, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(`Failed to decode sprite JSON: ${stderr || stdout}`.trim());
  }

  const lines = (result.stdout || "").split(/\r?\n/);
  const jsonStart = lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  });

  if (jsonStart < 0) {
    throw new Error("Decoder output did not contain JSON body");
  }

  const jsonText = lines.slice(jsonStart).join("\n");
  writeFileSync(filePath, jsonText, "utf8");
}

function tryDecodeBrotliJson(rawBuffer) {
  try {
    const decompressed = brotliDecompressSync(rawBuffer);
    if (!isLikelyTextJson(decompressed)) return null;
    return decompressed.toString("utf8");
  } catch {
    return null;
  }
}

function ensureReadableJson(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath);
  if (isLikelyTextJson(raw)) return;

  const brotliJson = tryDecodeBrotliJson(raw);
  if (brotliJson) {
    writeFileSync(filePath, brotliJson, "utf8");
    return;
  }

  decodeSpriteJsonFile(filePath);
}

function runConvertPy(mapKeys) {
  return runConvertPyWithArgs(mapKeys, []);
}

function runConvertPreviewPy(mapKeys) {
  return runConvertPyWithArgs(mapKeys, ["--preview"]);
}

function runConvertPyWithArgs(mapKeys, extraArgs = []) {
  const py = resolvePythonCommand();
  if (!py) {
    throw new Error("Python interpreter was not found (python/python3/py -3)");
  }

  const convertPath = join(SRC_MAP_ROOT, "convert.py");
  const args = [...py.argsPrefix, convertPath, ...extraArgs, ...mapKeys];
  const result = spawnSync(py.cmd, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("convert.py execution failed");
  }
}

function listLocalMapKeys() {
  if (!existsSync(SRC_MAP_ROOT)) return [];
  const entries = readdirSync(SRC_MAP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MAP_KEY_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => collator.compare(a, b));

  return entries.filter((mapKey) => {
    const mapDir = join(SRC_MAP_ROOT, mapKey);
    const files = readdirSync(mapDir);
    const hasImageJson = files.some((name) => IMAGE_JSON_RE.test(name));
    const hasImagePng = files.some((name) => IMAGE_PNG_RE.test(name));
    return hasImageJson && hasImagePng;
  });
}

function syncGeneratedSpritesToPublic(mapKeys) {
  for (const mapKey of mapKeys) {
    const outputLight = join(SRC_MAP_ROOT, "output", `${mapKey}_light.png`);
    const outputDark = join(SRC_MAP_ROOT, "output", `${mapKey}_dark.png`);
    const publicDir = join(PUBLIC_MAP_ROOT, mapKey);

    copyIfExists(outputLight, join(publicDir, `${mapKey}_light.png`));
    copyIfExists(outputDark, join(publicDir, `${mapKey}_dark.png`));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.previewOnly || args.buildOnly) {
    const allLocalMaps = listLocalMapKeys();
    const targetMaps = allLocalMaps.filter((k) =>
      args.maps.length > 0 ? args.maps.includes(k) : true,
    );

    if (targetMaps.length === 0) {
      throw new Error("No local map assets found for preview/build mode.");
    }

    console.log(
      `${args.previewOnly ? "Preview" : "Build"} mode maps: ${targetMaps.join(", ")}`,
    );

    if (args.dryRun) {
      console.log("Dry run completed. No files were changed.");
      return;
    }

    if (args.previewOnly) {
      runConvertPreviewPy(targetMaps);
      console.log("Done. Candidate preview images were generated.");
      return;
    }

    runConvertPy(targetMaps);
    syncGeneratedSpritesToPublic(targetMaps);
    console.log(
      "Done. Final battle map images were generated and copied to public.",
    );
    return;
  }

  const bucket = parseWranglerBucketName("ASSETS_BUCKET");
  const prefixes = args.prefix
    ? [toNormalizedPrefix(args.prefix)]
    : DEFAULT_PREFIX_CANDIDATES;

  console.log("=== Battle Map Sync ===");
  console.log(`Bucket: ${bucket}`);

  let selectedPrefix = null;
  let selectedItems = [];

  for (const prefix of prefixes) {
    process.stdout.write(`Scanning prefix: ${prefix} ... `);
    let keys;
    try {
      keys = await listR2Keys(bucket, prefix);
    } catch (error) {
      console.log("ERROR");
      if (args.prefix) throw error;
      continue;
    }

    const mapped = keys
      .map((key) => extractMapFileInfo(prefix, key))
      .filter((item) => item !== null);
    if (mapped.length === 0) {
      console.log("no map files");
      continue;
    }

    console.log(`found ${mapped.length} candidate files`);
    selectedPrefix = prefix;
    selectedItems = mapped;
    break;
  }

  if (!selectedPrefix || selectedItems.length === 0) {
    throw new Error(
      "Could not find map files in R2. Use --prefix to specify the map prefix.",
    );
  }

  const latest = chooseLatestTarget(selectedItems, args);
  if (!latest) {
    throw new Error("No matching version/tag found for the given filters.");
  }

  const scopedItems = selectedItems.filter(
    (item) => item.version === latest.version && item.tag === latest.tag,
  );
  const filesByMap = classifyMapFiles(scopedItems);

  const targetMapKeys = [...filesByMap.keys()]
    .filter((k) => (args.maps.length > 0 ? args.maps.includes(k) : true))
    .sort((a, b) => collator.compare(a, b));

  if (targetMapKeys.length === 0) {
    throw new Error("No target maps found after applying filters.");
  }

  console.log(`Prefix: ${selectedPrefix}`);
  console.log(`Version: ${latest.version || "(none)"}`);
  console.log(`Tag: ${latest.tag || "(none)"}`);
  console.log(`Maps: ${targetMapKeys.join(", ")}`);

  const skippedMapKeys = [];
  const mapKeysToProcess = [];
  for (const mapKey of targetMapKeys) {
    if (hasCompletePublicAssets(mapKey)) {
      skippedMapKeys.push(mapKey);
      continue;
    }
    mapKeysToProcess.push(mapKey);
  }

  if (skippedMapKeys.length > 0) {
    console.log(
      `Skipping existing maps (${skippedMapKeys.length}): ${skippedMapKeys.join(", ")}`,
    );
  }

  if (mapKeysToProcess.length === 0) {
    console.log(
      "All target maps already exist with complete assets. Nothing to do.",
    );
    return;
  }

  if (args.dryRun) {
    console.log(`Maps to process: ${mapKeysToProcess.join(", ")}`);
    console.log("Dry run completed. No files were changed.");
    return;
  }

  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });

  const downloadManifest = [];

  for (const mapKey of mapKeysToProcess) {
    const bundle = filesByMap.get(mapKey);
    if (!bundle?.imageJson || !bundle?.imagePng || !bundle?.infoJson) {
      console.log(`Skipping ${mapKey}: required files are missing`);
      continue;
    }

    const suffix = expectedSuffix(mapKey);
    const mapTmpDir = join(TMP_ROOT, mapKey);
    mkdirSync(mapTmpDir, { recursive: true });

    const imageJsonTmp = join(mapTmpDir, "image.json");
    const imagePngTmp = join(mapTmpDir, "image.png");
    const infoJsonTmp = join(mapTmpDir, "info.json");
    const labelsJsonTmp = join(mapTmpDir, "cell_labels.json");

    downloadRemoteObject(bucket, bundle.imageJson.key, imageJsonTmp);
    downloadRemoteObject(bucket, bundle.imagePng.key, imagePngTmp);
    downloadRemoteObject(bucket, bundle.infoJson.key, infoJsonTmp);
    if (bundle.labelsJson) {
      downloadRemoteObject(bucket, bundle.labelsJson.key, labelsJsonTmp);
    }

    ensureReadableJson(imageJsonTmp);
    ensureReadableJson(infoJsonTmp);
    ensureReadableJson(labelsJsonTmp);

    const srcDir = join(SRC_MAP_ROOT, mapKey);
    const publicDir = join(PUBLIC_MAP_ROOT, mapKey);

    clearMapDirectoryIfExists(SRC_MAP_ROOT, mapKey);
    clearMapDirectoryIfExists(PUBLIC_MAP_ROOT, mapKey);

    const srcImageJson = join(srcDir, `${suffix}_image.json`);
    const srcImagePng = join(srcDir, `${suffix}_image.png`);
    const srcInfoJson = join(srcDir, `${suffix}_info.json`);

    const publicImageJson = join(publicDir, `${suffix}_image.json`);
    const publicInfoJson = join(publicDir, `${suffix}_info.json`);
    const publicLabelsJson = join(publicDir, "cell_labels.json");

    copyIfExists(imageJsonTmp, srcImageJson);
    copyIfExists(imagePngTmp, srcImagePng);
    copyIfExists(infoJsonTmp, srcInfoJson);

    copyIfExists(imageJsonTmp, publicImageJson);
    copyIfExists(infoJsonTmp, publicInfoJson);
    copyIfExists(labelsJsonTmp, publicLabelsJson);
    ensureCellLabelsJson(publicLabelsJson, publicInfoJson);

    downloadManifest.push({
      mapKey,
      files: {
        imageJson: bundle.imageJson.key,
        imagePng: bundle.imagePng.key,
        infoJson: bundle.infoJson.key,
        labelsJson: bundle.labelsJson?.key || null,
      },
    });
  }

  const mapKeysForConvert = downloadManifest.map((entry) => entry.mapKey);
  if (mapKeysForConvert.length === 0) {
    throw new Error("No maps were downloaded. Nothing to convert.");
  }

  console.log("Running convert.py...");
  if (!args.downloadOnly) {
    runConvertPy(mapKeysForConvert);
    syncGeneratedSpritesToPublic(mapKeysForConvert);
  }

  const manifestPath = join(PUBLIC_MAP_ROOT, "_last_sync_manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        prefix: selectedPrefix,
        version: latest.version,
        tag: latest.tag,
        maps: downloadManifest,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (!args.keepTemp) {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  }

  if (args.downloadOnly) {
    console.log("Done. Battle map JSON/image source files were downloaded.");
  } else {
    console.log("Done. Battle map JSON and generated images were updated.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
