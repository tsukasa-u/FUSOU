#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_PACKAGE_DIR = resolve(SCRIPT_DIR, "../../FUSOU-WEB");

function parseArgs(argv) {
  const out = { remote: false, db: "", bucket: "", apply: false, limit: 0, phase: "d1-reindex" };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--remote") out.remote = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--phase") {
      out.phase = String(argv[i + 1] || "").trim();
      i += 1;
    }
    else if (a === "--db") {
      out.db = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (a === "--bucket") {
      out.bucket = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (a === "--limit") {
      const n = Number(argv[i + 1]);
      out.limit = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
      i += 1;
    }
  }
  return out;
}

function runNpx(args, cwd = process.cwd()) {
  return execFileSync("npx", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function d1Query(db, remote, sql) {
  const args = ["wrangler", "d1", "execute", db];
  if (remote) args.push("--remote");
  args.push("--command", sql, "--json");
  const out = runNpx(args, WEB_PACKAGE_DIR);
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results || [];
}

function queryReindexCounts(db, remote) {
  const rows = d1Query(
    db,
    remote,
    `SELECT
       (SELECT COUNT(*) FROM archived_files) AS archived_files_count,
       (SELECT COUNT(*) FROM block_indexes) AS block_indexes_count,
       (SELECT COUNT(*) FROM archived_files af LEFT JOIN block_indexes bi ON bi.file_id = af.id WHERE bi.file_id IS NULL) AS missing_index_rows;`,
  );
  const row = rows?.[0] || {};
  return {
    archivedFilesCount: Number(row.archived_files_count || 0),
    blockIndexesCount: Number(row.block_indexes_count || 0),
    missingIndexRows: Number(row.missing_index_rows || 0),
  };
}

function sqlQuote(v) {
  return String(v ?? "").replace(/'/g, "''");
}

function normalizeVersion(v) {
  const x = String(v || "").trim().toLowerCase();
  if (x === "0.4") return "0.4.0";
  if (x === "0.5") return "0.5.0";
  if (x === "v0") return "0.0.0";
  if (x === "v1") return "0.1.0";
  return String(v || "").trim();
}

function parsePath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const [version, period, p3, p4, ...rest] = parts;
  if (/^(hourly|daily|weekly|period)$/i.test(p3)) {
    const runKey = String(p4 || "");
    const runTs = /^\d{10,}$/.test(runKey)
      ? runKey
      : String(runKey).split("-")[0];
    return {
      version,
      period,
      tier: p3.toLowerCase(),
      runKey,
      runTs: /^\d{10,}$/.test(runTs) ? runTs : "0",
      file: rest.join("/"),
    };
  }
  if (/^\d{10,}$/.test(p3)) {
    return { version, period, tier: null, runKey: p3, runTs: p3, file: [p4, ...rest].join("/") };
  }
  return null;
}

function fileVariants(file) {
  const noExt = String(file || "").replace(/\.avro$/i, "");
  const core = noExt.replace(/-001$/i, "");
  return [...new Set([`${noExt}.avro`, `${core}.avro`, `${noExt}-001.avro`, `${core}-001.avro`])];
}

function sourceVersionAliases(v) {
  const x = String(v || "").trim().toLowerCase();
  const out = new Set([String(v || "").trim(), normalizeVersion(v)]);
  if (x === "0.4" || x === "0.4.0") {
    out.add("v0");
    out.add("0.0.0");
    out.add("0.1.0");
  }
  if (x === "0.5" || x === "0.5.0") {
    out.add("v1");
    out.add("0.1.0");
  }
  return [...out].filter(Boolean);
}

function buildSourceCandidates(path) {
  const p = parsePath(path);
  if (!p) return [];
  const versions = sourceVersionAliases(p.version);
  const files = fileVariants(p.file);
  const out = [];
  for (const v of versions) {
    for (const f of files) {
      out.push(`${v}/${p.period}/${p.runTs}/${f}`);
      out.push(`${v}/${p.period}/hourly/${p.runTs}/${f}`);
      out.push(`${v}/${p.period}/daily/${p.runTs}/${f}`);
      out.push(`${v}/${p.period}/weekly/${p.runTs}/${f}`);
      out.push(`${v}/${p.period}/period/${p.runTs}/${f}`);
    }
  }
  return [...new Set(out)];
}

function buildTargetPath(path, tier = "hourly") {
  const p = parsePath(path);
  if (!p) return null;
  const resolvedTier = String(p.tier || tier || "hourly").toLowerCase();
  const runSegment = String(p.runKey || p.runTs || "");
  return `${normalizeVersion(p.version)}/${p.period}/${resolvedTier}/${runSegment}/${p.file}`;
}

function versionFromKey(key) {
  return normalizeVersion(String(key || "").split("/")[0] || "");
}

async function listR2Objects(bucket) {
  const endpoint = process.env.R2_S3_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 env vars");
  }
  const c = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const objects = [];
  let token = undefined;
  do {
    const out = await c.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of out.Contents || []) {
      if (o.Key) {
        objects.push({
          key: o.Key,
          size: Number(o.Size || 0),
          lastModifiedMs: o.LastModified ? new Date(o.LastModified).getTime() : Date.now(),
        });
      }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

function classifyPhase(phase) {
  const value = String(phase || "").trim().toLowerCase();
  if (value === "d1-bootstrap-archived-files" || value === "bootstrap" || value === "bootstrap-archived-files") return "d1-bootstrap-archived-files";
  if (value === "d1-reindex" || value === "d1") return "d1-reindex";
  if (value === "d1-backfill-indexes" || value === "backfill-indexes" || value === "index-backfill") return "d1-backfill-indexes";
  if (value === "d1-verify" || value === "verify") return "d1-verify";
  throw new Error(`Invalid --phase value: ${phase}`);
}

function siblingVersionAliases(v) {
  const x = String(v || "").trim();
  if (x === "0.0.0") return ["0.4.0"];
  if (x === "0.1.0") return ["0.5.0"];
  if (x === "0.4.0") return ["0.0.0"];
  if (x === "0.5.0") return ["0.1.0"];
  return [];
}

function buildSiblingPathCandidates(path) {
  const p = parsePath(path);
  if (!p) return [];
  const out = [];
  const runSegment = String(p.runKey || p.runTs || "");
  for (const v of siblingVersionAliases(p.version)) {
    out.push(`${v}/${p.period}/${p.tier || "hourly"}/${runSegment}/${p.file}`);
  }
  return out;
}

function nearestByRunTs(candidates, targetRunTs) {
  const target = Number(targetRunTs || 0);
  if (!Number.isFinite(target) || target <= 0 || candidates.length === 0) return candidates[0] || null;
  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const diff = Math.abs(Number(c.runTs || 0) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}

async function bootstrapArchivedFilesFromR2({ db, remote, bucket, apply, limit }) {
  const r2Objects = await listR2Objects(bucket);
  const rows = d1Query(db, remote, "SELECT file_path FROM archived_files");
  const existing = new Set(rows.map((x) => String(x.file_path || "")).filter(Boolean));

  const plan = [];
  for (const obj of r2Objects) {
    const key = String(obj.key || "");
    const parsed = parsePath(key);
    if (!parsed || !parsed.file || !/\.avro$/i.test(parsed.file)) continue;
    if (existing.has(key)) continue;
    plan.push({
      key,
      size: Number(obj.size || 0),
      lastModifiedMs: Number(obj.lastModifiedMs || Date.now()),
      tableVersion: normalizeVersion(parsed.version || ""),
      compactionTier: String(parsed.tier || "hourly").toLowerCase(),
    });
  }

  const batch = limit > 0 ? plan.slice(0, limit) : plan;
  console.log(`R2 keys: ${r2Objects.length}`);
  console.log(`Existing archived_files rows: ${existing.size}`);
  console.log(`Bootstrap candidates: ${plan.length}`);
  console.log(`Planned now: ${batch.length}`);
  for (const x of batch.slice(0, 20)) {
    console.log(`ADD ${x.key} size=${x.size} tier=${x.compactionTier} version=${x.tableVersion}`);
  }
  if (!apply || batch.length === 0) return;

  for (const x of batch) {
    const createdAt = Math.max(0, Math.trunc(x.lastModifiedMs || Date.now()));
    d1Query(
      db,
      remote,
      `INSERT INTO archived_files (
         file_path, file_size, compression_codec, created_at, last_modified_at, table_version, compaction_tier
       ) VALUES (
         '${sqlQuote(x.key)}', ${Number(x.size || 0)}, 'none', ${createdAt}, ${createdAt}, '${sqlQuote(x.tableVersion || "0.0.0")}', '${sqlQuote(x.compactionTier || "hourly")}'
       ) ON CONFLICT(file_path) DO UPDATE SET
         file_size=excluded.file_size,
         last_modified_at=excluded.last_modified_at,
         table_version=excluded.table_version,
         compaction_tier=excluded.compaction_tier;`,
    );
  }

  console.log(`Bootstrapped rows: ${batch.length}`);
}

async function reindexD1({ db, remote, bucket, apply, limit }) {
  const r2Objects = await listR2Objects(bucket);
  const r2Keys = new Set(r2Objects.map((x) => x.key));
  const rows = d1Query(db, remote, "SELECT id, file_path, compaction_tier FROM archived_files ORDER BY id");

  const plan = [];
  for (const row of rows) {
    const oldPath = String(row.file_path || "");
    const newPath = buildTargetPath(oldPath, row.compaction_tier);
    if (!oldPath || !newPath) continue;
    const pathNeedsUpdate = newPath !== oldPath;
    const pathMissingInR2 = !r2Keys.has(newPath);
    if (!pathNeedsUpdate && !pathMissingInR2) continue;
    const sourceHits = buildSourceCandidates(oldPath).filter((k) => r2Keys.has(k));
    if (sourceHits.length === 0) continue;
    plan.push({
      id: Number(row.id),
      oldPath,
      sourcePath: sourceHits[0],
      newPath,
      tableVersion: versionFromKey(newPath),
      needsCopy: pathMissingInR2,
    });
  }

  const batch = limit > 0 ? plan.slice(0, limit) : plan;
  console.log(`R2 keys: ${r2Keys.size}`);
  console.log(`D1 rows: ${rows.length}`);
  console.log(`Resolvable by remap: ${plan.length}`);
  console.log(`Planned now: ${batch.length}`);
  for (const x of batch.slice(0, 20)) {
    console.log(`MAP ${x.id} ${x.oldPath} <- ${x.sourcePath} -> ${x.newPath}${x.needsCopy ? " [copy]" : ""}`);
  }
  if (!apply || batch.length === 0) return;

  const endpoint = process.env.R2_S3_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const c = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const { GetObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");

  let copied = 0;
  for (const x of batch) {
    if (x.needsCopy) {
      const obj = await c.send(new GetObjectCommand({ Bucket: bucket, Key: x.sourcePath }));
      const chunks = [];
      for await (const chunk of obj.Body) chunks.push(Buffer.from(chunk));
      await c.send(new PutObjectCommand({ Bucket: bucket, Key: x.newPath, Body: Buffer.concat(chunks) }));
      copied += 1;
      r2Keys.add(x.newPath);
    }
    d1Query(db, remote, `UPDATE archived_files SET file_path='${sqlQuote(x.newPath)}', table_version='${sqlQuote(x.tableVersion)}' WHERE id=${x.id};`);
  }
  console.log(`Copied objects: ${copied}`);
  console.log(`Applied updates: ${batch.length}`);
}

async function backfillIndexesD1({ db, remote, apply, limit }) {
  const missingRows = d1Query(
    db,
    remote,
    `SELECT af.id, af.file_path, af.table_version, af.compaction_tier, af.file_size, af.created_at
     FROM archived_files af
     LEFT JOIN block_indexes bi ON bi.file_id = af.id
     WHERE bi.file_id IS NULL
     ORDER BY af.id`,
  ).map((x) => ({
    id: Number(x.id),
    filePath: String(x.file_path || ""),
    tableVersion: String(x.table_version || ""),
    compactionTier: String(x.compaction_tier || ""),
    fileSize: Number(x.file_size || 0),
    createdAt: Number(x.created_at || 0),
  }));
  const targetRows = limit > 0 ? missingRows.slice(0, limit) : missingRows;

  const sourceRows = d1Query(
    db,
    remote,
    `SELECT af.id, af.file_path, af.table_version, af.compaction_tier
     FROM archived_files af
     WHERE EXISTS (SELECT 1 FROM block_indexes bi WHERE bi.file_id = af.id)`,
  ).map((x) => ({
    id: Number(x.id),
    filePath: String(x.file_path || ""),
    tableVersion: String(x.table_version || ""),
    compactionTier: String(x.compaction_tier || ""),
  }));

  const sourceByPath = new Map(sourceRows.map((x) => [x.filePath, x]));
  const sourceByFamily = new Map();
  const sourceByFamilyNoVersion = new Map();

  for (const src of sourceRows) {
    const parsed = parsePath(src.filePath);
    if (!parsed || !parsed.file) continue;
    const key = [parsed.version, parsed.period, parsed.tier || "hourly", parsed.file].join("|");
    if (!sourceByFamily.has(key)) sourceByFamily.set(key, []);
    sourceByFamily.get(key).push({ ...src, runTs: Number(parsed.runTs || 0) });

    const keyNoVersion = [parsed.period, parsed.tier || "hourly", parsed.file].join("|");
    if (!sourceByFamilyNoVersion.has(keyNoVersion)) sourceByFamilyNoVersion.set(keyNoVersion, []);
    sourceByFamilyNoVersion.get(keyNoVersion).push({ ...src, runTs: Number(parsed.runTs || 0) });
  }

  const plan = [];
  for (const target of targetRows) {
    let source = null;
    for (const path of buildSiblingPathCandidates(target.filePath)) {
      const hit = sourceByPath.get(path);
      if (hit) {
        source = hit;
        break;
      }
    }

    if (!source) {
      const p = parsePath(target.filePath);
      if (p) {
        const versions = [p.version, ...siblingVersionAliases(p.version)];
        const families = [];
        for (const v of versions) {
          const key = [v, p.period, p.tier || "hourly", p.file].join("|");
          for (const x of sourceByFamily.get(key) || []) families.push(x);
        }

        if (families.length === 0) {
          const keyNoVersion = [p.period, p.tier || "hourly", p.file].join("|");
          for (const x of sourceByFamilyNoVersion.get(keyNoVersion) || []) families.push(x);
        }

        const near = nearestByRunTs(families, Number(p.runTs || 0));
        if (near) source = near;
      }
    }

    if (!source) continue;
    plan.push({ target, source });
  }

  const batch = plan;
  const canClone = sourceRows.length > 0;
  console.log(`Missing index rows: ${missingRows.length}`);
  console.log(`Resolvable by clone: ${plan.length}`);
  if (!canClone) {
    console.log("Clone source rows are empty; fallback mode: synthesize from archived_files");
  }
  console.log(`Planned now: ${targetRows.length}`);
  for (const x of batch.slice(0, 20)) {
    console.log(`MAP ${x.target.id} ${x.target.filePath} <- ${x.source.id} ${x.source.filePath}`);
  }
  const clonedTargetIds = new Set(batch.map((x) => x.target.id));
  const synthPlan = targetRows.filter((x) => !clonedTargetIds.has(x.id));
  console.log(`Synthesizable rows: ${synthPlan.length}`);
  for (const x of synthPlan.slice(0, 20)) {
    const p = parsePath(x.filePath);
    const fileName = String(p?.file || "").split("/").pop() || "data.avro";
    const tableName = fileName.replace(/\.avro$/i, "").replace(/-\d+$/i, "") || "unknown";
    console.log(`SYNTH ${x.id} ${x.filePath} table=${tableName}`);
  }
  if (!apply) return;

  if (batch.length > 0) {
    for (const x of batch) {
      d1Query(db, remote, `DELETE FROM block_indexes WHERE file_id = ${x.target.id};`);
      d1Query(
        db,
        remote,
        `INSERT INTO block_indexes (
           dataset_id, table_name, file_id, start_byte, length, record_count,
           start_timestamp, end_timestamp, table_version, period_tag,
           compaction_tier, window_start_ms, window_end_ms, source_file_count
         )
         SELECT
           dataset_id, table_name, ${x.target.id}, start_byte, length, record_count,
           start_timestamp, end_timestamp, '${sqlQuote(x.target.tableVersion)}', period_tag,
           '${sqlQuote(x.target.compactionTier)}', window_start_ms, window_end_ms, source_file_count
         FROM block_indexes
         WHERE file_id = ${x.source.id};`,
      );
    }
  }

  if (synthPlan.length > 0) {
    for (const x of synthPlan) {
      const p = parsePath(x.filePath);
      const fileName = String(p?.file || "").split("/").pop() || "data.avro";
      const tableName = fileName.replace(/\.avro$/i, "").replace(/-\d+$/i, "") || "unknown";
      const periodTag = String(p?.period || "unknown");
      const runKey = String(p?.runKey || p?.runTs || "0");
      const runTs = Number(p?.runTs || 0);
      const runMs = Number.isFinite(runTs) && runTs > 0 ? runTs * 1000 : Number(x.createdAt || Date.now());
      const version = normalizeVersion(x.tableVersion || p?.version || "0.0.0");
      const tier = String(x.compactionTier || p?.tier || "hourly").toLowerCase();
      const datasetId = `bootstrap:${periodTag}:${runKey}:${tableName}`;
      const length = Math.max(0, Math.trunc(Number(x.fileSize || 0)));

      d1Query(db, remote, `DELETE FROM block_indexes WHERE file_id = ${x.id};`);
      d1Query(
        db,
        remote,
        `INSERT INTO block_indexes (
           dataset_id, table_name, file_id, start_byte, length, record_count,
           start_timestamp, end_timestamp, table_version, period_tag,
           compaction_tier, window_start_ms, window_end_ms, source_file_count
         ) VALUES (
           '${sqlQuote(datasetId)}', '${sqlQuote(tableName)}', ${x.id}, 0, ${length}, 0,
           ${runMs}, ${runMs}, '${sqlQuote(version)}', '${sqlQuote(periodTag)}',
           '${sqlQuote(tier)}', ${runMs}, ${runMs}, 1
         );`,
      );
    }
  }

  console.log(`Backfilled rows (cloned): ${batch.length}`);
  console.log(`Backfilled rows (synthetic): ${synthPlan.length}`);
}

async function verifyReindexState({ db, remote }) {
  const counts = queryReindexCounts(db, remote);
  console.log(`archived_files_count: ${counts.archivedFilesCount}`);
  console.log(`block_indexes_count: ${counts.blockIndexesCount}`);
  console.log(`missing_index_rows: ${counts.missingIndexRows}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.db) throw new Error("Missing --db");
  if (!args.bucket) throw new Error("Missing --bucket");
  const phase = classifyPhase(args.phase);

  console.log("=== D1 index repair from R2 ===");
  console.log(`phase: ${phase}`);
  console.log(`mode: ${args.apply ? "apply" : "dry-run"}`);
  if (args.limit > 0) console.log(`limit: ${args.limit}`);

  if (phase === "d1-reindex") {
    await reindexD1({ db: args.db, remote: args.remote, bucket: args.bucket, apply: args.apply, limit: args.limit });
    return;
  }

  if (phase === "d1-bootstrap-archived-files") {
    await bootstrapArchivedFilesFromR2({ db: args.db, remote: args.remote, bucket: args.bucket, apply: args.apply, limit: args.limit });
    return;
  }

  if (phase === "d1-backfill-indexes") {
    await backfillIndexesD1({ db: args.db, remote: args.remote, apply: args.apply, limit: args.limit });
    return;
  }

  if (phase === "d1-verify") {
    await verifyReindexState({ db: args.db, remote: args.remote });
    return;
  }
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
