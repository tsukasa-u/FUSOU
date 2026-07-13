#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

function parseArgs(argv) {
  const out = {
    remote: false,
    db: "",
    bucket: "",
    apply: false,
    limit: 0,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--remote") out.remote = true;
    else if (a === "--apply") out.apply = true;
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

function runNpx(args) {
  return execFileSync("npx", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function d1Query(db, remote, sql) {
  const args = ["wrangler", "d1", "execute", db];
  if (remote) args.push("--remote");
  args.push("--command", sql, "--json");
  const out = runNpx(args);
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results || [];
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

function versionAliases(v) {
  const x = String(v || "").trim();
  const set = new Set([x, normalizeVersion(x)]);
  if (x === "0.4" || x === "0.4.0") set.add("v0");
  if (x === "0.5" || x === "0.5.0") set.add("v1");
  if (x === "v0") {
    set.add("0.4");
    set.add("0.4.0");
  }
  if (x === "v1") {
    set.add("0.5");
    set.add("0.5.0");
  }
  return [...set].filter(Boolean);
}

function parseOldLikePath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const [version, period, p3, p4, ...rest] = parts;

  if (/^(hourly|daily|weekly|period)$/i.test(p3) && /^\d{10,}$/.test(p4)) {
    const file = rest.join("/");
    return { version, period, runTs: p4, file, tiered: true };
  }

  if (/^\d{10,}$/.test(p3)) {
    const file = [p4, ...rest].join("/");
    return { version, period, runTs: p3, file, tiered: false };
  }

  return null;
}

function baseNameVariants(file) {
  const raw = String(file || "");
  const noExt = raw.replace(/\.avro$/i, "");
  const no001 = noExt.replace(/-001$/i, "");
  return [
    `${noExt}.avro`,
    `${no001}.avro`,
    `${noExt}-001.avro`,
    `${no001}-001.avro`,
  ];
}

function buildCandidates(path) {
  const p = parseOldLikePath(path);
  if (!p) return [];
  const versions = versionAliases(p.version);
  const files = [...new Set(baseNameVariants(p.file))];
  const c = [];

  for (const v of versions) {
    for (const f of files) {
      c.push(`${v}/${p.period}/${p.runTs}/${f}`);
      c.push(`${v}/${p.period}/hourly/${p.runTs}/${f}`);
      c.push(`${v}/${p.period}/daily/${p.runTs}/${f}`);
      c.push(`${v}/${p.period}/weekly/${p.runTs}/${f}`);
      c.push(`${v}/${p.period}/period/${p.runTs}/${f}`);
    }
  }
  return [...new Set(c)];
}

async function listR2KeysFromEnv(bucket) {
  const endpoint = process.env.R2_S3_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 env vars (R2_S3_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)");
  }

  const c = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  const keys = new Set();
  let token = undefined;
  do {
    const out = await c.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of out.Contents || []) {
      if (o.Key) keys.add(o.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  return keys;
}

function versionFromKey(key) {
  const first = String(key || "").split("/")[0] || "";
  return normalizeVersion(first);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.db) throw new Error("Missing --db");
  if (!args.bucket) throw new Error("Missing --bucket");

  console.log("=== R2 Source-of-Truth Reindex ===");
  console.log(`mode: ${args.apply ? "apply" : "dry-run"}`);
  if (args.limit > 0) console.log(`limit: ${args.limit}`);

  const r2Keys = await listR2KeysFromEnv(args.bucket);
  console.log(`R2 keys: ${r2Keys.size}`);

  const rows = d1Query(args.db, args.remote, "SELECT id, file_path, table_version FROM archived_files ORDER BY id");
  console.log(`D1 rows: ${rows.length}`);

  const plan = [];
  let d1Missing = 0;
  for (const r of rows) {
    const id = Number(r.id);
    const oldPath = String(r.file_path || "");
    if (!oldPath) continue;
    if (r2Keys.has(oldPath)) continue;

    d1Missing += 1;
    const candidates = buildCandidates(oldPath).filter((k) => r2Keys.has(k));
    if (candidates.length === 1) {
      const newPath = candidates[0];
      plan.push({ id, oldPath, newPath, tableVersion: versionFromKey(newPath) });
    }
  }

  const limited = args.limit > 0 ? plan.slice(0, args.limit) : plan;

  console.log(`D1 missing in R2: ${d1Missing}`);
  console.log(`Resolvable by deterministic remap: ${plan.length}`);
  console.log(`Planned to apply now: ${limited.length}`);

  for (const p of limited.slice(0, 20)) {
    console.log(`MAP ${p.id} ${p.oldPath} -> ${p.newPath}`);
  }

  if (!args.apply || limited.length === 0) return;

  const sql = limited
    .map(
      (p) =>
        `UPDATE archived_files SET file_path='${sqlQuote(p.newPath)}', table_version='${sqlQuote(p.tableVersion)}' WHERE id=${p.id};`,
    )
    .join("\n");

  d1Query(args.db, args.remote, sql);
  console.log(`Applied updates: ${limited.length}`);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
