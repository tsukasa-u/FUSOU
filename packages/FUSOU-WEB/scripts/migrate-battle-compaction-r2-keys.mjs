#!/usr/bin/env node

/**
 * Migrate existing battle compaction outputs in R2 to a tier/window-aware key layout,
 * then update D1 archived_files.file_path accordingly.
 *
 * Old key example:
 *   <table_version>/<period_tag>/<tier>/<run_ts>/<table_name>-001.avro
 *
 * New key example:
 *   <table_version>/<period_tag>/<tier>/<run_ts>/<table_name>.avro
 *
 * This script intentionally does NOT touch compaction-trigger code.
 * It only migrates existing objects + D1 references.
 *
 * Usage:
 *   node scripts/migrate-battle-compaction-r2-keys.mjs --remote --db dev-kc-battle-index --bucket dev-kc-battle-data
 *   node scripts/migrate-battle-compaction-r2-keys.mjs --remote --db dev-kc-battle-index --bucket dev-kc-battle-data --apply
 *   node scripts/migrate-battle-compaction-r2-keys.mjs --remote --db dev-kc-battle-index --bucket dev-kc-battle-data --apply --delete-old
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

function parseArgs(argv) {
  const out = {
    remote: false,
    db: "",
    bucket: "",
    apply: false,
    deleteOld: false,
    limit: 0,
    periodFrom: "",
    periodTo: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--remote") {
      out.remote = true;
      continue;
    }
    if (a === "--db") {
      out.db = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (a === "--bucket") {
      out.bucket = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (a === "--limit") {
      const n = Number(argv[i + 1]);
      out.limit = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
      i += 1;
      continue;
    }
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a === "--period-from") {
      out.periodFrom = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (a === "--period-to") {
      out.periodTo = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (a === "--delete-old") {
      out.deleteOld = true;
      continue;
    }
  }

  return out;
}

function sqlQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function runNpx(args) {
  return execFileSync("npx", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runD1({ db, remote }, sql) {
  const args = ["wrangler", "d1", "execute", db];
  if (remote) args.push("--remote");
  args.push("--command", sql, "--json");
  const output = runNpx(args);
  const m = output.match(/\[\s*\{[\s\S]*\}\s*\]\s*$/);
  if (!m) {
    throw new Error(`Failed to parse wrangler d1 JSON output: ${output.slice(0, 400)}`);
  }
  const parsed = JSON.parse(m[0]);
  return parsed?.[0]?.results || [];
}

function runR2Get({ bucket, remote }, key, filePath) {
  const args = ["wrangler", "r2", "object", "get", `${bucket}/${key}`, "--file", filePath];
  if (remote) args.push("--remote");
  runNpx(args);
}

function tryR2Get(ctx, key, filePath) {
  try {
    runR2Get(ctx, key, filePath);
    return true;
  } catch (error) {
    const message = String(error?.message || error || "");
    if (message.includes("specified key does not exist")) {
      return false;
    }
    throw error;
  }
}

function runR2Put({ bucket, remote }, key, filePath) {
  const args = ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", filePath];
  if (remote) args.push("--remote");
  runNpx(args);
}

function runR2Delete({ bucket, remote }, key) {
  const args = ["wrangler", "r2", "object", "delete", `${bucket}/${key}`];
  if (remote) args.push("--remote");
  runNpx(args);
}

function isTier(value) {
  return value === "hourly" || value === "daily" || value === "weekly" || value === "period";
}

function inferSourceTier(compactionTier) {
  if (compactionTier === "hourly") return "hourly";
  if (compactionTier === "daily") return "hourly";
  if (compactionTier === "weekly") return "daily";
  if (compactionTier === "period") return "weekly";
  return "";
}

function hasNewLayout(path) {
  return /^\d+(?:\.\d+){1,2}\/[^/]+\/(hourly|daily|weekly|period)\/\d{10,}\/[^/]+\.avro$/i.test(path);
}

function normalizeFileName(raw) {
  const base = String(raw || "data.avro").replace(/\.avro$/i, "");
  return `${base.replace(/-001$/i, "")}.avro`;
}

function normalizeTableVersion(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "0.4") return "0.4.0";
  if (value === "0.5") return "0.5.0";
  if (value === "v0") return "0.0.0";
  if (value === "v1") return "0.1.0";
  return String(raw || "").trim();
}

function buildNewKey(row) {
  const oldPath = String(row.file_path || "").trim();
  if (!oldPath) return null;
  if (hasNewLayout(oldPath)) return oldPath;

  const tableVersion = normalizeTableVersion(row.table_version);
  const periodTag = String(row.period_tag || "").trim();
  const tier = String(row.compaction_tier || "").trim() || "hourly";
  const sourceTier = String(row.source_tier || "").trim() || inferSourceTier(tier);
  const windowStart = Number(row.window_start_ms);
  const windowEnd = Number(row.window_end_ms);
  const tableName = normalizeFileName(String(row.table_name || "").trim() || "data");

  if (!tableVersion || !periodTag || !isTier(tier) || !sourceTier) return null;
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return null;

  const oldRunTsMatch = oldPath.match(/\/(\d{10,})\/[^/]+$/);
  const oldRunTs = oldRunTsMatch?.[1] || "";
  const runTs = oldRunTs || String(Number(row.created_at || Date.now()));

  return `${tableVersion}/${periodTag}/${tier}/${runTs}/${tableName}`;
}

function mappingSql(limit, periodFrom, periodTo) {
  const limitClause = limit > 0 ? ` LIMIT ${limit}` : "";
  const periodFromClause = periodFrom ? ` AND bi.period_tag >= '${sqlQuote(periodFrom)}'` : "";
  const periodToClause = periodTo ? ` AND bi.period_tag <= '${sqlQuote(periodTo)}'` : "";
  return `
SELECT
  af.id,
  af.file_path,
  af.created_at,
  MIN(bi.table_version) AS table_version,
  COALESCE(MIN(bi.compaction_tier), 'hourly') AS compaction_tier,
  MIN(COALESCE(bi.window_start_ms, bi.start_timestamp)) AS window_start_ms,
  MAX(COALESCE(bi.window_end_ms, bi.end_timestamp)) AS window_end_ms,
  MAX(COALESCE(af.source_tier, '')) AS source_tier,
  MIN(bi.table_name) AS table_name,
  MIN(bi.period_tag) AS period_tag,
  COUNT(DISTINCT bi.compaction_tier) AS compaction_tier_count,
  COUNT(DISTINCT bi.table_name) AS table_name_count,
  COUNT(DISTINCT bi.period_tag) AS period_tag_count
FROM archived_files af
JOIN block_indexes bi ON bi.file_id = af.id
WHERE bi.compaction_tier IN ('hourly','daily','weekly','period')
  ${periodFromClause}
  ${periodToClause}
GROUP BY af.id
ORDER BY af.id ASC${limitClause};`.trim();
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.db) throw new Error("Missing required --db <D1_DATABASE_NAME>");
  if (!args.bucket) throw new Error("Missing required --bucket <R2_BUCKET_NAME>");

  const envLabel = args.remote ? "remote" : "local";
  console.log(`=== Battle Compaction R2 Key Migration (${envLabel}) ===`);
  console.log(`DB: ${args.db}`);
  console.log(`Bucket: ${args.bucket}`);
  console.log(`Mode: ${args.apply ? "apply" : "dry-run"}`);
  if (args.limit > 0) console.log(`Limit: ${args.limit}`);
  if (args.periodFrom) console.log(`Period from: ${args.periodFrom}`);
  if (args.periodTo) console.log(`Period to: ${args.periodTo}`);

  const rows = runD1(
    { db: args.db, remote: args.remote },
    mappingSql(args.limit, args.periodFrom, args.periodTo),
  );
  if (!rows.length) {
    console.log("No eligible compaction rows found. Nothing to migrate.");
    return;
  }

  const skipped = [];
  const mappings = [];
  for (const row of rows) {
    const tableNameCount = Number(row.table_name_count || 0);
    const periodTagCount = Number(row.period_tag_count || 0);
    const compactionTierCount = Number(row.compaction_tier_count || 0);
    const oldKey = String(row.file_path || "");

    if (!oldKey) {
      skipped.push({ id: Number(row.id), reason: "empty file_path" });
      continue;
    }

    if (
      tableNameCount !== 1 ||
      periodTagCount !== 1 ||
      compactionTierCount !== 1
    ) {
      skipped.push({
        id: Number(row.id),
        reason:
          `ambiguous block metadata table_name_count=${tableNameCount} ` +
          `period_tag_count=${periodTagCount} compaction_tier_count=${compactionTierCount}`,
      });
      continue;
    }

    const newKey = buildNewKey(row);
    if (!newKey) {
      skipped.push({ id: Number(row.id), reason: "could not derive new key" });
      continue;
    }

    if (newKey === oldKey) continue;

    mappings.push({
      id: Number(row.id),
      oldKey,
      newKey,
      tableName: String(row.table_name || ""),
      tier: String(row.compaction_tier || ""),
      sourceTier: String(row.source_tier || ""),
      windowStart: Number(row.window_start_ms),
      windowEnd: Number(row.window_end_ms),
    });
  }

  console.log(`Eligible rows: ${rows.length}`);
  console.log(`Planned migrations: ${mappings.length}`);
  console.log(`Skipped rows: ${skipped.length}`);

  if (skipped.length > 0) {
    for (const s of skipped.slice(0, 20)) {
      console.log(`  SKIP id=${s.id}: ${s.reason}`);
    }
    if (skipped.length > 20) {
      console.log(`  ... and ${skipped.length - 20} more skipped rows`);
    }
  }

  if (!mappings.length) {
    console.log("No keys requiring migration found.");
    return;
  }

  for (const m of mappings.slice(0, 20)) {
    console.log(`  ${m.oldKey} -> ${m.newKey}`);
  }
  if (mappings.length > 20) {
    console.log(`  ... and ${mappings.length - 20} more`);
  }

  if (!args.apply) {
    console.log("Dry-run complete. Re-run with --apply to execute copy + D1 update.");
    return;
  }

  const tmpDir = join(process.cwd(), ".migrate-battle-compaction-r2-tmp");
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  let copied = 0;
  let updated = 0;
  let missing = 0;
  const missingSamples = [];

  try {
    for (const m of mappings) {
      const tmpFile = join(tmpDir, `${m.id}.avro`);
      const exists = tryR2Get({ bucket: args.bucket, remote: args.remote }, m.oldKey, tmpFile);
      if (!exists) {
        missing += 1;
        if (missingSamples.length < 20) {
          missingSamples.push({ id: m.id, key: m.oldKey });
        }
        if ((copied + missing) % 100 === 0) {
          console.log(`Progress ${copied + missing}/${mappings.length} (copied=${copied}, missing=${missing})`);
        }
        continue;
      }
      runR2Put({ bucket: args.bucket, remote: args.remote }, m.newKey, tmpFile);
      copied += 1;
      if ((copied + missing) % 100 === 0) {
        console.log(`Progress ${copied + missing}/${mappings.length} (copied=${copied}, missing=${missing})`);
      }

      const normalizedVersion = normalizeTableVersion(m.newKey.split("/")[0] || "");
      const updateSql = `UPDATE archived_files SET file_path='${sqlQuote(m.newKey)}', table_version='${sqlQuote(normalizedVersion)}' WHERE id=${m.id};`;
      runD1({ db: args.db, remote: args.remote }, updateSql);
      const updateMetaSql = `
    UPDATE archived_files
    SET compaction_tier='${sqlQuote(m.tier)}',
        source_tier='${sqlQuote(m.sourceTier || inferSourceTier(m.tier))}',
        window_start_ms=${Number(m.windowStart)},
        window_end_ms=${Number(m.windowEnd)}
    WHERE id=${m.id};

    UPDATE block_indexes
    SET table_version='${sqlQuote(normalizedVersion)}',
        compaction_tier='${sqlQuote(m.tier)}',
        window_start_ms=${Number(m.windowStart)},
        window_end_ms=${Number(m.windowEnd)}
    WHERE file_id=${m.id};`.trim();
      runD1({ db: args.db, remote: args.remote }, updateMetaSql);
      updated += 1;

      if (args.deleteOld) {
        runR2Delete({ bucket: args.bucket, remote: args.remote }, m.oldKey);
      }
    }

    const remaining = runD1(
      { db: args.db, remote: args.remote },
      `
SELECT COUNT(DISTINCT af.id) AS cnt
FROM archived_files af
JOIN block_indexes bi ON bi.file_id = af.id
WHERE bi.compaction_tier IN ('hourly','daily','weekly','period')
  AND bi.window_start_ms IS NOT NULL
  AND bi.window_end_ms IS NOT NULL
  AND af.file_path NOT GLOB '*/*/hourly/[0-9]*/**.avro'
  AND af.file_path NOT GLOB '*/*/daily/[0-9]*/**.avro'
  AND af.file_path NOT GLOB '*/*/weekly/[0-9]*/**.avro'
  AND af.file_path NOT GLOB '*/*/period/[0-9]*/**.avro';`.trim(),
    );

    const remainCnt = Number(remaining?.[0]?.cnt || 0);

    console.log("---");
    console.log(`Copied objects: ${copied}`);
    console.log(`Updated D1 rows: ${updated}`);
    console.log(`Missing old objects: ${missing}`);
    console.log(`Remaining old-layout compaction rows: ${remainCnt}`);
    console.log(`Old objects deleted: ${args.deleteOld ? "yes" : "no"}`);

    if (missingSamples.length > 0) {
      console.log("Missing sample keys:");
      for (const s of missingSamples) {
        console.log(`  id=${s.id} key=${s.key}`);
      }
    }

    if (remainCnt !== 0 && copied > 0) {
      throw new Error(`Migration incomplete: ${remainCnt} old-layout rows remain.`);
    }
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
