#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import avro from "avsc";

const DEFAULT_BASE_DIR = "/home/ogu-h/Desktop/FUSOU-PROXY-DATA-LOCAL";
const DEFAULT_OUTPUT_SUBDIR = "R2";
const DEFAULT_SOURCE_ORDER = ["google_drive", "ubuntu", "windows"];
const PASS1_SOURCE_ORDER = ["google_drive", "ubuntu"];

const MANIFEST_FILE_NAME = "_rebuild_manifest.json";
const REPORT_FILE_NAME = "_rebuild_report.json";
const VERIFY_REPORT_FILE_NAME = "_verify_report.json";
const RECONSTRUCT_REPORT_FILE_NAME = "_reconstruct_report.json";
const DEFAULT_MAX_ENV_INFO_RECORDS = 100000;
const DEFAULT_MAX_ENV_INFO_BYTES = 50 * 1024 * 1024;

// Known legacy writer-schema fingerprints observed in local backups.
// These are accepted only for the listed table to keep matching strict.
const LEGACY_FINGERPRINT_COMPAT = {
  "7b07d48a47fb7e8a512e6ca3d72f8d59": {
    tableName: "opening_airattack",
    tableVersion: "0.4.0",
    note: "legacy opening_airattack writer schema",
  },
  "ebc226668dcca9907c83b5bf8f0e44d5": {
    tableName: "opening_airattack",
    tableVersion: "0.5.0",
    note: "legacy opening_airattack writer schema (windows backup variant)",
  },
  "78377c1b121de3f04deb81d65e51f171": {
    tableName: "carrierbase_assault",
    tableVersion: "0.4.0",
    note: "legacy carrierbase_assault writer schema",
  },
  "123b7181dab59cc20dfcc05bd1730f61": {
    tableName: "airbase_assult",
    tableVersion: "0.4.0",
    note: "legacy airbase_assult writer schema",
  },
  "dad26b94ecdd2638df7f4f46a7a7a07a": {
    tableName: "battle",
    tableVersion: "0.5.0",
    note: "legacy battle schema variant",
  },
  "4ce4f579a52ffb7630c3111d3862db4c": {
    tableName: "cells",
    tableVersion: "0.5.0",
    note: "legacy cells schema variant",
  },
  "6da127f0659fee826deffa9c9c405ce3": {
    tableName: "own_ship",
    tableVersion: "0.5.0",
    note: "legacy own_ship schema variant",
  },
};

function parseArgs(argv) {
  const out = {
    command: "build",
    baseDir: DEFAULT_BASE_DIR,
    outputDir: "",
    schemasDir: "",
    sources: "",
    pass: "",
    clean: false,
    verifyAfterBuild: true,
    failOnError: true,
    failOnAbnormal: true,
    maxEnvInfoRecords: DEFAULT_MAX_ENV_INFO_RECORDS,
    maxEnvInfoBytes: DEFAULT_MAX_ENV_INFO_BYTES,
    maxFiles: 0,
    reconstructOutDir: "",
    strictGroup: "entity",
  };

  const positional = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    if (arg === "--base") {
      out.baseDir = String(argv[i + 1] || "").trim() || out.baseDir;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outputDir = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--schemas") {
      out.schemasDir = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--sources") {
      out.sources = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--pass") {
      out.pass = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--max-files") {
      const n = Number(argv[i + 1]);
      out.maxFiles = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
      i += 1;
      continue;
    }
    if (arg === "--clean") {
      out.clean = true;
      continue;
    }
    if (arg === "--no-verify") {
      out.verifyAfterBuild = false;
      continue;
    }
    if (arg === "--allow-errors") {
      out.failOnError = false;
      continue;
    }
    if (arg === "--allow-abnormal") {
      out.failOnAbnormal = false;
      continue;
    }
    if (arg === "--max-env-info-records") {
      const n = Number(argv[i + 1]);
      out.maxEnvInfoRecords = Number.isFinite(n) && n > 0 ? Math.trunc(n) : out.maxEnvInfoRecords;
      i += 1;
      continue;
    }
    if (arg === "--max-env-info-bytes") {
      const n = Number(argv[i + 1]);
      out.maxEnvInfoBytes = Number.isFinite(n) && n > 0 ? Math.trunc(n) : out.maxEnvInfoBytes;
      i += 1;
      continue;
    }
    if (arg === "--reconstruct-out") {
      out.reconstructOutDir = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--strict-group") {
      const raw = String(argv[i + 1] || "").trim().toLowerCase();
      out.strictGroup = ["entity", "run", "none"].includes(raw) ? raw : out.strictGroup;
      i += 1;
      continue;
    }
  }

  if (positional.length > 0) {
    out.command = String(positional[0] || "build").trim().toLowerCase();
  }

  return out;
}

function normalizeVersion(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  if (v === "v0") return "0.0.0";
  if (v === "v1") return "0.1.0";
  if (v === "0.4") return "0.4.0";
  if (v === "0.5") return "0.5.0";
  const parts = v.split(".");
  if (parts.length === 2 && parts.every((x) => /^\d+$/.test(x))) {
    return `${parts[0]}.${parts[1]}.0`;
  }
  return v;
}

function chooseSourceOrder(args) {
  if (args.sources) {
    return [...new Set(args.sources.split(",").map((x) => x.trim()).filter(Boolean))];
  }
  if (args.pass === "1") {
    return PASS1_SOURCE_ORDER;
  }
  if (args.pass === "2") {
    return DEFAULT_SOURCE_ORDER;
  }
  return PASS1_SOURCE_ORDER;
}

function inferOutputDir(args) {
  if (args.outputDir) return path.resolve(args.outputDir);
  return path.resolve(args.baseDir, DEFAULT_OUTPUT_SUBDIR);
}

function inferSchemasDir(args) {
  if (args.schemasDir) return path.resolve(args.schemasDir);
  return path.resolve(process.cwd(), "../kc_api/generated-schemas");
}

function inferReconstructOutDir(args, outputDir) {
  if (args.reconstructOutDir) return path.resolve(args.reconstructOutDir);
  return `${outputDir}_reconstructed`;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function walkAvroFiles(rootDir, maxFiles = 0) {
  const out = [];
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".avro")) {
        out.push(next);
        if (maxFiles > 0 && out.length >= maxFiles) return;
      }
      if (maxFiles > 0 && out.length >= maxFiles) return;
    }
  }

  await walk(rootDir);
  return out;
}

function parseBackupFileInfo(absFilePath, sourceRoot, sourceName) {
  const rel = path.relative(sourceRoot, absFilePath).split(path.sep).join("/");
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const periodTag = String(parts[0] || "").trim();
  const bucketKind = String(parts[1] || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodTag)) {
    return null;
  }

  const fileName = path.basename(absFilePath);
  const fileNoExt = fileName.replace(/\.avro$/i, "");

  if (bucketKind === "transaction_data") {
    if (parts.length < 5) return null;
    const mapTag = String(parts[2] || "").trim();
    const rawTable = String(parts[3] || "").trim();
    const tsMatch = fileNoExt.match(/^(\d{9,})_/);
    const uuidMatch = fileNoExt.match(/_(?<uuid>[0-9a-fA-F-]{36})$/);

    return {
      sourceName,
      absFilePath,
      relPath: rel,
      periodTag,
      bucketKind,
      mapTag,
      rawTable,
      fileName,
      fileNoExt,
      runTs: tsMatch ? Number(tsMatch[1]) : 0,
      datasetUuid: uuidMatch?.groups?.uuid?.toLowerCase() || "",
    };
  }

  return null;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildSchemaRegistry(schemasDir) {
  const files = fs
    .readdirSync(schemasDir)
    .filter((name) => /^schema_v.+\.json$/i.test(name) || /^master_schema_v.+\.json$/i.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error(`No schema_v*.json found in ${schemasDir}`);
  }

  const schemaByFingerprint = new Map();
  const schemasByTable = new Map();
  const tableVersionBySchemaFile = new Map();
  const tableNames = new Set();

  for (const file of files) {
    const full = path.join(schemasDir, file);
    const parsed = loadJson(full);
    const tableVersion = normalizeVersion(parsed?.table_version || "");
    tableVersionBySchemaFile.set(file, tableVersion);

    for (const entry of parsed?.schemas || []) {
      const tableName = String(entry?.table_name || "").trim();
      if (!tableName) continue;
      tableNames.add(tableName);

      const schemaObj = JSON.parse(String(entry?.schema || "{}"));
      const type = avro.Type.forSchema(schemaObj);
      const fp = type.fingerprint("md5").toString("hex");

      if (!schemaByFingerprint.has(fp)) {
        schemaByFingerprint.set(fp, []);
      }
      const schemaRef = {
        tableName,
        tableVersion,
        schemaFile: file,
        schemaObj,
      };
      schemaByFingerprint.get(fp).push(schemaRef);

      if (!schemasByTable.has(tableName)) {
        schemasByTable.set(tableName, []);
      }
      schemasByTable.get(tableName).push(schemaRef);
    }
  }

  return {
    schemaByFingerprint,
    schemasByTable,
    tableVersionBySchemaFile,
    knownTableNames: tableNames,
  };
}

async function decodeWithReaderSchema(filePath, readerSchemaObj, needFirstRecord) {
  const stream = fs.createReadStream(filePath);
  const decoder = new avro.streams.BlockDecoder({ readerSchema: readerSchemaObj });

  return await new Promise((resolve, reject) => {
    let firstRecord = null;
    let recordCount = 0;

    decoder.on("data", (record) => {
      recordCount += 1;
      if (needFirstRecord && firstRecord === null) {
        firstRecord = record;
      }
    });

    decoder.on("error", (err) => reject(err));
    decoder.on("end", () => {
      resolve({ firstRecord, recordCount });
    });

    stream.on("error", (err) => reject(err));
    stream.pipe(decoder);
  });
}

async function decodeAvroMetaAndMaybeFirstRecord(filePath, needFirstRecord) {
  const stream = fs.createReadStream(filePath);
  const decoder = new avro.streams.BlockDecoder();

  return await new Promise((resolve, reject) => {
    let metadata = null;
    let firstRecord = null;
    let recordCount = 0;

    decoder.on("metadata", (type, codec) => {
      const schemaObj = type.schema({ exportAttrs: true });
      const fp = type.fingerprint("md5").toString("hex");
      metadata = {
        codec: String(codec || ""),
        schemaObj,
        fingerprint: fp,
      };
    });

    decoder.on("data", (record) => {
      recordCount += 1;
      if (needFirstRecord && firstRecord === null) {
        firstRecord = record;
      }
    });

    decoder.on("error", (err) => reject(err));
    decoder.on("end", () => {
      if (!metadata) {
        reject(new Error(`No Avro metadata found: ${filePath}`));
        return;
      }
      resolve({ metadata, firstRecord, recordCount });
    });

    stream.on("error", (err) => reject(err));
    stream.pipe(decoder);
  });
}

function chooseSchemaMatch(candidates, tableHint, versionHint) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const tableNorm = String(tableHint || "").trim().toLowerCase();
  const versionNorm = normalizeVersion(versionHint || "");

  let filtered = candidates;
  if (tableNorm) {
    const byTable = filtered.filter((x) => String(x.tableName || "").toLowerCase() === tableNorm);
    if (byTable.length > 0) filtered = byTable;
  }

  if (versionNorm) {
    const byVersion = filtered.filter((x) => normalizeVersion(x.tableVersion) === versionNorm);
    if (byVersion.length > 0) filtered = byVersion;
  }

  if (filtered.length === 1) return filtered[0];
  if (filtered.length > 1) {
    const distinctVersions = [...new Set(filtered.map((x) => normalizeVersion(x.tableVersion)))];
    if (distinctVersions.length === 1) return filtered[0];
  }

  return filtered[0] || null;
}

function resolveLegacyCompat({ fingerprint, tableHint, versionHint }) {
  const compat = LEGACY_FINGERPRINT_COMPAT[String(fingerprint || "").toLowerCase()];
  if (!compat) return null;

  const hint = String(tableHint || "").trim().toLowerCase();
  if (hint && hint !== String(compat.tableName || "").toLowerCase()) {
    return null;
  }

  return {
    tableName: compat.tableName,
    tableVersion: normalizeVersion(compat.tableVersion || versionHint || ""),
    note: compat.note,
  };
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function toR2Key({ tableVersion, periodTag, runTs, tableName, index }) {
  const idx = String(index).padStart(3, "0");
  return `${tableVersion}/${periodTag}/hourly/${runTs}/${tableName}-${idx}.avro`;
}

function nowEpochSec() {
  return Math.floor(Date.now() / 1000);
}

function toDatasetKey(periodTag, mapTag, datasetUuid) {
  if (!datasetUuid) return "";
  return `${periodTag}::${mapTag}::${datasetUuid.toLowerCase()}`;
}

async function loadOrInitManifest(outputDir) {
  const manifestPath = path.join(outputDir, MANIFEST_FILE_NAME);
  if (await fileExists(manifestPath)) {
    const parsed = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    parsed.version = Number(parsed.version || 1);
    parsed.byHash = parsed.byHash || {};
    parsed.stats = parsed.stats || {};
    return { manifestPath, manifest: parsed };
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    byHash: {},
    stats: {
      copied: 0,
      deduped: 0,
      failed: 0,
      scanned: 0,
    },
  };
  return { manifestPath, manifest };
}

async function saveManifest(manifestPath, manifest) {
  manifest.updatedAt = new Date().toISOString();
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

function chooseRunTsFromInfo(info, statMtimeMs) {
  const rawTs = Number.isFinite(Number(info.runTs)) && Number(info.runTs) > 0
    ? Math.trunc(Number(info.runTs))
    : Math.max(1, Math.trunc(statMtimeMs / 1000));
  // Hourly key must be stable per hour window, not per raw event timestamp.
  return rawTs - (rawTs % 3600);
}

async function buildR2LikeTree(opts) {
  const {
    baseDir,
    outputDir,
    schemasDir,
    sourceOrder,
    clean,
    maxFiles,
    failOnError,
    failOnAbnormal,
    maxEnvInfoRecords,
    maxEnvInfoBytes,
  } = opts;

  await ensureDir(outputDir);

  if (clean) {
    const entries = await fsp.readdir(outputDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(outputDir, entry.name);
      await fsp.rm(full, { recursive: true, force: true });
    }
    await ensureDir(outputDir);
  }

  const registry = buildSchemaRegistry(schemasDir);
  const { manifestPath, manifest } = await loadOrInitManifest(outputDir);

  const allCandidateFiles = [];
  let excludedMasterData = 0;
  for (const sourceName of sourceOrder) {
    const root = path.join(baseDir, sourceName);
    if (!(await fileExists(root))) {
      continue;
    }
    const files = await walkAvroFiles(root, maxFiles > 0 ? maxFiles : 0);
    for (const absFilePath of files) {
      const rel = path.relative(root, absFilePath).split(path.sep).join("/");
      if (rel.includes("/master_data/")) {
        excludedMasterData += 1;
        continue;
      }
      const info = parseBackupFileInfo(absFilePath, root, sourceName);
      if (info) allCandidateFiles.push(info);
      if (maxFiles > 0 && allCandidateFiles.length >= maxFiles) break;
    }
    if (maxFiles > 0 && allCandidateFiles.length >= maxFiles) break;
  }

  const datasetVersionMap = new Map();
  const periodVersionCounts = new Map();

  for (const info of allCandidateFiles) {
    if (info.bucketKind !== "transaction_data") continue;
    if (String(info.rawTable).toLowerCase() !== "env_info") continue;

    try {
      const { firstRecord } = await decodeAvroMetaAndMaybeFirstRecord(info.absFilePath, true);
      const ver = normalizeVersion(firstRecord?.version || "");
      if (!ver) continue;
      const dkey = toDatasetKey(info.periodTag, info.mapTag, info.datasetUuid);
      if (dkey) datasetVersionMap.set(dkey, ver);

      const pk = info.periodTag;
      if (!periodVersionCounts.has(pk)) periodVersionCounts.set(pk, new Map());
      const counter = periodVersionCounts.get(pk);
      counter.set(ver, Number(counter.get(ver) || 0) + 1);
    } catch {
      // ignore; handled during full pass
    }
  }

  function dominantPeriodVersion(periodTag) {
    const counter = periodVersionCounts.get(periodTag);
    if (!counter) return "";
    const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || "";
  }

  function schemaCandidatesByHint(tableHint, versionHint) {
    const t = String(tableHint || "").trim().toLowerCase();
    if (!t) return [];
    const base = (registry.schemasByTable.get(t) || []).slice();
    if (!versionHint) return base;
    const v = normalizeVersion(versionHint);
    const byVersion = base.filter((x) => normalizeVersion(x.tableVersion) === v);
    return byVersion.length > 0 ? byVersion : base;
  }

  const keyCounters = new Map();
  const report = {
    sourceOrder,
    excludedMasterData,
    scanned: 0,
    copied: 0,
    deduped: 0,
    failed: 0,
    skippedUnknownSchema: 0,
    skippedUnknownVersion: 0,
    skippedAbnormalEnvInfo: 0,
    errors: [],
    unresolved: [],
    abnormalSamples: [],
  };

  for (const info of allCandidateFiles) {
    report.scanned += 1;
    manifest.stats.scanned = Number(manifest.stats.scanned || 0) + 1;

    try {
      const stat = await fsp.stat(info.absFilePath);
      const bytes = await fsp.readFile(info.absFilePath);
      const hash = sha256Hex(bytes);

      if (manifest.byHash[hash]?.key) {
        report.deduped += 1;
        manifest.stats.deduped = Number(manifest.stats.deduped || 0) + 1;
        continue;
      }

      const needFirst = String(info.rawTable).toLowerCase() === "env_info";
      const decoded = await decodeAvroMetaAndMaybeFirstRecord(info.absFilePath, needFirst);
      if (!Number.isFinite(Number(decoded.recordCount)) || Number(decoded.recordCount) <= 0) {
        // Skip zero-record containers to avoid polluting rebuilt R2 with empty data files.
        continue;
      }

      if (needFirst) {
        const bytesSize = Number(stat.size || 0);
        const records = Number(decoded.recordCount || 0);
        if (records > Number(maxEnvInfoRecords || DEFAULT_MAX_ENV_INFO_RECORDS) || bytesSize > Number(maxEnvInfoBytes || DEFAULT_MAX_ENV_INFO_BYTES)) {
          report.skippedAbnormalEnvInfo += 1;
          const abnormal = {
            path: info.absFilePath,
            reason: "abnormal-env-info",
            recordCount: records,
            sizeBytes: bytesSize,
            maxEnvInfoRecords: Number(maxEnvInfoRecords || DEFAULT_MAX_ENV_INFO_RECORDS),
            maxEnvInfoBytes: Number(maxEnvInfoBytes || DEFAULT_MAX_ENV_INFO_BYTES),
            source: info.sourceName,
            relPath: info.relPath,
          };
          report.abnormalSamples.push(abnormal);
          if (failOnAbnormal) {
            throw new Error(`Abnormal env_info detected: ${JSON.stringify(abnormal)}`);
          }
          continue;
        }
      }

      const candidates = registry.schemaByFingerprint.get(decoded.metadata.fingerprint) || [];

      const tableHint = String(info.rawTable || "").trim().toLowerCase();

      const datasetVersion = info.bucketKind === "transaction_data"
        ? datasetVersionMap.get(toDatasetKey(info.periodTag, info.mapTag, info.datasetUuid)) || ""
        : "";

      const envVersion = needFirst ? normalizeVersion(decoded.firstRecord?.version || "") : "";
      const periodVersion = dominantPeriodVersion(info.periodTag);
      const versionHint = datasetVersion || envVersion || periodVersion;

      let chosen = chooseSchemaMatch(candidates, tableHint, versionHint);
      if (!chosen) {
        const fallbackCandidates = schemaCandidatesByHint(tableHint, versionHint);
        for (const ref of fallbackCandidates) {
          try {
            const fallbackDecoded = await decodeWithReaderSchema(info.absFilePath, ref.schemaObj, needFirst);
            if (Number(fallbackDecoded.recordCount || 0) > 0) {
              chosen = ref;
              break;
            }
          } catch {
            // keep trying other schema candidates
          }
        }
      }
      const legacyCompat = !chosen
        ? resolveLegacyCompat({
            fingerprint: decoded.metadata.fingerprint,
            tableHint,
            versionHint,
          })
        : null;

      if (!chosen && legacyCompat) {
        const compatCandidates = schemaCandidatesByHint(
          legacyCompat.tableName,
          legacyCompat.tableVersion,
        );
        const exactCompat = compatCandidates.find(
          (ref) =>
            String(ref.tableName || "").toLowerCase() === String(legacyCompat.tableName || "").toLowerCase() &&
            normalizeVersion(ref.tableVersion) === normalizeVersion(legacyCompat.tableVersion),
        );

        if (exactCompat) {
          // Keep legacy compatibility explicit and table-scoped.
          // Raw OCF is copied as-is; runtime decoders resolve against writer schema.
          chosen = {
            ...exactCompat,
            compatNote: legacyCompat.note,
          };
        }
      }

      if (!chosen) {
        report.skippedUnknownSchema += 1;
        report.unresolved.push({
          path: info.absFilePath,
          reason: "schema-not-matched",
          tableHint,
          versionHint,
          fingerprint: decoded.metadata.fingerprint,
          writerSchemaName: decoded.metadata?.schemaObj?.name || null,
          writerFieldCount: Array.isArray(decoded.metadata?.schemaObj?.fields)
            ? decoded.metadata.schemaObj.fields.length
            : null,
        });
        continue;
      }

      let tableVersion = normalizeVersion(chosen.tableVersion || versionHint || "");
      if (!tableVersion) {
        report.skippedUnknownVersion += 1;
        report.unresolved.push({
          path: info.absFilePath,
          reason: "version-not-resolved",
          tableName: chosen.tableName,
          tableHint,
          versionHint,
        });
        continue;
      }

      const runTs = chooseRunTsFromInfo(info, stat.mtimeMs);
      const baseCounterKey = `${tableVersion}|${info.periodTag}|${runTs}|${chosen.tableName}`;
      const nextIndex = Number(keyCounters.get(baseCounterKey) || 0) + 1;
      keyCounters.set(baseCounterKey, nextIndex);

      const key = toR2Key({
        tableVersion,
        periodTag: info.periodTag,
        runTs,
        tableName: chosen.tableName,
        index: nextIndex,
      });

      const outPath = path.join(outputDir, key);
      await ensureDir(path.dirname(outPath));
      await fsp.writeFile(outPath, bytes);

      manifest.byHash[hash] = {
        key,
        tableName: chosen.tableName,
        tableVersion,
        periodTag: info.periodTag,
        source: info.sourceName,
        sourceRelPath: info.relPath,
        copiedAt: new Date().toISOString(),
      };

      report.copied += 1;
      manifest.stats.copied = Number(manifest.stats.copied || 0) + 1;
    } catch (error) {
      report.failed += 1;
      manifest.stats.failed = Number(manifest.stats.failed || 0) + 1;
      report.errors.push({
        path: info.absFilePath,
        error: String(error?.message || error),
      });
      if (failOnError) {
        await saveManifest(manifestPath, manifest);
        throw error;
      }
    }
  }

  await saveManifest(manifestPath, manifest);
  await fsp.writeFile(path.join(outputDir, REPORT_FILE_NAME), JSON.stringify(report, null, 2));
  return report;
}

const UUID_VX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_GENERIC_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  return UUID_VX_RE.test(s) || UUID_GENERIC_RE.test(s);
}

function inferTargetTableFromField(fieldName) {
  const f = String(fieldName || "").trim().toLowerCase();
  if (!f) return "";
  if (f.endsWith("_uuids")) return f.slice(0, -6);
  if (f.endsWith("_uuid")) return f.slice(0, -5);
  return "";
}

function collectUuidRefsFromRecord(record) {
  const refs = [];

  function walk(value, pathPrefix) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        walk(value[i], `${pathPrefix}[${i}]`);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const [k, v] of Object.entries(value)) {
      const nextPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      const key = String(k || "");
      const keyLower = key.toLowerCase();

      if (keyLower === "uuid") {
        walk(v, nextPath);
        continue;
      }

      if (keyLower.endsWith("_uuid") && typeof v === "string" && isUuidLike(v)) {
        refs.push({
          fieldName: keyLower,
          fieldPath: nextPath,
          value: v.trim().toLowerCase(),
        });
      } else if (keyLower.endsWith("_uuids") && Array.isArray(v)) {
        for (let i = 0; i < v.length; i += 1) {
          const item = v[i];
          if (typeof item === "string" && isUuidLike(item)) {
            refs.push({
              fieldName: keyLower,
              fieldPath: `${nextPath}[${i}]`,
              value: item.trim().toLowerCase(),
            });
          }
        }
      } else if (keyLower.includes("uuid") && typeof v === "string" && isUuidLike(v)) {
        // Catch non-standard UUID key names to avoid missing hidden references.
        refs.push({
          fieldName: keyLower,
          fieldPath: nextPath,
          value: v.trim().toLowerCase(),
        });
      }

      walk(v, nextPath);
    }
  }

  walk(record, "");
  return refs;
}

function getOrCreateScope(scopeMap, key) {
  if (!scopeMap.has(key)) {
    scopeMap.set(key, {
      allUuids: new Set(),
      tableUuids: new Map(),
    });
  }
  return scopeMap.get(key);
}

function upsertTableUuid(scopeState, tableName, uuidValue) {
  const table = String(tableName || "").trim().toLowerCase();
  if (!table || !uuidValue) return;
  if (!scopeState.tableUuids.has(table)) scopeState.tableUuids.set(table, new Set());
  scopeState.tableUuids.get(table).add(uuidValue);
  scopeState.allUuids.add(uuidValue);
}

function findTablesContainingUuid(scopeState, uuidValue, maxTables = 5) {
  const out = [];
  for (const [tableName, set] of scopeState.tableUuids.entries()) {
    if (set.has(uuidValue)) {
      out.push(tableName);
      if (out.length >= maxTables) break;
    }
  }
  return out;
}

async function scanAvroRecords(filePath, onRecord) {
  const stream = fs.createReadStream(filePath);
  const decoder = new avro.streams.BlockDecoder();
  await new Promise((resolve, reject) => {
    let recordIndex = 0;
    decoder.on("data", (record) => {
      onRecord(record, recordIndex);
      recordIndex += 1;
    });
    decoder.on("error", reject);
    decoder.on("end", resolve);
    stream.on("error", reject);
    stream.pipe(decoder);
  });
}

async function analyzeUuidIntegrity({ outputDir, schemasDir, failOnError }) {
  const registry = buildSchemaRegistry(schemasDir);
  const errors = [];
  const warnings = [];
  let checked = 0;
  const parsedFiles = [];

  const files = await walkAvroFiles(outputDir, 0);
  for (const absPath of files) {
    const rel = path.relative(outputDir, absPath).split(path.sep).join("/");
    if (rel.startsWith("_")) continue;

    checked += 1;
    const m = rel.match(/^([^/]+)\/([^/]+)\/hourly\/(\d{9,})\/([^/]+)-(\d{3})\.avro$/);
    if (!m) {
      errors.push({ path: rel, reason: "invalid-key-layout" });
      continue;
    }

    const [, keyVersionRaw, periodTag, runTs, keyTable] = m;
    const keyVersion = normalizeVersion(keyVersionRaw);

    try {
      const decoded = await decodeAvroMetaAndMaybeFirstRecord(absPath, keyTable === "env_info");
      if (!Number.isFinite(Number(decoded.recordCount)) || Number(decoded.recordCount) <= 0) {
        errors.push({ path: rel, reason: "empty-or-invalid-avro" });
        continue;
      }

      const candidates = registry.schemaByFingerprint.get(decoded.metadata.fingerprint) || [];
      const chosen = chooseSchemaMatch(candidates, keyTable, keyVersion);
      const compat = !chosen
        ? resolveLegacyCompat({
            fingerprint: decoded.metadata.fingerprint,
            tableHint: keyTable,
            versionHint: keyVersion,
          })
        : null;
      const effectiveTable = compat ? compat.tableName : keyTable;
      const effectiveVersion = compat ? normalizeVersion(compat.tableVersion || keyVersion) : keyVersion;

      if (!chosen) {
        if (!compat) {
          errors.push({ path: rel, reason: "schema-fingerprint-unmatched", fingerprint: decoded.metadata.fingerprint });
          continue;
        }
      }

      const schemaTable = chosen ? String(chosen.tableName || "") : effectiveTable;
      const schemaVersion = chosen ? normalizeVersion(chosen.tableVersion || "") : effectiveVersion;

      if (schemaTable !== keyTable) {
        errors.push({
          path: rel,
          reason: "table-mismatch",
          keyTable,
          schemaTable,
        });
      }

      if (schemaVersion && keyVersion && schemaVersion !== keyVersion) {
        errors.push({
          path: rel,
          reason: "version-mismatch",
          keyVersion,
          schemaVersion,
        });
      }

      if (keyTable === "env_info" && decoded.firstRecord) {
        const recordVersion = normalizeVersion(decoded.firstRecord.version || "");
        if (recordVersion && recordVersion !== keyVersion) {
          warnings.push({
            path: rel,
            reason: "env-info-version-differs-from-key",
            keyVersion,
            recordVersion,
          });
        }
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodTag)) {
        errors.push({ path: rel, reason: "invalid-period-tag" });
      }

      if (!/^\d{9,}$/.test(runTs)) {
        errors.push({ path: rel, reason: "invalid-run-ts" });
      }

      parsedFiles.push({
        absPath,
        rel,
        version: keyVersion,
        periodTag,
        tableName: keyTable,
        schemaObj: decoded.metadata.schemaObj,
        codec: decoded.metadata.codec,
      });
    } catch (error) {
      errors.push({ path: rel, reason: "decode-failed", error: String(error?.message || error) });
      if (failOnError) break;
    }
  }

  const scopes = new Map();
  for (const f of parsedFiles) {
    const key = `${f.version}|${f.periodTag}`;
    const scopeState = getOrCreateScope(scopes, key);
    try {
      await scanAvroRecords(f.absPath, (record) => {
        const u = String(record?.uuid ?? "").trim().toLowerCase();
        if (!isUuidLike(u)) return;
        upsertTableUuid(scopeState, f.tableName, u);
      });
    } catch (error) {
      errors.push({
        path: f.rel,
        reason: "uuid-index-decode-failed",
        error: String(error?.message || error),
      });
    }
  }

  const badFiles = new Set();
  const unresolvedCountByFile = new Map();
  for (const f of parsedFiles) {
    const key = `${f.version}|${f.periodTag}`;
    const scopeState = scopes.get(key) || { allUuids: new Set(), tableUuids: new Map() };
    try {
      await scanAvroRecords(f.absPath, (record) => {
        const refs = collectUuidRefsFromRecord(record);
        for (const ref of refs) {
          const inferredTable = inferTargetTableFromField(ref.fieldName);
          const hasTypedTable = inferredTable && scopeState.tableUuids.has(inferredTable);

          if (hasTypedTable) {
            const targetSet = scopeState.tableUuids.get(inferredTable);
            if (!targetSet.has(ref.value)) {
              const foundInTables = findTablesContainingUuid(scopeState, ref.value);
              errors.push({
                path: f.rel,
                reason: "uuid-unresolved-target-table",
                field: ref.fieldPath,
                value: ref.value,
                expectedTable: inferredTable,
                foundInTables,
                periodTag: f.periodTag,
                tableVersion: f.version,
              });
              badFiles.add(f.rel);
              unresolvedCountByFile.set(f.rel, Number(unresolvedCountByFile.get(f.rel) || 0) + 1);
            }
            continue;
          }

          if (!scopeState.allUuids.has(ref.value)) {
            errors.push({
              path: f.rel,
              reason: "uuid-unresolved-global",
              field: ref.fieldPath,
              value: ref.value,
              inferredTable: inferredTable || null,
              periodTag: f.periodTag,
              tableVersion: f.version,
            });
            badFiles.add(f.rel);
            unresolvedCountByFile.set(f.rel, Number(unresolvedCountByFile.get(f.rel) || 0) + 1);
          }
        }
      });
    } catch (error) {
      errors.push({
        path: f.rel,
        reason: "uuid-ref-check-decode-failed",
        error: String(error?.message || error),
      });
    }
  }

  const report = {
    checked,
    files: parsedFiles,
    errors,
    warnings,
    badFiles: [...badFiles].sort(),
    unresolvedCountByFile: Object.fromEntries([...unresolvedCountByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    ok: errors.length === 0,
  };

  return report;
}

async function verifyR2LikeTree({ outputDir, schemasDir, failOnError }) {
  const report = await analyzeUuidIntegrity({ outputDir, schemasDir, failOnError });
  const trimmed = {
    checked: report.checked,
    errors: report.errors,
    warnings: report.warnings,
    badFiles: report.badFiles,
    unresolvedCountByFile: report.unresolvedCountByFile,
    ok: report.ok,
  };

  await fsp.writeFile(path.join(outputDir, VERIFY_REPORT_FILE_NAME), JSON.stringify(trimmed, null, 2));
  return trimmed;
}

function buildRecordRepairPlan(analysis) {
  const recordsById = new Map();
  const scopeRecordIds = new Map();
  const fileRecordIds = new Map();
  let nextRecordId = 1;

  for (const fileInfo of analysis.files || []) {
    const scopeKey = `${fileInfo.version}|${fileInfo.periodTag}`;
    if (!scopeRecordIds.has(scopeKey)) scopeRecordIds.set(scopeKey, []);
    if (!fileRecordIds.has(fileInfo.rel)) fileRecordIds.set(fileInfo.rel, []);
  }

  return {
    nextRecordId,
    recordsById,
    scopeRecordIds,
    fileRecordIds,
  };
}

function toRunGroupKeyFromRel(relPath) {
  const rel = String(relPath || "").trim();
  const m = rel.match(/^([^/]+)\/([^/]+)\/hourly\/(\d{9,})\//);
  if (!m) return "";
  return `${m[1]}|${m[2]}|${m[3]}`;
}

function extractEntityKeyFromRecord(record, tableName, runGroupKey) {
  const table = String(tableName || "").trim().toLowerCase();
  if (table === "env_info") {
    const u = String(record?.uuid ?? "").trim().toLowerCase();
    if (isUuidLike(u)) return u;
  }

  const envRef = String(record?.env_uuid ?? "").trim().toLowerCase();
  if (isUuidLike(envRef)) return envRef;

  const refs = collectUuidRefsFromRecord(record);
  const envCandidate = refs.find((x) => String(x.fieldName || "") === "env_uuid");
  if (envCandidate && isUuidLike(envCandidate.value)) {
    return envCandidate.value;
  }

  // Fallback: keep legacy bucket scope when entity key cannot be inferred.
  return `run:${runGroupKey}`;
}

function evaluateRecordRefs(recordMeta, scopeState) {
  for (const ref of recordMeta.refs) {
    const inferredTable = inferTargetTableFromField(ref.fieldName);
    const hasTypedTable = inferredTable && scopeState.tableUuids.has(inferredTable);

    if (hasTypedTable) {
      const targetSet = scopeState.tableUuids.get(inferredTable);
      if (!targetSet.has(ref.value)) {
        return {
          ok: false,
          reason: "uuid-unresolved-target-table",
          field: ref.fieldPath,
          value: ref.value,
          expectedTable: inferredTable,
          foundInTables: findTablesContainingUuid(scopeState, ref.value),
        };
      }
      continue;
    }

    if (!scopeState.allUuids.has(ref.value)) {
      return {
        ok: false,
        reason: "uuid-unresolved-global",
        field: ref.fieldPath,
        value: ref.value,
        inferredTable: inferredTable || null,
      };
    }
  }

  return { ok: true };
}

function buildScopeStateFromActive(recordIds, recordsById) {
  const state = {
    allUuids: new Set(),
    tableUuids: new Map(),
  };

  for (const recordId of recordIds) {
    const meta = recordsById.get(recordId);
    if (!meta) continue;
    if (!meta.ownUuid) continue;
    upsertTableUuid(state, meta.tableName, meta.ownUuid);
  }

  return state;
}

async function writeFilteredAvroFile({ sourcePath, outPath, schemaObj, codec, keepRecordIndexes }) {
  const type = avro.Type.forSchema(schemaObj);
  const input = fs.createReadStream(sourcePath);
  const decoder = new avro.streams.BlockDecoder();
  const encoder = new avro.streams.BlockEncoder(type, {
    codec: String(codec || "null"),
  });
  const output = fs.createWriteStream(outPath);

  let index = 0;

  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);

    input.on("error", onError);
    decoder.on("error", onError);
    encoder.on("error", onError);
    output.on("error", onError);

    output.on("finish", resolve);
    encoder.pipe(output);

    decoder.on("data", (record) => {
      if (keepRecordIndexes.has(index)) {
        encoder.write(record);
      }
      index += 1;
    });

    decoder.on("end", () => {
      encoder.end();
    });

    input.pipe(decoder);
  });
}

async function reconstructR2LikeTree({ outputDir, reconstructOutDir, schemasDir, failOnError, strictGroup }) {
  const analysis = await analyzeUuidIntegrity({ outputDir, schemasDir, failOnError });

  const plan = buildRecordRepairPlan(analysis);
  const { recordsById, scopeRecordIds, fileRecordIds } = plan;

  for (const fileInfo of analysis.files || []) {
    const scopeKey = `${fileInfo.version}|${fileInfo.periodTag}`;
    await scanAvroRecords(fileInfo.absPath, (record, recordIndex) => {
      const runGroupKey = toRunGroupKeyFromRel(fileInfo.rel);
      const ownUuid = String(record?.uuid ?? "").trim().toLowerCase();
      const refs = collectUuidRefsFromRecord(record);
      const entityKey = extractEntityKeyFromRecord(record, fileInfo.tableName, runGroupKey);

      const recordId = plan.nextRecordId;
      plan.nextRecordId += 1;

      recordsById.set(recordId, {
        recordId,
        scopeKey,
        rel: fileInfo.rel,
        tableName: fileInfo.tableName,
        filePath: fileInfo.absPath,
        recordIndex,
        runGroupKey,
        entityKey,
        ownUuid: isUuidLike(ownUuid) ? ownUuid : "",
        refs,
      });

      scopeRecordIds.get(scopeKey).push(recordId);
      fileRecordIds.get(fileInfo.rel).push(recordId);
    });
  }

  const activeRecordIds = new Set(recordsById.keys());
  const removedRecords = [];
  let iterations = 0;

  while (true) {
    iterations += 1;
    const removeSet = new Set();

    for (const [scopeKey, allScopeRecordIds] of scopeRecordIds.entries()) {
      const activeInScope = allScopeRecordIds.filter((rid) => activeRecordIds.has(rid));
      const scopeState = buildScopeStateFromActive(activeInScope, recordsById);

      for (const recordId of activeInScope) {
        const meta = recordsById.get(recordId);
        const result = evaluateRecordRefs(meta, scopeState);
        if (result.ok) continue;

        removeSet.add(recordId);
        removedRecords.push({
          rel: meta.rel,
          recordIndex: meta.recordIndex,
          scopeKey,
          tableName: meta.tableName,
          entityKey: meta.entityKey,
          ...result,
        });
      }
    }

    if (removeSet.size === 0) break;
    for (const rid of removeSet) activeRecordIds.delete(rid);
    if (iterations > 32) {
      throw new Error("record-level repair did not converge within 32 iterations");
    }
  }

  const invalidRunGroups = new Set();
  const invalidEntityKeys = new Set();
  if (strictGroup !== "none") {
    for (const r of removedRecords) {
      if (strictGroup === "run") {
        const gk = toRunGroupKeyFromRel(r.rel);
        if (gk) invalidRunGroups.add(gk);
      }
      if (strictGroup === "entity") {
        const ek = String(r.entityKey || "").trim();
        if (ek) invalidEntityKeys.add(ek);
      }
    }

    if (invalidRunGroups.size > 0 || invalidEntityKeys.size > 0) {
      for (const recordId of [...activeRecordIds]) {
        const meta = recordsById.get(recordId);
        if (!meta) continue;
        if (strictGroup === "run" && meta.runGroupKey && invalidRunGroups.has(meta.runGroupKey)) {
          activeRecordIds.delete(recordId);
          continue;
        }
        if (strictGroup === "entity" && meta.entityKey && invalidEntityKeys.has(meta.entityKey)) {
          activeRecordIds.delete(recordId);
        }
      }
    }
  }

  await fsp.rm(reconstructOutDir, { recursive: true, force: true });
  await ensureDir(reconstructOutDir);

  const keptRecordIndexesByFile = new Map();
  for (const [rel, ids] of fileRecordIds.entries()) {
    const keep = new Set();
    for (const rid of ids) {
      if (!activeRecordIds.has(rid)) continue;
      const meta = recordsById.get(rid);
      keep.add(meta.recordIndex);
    }
    keptRecordIndexesByFile.set(rel, keep);
  }

  let copiedFiles = 0;
  let droppedFiles = 0;
  let partiallyRewrittenFiles = 0;
  let droppedByInvalidRunGroupFiles = 0;
  let droppedByInvalidEntityFiles = 0;
  const runGroupFileCounts = new Map();

  for (const f of analysis.files || []) {
    const runGroupKey = toRunGroupKeyFromRel(f.rel);
    if (runGroupKey) {
      runGroupFileCounts.set(runGroupKey, Number(runGroupFileCounts.get(runGroupKey) || 0) + 1);
    }
    const fileRecordIdsList = fileRecordIds.get(f.rel) || [];
    const fileEntityKeys = new Set(
      fileRecordIdsList
        .map((rid) => recordsById.get(rid)?.entityKey)
        .filter(Boolean),
    );

    const entityInvalid = strictGroup === "entity" && [...fileEntityKeys].some((ek) => invalidEntityKeys.has(ek));

    if (runGroupKey && strictGroup === "run" && invalidRunGroups.has(runGroupKey)) {
      droppedFiles += 1;
      droppedByInvalidRunGroupFiles += 1;
      continue;
    }
    if (entityInvalid) {
      droppedFiles += 1;
      droppedByInvalidEntityFiles += 1;
      continue;
    }

    const keepIndexes = keptRecordIndexesByFile.get(f.rel) || new Set();
    if (keepIndexes.size === 0) {
      droppedFiles += 1;
      continue;
    }

    const outPath = path.join(reconstructOutDir, f.rel);
    await ensureDir(path.dirname(outPath));

    const originalCount = Number(fileRecordIds.get(f.rel)?.length || 0);
    if (keepIndexes.size < originalCount) {
      partiallyRewrittenFiles += 1;
    }

    await writeFilteredAvroFile({
      sourcePath: f.absPath,
      outPath,
      schemaObj: f.schemaObj,
      codec: f.codec,
      keepRecordIndexes: keepIndexes,
    });

    copiedFiles += 1;
  }

  const verify = await verifyR2LikeTree({
    outputDir: reconstructOutDir,
    schemasDir,
    failOnError: false,
  });

  const report = {
    sourceDir: outputDir,
    reconstructOutDir,
    strictGroup,
    scannedFiles: Number(analysis.files?.length || 0),
    scannedRecords: recordsById.size,
    copiedFiles,
    droppedFiles,
    droppedByInvalidRunGroupFiles,
    droppedByInvalidEntityFiles,
    invalidRunGroups: [...invalidRunGroups].sort(),
    invalidRunGroupCount: invalidRunGroups.size,
    invalidEntityKeyCount: invalidEntityKeys.size,
    invalidEntityKeySamples: [...invalidEntityKeys].slice(0, 100),
    invalidRunGroupFileCounts: Object.fromEntries(
      [...runGroupFileCounts.entries()]
        .filter(([k]) => invalidRunGroups.has(k))
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    partiallyRewrittenFiles,
    removedRecords: removedRecords.length,
    repairedRecords: Math.max(0, recordsById.size - activeRecordIds.size),
    repairIterations: iterations,
    removalSamples: removedRecords.slice(0, 100),
    verify,
  };

  await fsp.writeFile(path.join(reconstructOutDir, RECONSTRUCT_REPORT_FILE_NAME), JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseDir = path.resolve(args.baseDir);
  const outputDir = inferOutputDir(args);
  const schemasDir = inferSchemasDir(args);
  const reconstructOutDir = inferReconstructOutDir(args, outputDir);

  const sourceOrder = chooseSourceOrder(args);

  console.log(JSON.stringify({
    command: args.command,
    baseDir,
    outputDir,
    schemasDir,
    sourceOrder,
    pass: args.pass || null,
    clean: args.clean,
    maxFiles: args.maxFiles,
    verifyAfterBuild: args.verifyAfterBuild,
    failOnError: args.failOnError,
    failOnAbnormal: args.failOnAbnormal,
    maxEnvInfoRecords: args.maxEnvInfoRecords,
    maxEnvInfoBytes: args.maxEnvInfoBytes,
    reconstructOutDir,
    strictGroup: args.strictGroup,
  }, null, 2));

  if (args.command === "build") {
    const report = await buildR2LikeTree({
      baseDir,
      outputDir,
      schemasDir,
      sourceOrder,
      clean: args.clean,
      maxFiles: args.maxFiles,
      failOnError: args.failOnError,
      failOnAbnormal: args.failOnAbnormal,
      maxEnvInfoRecords: args.maxEnvInfoRecords,
      maxEnvInfoBytes: args.maxEnvInfoBytes,
    });

    console.log(JSON.stringify({ buildReport: report }, null, 2));

    if (args.verifyAfterBuild) {
      const verify = await verifyR2LikeTree({
        outputDir,
        schemasDir,
        failOnError: false,
      });
      console.log(JSON.stringify({ verifyReport: verify }, null, 2));
      if (!verify.ok && args.failOnError) {
        process.exit(2);
      }
    }

    return;
  }

  if (args.command === "verify") {
    const verify = await verifyR2LikeTree({
      outputDir,
      schemasDir,
      failOnError: args.failOnError,
    });
    console.log(JSON.stringify({ verifyReport: verify }, null, 2));
    if (!verify.ok && args.failOnError) {
      process.exit(2);
    }
    return;
  }

  if (args.command === "reconstruct") {
    const report = await reconstructR2LikeTree({
      outputDir,
      reconstructOutDir,
      schemasDir,
      failOnError: args.failOnError,
      strictGroup: args.strictGroup,
    });
    console.log(JSON.stringify({ reconstructReport: report }, null, 2));
    if (!report?.verify?.ok && args.failOnError) {
      process.exit(2);
    }
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(String(error?.stack || error?.message || error));
  process.exit(1);
});
