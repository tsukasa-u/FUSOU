#!/usr/bin/env node
/**
 * check-experimental-data.mjs
 *
 * 実験的データ収集（ship_growth / quest_tree / remodel_data）の
 * 収集状況をリモート D1 から表示する診断スクリプト。
 *
 * Usage:
 *   node scripts/check-experimental-data.mjs
 *   node scripts/check-experimental-data.mjs --target ship_growth
 *   node scripts/check-experimental-data.mjs --target quest_tree
 *   node scripts/check-experimental-data.mjs --target remodel
 *
 * Prerequisites:
 *   - `npx wrangler login` (Cloudflare 認証)
 *   - wrangler.toml に D1 バインディングが設定されていること
 */

import { execFileSync } from "child_process";

// ── CLI 引数 ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const targetFilter = targetIdx !== -1 ? args[targetIdx + 1] : null;

// ── D1 database_name（wrangler.toml の database_name フィールドと一致させる） ─
const DB = {
  ship_growth: "dev-kc-ship-growth",
  quest_tree:  "dev-kc-quest-index",
  remodel:     "dev-kc-remodel-index",
};

// ── ヘルパー ────────────────────────────────────────────────────────
function run(file, args) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function d1query(dbName, sql) {
  // Collapse whitespace to a single line
  const oneLine = sql.replace(/\s+/g, " ").trim();
  const out = run("npx", [
    "wrangler",
    "d1",
    "execute",
    dbName,
    "--remote",
    "--command",
    oneLine,
    "--json",
  ]);
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? [];
}

function section(title) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

function table(rows) {
  if (!rows || rows.length === 0) {
    console.log("  (データなし)");
    return;
  }
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)),
  );
  const header = keys.map((k, i) => k.padEnd(widths[i])).join("  ");
  const sep    = widths.map((w) => "─".repeat(w)).join("  ");
  console.log("  " + header);
  console.log("  " + sep);
  for (const row of rows) {
    const line = keys.map((k, i) => String(row[k] ?? "").padEnd(widths[i])).join("  ");
    console.log("  " + line);
  }
}

// ── ship_growth ─────────────────────────────────────────────────────
async function checkShipGrowth() {
  section("ship_growth（艦娘成長データ）");
  const db = DB.ship_growth;

  try {
    // bounds テーブル: period × master_id 数
    const bounds = d1query(
      db,
      `SELECT period_tag, table_version, COUNT(DISTINCT master_id) AS ship_types, COUNT(*) AS bound_rows FROM ship_growth_bounds GROUP BY period_tag, table_version ORDER BY period_tag DESC, table_version DESC LIMIT 10`,
    );
    console.log("\n[ship_growth_bounds] period 別 収集状況:");
    table(bounds);

    // caps テーブル
    const caps = d1query(
      db,
      `SELECT period_tag, table_version, COUNT(DISTINCT master_id) AS ship_types FROM ship_growth_caps GROUP BY period_tag, table_version ORDER BY period_tag DESC, table_version DESC LIMIT 10`,
    );
    console.log("\n[ship_growth_caps] period 別 収集状況:");
    table(caps);

    // exp テーブル
    const exp = d1query(
      db,
      `SELECT period_tag, table_version, COUNT(*) AS lv_rows FROM ship_level_exp_pairs GROUP BY period_tag, table_version ORDER BY period_tag DESC LIMIT 10`,
    );
    console.log("\n[ship_level_exp_pairs] period 別 Lv 行数:");
    table(exp);
  } catch (err) {
    console.error("  エラー:", err.message);
  }
}

// ── quest_tree ──────────────────────────────────────────────────────
async function checkQuestTree() {
  section("quest_tree（クエストツリーデータ）");
  const db = DB.quest_tree;

  try {
    // ingest イベント数
    const events = d1query(
      db,
      `SELECT period_tag, table_version, COUNT(DISTINCT dataset_id) AS datasets, COUNT(*) AS total_events FROM quest_ingest_events GROUP BY period_tag, table_version ORDER BY period_tag DESC, table_version DESC LIMIT 10`,
    );
    console.log("\n[quest_ingest_events] period 別 収集状況:");
    table(events);

    // セッション数
    const sessions = d1query(
      db,
      `SELECT COUNT(*) AS total_sessions FROM quest_collection_sessions`,
    );
    console.log("\n[quest_collection_sessions] セッション総数:");
    table(sessions);

    // ルール数
    const rules = d1query(
      db,
      `SELECT period_tag, table_version, COUNT(*) AS rule_count, COUNT(DISTINCT target_quest_id) AS target_count FROM quest_rule_edges GROUP BY period_tag, table_version ORDER BY period_tag DESC, table_version DESC LIMIT 10`,
    );
    console.log("\n[quest_rule_edges] 導出ルール数:");
    table(rules);

    // 最新 10 件のイベント
    const recent = d1query(
      db,
      `SELECT id, event_type, period_tag, table_version, dataset_id, datetime(created_at / 1000, 'unixepoch') AS created_at FROM quest_ingest_events ORDER BY id DESC LIMIT 10`,
    );
    console.log("\n[quest_ingest_events] 最近の ingestion（最新10件）:");
    table(recent);
  } catch (err) {
    console.error("  エラー:", err.message);
  }
}

// ── remodel ─────────────────────────────────────────────────────────
async function checkRemodel() {
  section("remodel_data（改造データ）");
  const db = DB.remodel;

  try {
    // slotlist_entries: period 別 収集状況
    const slotlist = d1query(
      db,
      `SELECT period_tag, COUNT(DISTINCT slotitem_master_id) AS slotitem_types, COUNT(*) AS rows FROM remodel_slotlist_effective_requirements GROUP BY period_tag ORDER BY period_tag DESC LIMIT 10`,
    );
    console.log("\n[remodel_slotlist_effective_requirements] period 別 収集状況:");
    table(slotlist);

    // detail_entries: period 別 収集状況
    const details = d1query(
      db,
      `SELECT period_tag, COUNT(DISTINCT slotitem_master_id) AS slotitem_types, COUNT(*) AS rows FROM remodel_detail_entries GROUP BY period_tag ORDER BY period_tag DESC LIMIT 10`,
    );
    console.log("\n[remodel_detail_entries] period 別 収集状況:");
    table(details);

    // 装備種別の上位（slotlist）
    const topItems = d1query(
      db,
      `SELECT slotitem_master_id, COUNT(*) AS observed_by FROM remodel_slotlist_effective_requirements GROUP BY slotitem_master_id ORDER BY observed_by DESC LIMIT 15`,
    );
    console.log("\n[remodel_slotlist_effective_requirements] 観測数上位装備:");
    table(topItems);
  } catch (err) {
    console.error("  エラー:", err.message);
  }
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  console.log("=== FUSOU 実験的データ収集 診断スクリプト ===");
  console.log(`対象: ${targetFilter ?? "all"}`);

  if (!targetFilter || targetFilter === "ship_growth") await checkShipGrowth();
  if (!targetFilter || targetFilter === "quest_tree")  await checkQuestTree();
  if (!targetFilter || targetFilter === "remodel")     await checkRemodel();

  console.log("\n完了。");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
