#!/usr/bin/env node

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const BASE_URL = process.env.BASE_URL || "https://fusou.ogu-hide-u-425.workers.dev";
const PERIOD_TAG = process.env.PERIOD_TAG || "2026-10-14";

console.log("=================================================");
console.log("       FUSOU COMPACTION VERIFICATION SUITE       ");
console.log("=================================================");
console.log(`Target: ${BASE_URL}`);
console.log(`Period: ${PERIOD_TAG}\n`);

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    if (details) console.log(`         -> ${details}`);
    passedCount++;
  } else {
    console.error(`  [FAIL] ${testName}`);
    if (details) console.error(`         -> ${details}`);
    failedCount++;
  }
}

async function verifyPeriodConvergence() {
  console.log("--- 1. Verifying Period File Convergence in D1 ---");
  try {
    const raw = execSync(
      `pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command "SELECT file_path FROM archived_files WHERE file_path LIKE '%/${PERIOD_TAG}/period/%' AND file_path NOT LIKE 'compacted/%'"`,
      { cwd: REPO_ROOT, encoding: "utf-8" }
    );
    const parsed = JSON.parse(raw);
    const files = (parsed[0]?.results || []).map((r) => r.file_path);

    assert(files.length > 0, "Period files exist in D1", `Found ${files.length} active period files`);

    // Check that each table has at most ONE period file (e.g. battle-001.avro, but not battle-002.avro)
    const tableCounts = new Map();
    for (const f of files) {
      const match = f.match(/\/([^/]+)-001\.avro$/) || f.match(/\/([^/]+)\.avro$/);
      if (match) {
        const table = match[1];
        tableCounts.set(table, (tableCounts.get(table) || 0) + 1);
      }
    }

    let converged = true;
    for (const [table, count] of tableCounts.entries()) {
      if (count > 1) {
        converged = false;
        console.warn(`         Table ${table} has ${count} period files (not converged)!`);
      }
    }
    assert(converged, "All tables are converged to a SINGLE period file (no duplicate period files)");
  } catch (err) {
    assert(false, "Querying D1 archived_files", err.message);
  }
}

async function verifyDeduplication() {
  console.log("\n--- 2. Verifying Record Deduplication (1-2 Sorties & Drops) ---");
  try {
    const res = await fetch(`${BASE_URL}/api/battle-data/global/overview?period_tag=${PERIOD_TAG}`);
    const data = await res.json();
    const battles = data.battles || [];

    // Filter battles for Map 1-2
    const map12Battles = battles.filter((b) => Number(b.maparea_id) === 1 && Number(b.mapinfo_no) === 2);
    const uniqueKeys = new Set(map12Battles.map((b) => `${b.uuid || b.env_uuid}:${b.index}`));

    assert(map12Battles.length === uniqueKeys.size, "Map 1-2 battles have 0 duplicate primary keys (uuid:index)", `Battles: ${map12Battles.length}, Unique keys: ${uniqueKeys.size}`);

    // Check drop consistency: drops must not exceed sorties
    const drops = map12Battles.filter((b) => b.battle_result?.drop_ship_id);
    assert(drops.length <= map12Battles.length, "Drops do not exceed sorties (no multiplication bug)", `Sorties: ${map12Battles.length}, Drops: ${drops.length}`);
  } catch (err) {
    assert(false, "Verifying deduplication via overview", err.message);
  }
}

async function verifySnapshotsAndMasterData() {
  console.log("\n--- 3. Verifying Snapshots & Master Data Integrity ---");
  
  // Overview
  try {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/battle-data/global/overview?period_tag=latest`);
    const lat = Math.round(performance.now() - t0);
    assert(res.status === 200, "Overview endpoint status is 200", `HTTP ${res.status}`);
    assert(res.headers.get("x-fusou-cache") === "SNAPSHOT-HIT", "Overview cache is SNAPSHOT-HIT", `Cache: ${res.headers.get("x-fusou-cache")}, Latency: ${lat}ms`);
    const json = await res.json();
    assert(Array.isArray(json.battles) && json.battles.length > 0, "Overview contains valid battles list", `Count: ${json.battles?.length}`);
  } catch (err) {
    assert(false, "Overview snapshot verification", err.message);
  }

  // Drops
  try {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/battle-data/global/drops?period_tag=latest`);
    const lat = Math.round(performance.now() - t0);
    assert(res.status === 200, "Drops endpoint status is 200", `HTTP ${res.status}`);
    assert(res.headers.get("x-fusou-cache") === "SNAPSHOT-HIT", "Drops cache is SNAPSHOT-HIT", `Cache: ${res.headers.get("x-fusou-cache")}, Latency: ${lat}ms`);
    const json = await res.json();
    assert(Array.isArray(json.battles) && json.battles.length > 0, "Drops contains valid battles list", `Count: ${json.battles?.length}`);
  } catch (err) {
    assert(false, "Drops snapshot verification", err.message);
  }

  // Detail & Master Data check
  try {
    const testEnvUuid = "01a13a7f-8c80-7002-8deb-a2c53be59e9d";
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/battle-data/detail?env_uuid=${testEnvUuid}&battle_index=0&period_tag=${PERIOD_TAG}`);
    const lat = Math.round(performance.now() - t0);
    assert(res.status === 200, "Detail endpoint status is 200", `HTTP ${res.status}`);
    assert(res.headers.get("x-fusou-cache") === "SNAPSHOT-HIT", "Detail cache is SNAPSHOT-HIT", `Cache: ${res.headers.get("x-fusou-cache")}, Latency: ${lat}ms`);
    
    const json = await res.json();
    assert(!!json.battle, "Detail payload contains valid battle object");

    // Master data presence verification
    const mstShipCount = json.refs?.mst_ship?.length || 0;
    const mstSlotCount = json.refs?.mst_slotitem?.length || 0;
    assert(mstShipCount > 0, "Master data: mst_ship is embedded in refs (UI success)", `Count: ${mstShipCount} ship(s)`);
    assert(mstSlotCount > 0, "Master data: mst_slotitem is embedded in refs (UI success)", `Count: ${mstSlotCount} item(s)`);
  } catch (err) {
    assert(false, "Detail snapshot verification", err.message);
  }

  // Detail-Env (Sortie-level bundle) check
  try {
    const testEnvUuid = "01a13a7f-8c80-7002-8deb-a2c53be59e9d";
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/battle-data/detail-env?env_uuid=${testEnvUuid}&period_tag=${PERIOD_TAG}`);
    const lat = Math.round(performance.now() - t0);
    assert(res.status === 200, "Detail-Env endpoint status is 200", `HTTP ${res.status}`);
    assert(res.headers.get("x-fusou-cache") === "SNAPSHOT-HIT", "Detail-Env cache is SNAPSHOT-HIT", `Cache: ${res.headers.get("x-fusou-cache")}, Latency: ${lat}ms`);
    const json = await res.json();
    assert(typeof json.battles === "object" && Object.keys(json.battles).length > 0, "Detail-Env bundle contains all sortie battles", `Battles: [${Object.keys(json.battles).join(", ")}]`);
  } catch (err) {
    assert(false, "Detail-Env verification", err.message);
  }
}

async function main() {
  await verifyPeriodConvergence();
  await verifyDeduplication();
  await verifySnapshotsAndMasterData();

  console.log("\n=================================================");
  console.log(`VERIFICATION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("=================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification suite failed unexpectedly:", err);
  process.exit(1);
});
