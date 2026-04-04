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

const path = require('path');
const fs = require('fs');
const {
  ROOT, findMasterData, parseMasterData, buildMstDict, createGetMst, loadBundle
} = require('../lib/loader');

// ── Parse arguments ────────────────────────────────────────────────
const args = process.argv.slice(2);
const useMain = args.includes('--main');
const deterministic = !args.includes('--volatile-generated');
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx >= 0 && args[outputIdx + 1]
  ? path.resolve(args[outputIdx + 1])
  : path.join(ROOT, 'output', 'slot_item_effects.json');
const previewNameManifestPath = path.join(path.dirname(outputPath), 'preview_name_manifest.json');

// ── Load master data ───────────────────────────────────────────────
const masterPath = findMasterData();
if (!masterPath) {
  console.error('Error: No master data found in master_data/. Place an api_start2 response file there.');
  process.exit(1);
}
console.log(`[scan] Master data: ${path.relative(ROOT, masterPath)}`);

const masterData = parseMasterData(masterPath);
const mstShips = [...masterData.api_mst_ship].sort((a, b) => a.api_id - b.api_id);
const mstSlotitems = [...masterData.api_mst_slotitem].sort((a, b) => a.api_id - b.api_id);
console.log(`[scan] Ships: ${mstShips.length}, Items: ${mstSlotitems.length}`);

// ── Build mstDict and load bundle ──────────────────────────────────
const mstDict = buildMstDict(mstSlotitems);
const getMst = createGetMst(mstDict);
const { kcsRequire } = loadBundle({ useMain, getMst, silent: false });
const { SlotItemEffectUtil } = kcsRequire(82692);

// ── Helpers ────────────────────────────────────────────────────────
const STAT_KEYS = ['houg', 'raig', 'tyku', 'souk', 'kaih', 'tais', 'saku', 'baku', 'houm', 'leng'];

function extractNonZero(result) {
  if (!result) return null;
  const obj = {};
  let any = false;
  for (const k of STAT_KEYS) {
    const v = result[k];
    if (v !== 0) { obj[k] = v; any = true; }
  }
  return any ? obj : null;
}

function bkey(obj) { return obj ? JSON.stringify(obj) : ''; }

function statsEqual(a, b) { return bkey(a) === bkey(b); }

function statsAdd(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const out = {};
  let any = false;
  for (const k of STAT_KEYS) {
    const v = (a[k] || 0) + (b[k] || 0);
    if (v !== 0) { out[k] = v; any = true; }
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
    if (v !== 0) { out[k] = v; any = true; }
  }
  return any ? out : null;
}

// Pre-build slot objects
const slotInfos = mstSlotitems.map(si => ({
  id: si.api_id,
  equipType: (si.api_type && si.api_type[2]) || 0
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
    yomi: shipData.api_yomi || '',
    shipTypeID: shipData.api_stype || 0,
    getClassType: () => shipData.api_ctype || 0
  };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Single-item scan
// ═══════════════════════════════════════════════════════════════════
console.log('\n[Phase 1] Single-item scan ...');
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

    // ★0 ×1
    const r0 = SlotItemEffectUtil.getSlotitemEffect(ship, [makeSlot(slot.id, 0)]);
    const b = extractNonZero(r0);
    if (!b) continue;

    // Record single bonus for phase 2
    if (!singleBonus[shipId]) singleBonus[shipId] = {};
    singleBonus[shipId][slot.id] = b;

    // ★10 ×1
    const r10 = SlotItemEffectUtil.getSlotitemEffect(ship, [makeSlot(slot.id, 10)]);
    const l10 = extractNonZero(r10);
    const l = (l10 && !statsEqual(b, l10)) ? l10 : undefined;

    // ★0 ×2
    const r2 = SlotItemEffectUtil.getSlotitemEffect(ship, [makeSlot(slot.id, 0), makeSlot(slot.id, 0)]);
    const c2raw = extractNonZero(r2);
    let c2;
    if (c2raw) {
      const doubled = {};
      for (const k of STAT_KEYS) { const v = (b[k] || 0) * 2; if (v !== 0) doubled[k] = v; }
      if (!statsEqual(c2raw, doubled)) c2 = c2raw;
    }

    // ★0 ×3
    const r3 = SlotItemEffectUtil.getSlotitemEffect(ship, [makeSlot(slot.id, 0), makeSlot(slot.id, 0), makeSlot(slot.id, 0)]);
    const c3raw = extractNonZero(r3);
    let c3;
    if (c3raw) {
      const tripled = {};
      for (const k of STAT_KEYS) { const v = (b[k] || 0) * 3; if (v !== 0) tripled[k] = v; }
      if (!statsEqual(c3raw, tripled)) c3 = c3raw;
    }

    const profile = { b };
    if (l) profile.l = l;
    if (c2) profile.c2 = c2;
    if (c3) profile.c3 = c3;
    const pk = bkey(profile);

    if (!equipResults.has(slot.id)) equipResults.set(slot.id, new Map());
    const pm = equipResults.get(slot.id);
    if (!pm.has(pk)) pm.set(pk, { ships: [], profile });
    pm.get(pk).ships.push(shipId);
    nonZeroCount++;
  }

  if ((si + 1) % 200 === 0 || si === mstShips.length - 1) {
    const e = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`\r  ${si + 1}/${mstShips.length} ships | ${nonZeroCount} bonuses | ${e}s`);
  }
}
console.log('');
console.log(`[Phase 1] Done: ${nonZeroCount} bonuses in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Cross-item synergy scan
// ═══════════════════════════════════════════════════════════════════
console.log('\n[Phase 2] Cross-item synergy scan ...');
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
const allItemIds = slotInfos.map(s => s.id).sort((a, b) => a - b);

for (let ai = 0; ai < bonusItemIds.length; ai++) {
  const itemA = bonusItemIds[ai];

  // Ships where itemA has a bonus
  const shipsForA = [];
  for (const [shipIdStr, bonuses] of Object.entries(singleBonus)) {
    if (bonuses[itemA]) shipsForA.push(parseInt(shipIdStr, 10));
  }
  if (shipsForA.length === 0) continue;

  for (let bi = 0; bi < allItemIds.length; bi++) {
    const itemB = allItemIds[bi];
    if (itemB === itemA) continue; // same-item stacking handled in Phase 1

    // Test the pair on all ships where itemA has a bonus
    for (const shipId of shipsForA) {
      pairsTested++;
      const shipData = shipById[shipId];
      if (!shipData) continue;
      const ship = makeShip(shipData);

      const combined = SlotItemEffectUtil.getSlotitemEffect(ship, [makeSlot(itemA, 0), makeSlot(itemB, 0)]);
      const comb = extractNonZero(combined);

      // Expected = bonus(A alone) + bonus(B alone)
      const bonusA = singleBonus[shipId]?.[itemA] || null;
      const bonusB = singleBonus[shipId]?.[itemB] || null;
      const expected = statsAdd(bonusA, bonusB);

      if (statsEqual(comb, expected)) continue; // No synergy

      // Synergy detected!
      const synDelta = statsSub(comb, expected);
      if (!synDelta) continue;

      const pairKey = `${Math.min(itemA, itemB)}:${Math.max(itemA, itemB)}`;
      const profileKey = bkey({ a: Math.min(itemA, itemB), b: Math.max(itemA, itemB), d: synDelta });

      if (!synergies.has(pairKey)) synergies.set(pairKey, new Map());
      const pm = synergies.get(pairKey);
      if (!pm.has(profileKey)) pm.set(profileKey, { ships: [], synergy: synDelta, items: [Math.min(itemA, itemB), Math.max(itemA, itemB)] });
      const entry = pm.get(profileKey);
      if (!entry.ships.includes(shipId)) {
        entry.ships.push(shipId);
        synergyCount++;
      }
    }
  }

  if ((ai + 1) % 10 === 0 || ai === bonusItemIds.length - 1) {
    const e = ((Date.now() - t1) / 1000).toFixed(1);
    process.stdout.write(`\r  ${ai + 1}/${bonusItemIds.length} trigger items | ${synergyCount} synergies | ${pairsTested} tests | ${e}s`);
  }
}
console.log('');
console.log(`[Phase 2] Done: ${synergyCount} synergies from ${synergies.size} pairs in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

// ═══════════════════════════════════════════════════════════════════
// Build output
// ═══════════════════════════════════════════════════════════════════
console.log('\n[output] Building ...');

// Collect referenced IDs
const refShipIds = new Set();
const refItemIds = new Set();
for (const [slotId, profileMap] of equipResults) {
  refItemIds.add(slotId);
  for (const { ships } of profileMap.values()) {
    for (const sid of ships) refShipIds.add(sid);
  }
}
for (const pm of synergies.values()) {
  for (const { ships, items } of pm.values()) {
    for (const sid of ships) refShipIds.add(sid);
    for (const id of items) refItemIds.add(id);
  }
}

// Ship lookup
const shipLookup = {};
for (const s of mstShips) {
  if (refShipIds.has(s.api_id)) {
    shipLookup[s.api_id] = { name: s.api_name, yomi: s.api_yomi, stype: s.api_stype, ctype: s.api_ctype };
  }
}

// Item lookup
const itemLookup = {};
for (const si of mstSlotitems) {
  if (refItemIds.has(si.api_id)) {
    itemLookup[si.api_id] = { name: si.api_name, type: si.api_type };
  }
}

const previewNameManifest = {
  _meta: {
    generated: deterministic ? '1970-01-01T00:00:00.000Z' : new Date().toISOString(),
    deterministic,
    source: path.basename(useMain ? 'main.js' : 'output/deobfuscated.js'),
    total_ships: mstShips.length,
    total_items: mstSlotitems.length
  },
  ships: Object.fromEntries(
    mstShips
      .map((ship) => [String(ship.api_id), ship.api_name])
      .filter(([, name]) => typeof name === 'string' && name.length > 0)
  ),
  items: Object.fromEntries(
    mstSlotitems
      .map((item) => [String(item.api_id), item.api_name])
      .filter(([, name]) => typeof name === 'string' && name.length > 0)
  )
};

// Single-item effects
const effects = {};
for (const [slotId, profileMap] of equipResults) {
  const entries = [];
  for (const { ships, profile } of profileMap.values()) {
    ships.sort((a, b) => a - b);
    const entry = { ships, b: profile.b };
    if (profile.l) entry.l = profile.l;
    if (profile.c2) entry.c2 = profile.c2;
    if (profile.c3) entry.c3 = profile.c3;
    entries.push(entry);
  }
  entries.sort((a, b) => a.ships[0] - b.ships[0]);
  effects[slotId] = entries;
}

// Cross-item synergies
const crossEffects = {};
for (const [pairKey, profileMap] of synergies) {
  const entries = [];
  for (const { ships, synergy, items } of profileMap.values()) {
    ships.sort((a, b) => a - b);
    entries.push({ ships, items, synergy });
  }
  entries.sort((a, b) => a.ships[0] - b.ships[0]);
  crossEffects[pairKey] = entries;
}

const output = {
  _meta: {
    generated: deterministic ? '1970-01-01T00:00:00.000Z' : new Date().toISOString(),
    deterministic,
    source: path.basename(useMain ? 'main.js' : 'output/deobfuscated.js'),
    total_ships: mstShips.length,
    total_items: mstSlotitems.length,
    total_single_bonuses: nonZeroCount,
    total_cross_synergies: synergyCount,
    unique_items_with_bonus: equipResults.size,
    unique_synergy_pairs: synergies.size,
    fields: {
      b: "bonus with 1× at ★0",
      l: "bonus with 1× at ★10 (only if differs from b)",
      c2: "bonus with 2× at ★0 (only if not exactly 2×b)",
      c3: "bonus with 3× at ★0 (only if not exactly 3×b)"
    },
    cross_fields: {
      items: "[itemA_id, itemB_id]",
      synergy: "additional bonus beyond sum of individual bonuses"
    },
    stats: {
      houg: "火力", raig: "雷装", tyku: "対空", souk: "装甲",
      kaih: "回避", tais: "対潜", saku: "索敵", baku: "爆装",
      houm: "命中", leng: "射程"
    }
  },
  _ships: shipLookup,
  _items: itemLookup,
  effects,
  cross_effects: crossEffects
};

const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const jsonOut = JSON.stringify(output);
fs.writeFileSync(outputPath, jsonOut, 'utf-8');
const sizeKB = (Buffer.byteLength(jsonOut) / 1024).toFixed(1);
console.log(`[output] Saved: ${path.relative(ROOT, outputPath)} (${sizeKB} KB)`);

const previewManifestJson = JSON.stringify(previewNameManifest);
fs.writeFileSync(previewNameManifestPath, previewManifestJson, 'utf-8');
const previewManifestSizeKB = (Buffer.byteLength(previewManifestJson) / 1024).toFixed(1);
console.log(`[output] Saved: ${path.relative(ROOT, previewNameManifestPath)} (${previewManifestSizeKB} KB)`);
