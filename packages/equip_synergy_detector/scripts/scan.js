#!/usr/bin/env node
/**
 * Exhaustive equipment bonus scan.
 *
 * Phase 1: Single-item scan (every ship × every item, ★0/★10, ×1/×2)
 * Phase 2: Cross-item synergy scan (pairs of different items)
 * Phase 3: Stacking scan (×3, ×4 for items with non-linear stacking)
 *
 * Usage:
 *   node scripts/scan.js [--main] [--output <path>]
 *
 * Output: output/slot_item_effects.json
 */

const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { createHash } = require("crypto");
const { compressWithZDD } = require("./zdd");
const {
  ROOT,
  findMasterData,
  parseMasterData,
  buildMstDict,
  createGetMst,
  loadBundle,
} = require("../lib/loader");

// ── Parse arguments ────────────────────────────────────────────────
const args = process.argv.slice(2);

// Reject unknown flags and positional arguments.
const KNOWN_FLAGS = new Set([
  "--main",
  "--volatile-generated",
  "--output",
  "--period-tag",
]);
const FLAGS_WITH_VALUE = new Set(["--output", "--period-tag"]);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith("--")) {
    console.error(`Error: unexpected positional argument: ${arg}`);
    process.exit(1);
  }
  if (!KNOWN_FLAGS.has(arg)) {
    console.error(`Error: unknown option: ${arg}`);
    process.exit(1);
  }
  if (FLAGS_WITH_VALUE.has(arg)) {
    const val = args[i + 1];
    if (!val || val.startsWith("--")) {
      console.error(`Error: ${arg} requires a value.`);
      process.exit(1);
    }
    i += 1; // skip value
  }
}

const useMain = args.includes("--main");
const deterministic = !args.includes("--volatile-generated");
const pruneInvisible = !args.includes("--no-prune-invisible");
const outputIdx = args.indexOf("--output");
const outputPath =
  outputIdx >= 0
    ? path.resolve(args[outputIdx + 1])
    : path.join(ROOT, "output", "slot_item_effects.json");
const previewNameManifestPath = path.join(
  path.dirname(outputPath),
  "preview_name_manifest.json",
);

// --period-tag YYYY-MM-DD: the KanColle game period tag to associate with this scan.
// This must match the period_tag used by the server for master-data and ship-growth uploads.
// If not provided, remains null and upload-synergy.mjs will require --period-tag explicitly.
const periodTagIdx = args.indexOf("--period-tag");
const scanPeriodTag = periodTagIdx >= 0 ? args[periodTagIdx + 1] : null;
if (scanPeriodTag && !/^\d{4}-\d{2}-\d{2}$/.test(scanPeriodTag)) {
  console.error(
    `Error: --period-tag must be YYYY-MM-DD, got: ${scanPeriodTag}`,
  );
  process.exit(1);
}
if (scanPeriodTag) {
  console.log(`[scan] period_tag: ${scanPeriodTag}`);
} else {
  console.warn(
    "[scan] WARNING: --period-tag not specified. Add it to _meta manually or pass --period-tag to upload-synergy.mjs.",
  );
}

// ── Load master data ───────────────────────────────────────────────
const masterPath = findMasterData();
if (!masterPath) {
  console.error(
    "Error: No master data found in master_data/. Place an api_start2 response file there.",
  );
  process.exit(1);
}
console.log(`[scan] Master data: ${path.relative(ROOT, masterPath)}`);

// Compute hash of the raw master data file bytes for provenance tracking.
const apiStart2BatchHash = createHash("sha256")
  .update(fs.readFileSync(masterPath))
  .digest("hex");
console.log(`[scan] api_start2_batch_hash: ${apiStart2BatchHash}`);

const masterData = parseMasterData(masterPath);
const mstShips = [...masterData.api_mst_ship].sort(
  (a, b) => a.api_id - b.api_id,
);
const mstSlotitems = [...masterData.api_mst_slotitem].sort(
  (a, b) => a.api_id - b.api_id,
);
console.log(`[scan] Ships: ${mstShips.length}, Items: ${mstSlotitems.length}`);

// ── Build mstDict and load bundle ──────────────────────────────────
const mstDict = buildMstDict(mstSlotitems);
const getMst = createGetMst(mstDict);
const { kcsRequire } = loadBundle({ useMain, getMst, silent: false });
const { SlotItemEffectUtil } = kcsRequire(82692);

// ── Helpers ────────────────────────────────────────────────────────
const STAT_KEYS = [
  "houg",
  "raig",
  "tyku",
  "souk",
  "kaih",
  "tais",
  "saku",
  "baku",
  "houm",
  "leng",
];

function extractNonZero(result) {
  if (!result) return null;
  const obj = {};
  let any = false;
  for (const k of STAT_KEYS) {
    const raw = result[k];
    if (raw == null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const iv = Math.trunc(v);
    if (iv !== v) {
      throw new Error(
        `[scan] non-integer bonus detected: stat=${k}, value=${String(raw)}`,
      );
    }
    if (v !== 0) {
      obj[k] = iv;
      any = true;
    }
  }
  return any ? obj : null;
}

function encodeCombosB64(combos, pool, comboSize) {
  const itemIdx = new Map(pool.map((id, i) => [id, i]));
  let raw;
  let codec;
  if (pool.length < 256) {
    const buf = new Uint8Array(combos.length * comboSize);
    let pos = 0;
    for (const combo of combos) {
      for (const id of combo) buf[pos++] = itemIdx.get(id);
    }
    raw = Buffer.from(buf);
    codec = "u8";
  } else if (pool.length < 65536) {
    raw = Buffer.allocUnsafe(combos.length * comboSize * 2);
    let pos = 0;
    for (const combo of combos) {
      for (const id of combo) {
        raw.writeUInt16LE(itemIdx.get(id), pos);
        pos += 2;
      }
    }
    codec = "u16";
  } else {
    raw = Buffer.allocUnsafe(combos.length * comboSize * 4);
    let pos = 0;
    for (const combo of combos) {
      for (const id of combo) {
        raw.writeUInt32LE(itemIdx.get(id), pos);
        pos += 4;
      }
    }
    codec = "u32";
  }

  const plainB64 = raw.toString("base64");
  if (codec === "u8") {
    return { items: pool, combos_b64: plainB64 };
  }
  if (codec === "u16") {
    return { items: pool, combos_u16_b64: plainB64 };
  }
  return {
    items: pool,
    combos_u32_b64: plainB64,
  };
}

function bkey(obj) {
  return obj ? JSON.stringify(obj) : "";
}

function statsEqual(a, b) {
  return bkey(a) === bkey(b);
}

function statsAdd(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const out = {};
  let any = false;
  for (const k of STAT_KEYS) {
    const v = (a[k] || 0) + (b[k] || 0);
    if (v !== 0) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
}

function statsSub(a, b) {
  if (!a) return null;
  if (!b) return { ...a };
  const out = {};
  let any = false;
  for (const k of STAT_KEYS) {
    const v = (a[k] || 0) - (b[k] || 0);
    if (v !== 0) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
}

function isMeaninglessSynergy(delta) {
  if (!delta) return true;
  let hasVisible = false;
  for (const [k, v] of Object.entries(delta)) {
    if (v === 0) continue;
    // For Speed (soku), values < 5 don't change the UI tier.
    if (k === "soku" && Math.abs(v) < 5) continue;
    hasVisible = true;
    break;
  }
  return !hasVisible;
}

// Pre-build slot objects
const slotInfos = mstSlotitems.map((si) => ({
  id: si.api_id,
  equipType: (si.api_type && si.api_type[2]) || 0,
}));
const slotById = {};
for (const s of slotInfos) slotById[s.id] = s;

function makeSlot(id, level) {
  const s = slotById[id];
  return { mstID: id, equipType: s ? s.equipType : 0, level: level || 0 };
}

function makeShip(shipData) {
  return {
    mstID: shipData.api_id,
    yomi: shipData.api_yomi || "",
    shipTypeID: shipData.api_stype || 0,
    getClassType: () => shipData.api_ctype || 0,
  };
}

// ── Equip permission tables ────────────────────────────────────────
// Per ship-type: Set of equip types (api_type[2]) that can be used in normal slots
const stypeEquipTypeSet = {};
for (const st of masterData.api_mst_stype) {
  const allowed = new Set();
  for (const [etStr, v] of Object.entries(st.api_equip_type)) {
    if (v === 1) allowed.add(parseInt(etStr));
  }
  stypeEquipTypeSet[st.api_id] = allowed;
}

// Ship-specific equip overrides (additively grant permissions beyond stype)
const shipEquipOverrideMap = {};
for (const [shipIdStr, info] of Object.entries(
  masterData.api_mst_equip_ship || {},
)) {
  if (info.api_equip_type)
    shipEquipOverrideMap[parseInt(shipIdStr)] = info.api_equip_type;
}

// Equip types allowed in the reinforcement expansion slot (補強増設)
const exslotEquipTypes = new Set(
  (masterData.api_mst_equip_exslot || []).map(Number),
);

// Ship/stype/ctype-specific exslot exceptions
const exslotShipExcMap = {};
for (const [etStr, info] of Object.entries(
  masterData.api_mst_equip_exslot_ship || {},
)) {
  exslotShipExcMap[parseInt(etStr)] = info;
}

// Item equip type (api_type[2]) per item ID
const itemEquipType2 = {};
for (const si of mstSlotitems) {
  itemEquipType2[si.api_id] = (si.api_type && si.api_type[2]) || 0;
}

/**
 * Returns true if this ship can equip the given item in any slot
 * (normal slot via stype, exslot via api_mst_equip_exslot, or ship-specific override).
 */
function canEquipItem(shipId, stypeId, ctypeId, itemId) {
  const et2 = itemEquipType2[itemId];
  if (!et2) return false;
  // Normal slot via stype
  if (stypeEquipTypeSet[stypeId]?.has(et2)) return true;
  // Reinforcement expansion slot (exslot) – global types
  if (exslotEquipTypes.has(et2)) return true;
  // Exslot – ship/stype/ctype-specific exceptions
  const exc = exslotShipExcMap[et2];
  if (exc) {
    if (exc.api_ship_ids?.[shipId]) return true;
    if (exc.api_stypes?.[stypeId]) return true;
    if (exc.api_ctypes?.[ctypeId]) return true;
  }
  // Ship-specific override grants additional permission
  const ov = shipEquipOverrideMap[shipId];
  if (ov && et2 in ov) {
    const val = ov[et2];
    if (val === null) return true;
    if (Array.isArray(val) && val.includes(itemId)) return true;
  }
  return false;
}

// Pre-build equippable item list per ship (sorted ascending)
const equippableByShip = {};
for (const shipData of mstShips) {
  const sid = shipData.api_id;
  const stid = shipData.api_stype;
  const ctid = shipData.api_ctype || 0;
  const list = [];
  for (const si of slotInfos) {
    if (canEquipItem(sid, stid, ctid, si.id)) list.push(si.id);
  }
  equippableByShip[sid] = list;
}

// Effective slot count per ship: normal slots + 1 for expansion slot
const effectiveSlotsOf = {};
for (const shipData of mstShips) {
  effectiveSlotsOf[shipData.api_id] = (shipData.api_slot_num || 0) + 1;
}

// ── Combinatorial helpers ──────────────────────────────────────────

/** Binomial coefficient C(n, k). */
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

/**
 * For a synergyMap (Map<comboKey, Map<profileKey, {ships,synergy}>>) find
 * groups whose stored combos are exactly all C(pool, comboSize) combinations
 * of some item pool. Returns { shipId → [{pool: sortedItemIds}] } for groups
 * where pool.length > comboSize. Used to prune Phase 5/6 to known pools.
 */
function detectPoolsByShip(synergyMap, comboSize) {
  const groups = new Map();
  for (const [key, profileMap] of synergyMap) {
    const items = key.split(":").map(Number);
    for (const { ships, synergy } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const synSorted = Object.fromEntries(Object.entries(synergy).sort());
      const groupKey = shipsSorted.join(",") + "|" + JSON.stringify(synSorted);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          ships: shipsSorted,
          allItems: new Set(),
          count: 0,
        });
      }
      const g = groups.get(groupKey);
      for (const id of items) g.allItems.add(id);
      g.count++;
    }
  }
  const byShip = {};
  for (const { ships, allItems, count } of groups.values()) {
    const pool = [...allItems].sort((a, b) => a - b);
    if (pool.length <= comboSize) continue;
    if (choose(pool.length, comboSize) !== count) continue;
    for (const shipId of ships) {
      if (!byShip[shipId]) byShip[shipId] = [];
      byShip[shipId].push({ pool });
    }
  }
  return byShip;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Single-item scan
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 1] Single-item scan ...");
const t0 = Date.now();

// singleBonus[shipId][itemId] = stats at ★0×1
const singleBonus = {};
// Results: Map<slotId, Map<profileKey, { ships: [], profile }>>
const equipResults = new Map();
let nonZeroCount = 0;

for (let si = 0; si < mstShips.length; si++) {
  const shipData = mstShips[si];
  const ship = makeShip(shipData);
  const shipId = shipData.api_id;

  for (let ei = 0; ei < slotInfos.length; ei++) {
    const slot = slotInfos[ei];
    if (
      !canEquipItem(
        shipId,
        shipData.api_stype,
        shipData.api_ctype || 0,
        slot.id,
      )
    )
      continue;

    // ★0 ×1
    const r0 = SlotItemEffectUtil.getSlotitemEffect(ship, [
      makeSlot(slot.id, 0),
    ]);
    const b = extractNonZero(r0);
    if (!b) continue;

    // Record single bonus for phase 2
    if (!singleBonus[shipId]) singleBonus[shipId] = {};
    singleBonus[shipId][slot.id] = b;

    // ★1..★10 ×1 (discrete; no interpolation in consumer)
    const improvementTransitions = [];
    let prevLevelStats = b;
    for (let star = 1; star <= 10; star++) {
      const rStar = SlotItemEffectUtil.getSlotitemEffect(ship, [
        makeSlot(slot.id, star),
      ]);
      const sStar = extractNonZero(rStar);
      if (!statsEqual(prevLevelStats, sStar)) {
        improvementTransitions.push([star, sStar || {}]);
        prevLevelStats = sStar;
      }
    }

    // Backward-compact path: only ★10 differs -> keep legacy `l`.
    let l;
    let i;
    if(
      improvementTransitions.length === 1 &&
      improvementTransitions[0][0] === 10
    ) {
      const only = improvementTransitions[0][1];
      if (!statsEqual(b, only)) l = only;
    } else if (improvementTransitions.length > 0) {
      i = improvementTransitions;
    }

    // ★0 ×2
    const r2 = SlotItemEffectUtil.getSlotitemEffect(ship, [
      makeSlot(slot.id, 0),
      makeSlot(slot.id, 0),
    ]);
    const c2raw = extractNonZero(r2);
    let c2;
    if (c2raw) {
      const doubled = {};
      for (const k of STAT_KEYS) {
        const v = (b[k] || 0) * 2;
        if (v !== 0) doubled[k] = v;
      }
      if (!statsEqual(c2raw, doubled)) c2 = c2raw;
    }

    // ★0 ×3
    const r3 = SlotItemEffectUtil.getSlotitemEffect(ship, [
      makeSlot(slot.id, 0),
      makeSlot(slot.id, 0),
      makeSlot(slot.id, 0),
    ]);
    const c3raw = extractNonZero(r3);
    let c3;
    if (c3raw) {
      const tripled = {};
      for (const k of STAT_KEYS) {
        const v = (b[k] || 0) * 3;
        if (v !== 0) tripled[k] = v;
      }
      if (!statsEqual(c3raw, tripled)) c3 = c3raw;
    }

    const profile = { b };
    if (l) profile.l = l;
    if (i) profile.i = i;
    if (c2) profile.c2 = c2;
    if (c3) profile.c3 = c3;
    const pk = bkey(profile);

    if (!equipResults.has(slot.id)) equipResults.set(slot.id, new Map());
    const pm = equipResults.get(slot.id);
    if (!pm.has(pk)) pm.set(pk, { ships: [], profile });
    pm.get(pk).ships.push(shipId);
    nonZeroCount++;
  }

  if ((si + 1) % 1 === 0 || si === mstShips.length - 1) {
    const e = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${si + 1}/${mstShips.length} ships | ${nonZeroCount} bonuses | ${e}s`,
    );
  }
}
console.log("");
console.log(
  `[Phase 1] Done: ${nonZeroCount} bonuses in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Cross-item synergy scan
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 2] Cross-item synergy scan ...");
const t1 = Date.now();

// Collect items that have any bonus on any ship
const itemsWithBonus = new Set();
for (const shipBonuses of Object.values(singleBonus)) {
  for (const itemId of Object.keys(shipBonuses)) {
    itemsWithBonus.add(parseInt(itemId, 10));
  }
}
const bonusItemIds = [...itemsWithBonus].sort((a, b) => a - b);
console.log(`  Items with any bonus: ${bonusItemIds.length}`);

// Pre-build ship lookup map for fast access
const shipById = {};
for (const s of mstShips) shipById[s.api_id] = s;

// synergies: Map<"itemA:itemB", Map<profileKey, { ships: [], synergy }>>
const synergies = new Map();
let synergyCount = 0;
let pairsTested = 0;

for (let ai = 0; ai < bonusItemIds.length; ai++) {
  const itemA = bonusItemIds[ai];

  // Ships where itemA has a bonus
  const shipsForA = [];
  for (const [shipIdStr, bonuses] of Object.entries(singleBonus)) {
    if (bonuses[itemA]) shipsForA.push(parseInt(shipIdStr, 10));
  }
  if (shipsForA.length === 0) continue;

  // For each ship, only test items the ship can actually equip
  for (const shipId of shipsForA) {
    const shipData = shipById[shipId];
    if (!shipData) continue;
    const ship = makeShip(shipData);
    const equippable = equippableByShip[shipId] || [];

    for (const itemB of equippable) {
      if (itemB === itemA) continue; // same-item stacking handled in Phase 1
      pairsTested++;

      const combined = SlotItemEffectUtil.getSlotitemEffect(ship, [
        makeSlot(itemA, 0),
        makeSlot(itemB, 0),
      ]);
      const comb = extractNonZero(combined);

      // Expected = bonus(A alone) + bonus(B alone)
      const bonusA = singleBonus[shipId]?.[itemA] || null;
      const bonusB = singleBonus[shipId]?.[itemB] || null;
      const expected = statsAdd(bonusA, bonusB);

      if (statsEqual(comb, expected)) continue; // No synergy

      // Synergy detected!
      const synDelta = statsSub(comb, expected);
      if (!synDelta) continue;
      if (pruneInvisible && isMeaninglessSynergy(synDelta)) continue;

      const pairKey = `${Math.min(itemA, itemB)}:${Math.max(itemA, itemB)}`;
      const profileKey = bkey({
        a: Math.min(itemA, itemB),
        b: Math.max(itemA, itemB),
        d: synDelta,
      });

      if (!synergies.has(pairKey)) synergies.set(pairKey, new Map());
      const pm = synergies.get(pairKey);
      if (!pm.has(profileKey))
        pm.set(profileKey, {
          ships: [],
          synergy: synDelta,
          items: [Math.min(itemA, itemB), Math.max(itemA, itemB)],
        });
      const entry = pm.get(profileKey);
      if (!entry.ships.includes(shipId)) {
        entry.ships.push(shipId);
        synergyCount++;
      }
    }
  }

  if ((ai + 1) % 1 === 0 || ai === bonusItemIds.length - 1) {
    const e = ((Date.now() - t1) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${ai + 1}/${bonusItemIds.length} trigger items | ${synergyCount} synergies | ${pairsTested} tests | ${e}s`,
    );
  }
}
console.log("");
console.log(
  `[Phase 2] Done: ${synergyCount} synergies from ${synergies.size} pairs in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Triple cross-item synergy scan
//   For each ship, test all triples (A, B, C) of synergy-participating items.
//   Compute the residual delta not explained by individual bonuses and
//   pairwise synergies. A non-zero residual means the same execFunc is
//   triggered by multiple pairs and the triple correction prevents
//   double-counting (hence negative values are expected and correct).
//
//   Why negative triple deltas?
//   If execFunc F fires for A+B (+1) and also A+C (+1), but only once per
//   getSlotitemEffect call, then combined(A,B,C)=+1 instead of +2.
//   triple_delta = 1 - 0 - 0 - 0 - 1 - 1 - 0 = -1  (necessary correction)
//
//   Pruning: test triples where items have individual bonuses OR participate
//   in pair synergies on the same ship.
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 3] Triple cross-item synergy scan ...");
const t3 = Date.now();
let tripleCount = 0;
let triplesTested = 0;

// synergyItemsByShip[shipId] = sorted array of item IDs that participate in
// any synergy (individual bonus OR pair synergy) on that ship.
// This is broader than just Phase 1 items to catch items that have no solo
// bonus but do participate in pair synergies (e.g. the "B" in A+B->bonus
// where B alone gives nothing but the pair fires an execFunc).
const bonusItemsByShip = {};
for (const [itemId, profileMap] of equipResults) {
  for (const { ships } of profileMap.values()) {
    for (const shipId of ships) {
      if (!bonusItemsByShip[shipId]) bonusItemsByShip[shipId] = [];
      if (!bonusItemsByShip[shipId].includes(itemId)) {
        bonusItemsByShip[shipId].push(itemId);
      }
    }
  }
}
// Also include items that only appear in pair synergies (no individual bonus).
for (const [, profileMap] of synergies) {
  for (const { ships, items } of profileMap.values()) {
    for (const shipId of ships) {
      if (!bonusItemsByShip[shipId]) bonusItemsByShip[shipId] = [];
      for (const itemId of items) {
        if (!bonusItemsByShip[shipId].includes(itemId)) {
          bonusItemsByShip[shipId].push(itemId);
        }
      }
    }
  }
}
for (const items of Object.values(bonusItemsByShip)) {
  items.sort((a, b) => a - b);
}

// pairByShipKey[shipId]["a:b"] = synergy stats (from Phase 2)
const pairByShipKey = {};
for (const [pairKey, profileMap] of synergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      if (!pairByShipKey[shipId]) pairByShipKey[shipId] = {};
      pairByShipKey[shipId][pairKey] = synergy;
    }
  }
}

// Triple synergy storage: Map<tripleKey, Map<profileKey, {ships, synergy, items}>>
const tripleSynergies = new Map();

const shipIdsWithBonuses = Object.keys(bonusItemsByShip)
  .map(Number)
  .sort((a, b) => a - b);
const { getSlotitemEffect } = SlotItemEffectUtil;

for (let si = 0; si < shipIdsWithBonuses.length; si++) {
  const shipId = shipIdsWithBonuses[si];
  const bItems = bonusItemsByShip[shipId]; // sorted
  if (bItems.length < 3) continue;
  if (effectiveSlotsOf[shipId] < 3) continue;

  const shipData = shipById[shipId];
  if (!shipData) continue;
  const ship = makeShip(shipData);

  // Precompute single-item results for all bonus items on this ship
  const aloneResults = {};
  for (const itemId of bItems) {
    aloneResults[itemId] = extractNonZero(
      getSlotitemEffect(ship, [makeSlot(itemId, 0)]),
    );
  }

  for (let ai = 0; ai < bItems.length - 2; ai++) {
    const itemA = bItems[ai];
    const aloneA = aloneResults[itemA];

    for (let bi = ai + 1; bi < bItems.length - 1; bi++) {
      const itemB = bItems[bi];
      const aloneB = aloneResults[itemB];
      const abKey = `${itemA}:${itemB}`; // guaranteed a < b
      const delta2AB = pairByShipKey[shipId]?.[abKey] ?? null;

      for (let ci = bi + 1; ci < bItems.length; ci++) {
        const itemC = bItems[ci];
        const aloneC = aloneResults[itemC];
        triplesTested++;

        const acKey = `${itemA}:${itemC}`; // guaranteed a < c
        const bcKey = `${itemB}:${itemC}`; // guaranteed b < c
        const delta2AC = pairByShipKey[shipId]?.[acKey] ?? null;
        const delta2BC = pairByShipKey[shipId]?.[bcKey] ?? null;

        // Test all 3 items together
        const combined = extractNonZero(
          getSlotitemEffect(ship, [
            makeSlot(itemA, 0),
            makeSlot(itemB, 0),
            makeSlot(itemC, 0),
          ]),
        );

        // Expected = aloneA + aloneB + aloneC + delta2(A,B) + delta2(A,C) + delta2(B,C)
        let expected = statsAdd(aloneA, aloneB);
        expected = statsAdd(expected, aloneC);
        if (delta2AB) expected = statsAdd(expected, delta2AB);
        if (delta2AC) expected = statsAdd(expected, delta2AC);
        if (delta2BC) expected = statsAdd(expected, delta2BC);

        // Residual = combined - expected (true 3-item exclusive bonus)
        const residual = statsSub(combined, expected);
        if (!residual) continue;
        if (pruneInvisible && isMeaninglessSynergy(residual)) continue;

        let isCancel = false;
        const invA = statsSub(null, aloneA);
        const invB = statsSub(null, aloneB);
        const invC = statsSub(null, aloneC);
        if (statsEqual(residual, invA) || statsEqual(residual, invB) || statsEqual(residual, invC)) {
          isCancel = true;
        }

        tripleCount++;
        const tripleKey = `${itemA}:${itemB}:${itemC}`; // a < b < c
        const profileKey = bkey(residual) + (isCancel ? "|C" : "");

        if (!tripleSynergies.has(tripleKey))
          tripleSynergies.set(tripleKey, new Map());
        const pm = tripleSynergies.get(tripleKey);
        if (!pm.has(profileKey)) {
          pm.set(profileKey, {
            ships: [],
            items: [itemA, itemB, itemC],
            synergy: residual,
            cancels_single: isCancel,
          });
        }
        const entry = pm.get(profileKey);
        if (!entry.ships.includes(shipId)) entry.ships.push(shipId);
      }
    }
  }

  if ((si + 1) % 1 === 0 || si === shipIdsWithBonuses.length - 1) {
    const e = ((Date.now() - t3) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${si + 1}/${shipIdsWithBonuses.length} ships | ${tripleCount} synergies | ${triplesTested} tests | ${e}s`,
    );
  }
}
console.log("");
console.log(
  `[Phase 3] Done: ${tripleCount} triple synergies from ${tripleSynergies.size} triples in ${((Date.now() - t3) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Quad cross-item correction scan
//   For each ship with ≥4 synergy items, test all quadruples (A, B, C, D).
//   Computes the residual not explained by singles + pair_deltas + triple_corrections.
//   This handles the case where the same execFunc fires for 3+ different items
//   (e.g. "ship X with any of radar-A, radar-B, radar-C, radar-D: +bonus"),
//   causing triple corrections to themselves be over-counted without a quad fix.
//
//   Pruning: only test quadruples where at least one sub-triple has a
//   non-zero triple correction (cheapest indicator that a quad may matter).
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 4] Quad cross-item correction scan ...");
const t4 = Date.now();
let quadCount = 0;
let quadsTested = 0;

// Build triple-correction lookup by ship: tripleByShipKey[shipId]["a:b:c"] = stats
const tripleByShipKey = {};
for (const [tripleKey, profileMap] of tripleSynergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      if (!tripleByShipKey[shipId]) tripleByShipKey[shipId] = {};
      tripleByShipKey[shipId][tripleKey] = synergy;
    }
  }
}

// Quad correction storage: Map<quadKey, Map<profileKey, {ships, synergy, items}>>
const quadSynergies = new Map();

for (let si = 0; si < shipIdsWithBonuses.length; si++) {
  const shipId = shipIdsWithBonuses[si];
  const bItems = bonusItemsByShip[shipId]; // sorted
  if (bItems.length < 4) continue;
  if (effectiveSlotsOf[shipId] < 4) continue;
  if (!tripleByShipKey[shipId]) continue; // skip: no triple corrections on this ship

  const shipData = shipById[shipId];
  if (!shipData) continue;
  const ship = makeShip(shipData);

  // Lazily compute single results
  const aloneResults = {};
  const getAlone = (id) => {
    if (!(id in aloneResults)) {
      aloneResults[id] = extractNonZero(
        getSlotitemEffect(ship, [makeSlot(id, 0)]),
      );
    }
    return aloneResults[id];
  };

  const tMap = tripleByShipKey[shipId];
  const pMap = pairByShipKey[shipId] || {};

  for (let ai = 0; ai < bItems.length - 3; ai++) {
    const A = bItems[ai];
    for (let bi = ai + 1; bi < bItems.length - 2; bi++) {
      const B = bItems[bi];
      for (let ci = bi + 1; ci < bItems.length - 1; ci++) {
        const C = bItems[ci];
        for (let di = ci + 1; di < bItems.length; di++) {
          const D = bItems[di];

          // Pruning: at least one sub-triple must have a non-zero correction
          const tABC = tMap[`${A}:${B}:${C}`] ?? null;
          const tABD = tMap[`${A}:${B}:${D}`] ?? null;
          const tACD = tMap[`${A}:${C}:${D}`] ?? null;
          const tBCD = tMap[`${B}:${C}:${D}`] ?? null;
          if (!tABC && !tABD && !tACD && !tBCD) continue;

          quadsTested++;

          const combined = extractNonZero(
            getSlotitemEffect(ship, [
              makeSlot(A, 0),
              makeSlot(B, 0),
              makeSlot(C, 0),
              makeSlot(D, 0),
            ]),
          );

          // Expected = singles + pair_deltas + triple_corrections
          let expected = statsAdd(getAlone(A), getAlone(B));
          expected = statsAdd(expected, getAlone(C));
          expected = statsAdd(expected, getAlone(D));

          // 6 pairs
          for (const [x, y] of [
            [A, B],
            [A, C],
            [A, D],
            [B, C],
            [B, D],
            [C, D],
          ]) {
            const d = pMap[`${x}:${y}`];
            if (d) expected = statsAdd(expected, d);
          }
          // 4 triple corrections
          if (tABC) expected = statsAdd(expected, tABC);
          if (tABD) expected = statsAdd(expected, tABD);
          if (tACD) expected = statsAdd(expected, tACD);
          if (tBCD) expected = statsAdd(expected, tBCD);

          const residual = statsSub(combined, expected);
          if (!residual) continue;
          if (pruneInvisible && isMeaninglessSynergy(residual)) continue;

          quadCount++;
          const quadKey = `${A}:${B}:${C}:${D}`;
          const profileKey = bkey(residual);

          if (!quadSynergies.has(quadKey))
            quadSynergies.set(quadKey, new Map());
          const pm2 = quadSynergies.get(quadKey);
          if (!pm2.has(profileKey)) {
            pm2.set(profileKey, {
              ships: [],
              items: [A, B, C, D],
              synergy: residual,
            });
          }
          const entry = pm2.get(profileKey);
          if (!entry.ships.includes(shipId)) entry.ships.push(shipId);
        }
      }
    }
  }

  if ((si + 1) % 1 === 0 || si === shipIdsWithBonuses.length - 1) {
    const e = ((Date.now() - t4) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${si + 1}/${shipIdsWithBonuses.length} ships | ${quadCount} corrections | ${quadsTested} tests | ${e}s`,
    );
  }
}
console.log("");
console.log(
  `[Phase 4] Done: ${quadCount} quad corrections from ${quadSynergies.size} quads in ${((Date.now() - t4) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Phase 5: Penta cross-item correction scan
//   Uses item pools detected from Phase 4 quad rules.
//   Only tests quintuples within known pools (pool.length >= 5).
//   Ships need effectiveSlotsOf >= 5.
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 5] Penta cross-item correction scan ...");
const t5 = Date.now();
let pentaCount = 0;
let pentasTested = 0;

// Build quad correction lookup by ship: quadByShipKey[shipId]["a:b:c:d"] = stats
const quadByShipKey = {};
for (const [quadKey, profileMap] of quadSynergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      if (!quadByShipKey[shipId]) quadByShipKey[shipId] = {};
      quadByShipKey[shipId][quadKey] = synergy;
    }
  }
}

const quadPoolsByShip = detectPoolsByShip(quadSynergies, 4);
const shipIdsForPenta = Object.keys(quadPoolsByShip)
  .map(Number)
  .filter((sid) => effectiveSlotsOf[sid] >= 5)
  .sort((a, b) => a - b);

const pentaSynergies = new Map();

for (let si = 0; si < shipIdsForPenta.length; si++) {
  const shipId = shipIdsForPenta[si];
  const pools = quadPoolsByShip[shipId];
  const shipData = shipById[shipId];
  if (!shipData) continue;
  const ship = makeShip(shipData);

  const aloneResults = {};
  const getAlone5 = (id) => {
    if (!(id in aloneResults))
      aloneResults[id] = extractNonZero(
        getSlotitemEffect(ship, [makeSlot(id, 0)]),
      );
    return aloneResults[id];
  };
  const pMap5 = pairByShipKey[shipId] || {};
  const tMap5 = tripleByShipKey[shipId] || {};
  const qMap5 = quadByShipKey[shipId] || {};

  for (const { pool } of pools) {
    for (let ai = 0; ai < pool.length - 4; ai++) {
      const A = pool[ai];
      for (let bi = ai + 1; bi < pool.length - 3; bi++) {
        const B = pool[bi];
        for (let ci = bi + 1; ci < pool.length - 2; ci++) {
          const C = pool[ci];
          for (let di = ci + 1; di < pool.length - 1; di++) {
            const D = pool[di];
            for (let ei = di + 1; ei < pool.length; ei++) {
              const E = pool[ei];
              if (
                !qMap5[`${A}:${B}:${C}:${D}`] &&
                !qMap5[`${A}:${B}:${C}:${E}`] &&
                !qMap5[`${A}:${B}:${D}:${E}`] &&
                !qMap5[`${A}:${C}:${D}:${E}`] &&
                !qMap5[`${B}:${C}:${D}:${E}`]
              )
                continue;
              pentasTested++;
              const combined = extractNonZero(
                getSlotitemEffect(ship, [
                  makeSlot(A, 0),
                  makeSlot(B, 0),
                  makeSlot(C, 0),
                  makeSlot(D, 0),
                  makeSlot(E, 0),
                ]),
              );
              let expected = statsAdd(getAlone5(A), getAlone5(B));
              expected = statsAdd(expected, getAlone5(C));
              expected = statsAdd(expected, getAlone5(D));
              expected = statsAdd(expected, getAlone5(E));
              for (const [x, y] of [
                [A, B],
                [A, C],
                [A, D],
                [A, E],
                [B, C],
                [B, D],
                [B, E],
                [C, D],
                [C, E],
                [D, E],
              ]) {
                const d = pMap5[`${x}:${y}`];
                if (d) expected = statsAdd(expected, d);
              }
              for (const [x, y, z] of [
                [A, B, C],
                [A, B, D],
                [A, B, E],
                [A, C, D],
                [A, C, E],
                [A, D, E],
                [B, C, D],
                [B, C, E],
                [B, D, E],
                [C, D, E],
              ]) {
                const d = tMap5[`${x}:${y}:${z}`];
                if (d) expected = statsAdd(expected, d);
              }
              for (const k of [
                `${A}:${B}:${C}:${D}`,
                `${A}:${B}:${C}:${E}`,
                `${A}:${B}:${D}:${E}`,
                `${A}:${C}:${D}:${E}`,
                `${B}:${C}:${D}:${E}`,
              ]) {
                const d = qMap5[k];
                if (d) expected = statsAdd(expected, d);
              }
              const residual = statsSub(combined, expected);
              if (!residual) continue;
              if (pruneInvisible && isMeaninglessSynergy(residual)) continue;
              pentaCount++;
              const pentaKey = `${A}:${B}:${C}:${D}:${E}`;
              const profileKey5 = bkey(residual);
              if (!pentaSynergies.has(pentaKey))
                pentaSynergies.set(pentaKey, new Map());
              const pm5 = pentaSynergies.get(pentaKey);
              if (!pm5.has(profileKey5))
                pm5.set(profileKey5, {
                  ships: [],
                  items: [A, B, C, D, E],
                  synergy: residual,
                });
              const entry5 = pm5.get(profileKey5);
              if (!entry5.ships.includes(shipId)) entry5.ships.push(shipId);
            }
          }
        }
      }
    }
  }
  if ((si + 1) % 1 === 0 || si === shipIdsForPenta.length - 1) {
    const e = ((Date.now() - t5) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${si + 1}/${shipIdsForPenta.length} ships | ${pentaCount} corrections | ${pentasTested} tests | ${e}s`,
    );
  }
}
console.log("");
console.log(
  `[Phase 5] Done: ${pentaCount} penta corrections from ${pentaSynergies.size} pentas in ${((Date.now() - t5) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Phase 6: Hexa cross-item correction scan
//   Uses item pools detected from Phase 5 penta rules.
//   Only tests sextuples within known pools (pool.length >= 6).
//   Ships need effectiveSlotsOf >= 6.
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 6] Hexa cross-item correction scan ...");
const t6 = Date.now();
let hexaCount = 0;
let hexasTested = 0;

const pentaByShipKey = {};
for (const [pentaKey, profileMap] of pentaSynergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      if (!pentaByShipKey[shipId]) pentaByShipKey[shipId] = {};
      pentaByShipKey[shipId][pentaKey] = synergy;
    }
  }
}

const pentaPoolsByShip = detectPoolsByShip(pentaSynergies, 5);
const shipIdsForHexa = Object.keys(pentaPoolsByShip)
  .map(Number)
  .filter((sid) => effectiveSlotsOf[sid] >= 6)
  .sort((a, b) => a - b);

const hexaSynergies = new Map();

for (let si = 0; si < shipIdsForHexa.length; si++) {
  const shipId = shipIdsForHexa[si];
  const pools = pentaPoolsByShip[shipId];
  const shipData = shipById[shipId];
  if (!shipData) continue;
  const ship = makeShip(shipData);

  const aloneResults = {};
  const getAlone6 = (id) => {
    if (!(id in aloneResults))
      aloneResults[id] = extractNonZero(
        getSlotitemEffect(ship, [makeSlot(id, 0)]),
      );
    return aloneResults[id];
  };
  const pMap6 = pairByShipKey[shipId] || {};
  const tMap6 = tripleByShipKey[shipId] || {};
  const qMap6 = quadByShipKey[shipId] || {};
  const p5Map6 = pentaByShipKey[shipId] || {};

  for (const { pool } of pools) {
    for (let ai = 0; ai < pool.length - 5; ai++) {
      const A = pool[ai];
      for (let bi = ai + 1; bi < pool.length - 4; bi++) {
        const B = pool[bi];
        for (let ci = bi + 1; ci < pool.length - 3; ci++) {
          const C = pool[ci];
          for (let di = ci + 1; di < pool.length - 2; di++) {
            const D = pool[di];
            for (let ei = di + 1; ei < pool.length - 1; ei++) {
              const E = pool[ei];
              for (let fi = ei + 1; fi < pool.length; fi++) {
                const F = pool[fi];
                if (
                  !p5Map6[`${A}:${B}:${C}:${D}:${E}`] &&
                  !p5Map6[`${A}:${B}:${C}:${D}:${F}`] &&
                  !p5Map6[`${A}:${B}:${C}:${E}:${F}`] &&
                  !p5Map6[`${A}:${B}:${D}:${E}:${F}`] &&
                  !p5Map6[`${A}:${C}:${D}:${E}:${F}`] &&
                  !p5Map6[`${B}:${C}:${D}:${E}:${F}`]
                )
                  continue;
                hexasTested++;
                const combined = extractNonZero(
                  getSlotitemEffect(ship, [
                    makeSlot(A, 0),
                    makeSlot(B, 0),
                    makeSlot(C, 0),
                    makeSlot(D, 0),
                    makeSlot(E, 0),
                    makeSlot(F, 0),
                  ]),
                );
                let expected = statsAdd(getAlone6(A), getAlone6(B));
                expected = statsAdd(expected, getAlone6(C));
                expected = statsAdd(expected, getAlone6(D));
                expected = statsAdd(expected, getAlone6(E));
                expected = statsAdd(expected, getAlone6(F));
                for (const [x, y] of [
                  [A, B],
                  [A, C],
                  [A, D],
                  [A, E],
                  [A, F],
                  [B, C],
                  [B, D],
                  [B, E],
                  [B, F],
                  [C, D],
                  [C, E],
                  [C, F],
                  [D, E],
                  [D, F],
                  [E, F],
                ]) {
                  const d = pMap6[`${x}:${y}`];
                  if (d) expected = statsAdd(expected, d);
                }
                for (const [x, y, z] of [
                  [A, B, C],
                  [A, B, D],
                  [A, B, E],
                  [A, B, F],
                  [A, C, D],
                  [A, C, E],
                  [A, C, F],
                  [A, D, E],
                  [A, D, F],
                  [A, E, F],
                  [B, C, D],
                  [B, C, E],
                  [B, C, F],
                  [B, D, E],
                  [B, D, F],
                  [B, E, F],
                  [C, D, E],
                  [C, D, F],
                  [C, E, F],
                  [D, E, F],
                ]) {
                  const d = tMap6[`${x}:${y}:${z}`];
                  if (d) expected = statsAdd(expected, d);
                }
                for (const k of [
                  `${A}:${B}:${C}:${D}`,
                  `${A}:${B}:${C}:${E}`,
                  `${A}:${B}:${C}:${F}`,
                  `${A}:${B}:${D}:${E}`,
                  `${A}:${B}:${D}:${F}`,
                  `${A}:${B}:${E}:${F}`,
                  `${A}:${C}:${D}:${E}`,
                  `${A}:${C}:${D}:${F}`,
                  `${A}:${C}:${E}:${F}`,
                  `${A}:${D}:${E}:${F}`,
                  `${B}:${C}:${D}:${E}`,
                  `${B}:${C}:${D}:${F}`,
                  `${B}:${C}:${E}:${F}`,
                  `${B}:${D}:${E}:${F}`,
                  `${C}:${D}:${E}:${F}`,
                ]) {
                  const d = qMap6[k];
                  if (d) expected = statsAdd(expected, d);
                }
                for (const k of [
                  `${A}:${B}:${C}:${D}:${E}`,
                  `${A}:${B}:${C}:${D}:${F}`,
                  `${A}:${B}:${C}:${E}:${F}`,
                  `${A}:${B}:${D}:${E}:${F}`,
                  `${A}:${C}:${D}:${E}:${F}`,
                  `${B}:${C}:${D}:${E}:${F}`,
                ]) {
                  const d = p5Map6[k];
                  if (d) expected = statsAdd(expected, d);
                }
                const residual = statsSub(combined, expected);
                if (!residual) continue;
                if (pruneInvisible && isMeaninglessSynergy(residual)) continue;
                hexaCount++;
                const hexaKey = `${A}:${B}:${C}:${D}:${E}:${F}`;
                const profileKey6 = bkey(residual);
                if (!hexaSynergies.has(hexaKey))
                  hexaSynergies.set(hexaKey, new Map());
                const pm6 = hexaSynergies.get(hexaKey);
                if (!pm6.has(profileKey6))
                  pm6.set(profileKey6, {
                    ships: [],
                    items: [A, B, C, D, E, F],
                    synergy: residual,
                  });
                const entry6 = pm6.get(profileKey6);
                if (!entry6.ships.includes(shipId)) entry6.ships.push(shipId);
              }
            }
          }
        }
      }
    }
  }
  if ((si + 1) % 1 === 0 || si === shipIdsForHexa.length - 1) {
    const e = ((Date.now() - t6) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${si + 1}/${shipIdsForHexa.length} ships | ${hexaCount} corrections | ${hexasTested} tests | ${e}s`,
    );
  }
}
console.log("");
console.log(
  `[Phase 6] Done: ${hexaCount} hexa corrections from ${hexaSynergies.size} hexas in ${((Date.now() - t6) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Build output
// ═══════════════════════════════════════════════════════════════════
console.log("\n[output] Building ...");

const previewNameManifest = {
  _meta: {
    generated: deterministic
      ? "1970-01-01T00:00:00.000Z"
      : new Date().toISOString(),
    deterministic,
    source: path.basename(useMain ? "main.js" : "output/deobfuscated.js"),
    total_ships: mstShips.length,
    total_items: mstSlotitems.length,
  },
  ships: Object.fromEntries(
    mstShips
      .map((ship) => [String(ship.api_id), ship.api_name])
      .filter(([, name]) => typeof name === "string" && name.length > 0),
  ),
  items: Object.fromEntries(
    mstSlotitems
      .map((item) => [String(item.api_id), item.api_name])
      .filter(([, name]) => typeof name === "string" && name.length > 0),
  ),
};

// ── Compressed output builders ─────────────────────────────────────

/**
 * Groups single-item bonuses by (ships_array, bonus_profile) across all items.
 * Returns array of { ships, b, l?, i?, c2?, c3?, items: [itemId...] }.
 */
function buildEffectRules(equipResultsMap) {
  const rulesMap = new Map();
  for (const [itemId, profileMap] of equipResultsMap) {
    for (const { ships, profile } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const profNorm = {
        b: Object.fromEntries(Object.entries(profile.b).sort()),
      };
      if (profile.l)
        profNorm.l = Object.fromEntries(Object.entries(profile.l).sort());
      if (profile.i) {
        profNorm.i = profile.i.map(([lv, stats]) => [
          lv,
          Object.fromEntries(Object.entries(stats).sort()),
        ]);
      }
      if (profile.c2)
        profNorm.c2 = Object.fromEntries(Object.entries(profile.c2).sort());
      if (profile.c3)
        profNorm.c3 = Object.fromEntries(Object.entries(profile.c3).sort());
      const groupKey = shipsSorted.join(",") + "|" + JSON.stringify(profNorm);
      if (!rulesMap.has(groupKey)) {
        rulesMap.set(groupKey, { ships: shipsSorted, ...profNorm, items: [] });
      }
      rulesMap.get(groupKey).items.push(itemId);
    }
  }
  const rules = [...rulesMap.values()];
  for (const rule of rules) rule.items.sort((a, b) => a - b);
  rules.sort((a, b) => a.ships[0] - b.ships[0]);
  return rules;
}

/**
 * Groups pair synergies by (ships_array, synergy) across all pairs.
 * Returns array of { ships, synergy, pairs: [[a,b], ...] }.
 */
function buildCrossRules(synergiesMap) {
  const rulesMap = new Map();
  for (const [pairKey, profileMap] of synergiesMap) {
    const [aStr, bStr] = pairKey.split(":");
    const pair = [parseInt(aStr), parseInt(bStr)]; // a < b guaranteed
    for (const { ships, synergy } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const synSorted = Object.fromEntries(Object.entries(synergy).sort());
      const groupKey = shipsSorted.join(",") + "|" + JSON.stringify(synSorted);
      if (!rulesMap.has(groupKey)) {
        rulesMap.set(groupKey, {
          ships: shipsSorted,
          synergy: synSorted,
          pairs: [],
        });
      }
      rulesMap.get(groupKey).pairs.push(pair);
    }
  }
  const rules = [...rulesMap.values()];
  for (const rule of rules) {
    const uniquePairs = new Map();
    for (const p of rule.pairs) {
      uniquePairs.set(`${p[0]}:${p[1]}`, p);
    }
    rule.pairs = [...uniquePairs.values()];
    rule.pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  rules.sort((a, b) => a.ships[0] - b.ships[0]);
  return rules;
}

/**
 * Groups triple/quad/penta/hexa synergies by (ships, synergy) then detects
 * when a group's combos are exactly all C(pool, comboSize) combinations (item_pool).
 * Stores item_pool instead of explicit combos when the pool is complete — up to
 * 1000× compression for large pools. Falls back to explicit combos otherwise.
 */
function buildRules(synergyMap, comboSize) {
  const rulesMap = new Map();
  for (const [key, profileMap] of synergyMap) {
    const items = key.split(":").map(Number);
    for (const { ships, synergy, cancels_single } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const synSorted = Object.fromEntries(Object.entries(synergy).sort());
      const groupKey = shipsSorted.join(",") + "|" + JSON.stringify(synSorted) + (cancels_single ? "|C" : "");
      if (!rulesMap.has(groupKey)) {
        rulesMap.set(groupKey, {
          ships: shipsSorted,
          synergy: synSorted,
          cancels_single,
          combos: [],
          _allItems: new Set(),
        });
      }
      const rule = rulesMap.get(groupKey);
      rule.combos.push(items);
      for (const id of items) rule._allItems.add(id);
    }
  }
  const rules = [...rulesMap.values()];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    process.stdout.write(`\r  [Building Size ${comboSize}] Group ${i + 1}/${rules.length}... `);
    rule.combos.sort((a, b) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return 0;
    });
    const pool = [...rule._allItems].sort((a, b) => a - b);
    delete rule._allItems;


    function findCategoryPools(combos, pool, comboSize) {
      if (combos.length === 0 || pool.length === 0) return null;
      const appearTogether = new Map();
      for (const id of pool) appearTogether.set(id, new Set());
      for (const combo of combos) {
        for (let i = 0; i < combo.length; i++) {
          for (let j = i + 1; j < combo.length; j++) {
            appearTogether.get(combo[i]).add(combo[j]);
            appearTogether.get(combo[j]).add(combo[i]);
          }
        }
      }
      const visited = new Set();
      const components = [];
      for (const id of pool) {
        if (visited.has(id)) continue;
        const comp = [];
        const queue = [id];
        visited.add(id);
        while (queue.length > 0) {
          const curr = queue.shift();
          comp.push(curr);
          for (const neighbor of pool) {
            if (curr === neighbor) continue;
            if (!visited.has(neighbor) && !appearTogether.get(curr).has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        comp.sort((a, b) => a - b);
        components.push(comp);
      }
      if (components.length !== comboSize) return null;
      for (const comp of components) {
        for (let i = 0; i < comp.length; i++) {
          for (let j = i + 1; j < comp.length; j++) {
            if (appearTogether.get(comp[i]).has(comp[j])) return null;
          }
        }
      }
      let expectedCombos = 1;
      for (const comp of components) expectedCombos *= comp.length;
      if (combos.length !== expectedCombos) return null;
      return components;
    }

    function findRepeatedCategoryPools(combos, pool, comboSize) {
      if (combos.length === 0 || pool.length === 0) return null;
      const freq = new Map();
      for (const combo of combos) {
        for (const id of combo) freq.set(id, (freq.get(id) || 0) + 1);
      }
      
      const byFreq = new Map();
      for (const [id, f] of freq) {
        if (!byFreq.has(f)) byFreq.set(f, []);
        byFreq.get(f).push(id);
      }
      
      const components = [];
      const counts = [];
      let expectedCombos = 1;
      let totalAssignedSize = 0;
      
      for (const [f, ids] of byFreq) {
        const poolSize = ids.length;
        // The frequency f of an item in a pool of size N that is picked K times out of M combinations is:
        // f = M * K / N. So K = f * N / M.
        const kFloat = (f * poolSize) / combos.length;
        const k = Math.round(kFloat);
        if (Math.abs(k - kFloat) > 0.0001) return null; // Not a perfect integer pick
        if (k === 0) return null;
        
        components.push(ids.sort((a,b)=>a-b));
        counts.push(k);
        totalAssignedSize += k;
        expectedCombos *= choose(poolSize, k);
      }
      
      if (totalAssignedSize !== comboSize) return null;
      if (expectedCombos !== combos.length) return null;
      
      // Verification: Check if every combo exactly satisfies the counts
      const compSets = components.map(c => new Set(c));
      for (const combo of combos) {
        const matchCounts = new Array(components.length).fill(0);
        for (const id of combo) {
          for (let i = 0; i < compSets.length; i++) {
            if (compSets[i].has(id)) {
              matchCounts[i]++;
              break;
            }
          }
        }
        for (let i = 0; i < components.length; i++) {
          if (matchCounts[i] !== counts[i]) return null;
        }
      }
      
      const result = [];
      for (let i = 0; i < components.length; i++) {
        for (let j = 0; j < counts[i]; j++) {
          result.push(components[i]);
        }
      }
      return result;
    }

    if (
      pool.length >= comboSize &&
      choose(pool.length, comboSize) === rule.combos.length
    ) {
      // All C(pool, comboSize) combinations: store pool only.
      rule.item_pool = pool;
      delete rule.combos;
    } else if (comboSize > 1 && rule.combos.length > 0) {
      // Try fixed-item encoding: items present in EVERY combo become fixed_items,
      // the remainder form free_pool. If C(free_pool, comboSize - k) == comboCount,
      // we can store just {fixed_items, free_pool} instead of explicit combo list.
      const comboCount = rule.combos.length;
      const freq = new Map();
      for (const combo of rule.combos)
        for (const id of combo) freq.set(id, (freq.get(id) || 0) + 1);
      const fixedItems = pool.filter((id) => freq.get(id) === comboCount);
      let usedFixed = false;
      if (fixedItems.length > 0 && fixedItems.length < comboSize) {
        const fixedSet = new Set(fixedItems);
        const freePool = pool.filter((id) => !fixedSet.has(id));
        const remainingSize = comboSize - fixedItems.length;
        if (choose(freePool.length, remainingSize) === comboCount) {
          rule.fixed_items = fixedItems;
          rule.free_pool = freePool;
          delete rule.combos;
          usedFixed = true;
        }
      }
      if (!usedFixed) {
        const catPools = findCategoryPools(rule.combos, pool, comboSize);
        if (catPools) {
          rule.category_pools = catPools;
          delete rule.combos;
        } else {
          const repPools = findRepeatedCategoryPools(rule.combos, pool, comboSize);
          if (repPools) {
            rule.category_pools = repPools;
            delete rule.combos;
          } else {
            const implicants = compressWithZDD(rule.combos);
            if (implicants) {
              rule.implicants = implicants;
              delete rule.combos;
            } else {
              // Fall back to compact base64 encoding.
              Object.assign(rule, encodeCombosB64(rule.combos, pool, comboSize));
              delete rule.combos;
            }
          }
        }
      }
    } else {
      const catPools = findCategoryPools(rule.combos, pool, comboSize);
      if (catPools) {
        rule.category_pools = catPools;
        delete rule.combos;
      } else {
        const repPools = findRepeatedCategoryPools(rule.combos, pool, comboSize);
        if (repPools) {
          rule.category_pools = repPools;
          delete rule.combos;
        } else {
          const implicants = findQuineMcCluskeyImplicants(rule.combos, rule.ships, comboSize);
          if (implicants) {
            rule.implicants = implicants;
            delete rule.combos;
          } else {
            // Compact encoding with dynamic index width (u8/u16/u32), then base64.
            Object.assign(rule, encodeCombosB64(rule.combos, pool, comboSize));
            delete rule.combos;
          }
        }
      }
    }
  }
  console.log(""); // newline after progress bar
  rules.sort((a, b) => a.ships[0] - b.ships[0]);
  return rules;
}

// Single-item effects grouped by (ships, profile) across items
const effectRules = buildEffectRules(equipResults);
// Cross-item synergies grouped by (ships, synergy) across pairs
const crossRules = buildCrossRules(synergies);
// Triple/quad/penta/hexa corrections with item_pool compression
const tripleRules = buildRules(tripleSynergies, 3);
const quadRules = buildRules(quadSynergies, 4);
const pentaRules = buildRules(pentaSynergies, 5);
const hexaRules = buildRules(hexaSynergies, 6);
const pkgVersion = (() => {
  try {
    return (
      "v" +
      JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"))
        .version
    );
  } catch {
    return "v0.0.0";
  }
})();

const output = {
  _meta: {
    generated: deterministic
      ? "1970-01-01T00:00:00.000Z"
      : new Date().toISOString(),
    generator_version: pkgVersion,
    api_start2_batch_hash: apiStart2BatchHash,
    period_tag: scanPeriodTag,
    deterministic,
    source: path.basename(useMain ? "main.js" : "output/deobfuscated.js"),
    total_ships: mstShips.length,
    total_items: mstSlotitems.length,
    total_single_bonuses: nonZeroCount,
    total_cross_synergies: synergyCount,
    total_triple_synergies: tripleCount,
    unique_items_with_bonus: equipResults.size,
    unique_synergy_pairs: synergies.size,
    unique_synergy_triples: tripleSynergies.size,
    total_quad_corrections: quadCount,
    unique_synergy_quads: quadSynergies.size,
    total_penta_corrections: pentaCount,
    unique_synergy_pentas: pentaSynergies.size,
    total_hexa_corrections: hexaCount,
    unique_synergy_hexas: hexaSynergies.size,
    effect_rule_count: effectRules.length,
    cross_rule_count: crossRules.length,
    triple_rule_count: tripleRules.length,
    quad_rule_count: quadRules.length,
    penta_rule_count: pentaRules.length,
    hexa_rule_count: hexaRules.length,
    stats: {
      houg: "火力",
      raig: "雷装",
      tyku: "対空",
      souk: "装甲",
      kaih: "回避",
      tais: "対潜",
      saku: "索敵",
      baku: "爆装",
      houm: "命中",
      leng: "射程",
    },
  },
  effect_rules: effectRules,
  cross_rules: crossRules,
  triple_rules: tripleRules,
  quad_rules: quadRules,
  penta_rules: pentaRules,
  hexa_rules: hexaRules,
};

const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const jsonOut = JSON.stringify(output);
fs.writeFileSync(outputPath, jsonOut, "utf-8");
const sizeKB = (Buffer.byteLength(jsonOut) / 1024).toFixed(1);
console.log(
  `[output] Saved: ${path.relative(ROOT, outputPath)} (${sizeKB} KB)`,
);

const brotliOut = zlib.brotliCompressSync(Buffer.from(jsonOut, "utf-8"), {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
  },
});
const brotliPath = `${outputPath}.br`;
fs.writeFileSync(brotliPath, brotliOut);
const brotliSizeKB = (brotliOut.byteLength / 1024).toFixed(1);
console.log(
  `[output] Saved: ${path.relative(ROOT, brotliPath)} (${brotliSizeKB} KB)`,
);

const previewManifestJson = JSON.stringify(previewNameManifest);
fs.writeFileSync(previewNameManifestPath, previewManifestJson, "utf-8");
const previewManifestSizeKB = (
  Buffer.byteLength(previewManifestJson) / 1024
).toFixed(1);
console.log(
  `[output] Saved: ${path.relative(ROOT, previewNameManifestPath)} (${previewManifestSizeKB} KB)`,
);
