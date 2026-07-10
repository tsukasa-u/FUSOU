#!/usr/bin/env node
/**
 * Optimized equipment bonus scan.
 * 
 * Key optimizations over scan.js:
 *
 *  1. Ship deduplication by bonus profile:
 *     After Phase 1, ships with identical bonus profiles are grouped.
 *     Phases 2-6 run on representative ships only, then results are
 *     spread to the whole group — reducing API calls by up to 10x.
 *
 *  2. Global aloneCache:
 *     Avoids repeated getSlotitemEffect() calls for the same (ship, item)
 *     across phases.
 *
 *  3. Set-based lookups:
 *     All Array.includes() O(n) replaced with Set.has() O(1).
 *
 *  4. Phase 2 candidate pre-filtering:
 *     For each trigger item A, only ships where A has a bonus AND where at
 *     least one other bonus item exists are tested.
 *     Also limits itemB candidates to bonusItemIds (345) not all items (726).
 *
 *  5. Shared ship object pool:
 *     makeShip() results are cached per shipId to avoid repeated object creation.
 *
 * Usage:
 *   node scripts/scan-fast.js [--main] [--output <path>]
 *
 * Output: output/slot_item_effects.json  (same format as scan.js)
 */

const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { createHash } = require("crypto");
const { compressWithZDD } = require("../utils/zdd");
const {
  ROOT,
  findMasterData,
  parseMasterData,
  buildMstDict,
  createGetMst,
  loadBundle
} = require("../../lib/loader");

// Re-exec with a larger V8 heap unless already specified.
const maxOldSpaceFromEnv = Number.parseInt(
  process.env.SCAN_AST_MAX_OLD_SPACE_MB || "8192",
  10,
);
const hasMaxOldSpace = process.execArgv.some(
  (arg) =>
    arg === "--max-old-space-size" ||
    arg.startsWith("--max-old-space-size=") ||
    arg === "--max_old_space_size" ||
    arg.startsWith("--max_old_space_size="),
);
const hasMaxOldSpaceInNodeOptions = /(?:^|\s)--max(?:-|_)old(?:-|_)space(?:-|_)size(?:=|\s|$)/.test(
  process.env.NODE_OPTIONS || "",
);

if (
  !process.env.SCAN_AST_NO_REEXEC &&
  !hasMaxOldSpace &&
  !hasMaxOldSpaceInNodeOptions &&
  Number.isFinite(maxOldSpaceFromEnv) &&
  maxOldSpaceFromEnv > 0
) {
  console.log(
    `[scan] Re-executing with --max-old-space-size=${maxOldSpaceFromEnv} MB`,
  );
  const child = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      `--max-old-space-size=${maxOldSpaceFromEnv}`,
      __filename,
      ...process.argv.slice(2),
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, SCAN_AST_NO_REEXEC: "1" },
    },
  );
  process.exit(child.status ?? 1);
}

// ── Parse arguments ────────────────────────────────────────────────
const args = process.argv.slice(2);

const KNOWN_FLAGS = new Set([
  "--main",
  "--volatile-generated",
  "--no-prune-invisible",
  "--output",
  "--period-tag",
  "--ships",
  "--ship-range",
  "--first-index-range",
  "--phase4-first-index-range",
  "--strict-nminus1",
  "--no-strict-nminus1",
  "--allow-duplicate-items",
  "--no-allow-duplicate-items",
  "--max-combo-size",
  "--ast-candidate-ships",
]);
const FLAGS_WITH_VALUE = new Set([
  "--output",
  "--period-tag",
  "--ships",
  "--ship-range",
  "--first-index-range",
  "--phase4-first-index-range",
  "--max-combo-size",
  "--ast-candidate-ships",
]);
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
    i += 1;
  }
}

const useMain = args.includes("--main");
const deterministic = !args.includes("--volatile-generated");
const pruneInvisible = !args.includes("--no-prune-invisible");
const strictEnabled = args.includes("--strict-nminus1");
const strictDisabled = args.includes("--no-strict-nminus1");
if (strictEnabled && strictDisabled) {
  console.error("Error: cannot use both --strict-nminus1 and --no-strict-nminus1.");
  process.exit(1);
}
const strictNMinusOne = strictDisabled ? false : true;

const duplicateEnabled = args.includes("--allow-duplicate-items");
const duplicateDisabled = args.includes("--no-allow-duplicate-items");
if (duplicateEnabled && duplicateDisabled) {
  console.error(
    "Error: cannot use both --allow-duplicate-items and --no-allow-duplicate-items.",
  );
  process.exit(1);
}
const allowDuplicateItems = duplicateDisabled ? false : true;
const outputIdx = args.indexOf("--output");
const maxComboSizeIdx = args.indexOf("--max-combo-size");

const periodTagIdx = args.indexOf("--period-tag");
const scanPeriodTag = periodTagIdx >= 0 ? args[periodTagIdx + 1] : null;

const shipsIdx = args.indexOf("--ships");
const targetShipsArg = shipsIdx >= 0 ? args[shipsIdx + 1] : null;
const targetShips = targetShipsArg ? targetShipsArg.split(",").map(Number).filter(n => !isNaN(n)) : null;
const astCandidateShipsIdx = args.indexOf("--ast-candidate-ships");
const astCandidateShipsArg = astCandidateShipsIdx >= 0 ? args[astCandidateShipsIdx + 1] : null;
const shipRangeIdx = args.indexOf("--ship-range");
const shipRangeArg = shipRangeIdx >= 0 ? args[shipRangeIdx + 1] : null;
const firstIndexRangeIdx = args.indexOf("--first-index-range");
const firstIndexRangeArg =
  firstIndexRangeIdx >= 0 ? args[firstIndexRangeIdx + 1] : null;
const phase4RangeIdx = args.indexOf("--phase4-first-index-range");
const phase4RangeArg = phase4RangeIdx >= 0 ? args[phase4RangeIdx + 1] : null;
let targetShipRange = null;
if (shipRangeArg) {
  const m = String(shipRangeArg).match(/^(\d+)\s*[-.:]{1,2}\s*(\d+)$/);
  if (!m) {
    console.error(`Error: --ship-range must be START-END, got: ${shipRangeArg}`);
    process.exit(1);
  }
  const start = Number.parseInt(m[1], 10);
  const end = Number.parseInt(m[2], 10);
  targetShipRange = [Math.min(start, end), Math.max(start, end)];
}
let phase4FirstIndexRange = null;
let firstIndexRange = null;
if (firstIndexRangeArg) {
  const m = String(firstIndexRangeArg).match(/^(\d+)\s*[-.:]{1,2}\s*(\d+)$/);
  if (!m) {
    console.error(`Error: --first-index-range must be START-END, got: ${firstIndexRangeArg}`);
    process.exit(1);
  }
  const start = Number.parseInt(m[1], 10);
  const end = Number.parseInt(m[2], 10);
  firstIndexRange = [Math.min(start, end), Math.max(start, end)];
}
if (phase4RangeArg) {
  const m = String(phase4RangeArg).match(/^(\d+)\s*[-.:]{1,2}\s*(\d+)$/);
  if (!m) {
    console.error(`Error: --phase4-first-index-range must be START-END, got: ${phase4RangeArg}`);
    process.exit(1);
  }
  const start = Number.parseInt(m[1], 10);
  const end = Number.parseInt(m[2], 10);
  phase4FirstIndexRange = [Math.min(start, end), Math.max(start, end)];
}
const effectivePhase4FirstIndexRange = phase4FirstIndexRange || firstIndexRange;
const maxComboSizeRaw =
  maxComboSizeIdx >= 0
    ? args[maxComboSizeIdx + 1]
    : "6";
const maxComboSize = Number.parseInt(maxComboSizeRaw, 10);

let astCandidateShipSet = null;
if (astCandidateShipsArg) {
  const normalized = String(astCandidateShipsArg).trim().toLowerCase();
  if (normalized !== "all") {
    const ids = astCandidateShipsArg
      .split(",")
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      console.error(
        `Error: --ast-candidate-ships must be 'all' or comma-separated ship IDs, got: ${astCandidateShipsArg}`,
      );
      process.exit(1);
    }
    astCandidateShipSet = new Set(ids);
  }
}

if (!Number.isFinite(maxComboSize) || maxComboSize < 2 || maxComboSize > 6) {
  console.error(
    `Error: --max-combo-size (or SCAN_AST_MAX_COMBO_SIZE) must be an integer in [2, 6], got: ${maxComboSizeRaw}`,
  );
  process.exit(1);
}

const outName = scanPeriodTag ? `slot_item_effects_${scanPeriodTag}.json` : "slot_item_effects_ast.json";
const outputPath =
  outputIdx >= 0
    ? path.resolve(process.cwd(), args[outputIdx + 1])
    : path.join(ROOT, "output", outName);
const previewNameManifestPath = path.join(
  path.dirname(outputPath),
  "preview_name_manifest.json",
);

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
console.log(`[scan] max_combo_size: ${maxComboSize}`);
if (strictNMinusOne && maxComboSize >= 4) {
  console.warn(
    "[scan] strict N-1 can increase phase4+ tests by around 10x depending on period data.",
  );
}

function loadAstRules(periodTag) {
  const dictName = periodTag ? `synergy_dict_${periodTag}.json` : "synergy_dict.json";
  const astRulesPath = path.join(ROOT, "output", dictName);
  if (!fs.existsSync(astRulesPath)) {
    console.error(
      `[scan] Missing AST dictionary: ${path.relative(ROOT, astRulesPath)}. Run extract-ast first.`,
    );
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(astRulesPath, "utf8"));
  if (!Array.isArray(raw)) {
    console.error(`[scan] Invalid AST dictionary format: ${path.relative(ROOT, astRulesPath)}`);
    process.exit(1);
  }
  return raw.map((rule) => ({
    ...rule,
    requiredItemIds: Array.isArray(rule.requiredItemIds)
      ? rule.requiredItemIds.map(Number).filter(Number.isFinite)
      : [],
    requiredItemTypes: Array.isArray(rule.requiredItemTypes)
      ? rule.requiredItemTypes.map(Number).filter(Number.isFinite)
      : [],
  }));
}

const astRules = loadAstRules(scanPeriodTag);

// ── Load master data ───────────────────────────────────────────────
const masterPath = findMasterData(scanPeriodTag);
if (!masterPath) {
  console.error(
    "Error: No master data found in master_data/. Place an api_start2 response file there.",
  );
  process.exit(1);
}
console.log(`[scan] Master data: ${path.relative(ROOT, masterPath)}`);

const apiStart2BatchHash = createHash("sha256")
  .update(fs.readFileSync(masterPath))
  .digest("hex");
console.log(`[scan] api_start2_batch_hash: ${apiStart2BatchHash}`);

const masterData = parseMasterData(masterPath);
const mstShips = [...masterData.api_mst_ship]
  .filter(s => {
    if (targetShips && targetShips.length > 0) return targetShips.includes(s.api_id);
    if (targetShipRange) return s.api_id >= targetShipRange[0] && s.api_id <= targetShipRange[1];
    return s.api_id < 1500;
  })
  .sort((a, b) => a.api_id - b.api_id);
const mstSlotitems = [...masterData.api_mst_slotitem].sort(
  (a, b) => a.api_id - b.api_id,
);
console.log(`[scan] Ships: ${mstShips.length}, Items: ${mstSlotitems.length}`);

// ── Build mstDict and load bundle ──────────────────────────────────
const mstDict = buildMstDict(mstSlotitems);
const getMst = createGetMst(mstDict);

function extractSlotItemEffectUtil(mod) {
  if (!mod || (typeof mod !== "object" && typeof mod !== "function")) {
    return null;
  }
  if (typeof mod.getSlotitemEffect === "function") return mod;
  if (mod.SlotItemEffectUtil) {
    const util = mod.SlotItemEffectUtil;
    if (util && typeof util.getSlotitemEffect === "function") return util;
  }
  if (mod.default) {
    const d = mod.default;
    if (d && typeof d.getSlotitemEffect === "function") return d;
    if (d?.SlotItemEffectUtil) {
      const util = d.SlotItemEffectUtil;
      if (util && typeof util.getSlotitemEffect === "function") return util;
    }
  }
  return null;
}

function patchGetMstInCache(kcsCache, getMstFn) {
  if (!getMstFn) return 0;
  let patched = 0;
  const visitedNodes = new Set();
  function patchNode(root) {
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || (typeof node !== "object" && typeof node !== "function")) continue;
      if (visitedNodes.has(node)) continue;
      visitedNodes.add(node);
      for (const name of Object.getOwnPropertyNames(node)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(node, name);
          if (!desc || !("value" in desc)) continue;
          if (name === "getMst" && typeof desc.value === "function") { node[name] = getMstFn; patched++; continue; }
          if (desc.value && (typeof desc.value === "object" || typeof desc.value === "function")) stack.push(desc.value);
        } catch {}
      }
    }
  }
  for (const mod of Object.values(kcsCache || {})) {
    if (mod && typeof mod === "object") { patchNode(mod.exports); patchNode(mod.exports?.default); }
  }
  return patched;
}

function resolveSlotItemEffectUtil({ kcsRequire, kcsCache, kcsModules, getMstFn, astRules }) {
  patchGetMstInCache(kcsCache, getMstFn);
  
  const allSynergies = kcsRequire(87618);
  let WrapperClass = null;
  try { WrapperClass = kcsRequire(98672).SlotItemEffectParamModel; } catch(e) {}
  if (!WrapperClass) {
     for (const mod of Object.values(kcsCache || {})) {
       if (mod?.exports?.SlotItemEffectParamModel) {
          WrapperClass = mod.exports.SlotItemEffectParamModel;
          break;
       }
     }
  }
  
  const STAT_KEYS = ["houg","raig","tyku","tais","souk","kaih","saku","baku","houm","raim","leng"];
  
  // Zero-allocation pre-filter maps
  const nativeFuncs = {};
  const itemIdToRules = {}; 
  const itemTypeToRules = {};

  for (let i = 0; i < astRules.length; i++) {
    const rule = astRules[i];
    rule._idx = i + 1; // 1-indexed
    if (allSynergies[rule.funcName]) {
      nativeFuncs[rule.funcName] = allSynergies[rule.funcName];
    }
    
    for (const id of rule.requiredItemIds) {
      if (!itemIdToRules[id]) itemIdToRules[id] = [];
      itemIdToRules[id].push(rule);
    }
    for (const type of rule.requiredItemTypes) {
      if (!itemTypeToRules[type]) itemTypeToRules[type] = [];
      itemTypeToRules[type].push(rule);
    }
  }
  
  const seenRules = new Uint32Array(astRules.length + 1);
  const matchedRules = new Array(astRules.length);
  let evalVersion = 0;
  
  console.log("[scan-ast] Injected ZERO-ALLOCATION Optimized AST Fast Evaluator!");
  
  return {
    getSlotitemEffect: (ship, items) => {
      evalVersion++;
      let matchedCount = 0;
      
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        
        const rulesById = itemIdToRules[item.mstID];
        if (rulesById) {
          for (let i = 0; i < rulesById.length; i++) {
            const r = rulesById[i];
            if (seenRules[r._idx] !== evalVersion) {
              seenRules[r._idx] = evalVersion;
              matchedRules[matchedCount++] = r;
            }
          }
        }
        
        const rulesByType = itemTypeToRules[item.equipType];
        if (rulesByType) {
          for (let i = 0; i < rulesByType.length; i++) {
            const r = rulesByType[i];
            if (seenRules[r._idx] !== evalVersion) {
              seenRules[r._idx] = evalVersion;
              matchedRules[matchedCount++] = r;
            }
          }
        }
      }

      if (matchedCount === 0) return null;

      let hasBonus = false;
      const wrapper = new WrapperClass(ship, items);
      const outStats = {};
      
      for (let i = 0; i < matchedCount; i++) {
        const rule = matchedRules[i];
        const synergyFunc = nativeFuncs[rule.funcName];
        if (synergyFunc) {
          let eff = null;
          try { eff = synergyFunc(wrapper); } catch(e) {}
          if (eff) {
            for (let k = 0; k < STAT_KEYS.length; k++) {
              const key = STAT_KEYS[k];
              if (eff[key]) {
                outStats[key] = (outStats[key] || 0) + eff[key];
                hasBonus = true;
              }
            }
          }
        }
      }
      return hasBonus ? outStats : null;
    }
  };
}



const { kcsRequire, kcsCache, kcsModules } = loadBundle({
  useMain,
  getMst,
  silent: false,
  periodTag: scanPeriodTag,
});
const SlotItemEffectUtil = resolveSlotItemEffectUtil({
  kcsRequire,
  kcsCache,
  kcsModules,
  getMstFn: getMst,
  astRules,
});

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

// ── OPTIMIZATION 1: Cached ship objects ────────────────────────────
const shipObjectCache = {};
function getShipObject(shipData) {
  const id = shipData.api_id;
  if (!shipObjectCache[id]) {
    shipObjectCache[id] = {
      mstID: id,
      yomi: shipData.api_yomi || "",
      shipTypeID: shipData.api_stype || 0,
      getClassType: () => shipData.api_ctype || 0,
    };
  }
  return shipObjectCache[id];
}

// ── OPTIMIZATION 2: Pre-built slot objects cache ───────────────────
// Cache makeSlot results to avoid repeated object allocation
const slotObjCache = {};
function getMakeSlot(id, level) {
  const key = `${id}:${level}`;
  if (!slotObjCache[key]) {
    const s = slotById[id];
    slotObjCache[key] = { mstID: id, equipType: s ? s.equipType : 0, level: level || 0 };
  }
  return slotObjCache[key];
}

// ── Equip permission tables ────────────────────────────────────────
const stypeEquipTypeSet = {};
for (const st of masterData.api_mst_stype || []) {
  const allowed = new Set();
  for (const [etStr, v] of Object.entries(st.api_equip_type || {})) {
    if (v === 1) allowed.add(parseInt(etStr, 10));
  }
  stypeEquipTypeSet[st.api_id] = allowed;
}

const shipEquipOverrideMap = {};
for (const [shipIdStr, info] of Object.entries(masterData.api_mst_equip_ship || {})) {
  shipEquipOverrideMap[parseInt(shipIdStr, 10)] = info;
}

const exslotEquipTypes = new Set((masterData.api_mst_equip_exslot || []).map(Number));

const exslotShipRuleMap = {};
for (const [itemIdStr, info] of Object.entries(masterData.api_mst_equip_exslot_ship || {})) {
  exslotShipRuleMap[parseInt(itemIdStr, 10)] = info;
}

const exslotLimitMap = {};
for (const [shipIdStr, info] of Object.entries(masterData.api_mst_equip_limit_exslot || {})) {
  const equip = Array.isArray(info?.api_equip) ? info.api_equip.map(Number) : [];
  exslotLimitMap[parseInt(shipIdStr, 10)] = new Set(equip);
}

const itemEquipType2 = {};
for (const si of mstSlotitems) {
  itemEquipType2[si.api_id] = (si.api_type && si.api_type[2]) || 0;
}

const itemsByType2 = {};
for (const si of mstSlotitems) {
  const t = (si.api_type && si.api_type[2]) || 0;
  if (!itemsByType2[t]) itemsByType2[t] = [];
  itemsByType2[t].push(si.api_id);
}

function parseNormalSlotTypeRestrictions(overrideInfo) {
  const raw =
    overrideInfo?.normal_slot_type_restrictions ||
    overrideInfo?.api_normal_slot_type_restrictions ||
    [];
  if (!Array.isArray(raw)) return [];
  const rules = [];
  for (const rule of raw) {
    if (!rule || typeof rule !== "object") continue;
    const mode = rule.mode;
    if (mode !== "exclude" && mode !== "allow-only") continue;
    const slotIndex = Number.isInteger(rule.slot_index)
      ? rule.slot_index
      : Number.isInteger(rule.min_slot_index)
        ? { min: rule.min_slot_index }
        : null;
    if (slotIndex == null) continue;
    const typeIds = new Set(
      (Array.isArray(rule.type_ids) ? rule.type_ids : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    if (typeIds.size === 0) continue;
    rules.push({ slotIndex, mode, typeIds });
  }
  return rules;
}

function getNormalSlotRule(shipData) {
  const override = shipEquipOverrideMap[shipData.api_id];
  if (override?.api_equip_type) {
    const allowedTypes = new Set();
    const itemAllowListByType = new Map();
    for (const [typeIdStr, value] of Object.entries(override.api_equip_type)) {
      const typeId = Number(typeIdStr);
      if (!Number.isFinite(typeId)) continue;
      allowedTypes.add(typeId);
      if (Array.isArray(value)) itemAllowListByType.set(typeId, new Set(value.map(Number)));
    }
    return { allowedTypes, itemAllowListByType, restrictions: parseNormalSlotTypeRestrictions(override) };
  }
  const allowedTypes = stypeEquipTypeSet[shipData.api_stype] || new Set();
  return { allowedTypes, itemAllowListByType: new Map(), restrictions: [] };
}

function passesNormalSlotRestriction(restrictions, slotIdx, equipType) {
  for (const rule of restrictions) {
    const matches =
      typeof rule.slotIndex === "number"
        ? slotIdx === rule.slotIndex
        : slotIdx >= rule.slotIndex.min;
    if (!matches) continue;
    if (rule.mode === "exclude") return !rule.typeIds.has(equipType);
    return rule.typeIds.has(equipType);
  }
  return true;
}

function getExslotRequirement(shipData, itemId) {
  const shipId = shipData.api_id;
  const equipType = itemEquipType2[itemId];
  if (!equipType) return null;

  const normalRule = getNormalSlotRule(shipData);
  let shipCompatible = false;
  if (normalRule.allowedTypes.has(equipType)) {
    const allowItems = normalRule.itemAllowListByType.get(equipType);
    shipCompatible = !allowItems || allowItems.has(itemId);
  }
  if (normalRule.allowedTypes.size > 0 && !shipCompatible) return null;

  const blocked = exslotLimitMap[shipId] || new Set();
  const allowByBaseType = exslotEquipTypes.has(equipType) && !blocked.has(equipType);

  let allowByExplicit = false;
  const exslotRule = exslotShipRuleMap[itemId];
  if (exslotRule) {
    const shipIds = exslotRule.api_ship_ids || exslotRule.ship_ids || null;
    const stypes = exslotRule.api_stypes || exslotRule.stypes || null;
    const ctypes = exslotRule.api_ctypes || exslotRule.ctypes || null;
    allowByExplicit =
      !!(shipIds && shipIds[String(shipId)]) ||
      !!(stypes && stypes[String(shipData.api_stype)]) ||
      !!(ctypes && ctypes[String(shipData.api_ctype || 0)]);
  }

  return allowByBaseType || allowByExplicit ? { level: 0, alv: 0 } : null;
}

const allowedPositionsByShipItem = {};

function getAllowedPositions(shipData, itemId) {
  const shipId = shipData.api_id;
  if (!allowedPositionsByShipItem[shipId]) allowedPositionsByShipItem[shipId] = {};
  if (allowedPositionsByShipItem[shipId][itemId]) return allowedPositionsByShipItem[shipId][itemId];

  const equipType = itemEquipType2[itemId];
  const positions = [];
  if (!equipType) {
    allowedPositionsByShipItem[shipId][itemId] = positions;
    return positions;
  }

  const normalRule = getNormalSlotRule(shipData);
  if (normalRule.allowedTypes.has(equipType)) {
    const allowItems = normalRule.itemAllowListByType.get(equipType);
    const itemAllowed = !allowItems || allowItems.has(itemId);
    if (itemAllowed) {
      const slotCount = shipData.api_slot_num || 0;
      for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
        if (passesNormalSlotRestriction(normalRule.restrictions, slotIdx, equipType)) {
          positions.push(slotIdx);
        }
      }
    }
  }

  const exslotReq = getExslotRequirement(shipData, itemId);
  if (exslotReq != null) positions.push(shipData.api_slot_num || 0);

  allowedPositionsByShipItem[shipId][itemId] = positions;
  return positions;
}

function canEquipItem(shipData, itemId) {
  return getAllowedPositions(shipData, itemId).length > 0;
}

function canAssignComboToShip(shipId, items) {
  const shipData = shipById[shipId];
  if (!shipData) return false;
  return findComboAssignment(shipData, items) != null;
}

function findComboAssignment(shipData, items, allowExslot = true, requireExslot = false) {
  const exslotPos = shipData.api_slot_num || 0;
  const choices = items.map((itemId) => {
    const positions = getAllowedPositions(shipData, itemId);
    if (allowExslot) return positions;
    return positions.filter((pos) => pos !== exslotPos);
  });
  if (choices.some((pos) => pos.length === 0)) return null;
  choices.sort((a, b) => a.length - b.length);
  const used = new Set();
  const assignment = new Array(choices.length);

  function backtrack(idx, usedExslot) {
    if (idx === choices.length) return !requireExslot || usedExslot;
    for (const pos of choices[idx]) {
      if (used.has(pos)) continue;
      used.add(pos);
      assignment[idx] = pos;
      if (backtrack(idx + 1, usedExslot || pos === exslotPos)) return true;
      used.delete(pos);
    }
    return false;
  }

  if (!backtrack(0, false)) return null;
  return assignment;
}

const comboPlacementSummaryCache = new Map();

function getComboPlacementSummaries(shipId, items) {
  const key = `${shipId}|${items.join(":")}`;
  if (comboPlacementSummaryCache.has(key)) return comboPlacementSummaryCache.get(key);
  const shipData = shipById[shipId];
  if (!shipData) return [];

  const summaries = [];
  const seen = new Set();
  const pushSummary = (assignment) => {
    if (!assignment) return;
    const exslotPos = shipData.api_slot_num || 0;
    let normal = 0;
    let exslot = 0;
    for (const pos of assignment) {
      if (pos === exslotPos) exslot += 1;
      else normal += 1;
    }
    const sig = `${normal}:${exslot}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    summaries.push({ normal, exslot });
  };

  pushSummary(findComboAssignment(shipData, items, false, false));
  pushSummary(findComboAssignment(shipData, items, true, true));
  comboPlacementSummaryCache.set(key, summaries);
  return summaries;
}

// Pre-build equippable item list per ship
const equippableByShip = {};
for (const shipData of mstShips) {
  const sid = shipData.api_id;
  const list = [];
  for (const si of slotInfos) {
    if (canEquipItem(shipData, si.id)) list.push(si.id);
  }
  equippableByShip[sid] = list;
}

// ── OPTIMIZATION 3: Set-based equippable lookups ───────────────────
const equippableByShipSet = {};
for (const [shipId, items] of Object.entries(equippableByShip)) {
  equippableByShipSet[parseInt(shipId)] = new Set(items);
}

if (astCandidateShipsArg && String(astCandidateShipsArg).trim().toLowerCase() === "all") {
  astCandidateShipSet = new Set(Object.keys(equippableByShipSet).map((k) => Number.parseInt(k, 10)));
}

const astConditionRuleTokens = astRules.map((rule) => ({
  ids: [...new Set((rule.requiredItemIds || []).map(Number).filter(Number.isFinite))],
  types: [...new Set((rule.requiredItemTypes || []).map(Number).filter(Number.isFinite))],
}));

function buildAstConditionMatchedItemsForShip(shipId) {
  const equippableSet = equippableByShipSet[shipId];
  if (!equippableSet) return [];
  const items = new Set();
  for (const tok of astConditionRuleTokens) {
    for (const id of tok.ids) {
      if (equippableSet.has(id)) items.add(id);
    }
    for (const type of tok.types) {
      const ids = itemsByType2[type] || [];
      for (const id of ids) {
        if (equippableSet.has(id)) items.add(id);
      }
    }
  }
  return [...items].sort((a, b) => a - b);
}

const astShipConditionMatchedItems = {};
const astShipConditionMatchedSet = {};
if (astCandidateShipSet && astCandidateShipSet.size > 0) {
  for (const shipId of astCandidateShipSet) {
    const items = buildAstConditionMatchedItemsForShip(shipId);
    astShipConditionMatchedItems[shipId] = items;
    astShipConditionMatchedSet[shipId] = new Set(items);
  }
  const sortedIds = [...astCandidateShipSet].sort((a, b) => a - b);
  console.log(`[Opt][AST] candidate-filter ships: ${sortedIds.join(",")}`);
  for (const shipId of sortedIds) {
    const astItems = astShipConditionMatchedItems[shipId] || [];
    const total = equippableByShip[shipId]?.length || 0;
    console.log(
      `  [ship=${shipId}] condition-matched items=${astItems.length}/${total}`,
    );
  }
}

function getAstFilteredItemsForShip(shipId, items) {
  if (!astCandidateShipSet || !astCandidateShipSet.has(shipId)) return items;
  const matched = astShipConditionMatchedSet[shipId];
  if (!matched || matched.size === 0) return items;
  const filtered = items.filter((id) => matched.has(id));
  return filtered.length > 0 ? filtered : items;
}

const effectiveSlotsOf = {};
for (const shipData of mstShips) {
  effectiveSlotsOf[shipData.api_id] = (shipData.api_slot_num || 0) + 1;
}

// ── Combinatorial helpers ──────────────────────────────────────────
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

function forEachCombinationIndices(n, k, allowDuplicates, cb) {
  if (k <= 0 || n <= 0) return;
  const indexBuffer = new Array(k);
  function walk(pos, start) {
    if (pos === k) {
      cb(indexBuffer);
      return;
    }
    for (let i = start; i < n; i++) {
      indexBuffer[pos] = i;
      walk(pos + 1, allowDuplicates ? i : i + 1);
    }
  }
  walk(0, 0);
}

function buildItemCounts(items) {
  const counts = new Map();
  for (const id of items) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function hasEnoughItems(itemCounts, requiredItems) {
  const reqCounts = new Map();
  for (const id of requiredItems) {
    reqCounts.set(id, (reqCounts.get(id) || 0) + 1);
  }
  for (const [id, need] of reqCounts.entries()) {
    if ((itemCounts.get(id) || 0) < need) return false;
  }
  return true;
}

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

// ── OPTIMIZATION 4: Global aloneCache ─────────────────────────────
// Keyed by `${shipId}:${itemId}` → stats (or null)
const aloneCache = {};
function getAlone(ship, itemId) {
  const key = `${ship.mstID}:${itemId}`;
  if (!(key in aloneCache)) {
    aloneCache[key] = extractNonZero(
      SlotItemEffectUtil.getSlotitemEffect(ship, [getMakeSlot(itemId, 0)]),
    );
  }
  return aloneCache[key];
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Single-item scan
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 1] Single-item scan ...");
const t0 = Date.now();

const singleBonus = {};
const equipResults = new Map();
let nonZeroCount = 0;

for (let si = 0; si < mstShips.length; si++) {
  const shipData = mstShips[si];
  const ship = getShipObject(shipData);
  const shipId = shipData.api_id;

  for (let ei = 0; ei < slotInfos.length; ei++) {
    const slot = slotInfos[ei];
    if (!canEquipItem(shipData, slot.id))
      continue;

    // ★0 ×1 — populate aloneCache
    const key0 = `${shipId}:${slot.id}`;
    let b;
    if (!(key0 in aloneCache)) {
      const r0 = SlotItemEffectUtil.getSlotitemEffect(ship, [getMakeSlot(slot.id, 0)]);
      b = extractNonZero(r0);
      aloneCache[key0] = b;
    } else {
      b = aloneCache[key0];
    }
    if (!b) continue;

    if (!singleBonus[shipId]) singleBonus[shipId] = {};
    singleBonus[shipId][slot.id] = b;

    // ★1..★10 ×1
    const improvementTransitions = [];
    let prevLevelStats = b;
    for (let star = 1; star <= 10; star++) {
      const rStar = SlotItemEffectUtil.getSlotitemEffect(ship, [
        getMakeSlot(slot.id, star),
      ]);
      const sStar = extractNonZero(rStar);
      if (!statsEqual(prevLevelStats, sStar)) {
        improvementTransitions.push([star, sStar || {}]);
        prevLevelStats = sStar;
      }
    }

    let l;
    let i;
    if (
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
      getMakeSlot(slot.id, 0),
      getMakeSlot(slot.id, 0),
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
      getMakeSlot(slot.id, 0),
      getMakeSlot(slot.id, 0),
      getMakeSlot(slot.id, 0),
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

  if (si === mstShips.length - 1 || (si + 1) % 50 === 0) {
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

// ── OPTIMIZATION 5: Ship deduplication by bonus profile ────────────
// Ships with identical bonus fingerprints form groups.
// Phases 2-4 compute on one representative per group, then spread results.
console.log("\n[Opt] Computing ship bonus fingerprints for deduplication...");

// Build bonus fingerprint per ship: sorted JSON of {itemId: stats}
function shipBonusFingerprint(shipId) {
  const bonuses = singleBonus[shipId];
  if (!bonuses) return "";
  // Also include equippable set fingerprint (for ships with same bonuses but different equip permissions)
  const equippable = equippableByShip[shipId] || [];
  const bonusEntries = Object.entries(bonuses)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([id, stats]) => `${id}:${JSON.stringify(stats)}`);
  const equipFingerprint = equippable.join(",");
  return bonusEntries.join("|") + "||" + equipFingerprint;
}

// Group ships by bonus fingerprint
const shipGroups = new Map(); // fingerprint → [shipId, ...]
const shipToGroup = {};       // shipId → representative shipId

for (const shipData of mstShips) {
  const shipId = shipData.api_id;
  const fp = shipBonusFingerprint(shipId);
  if (!shipGroups.has(fp)) {
    shipGroups.set(fp, []);
  }
  shipGroups.get(fp).push(shipId);
}

for (const [, members] of shipGroups) {
  const rep = members[0];
  for (const sid of members) {
    shipToGroup[sid] = rep;
  }
}

// Build representative ship list for Phase 2+
const repShipIds = new Set(Object.values(shipToGroup));
const repShips = [...repShipIds].sort((a, b) => a - b);

const groupMembersOf = {}; // repId → [all members in group]
for (const [, members] of shipGroups) {
  const rep = members[0];
  groupMembersOf[rep] = members;
}

function appendSynergyForRepShip(synergyMap, repShipId, items, synergy, cancelsSingle = false) {
  const key = items.join(":");
  if (!synergyMap.has(key)) synergyMap.set(key, new Map());
  const profileKey = bkey(synergy) + (cancelsSingle ? "|C" : "");
  const pm = synergyMap.get(key);
  if (!pm.has(profileKey)) {
    const entry = { ships: [], items, synergy, placements: [] };
    if (cancelsSingle) entry.cancels_single = true;
    pm.set(profileKey, entry);
  }

  const entry = pm.get(profileKey);
  const members = groupMembersOf[repShipId] || [repShipId];
  for (const memberId of members) {
    const memberEquippableSet = equippableByShipSet[memberId];
    if (!memberEquippableSet) continue;
    if (!items.every((id) => memberEquippableSet.has(id))) continue;
    if (!canAssignComboToShip(memberId, items)) continue;
    entry.ships.push(memberId);
    for (const placement of getComboPlacementSummaries(memberId, items)) {
      if (!entry.placements.some((p) => p.normal === placement.normal && p.exslot === placement.exslot)) {
        entry.placements.push(placement);
      }
    }
  }
}

console.log(`[Opt] ${mstShips.length} ships → ${repShips.length} unique bonus profiles (${((1 - repShips.length / mstShips.length) * 100).toFixed(1)}% dedup)`);

// ── Build lookup maps ──────────────────────────────────────────────
const shipById = {};
for (const s of mstShips) shipById[s.api_id] = s;

// ── OPTIMIZATION 6: Per-item ship sets ────────────────────────────
// For each item, the Set of representative ships that have a bonus for it.
const repShipsForItem = {}; // itemId → Set<repShipId>
for (const shipData of mstShips) {
  const shipId = shipData.api_id;
  const rep = shipToGroup[shipId];
  if (rep !== shipId) continue; // only process representatives
  const bonuses = singleBonus[shipId];
  if (!bonuses) continue;
  for (const itemIdStr of Object.keys(bonuses)) {
    const itemId = parseInt(itemIdStr, 10);
    if (!repShipsForItem[itemId]) repShipsForItem[itemId] = new Set();
    repShipsForItem[itemId].add(shipId);
  }
}

const itemsWithBonus = new Set();
for (const shipBonuses of Object.values(singleBonus)) {
  for (const itemId of Object.keys(shipBonuses)) {
    itemsWithBonus.add(parseInt(itemId, 10));
  }
}
const bonusItemIds = [...itemsWithBonus].sort((a, b) => a - b);
const bonusItemIdSet = new Set(bonusItemIds);
console.log(`  Items with any bonus: ${bonusItemIds.length}`);

// ── OPTIMIZATION 7: Category-aware expected baseline ───────────────
function getSingleProfile(shipId, itemId) {
  const pm = equipResults.get(itemId);
  if (!pm) return null;
  for (const [pk, data] of pm.entries()) {
    if (data.ships.includes(shipId)) return { pk, profile: data.profile };
  }
  return null;
}

function getExpectedBaseline(shipId, items) {
  const bonuses = {};
  const groups = {};
  
  for (const itemId of items) {
    const pInfo = getSingleProfile(shipId, itemId);
    if (pInfo) {
      if (!groups[pInfo.pk]) groups[pInfo.pk] = { profile: pInfo.profile, count: 0 };
      groups[pInfo.pk].count++;
    }
  }
  
  for (const group of Object.values(groups)) {
    const { profile, count } = group;
    let src = {};
    if (count === 1) {
      src = profile.b || {};
    } else if (count >= 3 && profile.c3) {
      src = { ...profile.c3 };
      if (count > 3 && !statsEqual(profile.c2 || {}, profile.c3)) {
        for (const k of Object.keys(profile.b || {})) {
          const extra = (profile.b[k] || 0) * (count - 3);
          if (extra) src[k] = (src[k] || 0) + extra;
        }
      }
    } else if (count >= 2 && profile.c2) {
      src = { ...profile.c2 };
      if (count > 2 && !statsEqual(profile.b || {}, profile.c2)) {
        for (const k of Object.keys(profile.b || {})) {
          const extra = (profile.b[k] || 0) * (count - 2);
          if (extra) src[k] = (src[k] || 0) + extra;
        }
      }
    } else {
      for (const k of Object.keys(profile.b || {})) {
        const v = (profile.b[k] || 0) * count;
        if (v) src[k] = v;
      }
    }
    
    for (const [k, v] of Object.entries(src)) {
      if (v) bonuses[k] = (bonuses[k] || 0) + v;
    }
  }
  
  return Object.keys(bonuses).length > 0 ? bonuses : null;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Cross-item synergy scan (optimized)
// ═══════════════════════════════════════════════════════════════════
console.log("\n[Phase 2] Cross-item synergy scan ...");
const t1 = Date.now();

const synergies = new Map();
let synergyCount = 0;
let pairsTested = 0;
let astPhase2ShipsHit = 0;
let astPhase2FallbackShips = 0;
let astPhase2CandidatesEvaluated = 0;

// Track synergies per rep ship; will expand to group members at end
// repSynergy[repShipId]["pairKey"] → synergy delta
const repSynergyResults = {}; // repShipId → { pairKey → { synDelta, cancelsSingle } }

for (let ai = 0; ai < bonusItemIds.length; ai++) {
  const itemA = bonusItemIds[ai];
  const shipsForA = repShipsForItem[itemA]; // Set of rep ships
  if (!shipsForA || shipsForA.size === 0) continue;

  for (const shipId of shipsForA) {
    const shipData = shipById[shipId];
    if (!shipData) continue;
    const ship = getShipObject(shipData);

    // Test ALL equippable items as itemB (not just bonus items).
    // Synergies can fire even when itemB alone gives no bonus on this ship.
    // equippableByShip[shipId] is already pre-computed and sorted.
    let equippable = equippableByShip[shipId] || [];
    if (astCandidateShipSet && astCandidateShipSet.has(shipId)) {
      const astCandidates = astShipConditionMatchedItems[shipId] || [];
      if (astCandidates.length > 0) {
        equippable = astCandidates;
        astPhase2ShipsHit++;
        astPhase2CandidatesEvaluated += astCandidates.length;
      } else {
        astPhase2FallbackShips++;
      }
    }

    for (const itemB of equippable) {
      if (itemB === itemA) continue;
      if (!canAssignComboToShip(shipId, [itemA, itemB])) continue;
      pairsTested++;

      const combined = SlotItemEffectUtil.getSlotitemEffect(ship, [
        getMakeSlot(itemA, 0),
        getMakeSlot(itemB, 0),
      ]);
      const comb = extractNonZero(combined);

      const expected = getExpectedBaseline(shipId, [itemA, itemB]);

      if (statsEqual(comb, expected)) continue;

      const synDelta = statsSub(comb, expected);
      if (!synDelta) continue;
      if (pruneInvisible && isMeaninglessSynergy(synDelta)) continue;

      const isCancel =
        statsEqual(synDelta, statsSub(null, getAlone(ship, itemA))) ||
        statsEqual(synDelta, statsSub(null, getAlone(ship, itemB)));

      const pairKey = `${Math.min(itemA, itemB)}:${Math.max(itemA, itemB)}`;

      // Track result on representative ship
      if (!repSynergyResults[shipId]) repSynergyResults[shipId] = {};
      repSynergyResults[shipId][pairKey] = {
        synDelta,
        cancelsSingle: isCancel,
      };
    }
  }

  if (ai === bonusItemIds.length - 1 || (ai + 1) % 5 === 0) {
    const e = ((Date.now() - t1) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${ai + 1}/${bonusItemIds.length} trigger items | ${pairsTested} tests | ${e}s`,
    );
  }
}
console.log("");

// Expand rep results to group members
// For each pair synergy found on a rep ship, add all group members to the synergy list
for (const [repShipId, pairMap] of Object.entries(repSynergyResults)) {
  const members = groupMembersOf[parseInt(repShipId)] || [parseInt(repShipId)];
  
  for (const [pairKey, pairResult] of Object.entries(pairMap)) {
    const { synDelta, cancelsSingle } = pairResult;
    const [aStr, bStr] = pairKey.split(":");
    const itemA = parseInt(aStr);
    const itemB = parseInt(bStr);
    
    if (!synergies.has(pairKey)) synergies.set(pairKey, new Map());
    const pm = synergies.get(pairKey);
    
    const profileKey = bkey({
      a: Math.min(itemA, itemB),
      b: Math.max(itemA, itemB),
      d: synDelta,
    });
    
    if (!pm.has(profileKey)) {
      pm.set(profileKey, {
        ships: [],
        synergy: synDelta,
        items: [Math.min(itemA, itemB), Math.max(itemA, itemB)],
        ...(cancelsSingle ? { cancels_single: true } : {}),
      });
    }
    
    const entry = pm.get(profileKey);
    for (const memberId of members) {
      // Only add if the member can actually equip both items
      const memberEquippableSet = equippableByShipSet[memberId];
      if (!memberEquippableSet) continue;
      if (!memberEquippableSet.has(itemA) || !memberEquippableSet.has(itemB)) continue;
      if (!canAssignComboToShip(memberId, [itemA, itemB])) continue;
      
      if (!entry.ships.includes(memberId)) {
        entry.ships.push(memberId);
        synergyCount++;
      }
    }
  }
}

console.log(
  `[Phase 2] Done: ${synergyCount} synergies from ${synergies.size} pairs (${pairsTested} tests) in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
);
if (astCandidateShipSet && astCandidateShipSet.size > 0) {
  console.log(
    `[Phase 2][AST] filtered_loops=${astPhase2ShipsHit}, fallback_loops=${astPhase2FallbackShips}, avg_candidates=${astPhase2ShipsHit > 0 ? (astPhase2CandidatesEvaluated / astPhase2ShipsHit).toFixed(1) : "0.0"}`,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Triple cross-item synergy scan (optimized)
// ═══════════════════════════════════════════════════════════════════

// Pre-build pair rules so we can simulate boolean expected values.
// Also index by ship once to avoid scanning all rules for every combo test.
const pairRules = buildRules(synergies, 2);

function indexRulesByShip(rules) {
  const byShip = Object.create(null);
  for (const rule of rules || []) {
    for (const shipId of rule.ships || []) {
      if (!byShip[shipId]) byShip[shipId] = [];
      byShip[shipId].push(rule);
    }
  }
  return byShip;
}

const pairRulesByShip = indexRulesByShip(pairRules);

function simulateRules(rulesForShip, items, comboSize) {
  if (!rulesForShip || rulesForShip.length === 0) return null;
  let bonuses = null;
  const itemCounts = buildItemCounts(items);
  const equippedSet = new Set(items);

  const hasEnoughFixedItems = (fixedItems) => hasEnoughItems(itemCounts, fixedItems);
  
  for (const rule of rulesForShip) {
    
    let active = false;
    if (rule.category_pools) {
      const poolMap = new Map();
      for (const pool of rule.category_pools) {
        const key = pool.join(",");
        if (!poolMap.has(key)) poolMap.set(key, { pool, count: 0 });
        poolMap.get(key).count++;
      }
      active = true;
      for (const { pool, count } of poolMap.values()) {
        let overlap = 0;
        for (const id of pool) if (equippedSet.has(id)) overlap++;
        if (overlap < count) { active = false; break; }
      }
    } else if (rule.item_pool) {
      let overlap = 0;
      for (const id of rule.item_pool) if (equippedSet.has(id)) overlap++;
      if (overlap >= comboSize) active = true;
    } else if (rule.fixed_items && rule.free_pool) {
      if (hasEnoughFixedItems(rule.fixed_items)) {
        const needed =
          typeof rule.free_pick_count === "number"
            ? rule.free_pick_count
            : comboSize - rule.fixed_items.length;
        if (rule.free_pool_with_replacement) {
          let available = 0;
          for (const id of rule.free_pool) available += itemCounts.get(id) || 0;
          if (available >= needed) active = true;
        } else {
          let overlap = 0;
          for (const id of rule.free_pool) if (equippedSet.has(id)) overlap++;
          if (overlap >= needed) active = true;
        }
      }
    } else if (rule.combos_b64 && rule.items) {
      const buf = Buffer.from(rule.combos_b64, "base64");
      const count = buf.length / comboSize;
      for (let ci = 0; ci < count; ci++) {
        const base = ci * comboSize;
        const combo = [];
        for (let j = 0; j < comboSize; j++) combo.push(rule.items[buf[base + j]]);
        const match = hasEnoughItems(itemCounts, combo);
        if (match) { active = true; break; }
      }
    } else if (rule.combos_u16_b64 && rule.items) {
      const raw = Buffer.from(rule.combos_u16_b64, "base64");
      const buf = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
      const count = buf.length / comboSize;
      for (let ci = 0; ci < count; ci++) {
        const base = ci * comboSize;
        const combo = [];
        for (let j = 0; j < comboSize; j++) combo.push(rule.items[buf[base + j]]);
        const match = hasEnoughItems(itemCounts, combo);
        if (match) { active = true; break; }
      }
    } else if (rule.combos_u32_b64 && rule.items) {
      const raw = Buffer.from(rule.combos_u32_b64, "base64");
      const buf = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
      const count = buf.length / comboSize;
      for (let ci = 0; ci < count; ci++) {
        const base = ci * comboSize;
        const combo = [];
        for (let j = 0; j < comboSize; j++) combo.push(rule.items[buf[base + j]]);
        const match = hasEnoughItems(itemCounts, combo);
        if (match) { active = true; break; }
      }
    } else if (rule.implicants) {
      for (const imp of rule.implicants) {
        let match = true;
        for (const term of imp) {
          let termMatch = false;
          for (const id of term) {
            if (equippedSet.has(id)) { termMatch = true; break; }
          }
          if (!termMatch) { match = false; break; }
        }
        if (match) { active = true; break; }
      }
    } else if (rule.combos) {
      for (const combo of rule.combos) {
        if (hasEnoughItems(itemCounts, combo)) { active = true; break; }
      }
    } else if (rule.items) {
      if (hasEnoughItems(itemCounts, rule.items)) active = true;
    }
    
    if (active) {
      if (!bonuses) bonuses = {};
      for (const [k, v] of Object.entries(rule.synergy)) {
        if (v) bonuses[k] = (bonuses[k] || 0) + v;
      }
    }
  }
  return bonuses;
}

console.log("\n[Phase 3] Triple cross-item synergy scan ...");
if (allowDuplicateItems) {
  console.log(
    "[Phase 3] duplicate-item mode: enabled (multiset combinations with replacement).",
  );
}
const t3 = Date.now();
let lastPhase3ProgressAt = Date.now();
let tripleCount = 0;
let triplesTested = 0;

// bonusItemsByShip for representative ships only
const bonusItemsByRepShip = {};
for (const [itemId, profileMap] of equipResults) {
  for (const { ships } of profileMap.values()) {
    for (const shipId of ships) {
      const repId = shipToGroup[shipId];
      if (repId !== shipId) continue; // only track representatives
      if (!bonusItemsByRepShip[shipId]) bonusItemsByRepShip[shipId] = new Set();
      bonusItemsByRepShip[shipId].add(itemId);
    }
  }
}
// Also include items from pair synergies
for (const [, profileMap] of synergies) {
  for (const { ships, items } of profileMap.values()) {
    for (const shipId of ships) {
      const repId = shipToGroup[shipId];
      if (repId !== shipId) continue;
      if (!bonusItemsByRepShip[shipId]) bonusItemsByRepShip[shipId] = new Set();
      for (const itemId of items) bonusItemsByRepShip[shipId].add(itemId);
    }
  }
}

// Convert to sorted arrays
const bonusItemsByRepShipArr = {};
for (const [sid, itemSet] of Object.entries(bonusItemsByRepShip)) {
  bonusItemsByRepShipArr[sid] = [...itemSet].sort((a, b) => a - b);
}

// Build pair lookup by rep ship
const pairByShipKey = {};
for (const [pairKey, profileMap] of synergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      const repId = shipToGroup[shipId] || shipId;
      if (!pairByShipKey[repId]) pairByShipKey[repId] = {};
      pairByShipKey[repId][pairKey] = synergy;
    }
  }
}

const tripleSynergies = new Map();
const repShipIdsWithBonuses = Object.keys(bonusItemsByRepShipArr)
  .map(Number)
  .sort((a, b) => a - b);

const { getSlotitemEffect } = SlotItemEffectUtil;

for (let si = 0; si < repShipIdsWithBonuses.length; si++) {
  const shipId = repShipIdsWithBonuses[si];
  const bItems = getAstFilteredItemsForShip(
    shipId,
    bonusItemsByRepShipArr[shipId],
  );
  if (bItems.length < 3) continue;
  if (effectiveSlotsOf[shipId] < 3) continue;

  const shipData = shipById[shipId];
  if (!shipData) continue;
  const ship = getShipObject(shipData);

  forEachCombinationIndices(
    bItems.length,
    3,
    allowDuplicateItems,
    ([ai, bi, ci]) => {
      if (
        firstIndexRange &&
        (ai < firstIndexRange[0] || ai >= firstIndexRange[1])
      ) {
        return;
      }
      const itemA = bItems[ai];
      const itemB = bItems[bi];
      const itemC = bItems[ci];
      const comboItems = [itemA, itemB, itemC];
      if (!canAssignComboToShip(shipId, comboItems)) return;

      const aloneA = getAlone(ship, itemA);
      const aloneB = getAlone(ship, itemB);
      const aloneC = getAlone(ship, itemC);
      triplesTested++;
      {
        const now = Date.now();
        if (now - lastPhase3ProgressAt >= 2000) {
          const e = ((now - t3) / 1000).toFixed(1);
          process.stdout.write(
            `\r  ${si + 1}/${repShipIdsWithBonuses.length} rep ships | ${tripleCount} synergies | ${triplesTested} tests | ${e}s`,
          );
          lastPhase3ProgressAt = now;
        }
      }

      const combined = extractNonZero(
        getSlotitemEffect(ship, comboItems.map((id) => getMakeSlot(id, 0))),
      );

      let expected = getExpectedBaseline(shipId, comboItems) || null;
      const pairExpected = simulateRules(pairRulesByShip[shipId], comboItems, 2);
      if (pairExpected) expected = statsAdd(expected, pairExpected);

      const residual = statsSub(combined, expected);
      if (!residual) return;
      if (pruneInvisible && isMeaninglessSynergy(residual)) return;

      const isCancel =
        statsEqual(residual, statsSub(null, aloneA)) ||
        statsEqual(residual, statsSub(null, aloneB)) ||
        statsEqual(residual, statsSub(null, aloneC));

      tripleCount++;
      appendSynergyForRepShip(
        tripleSynergies,
        shipId,
        comboItems,
        residual,
        isCancel,
      );
    },
  );

  if (si === repShipIdsWithBonuses.length - 1 || (si + 1) % 20 === 0) {
    const e = ((Date.now() - t3) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${si + 1}/${repShipIdsWithBonuses.length} rep ships | ${tripleCount} synergies | ${triplesTested} tests | ${e}s`,
    );
  }
}
console.log("");

console.log(
  `[Phase 3] Done: ${tripleCount} triple synergies from ${tripleSynergies.size} triples in ${((Date.now() - t3) / 1000).toFixed(1)}s`,
);

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Quad cross-item correction scan (optimized)
// ═══════════════════════════════════════════════════════════════════
const quadSynergies = new Map();
let quadRules = [];
let quadCount = 0;
let quadsTested = 0;

// Build triple lookup by rep ship
const tripleByShipKey = {};
for (const [tripleKey, profileMap] of tripleSynergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      const repId = shipToGroup[shipId] || shipId;
      if (!tripleByShipKey[repId]) tripleByShipKey[repId] = {};
      tripleByShipKey[repId][tripleKey] = synergy;
    }
  }
}

// Pre-build triple rules so we can simulate boolean expected values
const tripleRules = buildRules(tripleSynergies, 3);
const tripleRulesByShip = indexRulesByShip(tripleRules);
if (maxComboSize >= 4) {
  console.log("\n[Phase 4] Quad cross-item correction scan ...");
  if (strictNMinusOne) {
    console.log(
      "[Phase 4] strict N-1 mode: testing quads even when all 3-item subsets have zero synergy.",
    );
  }
  if (allowDuplicateItems) {
    console.log(
      "[Phase 4] duplicate-item mode: enabled (multiset combinations with replacement).",
    );
  }
  const t4 = Date.now();
  let lastPhase4ProgressAt = Date.now();

  for (let si = 0; si < repShipIdsWithBonuses.length; si++) {
    const shipId = repShipIdsWithBonuses[si];
    const bItems = getAstFilteredItemsForShip(
      shipId,
      bonusItemsByRepShipArr[shipId],
    );
    if (bItems.length < 4) continue;
    if (effectiveSlotsOf[shipId] < 4) continue;
    if (!tripleByShipKey[shipId]) continue;

    const shipData = shipById[shipId];
    if (!shipData) continue;
    const ship = getShipObject(shipData);

    const tMap = tripleByShipKey[shipId];

    forEachCombinationIndices(
      bItems.length,
      4,
      allowDuplicateItems,
      ([ai, bi, ci, di]) => {
        const comboItems = [bItems[ai], bItems[bi], bItems[ci], bItems[di]];
        if (
          effectivePhase4FirstIndexRange &&
          (ai < effectivePhase4FirstIndexRange[0] ||
            ai >= effectivePhase4FirstIndexRange[1])
        ) {
          return;
        }
        const [A, B, C, D] = comboItems;
        if (!canAssignComboToShip(shipId, comboItems)) return;

        const tABC = tMap[`${A}:${B}:${C}`] ?? null;
        const tABD = tMap[`${A}:${B}:${D}`] ?? null;
        const tACD = tMap[`${A}:${C}:${D}`] ?? null;
        const tBCD = tMap[`${B}:${C}:${D}`] ?? null;
        if (!strictNMinusOne && !tABC && !tABD && !tACD && !tBCD) return;

        quadsTested++;
        {
          const now = Date.now();
          if (now - lastPhase4ProgressAt >= 2000) {
            const e = ((now - t4) / 1000).toFixed(1);
            process.stdout.write(
              `\r  ${si + 1}/${repShipIdsWithBonuses.length} rep ships | ${quadCount} corrections | ${quadsTested} tests | ${e}s`,
            );
            lastPhase4ProgressAt = now;
          }
        }

        const combined = extractNonZero(
          getSlotitemEffect(ship, comboItems.map((id) => getMakeSlot(id, 0))),
        );

        let expected = getExpectedBaseline(shipId, comboItems) || null;
        const pairExpected = simulateRules(pairRulesByShip[shipId], comboItems, 2);
        if (pairExpected) expected = statsAdd(expected, pairExpected);
        const tripleExpected = simulateRules(tripleRulesByShip[shipId], comboItems, 3);
        if (tripleExpected) expected = statsAdd(expected, tripleExpected);

        const residual = statsSub(combined, expected);
        if (!residual) return;
        if (pruneInvisible && isMeaninglessSynergy(residual)) return;

        quadCount++;
        appendSynergyForRepShip(quadSynergies, shipId, comboItems, residual);
      },
    );

    if (si === repShipIdsWithBonuses.length - 1 || (si + 1) % 10 === 0) {
      const e = ((Date.now() - t4) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ${si + 1}/${repShipIdsWithBonuses.length} rep ships | ${quadCount} corrections | ${quadsTested} tests | ${e}s`,
      );
    }
  }
  console.log("");

  console.log(
    `[Phase 4] Done: ${quadCount} quad corrections from ${quadSynergies.size} quads in ${((Date.now() - t4) / 1000).toFixed(1)}s`,
  );
  quadRules = buildRules(quadSynergies, 4);
} else {
  console.log("\n[Phase 4] Skipped by max_combo_size setting.");
}
const quadRulesByShip = indexRulesByShip(quadRules);

// ═══════════════════════════════════════════════════════════════════
// Phase 5: Penta cross-item correction scan
// ═══════════════════════════════════════════════════════════════════
const pentaSynergies = new Map();
let pentaRules = [];
let pentaCount = 0;
let pentasTested = 0;

const quadByShipKey = {};
for (const [quadKey, profileMap] of quadSynergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      const repId = shipToGroup[shipId] || shipId;
      if (!quadByShipKey[repId]) quadByShipKey[repId] = {};
      quadByShipKey[repId][quadKey] = synergy;
    }
  }
}

const quadPoolsByShip = detectPoolsByShip(quadSynergies, 4);
const repShipIdsForPenta = Object.keys(quadPoolsByShip)
  .map(Number)
  .filter((sid) => {
    const repId = shipToGroup[sid] || sid;
    return repId === sid && effectiveSlotsOf[sid] >= 5;
  })
  .sort((a, b) => a - b);

if (maxComboSize >= 5) {
  console.log("\n[Phase 5] Penta cross-item correction scan ...");
  if (strictNMinusOne) {
    console.log(
      "[Phase 5] strict N-1 mode: testing pentas even when all 4-item subsets have zero synergy.",
    );
  }
  if (allowDuplicateItems) {
    console.log(
      "[Phase 5] duplicate-item mode: enabled (multiset combinations with replacement).",
    );
  }
  const t5 = Date.now();
  let lastPhase5ProgressAt = Date.now();

  for (let si = 0; si < repShipIdsForPenta.length; si++) {
    const shipId = repShipIdsForPenta[si];
    const pools = quadPoolsByShip[shipId];
    const shipData = shipById[shipId];
    if (!shipData) continue;
    const ship = getShipObject(shipData);

    const qMap5 = quadByShipKey[shipId] || {};

    for (const { pool } of pools) {
      const filteredPool = getAstFilteredItemsForShip(shipId, pool);
      if (filteredPool.length < 5) continue;
      forEachCombinationIndices(filteredPool.length, 5, allowDuplicateItems, ([ai, bi, ci, di, ei]) => {
        if (
          firstIndexRange &&
          (ai < firstIndexRange[0] || ai >= firstIndexRange[1])
        ) {
          return;
        }
        const comboItems = [filteredPool[ai], filteredPool[bi], filteredPool[ci], filteredPool[di], filteredPool[ei]];
        const [A, B, C, D, E] = comboItems;
        if (!canAssignComboToShip(shipId, comboItems)) {
          return;
        }
        if (
          !strictNMinusOne &&
          !qMap5[`${A}:${B}:${C}:${D}`] &&
          !qMap5[`${A}:${B}:${C}:${E}`] &&
          !qMap5[`${A}:${B}:${D}:${E}`] &&
          !qMap5[`${A}:${C}:${D}:${E}`] &&
          !qMap5[`${B}:${C}:${D}:${E}`]
        ) {
          return;
        }
        pentasTested++;
        {
          const now = Date.now();
          if (now - lastPhase5ProgressAt >= 2000) {
            const e = ((now - t5) / 1000).toFixed(1);
            process.stdout.write(
              `\r  ${si + 1}/${repShipIdsForPenta.length} ships | ${pentaCount} corrections | ${pentasTested} tests | ${e}s`,
            );
            lastPhase5ProgressAt = now;
          }
        }
        const combined = extractNonZero(
          getSlotitemEffect(ship, comboItems.map((id) => getMakeSlot(id, 0))),
        );
        let expected = getExpectedBaseline(shipId, comboItems) || null;
        const pairExpected = simulateRules(pairRulesByShip[shipId], comboItems, 2);
        if (pairExpected) expected = statsAdd(expected, pairExpected);
        const tripleExpected = simulateRules(tripleRulesByShip[shipId], comboItems, 3);
        if (tripleExpected) expected = statsAdd(expected, tripleExpected);
        const quadExpected = simulateRules(quadRulesByShip[shipId], comboItems, 4);
        if (quadExpected) expected = statsAdd(expected, quadExpected);

        const residual = statsSub(combined, expected);
        if (!residual) return;
        if (pruneInvisible && isMeaninglessSynergy(residual)) return;
        pentaCount++;
        appendSynergyForRepShip(pentaSynergies, shipId, comboItems, residual);
      });
    }
    if (si === repShipIdsForPenta.length - 1 || (si + 1) % 5 === 0) {
      const e = ((Date.now() - t5) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ${si + 1}/${repShipIdsForPenta.length} ships | ${pentaCount} corrections | ${pentasTested} tests | ${e}s`,
      );
    }
  }
  console.log("");

  console.log(
    `[Phase 5] Done: ${pentaCount} penta corrections from ${pentaSynergies.size} pentas in ${((Date.now() - t5) / 1000).toFixed(1)}s`,
  );
  pentaRules = buildRules(pentaSynergies, 5);
} else {
  console.log("\n[Phase 5] Skipped by max_combo_size setting.");
}
const pentaRulesByShip = indexRulesByShip(pentaRules);

// ═══════════════════════════════════════════════════════════════════
// Phase 6: Hexa cross-item correction scan
// ═══════════════════════════════════════════════════════════════════
let hexaCount = 0;
let hexasTested = 0;

const pentaByShipKey = {};
for (const [pentaKey, profileMap] of pentaSynergies) {
  for (const { ships, synergy } of profileMap.values()) {
    for (const shipId of ships) {
      const repId = shipToGroup[shipId] || shipId;
      if (!pentaByShipKey[repId]) pentaByShipKey[repId] = {};
      pentaByShipKey[repId][pentaKey] = synergy;
    }
  }
}

const pentaPoolsByShip = detectPoolsByShip(pentaSynergies, 5);
const repShipIdsForHexa = Object.keys(pentaPoolsByShip)
  .map(Number)
  .filter((sid) => {
    const repId = shipToGroup[sid] || sid;
    return repId === sid && effectiveSlotsOf[sid] >= 6;
  })
  .sort((a, b) => a - b);

const hexaSynergies = new Map();
if (maxComboSize >= 6) {
  console.log("\n[Phase 6] Hexa cross-item correction scan ...");
  if (strictNMinusOne) {
    console.log(
      "[Phase 6] strict N-1 mode: testing hexas even when all 5-item subsets have zero synergy.",
    );
  }
  if (allowDuplicateItems) {
    console.log(
      "[Phase 6] duplicate-item mode: enabled (multiset combinations with replacement).",
    );
  }
  const t6 = Date.now();
  let lastPhase6ProgressAt = Date.now();

  for (let si = 0; si < repShipIdsForHexa.length; si++) {
    const shipId = repShipIdsForHexa[si];
    const pools = pentaPoolsByShip[shipId];
    const shipData = shipById[shipId];
    if (!shipData) continue;
    const ship = getShipObject(shipData);

    const p5Map6 = pentaByShipKey[shipId] || {};

    for (const { pool } of pools) {
      const filteredPool = getAstFilteredItemsForShip(shipId, pool);
      if (filteredPool.length < 6) continue;
      forEachCombinationIndices(
        filteredPool.length,
        6,
        allowDuplicateItems,
        ([ai, bi, ci, di, ei, fi]) => {
          if (
            firstIndexRange &&
            (ai < firstIndexRange[0] || ai >= firstIndexRange[1])
          ) {
            return;
          }
          const comboItems = [filteredPool[ai], filteredPool[bi], filteredPool[ci], filteredPool[di], filteredPool[ei], filteredPool[fi]];
          const [A, B, C, D, E, F] = comboItems;
          if (!canAssignComboToShip(shipId, comboItems)) {
            return;
          }
          if (
            !strictNMinusOne &&
            !p5Map6[`${A}:${B}:${C}:${D}:${E}`] &&
            !p5Map6[`${A}:${B}:${C}:${D}:${F}`] &&
            !p5Map6[`${A}:${B}:${C}:${E}:${F}`] &&
            !p5Map6[`${A}:${B}:${D}:${E}:${F}`] &&
            !p5Map6[`${A}:${C}:${D}:${E}:${F}`] &&
            !p5Map6[`${B}:${C}:${D}:${E}:${F}`]
          ) {
            return;
          }
          hexasTested++;
          {
            const now = Date.now();
            if (now - lastPhase6ProgressAt >= 2000) {
              const e = ((now - t6) / 1000).toFixed(1);
              process.stdout.write(
                `\r  ${si + 1}/${repShipIdsForHexa.length} ships | ${hexaCount} corrections | ${hexasTested} tests | ${e}s`,
              );
              lastPhase6ProgressAt = now;
            }
          }
          const combined = extractNonZero(
            getSlotitemEffect(ship, comboItems.map((id) => getMakeSlot(id, 0))),
          );
          let expected = getExpectedBaseline(shipId, comboItems) || null;
          const pairExpected = simulateRules(pairRulesByShip[shipId], comboItems, 2);
          if (pairExpected) expected = statsAdd(expected, pairExpected);
          const tripleExpected = simulateRules(tripleRulesByShip[shipId], comboItems, 3);
          if (tripleExpected) expected = statsAdd(expected, tripleExpected);
          const quadExpected = simulateRules(quadRulesByShip[shipId], comboItems, 4);
          if (quadExpected) expected = statsAdd(expected, quadExpected);
          const pentaExpected = simulateRules(pentaRulesByShip[shipId], comboItems, 5);
          if (pentaExpected) expected = statsAdd(expected, pentaExpected);

          const residual = statsSub(combined, expected);
          if (!residual) return;
          if (pruneInvisible && isMeaninglessSynergy(residual)) return;
          hexaCount++;
          appendSynergyForRepShip(hexaSynergies, shipId, comboItems, residual);
        },
      );
    }
    if (si === repShipIdsForHexa.length - 1 || (si + 1) % 5 === 0) {
      const e = ((Date.now() - t6) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ${si + 1}/${repShipIdsForHexa.length} ships | ${hexaCount} corrections | ${hexasTested} tests | ${e}s`,
      );
    }
  }
  console.log("");

  console.log(
    `[Phase 6] Done: ${hexaCount} hexa corrections from ${hexaSynergies.size} hexas in ${((Date.now() - t6) / 1000).toFixed(1)}s`,
  );
} else {
  console.log("\n[Phase 6] Skipped by max_combo_size setting.");
}

// ═══════════════════════════════════════════════════════════════════
// Build output (identical format to scan.js)
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

function buildCrossRules(synergiesMap) {
  const rulesMap = new Map();
  for (const [pairKey, profileMap] of synergiesMap) {
    const [aStr, bStr] = pairKey.split(":");
    const pair = [parseInt(aStr), parseInt(bStr)];
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

function buildRules(synergyMap, comboSize) {
  function tryNormalizeDuplicateCombos(combos, comboSize) {
    if (!combos || combos.length === 0) return null;
    let hasDuplicate = false;
    for (const combo of combos) {
      if (new Set(combo).size !== combo.length) {
        hasDuplicate = true;
        break;
      }
    }
    if (!hasDuplicate) return null;

    const countMapOf = (arr) => {
      const m = new Map();
      for (const id of arr) m.set(id, (m.get(id) || 0) + 1);
      return m;
    };

    let fixedCountMap = countMapOf(combos[0]);
    for (let i = 1; i < combos.length; i++) {
      const cm = countMapOf(combos[i]);
      for (const [id, c] of [...fixedCountMap.entries()]) {
        fixedCountMap.set(id, Math.min(c, cm.get(id) || 0));
      }
    }

    function toFixedItems(map) {
      const out = [];
      for (const [id, c] of map.entries()) {
        for (let i = 0; i < c; i++) out.push(id);
      }
      out.sort((a, b) => a - b);
      return out;
    }

    function tryBuildRepresentationFromFixed(map) {
      const fixedItems = toFixedItems(map);
      const remainingSize = comboSize - fixedItems.length;
      if (remainingSize <= 0) {
        return { fixed_items: fixedItems };
      }

      const remainders = [];
      for (const combo of combos) {
        const cm = countMapOf(combo);
        for (const [id, c] of map.entries()) {
          const next = (cm.get(id) || 0) - c;
          if (next < 0) return null;
          if (next === 0) cm.delete(id);
          else cm.set(id, next);
        }
        const rem = [];
        for (const [id, c] of cm.entries()) {
          for (let i = 0; i < c; i++) rem.push(id);
        }
        rem.sort((a, b) => a - b);
        if (rem.length !== remainingSize) return null;
        remainders.push(rem);
      }

      function findCategoryPoolsFromRemainders(rems, k) {
        if (!rems || rems.length === 0 || k <= 1) return null;
        const poolSet = new Set();
        for (const rem of rems) for (const id of rem) poolSet.add(id);
        const pool = [...poolSet].sort((a, b) => a - b);
        if (pool.length < k) return null;

        const appearTogether = new Map();
        for (const id of pool) appearTogether.set(id, new Set());
        for (const rem of rems) {
          for (let i = 0; i < rem.length; i++) {
            for (let j = i + 1; j < rem.length; j++) {
              appearTogether.get(rem[i]).add(rem[j]);
              appearTogether.get(rem[j]).add(rem[i]);
            }
          }
        }

        const visited = new Set();
        const components = [];
        for (const id of pool) {
          if (visited.has(id)) continue;
          const comp = [];
          const q = [id];
          visited.add(id);
          while (q.length > 0) {
            const cur = q.shift();
            comp.push(cur);
            for (const neighbor of pool) {
              if (neighbor === cur) continue;
              if (visited.has(neighbor)) continue;
              if (!appearTogether.get(cur).has(neighbor)) {
                visited.add(neighbor);
                q.push(neighbor);
              }
            }
          }
          comp.sort((a, b) => a - b);
          components.push(comp);
        }

        if (components.length !== k) return null;
        for (const comp of components) {
          for (let i = 0; i < comp.length; i++) {
            for (let j = i + 1; j < comp.length; j++) {
              if (appearTogether.get(comp[i]).has(comp[j])) return null;
            }
          }
        }

        let expected = 1;
        for (const comp of components) expected *= comp.length;
        if (expected !== rems.length) return null;
        return components;
      }

      const categoryPools = findCategoryPoolsFromRemainders(
        remainders,
        remainingSize,
      );
      if (categoryPools) {
        return {
          category_pools: [
            ...fixedItems.map((id) => [id]),
            ...categoryPools,
          ],
        };
      }

      if (remainingSize === 1) {
        const poolSet = new Set();
        for (const rem of remainders) poolSet.add(rem[0]);
        if (poolSet.size !== remainders.length) return null;
        return {
          fixed_items: fixedItems,
          free_pool: [...poolSet].sort((a, b) => a - b),
        };
      }

      const poolSet = new Set();
      for (const rem of remainders) {
        for (const id of rem) poolSet.add(id);
      }
      const freePool = [...poolSet].sort((a, b) => a - b);
      const n = freePool.length;
      const k = remainingSize;
      if (n === 0) return null;

      const expectedCount = choose(n + k - 1, k);
      if (expectedCount !== remainders.length) return null;
      if (expectedCount > 300000) return null;

      const keySet = new Set(remainders.map((r) => r.join(":")));
      const generated = [];
      const cur = [];
      function rec(start, left) {
        if (left === 0) {
          generated.push(cur.join(":"));
          return;
        }
        for (let i = start; i < freePool.length; i++) {
          cur.push(freePool[i]);
          rec(i, left - 1);
          cur.pop();
        }
      }
      rec(0, k);
      if (generated.length !== expectedCount) return null;
      for (const g of generated) {
        if (!keySet.has(g)) return null;
      }

      return {
        fixed_items: fixedItems,
        free_pool: freePool,
        free_pool_with_replacement: true,
        free_pick_count: k,
      };
    }

    // Exhaustively search fixed-count subsets so we can prefer smaller fixed
    // prefixes even when they are only valid after dropping multiple copies at once.
    const entries = [...fixedCountMap.entries()].sort((a, b) => a[0] - b[0]);
    const searchBest = (requirePositive) => {
      let bestRep = null;
      let bestFixedTotal = Number.POSITIVE_INFINITY;

      const search = (index, currentMap, currentTotal) => {
        if (currentTotal >= bestFixedTotal) return;
      if (index === entries.length) {
        const rep = tryBuildRepresentationFromFixed(currentMap);
        if (rep && (!requirePositive || currentTotal > 0)) {
          bestRep = rep;
          bestFixedTotal = currentTotal;
        }
        return;
      }

      const [id, maxCount] = entries[index];
      for (let keep = maxCount; keep >= 0; keep--) {
        if (currentTotal + keep >= bestFixedTotal) continue;
        const nextMap = new Map(currentMap);
        if (keep > 0) nextMap.set(id, keep);
        else nextMap.delete(id);
        search(index + 1, nextMap, currentTotal + keep);
      }
    };

      search(0, new Map(), 0);
      return bestRep;
    };

    // Prefer a positive fixed total when possible so truly fixed items stay
    // represented as a fixed anchor instead of only singleton pools.
    const positiveRep = searchBest(true);
    if (positiveRep) return positiveRep;
    return searchBest(false);
  }

  const rulesMap = new Map();
  for (const [key, profileMap] of synergyMap) {
    const items = key.split(":").map(Number);
    for (const { ships, synergy, cancels_single, placements } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const synSorted = Object.fromEntries(Object.entries(synergy).sort());
      const groupKey = shipsSorted.join(",") + "|" + JSON.stringify(synSorted) + (cancels_single ? "|C" : "");
      if (!rulesMap.has(groupKey)) {
        rulesMap.set(groupKey, {
          ships: shipsSorted,
          synergy: synSorted,
          cancels_single,
          combos: [],
          placements: [],
          _allItems: new Set(),
        });
      }
      const rule = rulesMap.get(groupKey);
      rule.combos.push(items);
      if (placements && placements.length > 0) {
        for (const placement of placements) {
          if (!rule.placements.some((p) => p.normal === placement.normal && p.exslot === placement.exslot)) {
            rule.placements.push(placement);
          }
        }
      }
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
    const hasDuplicateInCombos = rule.combos.some(
      (combo) => new Set(combo).size !== combo.length,
    );
    delete rule._allItems;

    if (rule.placements) {
      rule.placements.sort((a, b) => a.exslot - b.exslot || a.normal - b.normal);
    }

    if (hasDuplicateInCombos) {
      const normalized = tryNormalizeDuplicateCombos(rule.combos, comboSize);
      if (normalized) {
        Object.assign(rule, normalized);
        delete rule.combos;
        continue;
      }
      Object.assign(rule, encodeCombosB64(rule.combos, pool, comboSize));
      delete rule.combos;
      continue;
    }

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
        const kFloat = (f * poolSize) / combos.length;
        const k = Math.round(kFloat);
        if (Math.abs(k - kFloat) > 0.0001) return null;
        if (k === 0) return null;
        components.push(ids.sort((a, b) => a - b));
        counts.push(k);
        totalAssignedSize += k;
        expectedCombos *= choose(poolSize, k);
      }
      if (totalAssignedSize !== comboSize) return null;
      if (expectedCombos !== combos.length) return null;
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
      delete rule.category_pools;
      delete rule.fixed_items;
      delete rule.free_pool;
      delete rule.implicants;
      delete rule.combos_b64;
      rule.item_pool = pool;
      delete rule.combos;
    } else if (comboSize > 1 && rule.combos.length > 0) {
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
        // First try: can the free pool itself be expressed as category_pools?
        // This collapses "fixed A + any one of [large radar group]" patterns
        // into fixed_items + category_pools instead of fixed_items + free_pool.
        const freeCombos = rule.combos.map(combo => combo.filter(id => !fixedSet.has(id)));
        const freeCatPools = remainingSize > 0 ? findCategoryPools(freeCombos, freePool, remainingSize) : null;
        const freeRepPools = (!freeCatPools && remainingSize > 0) ? findRepeatedCategoryPools(freeCombos, freePool, remainingSize) : null;
        if (freeCatPools || freeRepPools) {
          // Encode as fixed_items + category_pools (fully category-aware)
          const categoryPoolsList = freeCatPools || freeRepPools;
          // Prepend fixed items each as their own singleton pool
          delete rule.item_pool;
          delete rule.fixed_items;
          delete rule.free_pool;
          delete rule.implicants;
          delete rule.combos_b64;
          rule.category_pools = [...fixedItems.map(id => [id]), ...categoryPoolsList];
          delete rule.combos;
          usedFixed = true;
        } else if (choose(freePool.length, remainingSize) === comboCount) {
          delete rule.item_pool;
          delete rule.category_pools;
          delete rule.implicants;
          delete rule.combos_b64;
          rule.fixed_items = fixedItems;
          rule.free_pool = freePool;
          delete rule.combos;
          usedFixed = true;
        }
      }
      if (!usedFixed) {
        const catPools = findCategoryPools(rule.combos, pool, comboSize);
        if (catPools) {
          delete rule.item_pool;
          delete rule.fixed_items;
          delete rule.free_pool;
          delete rule.implicants;
          delete rule.combos_b64;
          rule.category_pools = catPools;
          delete rule.combos;
        } else {
          const repPools = findRepeatedCategoryPools(rule.combos, pool, comboSize);
          if (repPools) {
            delete rule.item_pool;
            delete rule.fixed_items;
            delete rule.free_pool;
            delete rule.implicants;
            delete rule.combos_b64;
            rule.category_pools = repPools;
            delete rule.combos;
          } else {
            const implicants = compressWithZDD(rule.combos);
            if (implicants) {
              delete rule.item_pool;
              delete rule.fixed_items;
              delete rule.free_pool;
              delete rule.category_pools;
              delete rule.combos_b64;
              rule.implicants = implicants;
              delete rule.combos;
            } else {
              delete rule.item_pool;
              delete rule.fixed_items;
              delete rule.free_pool;
              delete rule.category_pools;
              delete rule.implicants;
              Object.assign(rule, encodeCombosB64(rule.combos, pool, comboSize));
              delete rule.combos;
            }
          }
        }
      }
    } else {
      const catPools = findCategoryPools(rule.combos, pool, comboSize);
      if (catPools) {
        delete rule.item_pool;
        delete rule.fixed_items;
        delete rule.free_pool;
        delete rule.implicants;
        delete rule.combos_b64;
        rule.category_pools = catPools;
        delete rule.combos;
      } else {
        const repPools = findRepeatedCategoryPools(rule.combos, pool, comboSize);
        if (repPools) {
          delete rule.item_pool;
          delete rule.fixed_items;
          delete rule.free_pool;
          delete rule.implicants;
          delete rule.combos_b64;
          rule.category_pools = repPools;
          delete rule.combos;
        } else {
          const implicants = compressWithZDD(rule.combos);
          if (implicants) {
            delete rule.item_pool;
            delete rule.fixed_items;
            delete rule.free_pool;
            delete rule.category_pools;
            delete rule.combos_b64;
            rule.implicants = implicants;
            delete rule.combos;
          } else {
            delete rule.item_pool;
            delete rule.fixed_items;
            delete rule.free_pool;
            delete rule.category_pools;
            delete rule.implicants;
            Object.assign(rule, encodeCombosB64(rule.combos, pool, comboSize));
            delete rule.combos;
          }
        }
      }
    }
  }

  function radarClassOf(itemId) {
    const type2 = itemEquipType2[itemId] || 0;
    if (type2 === 12) return "small-radar";
    if (type2 === 13) return "large-radar";
    return "other";
  }

  function splitMixedRadarPool(pool) {
    const grouped = {
      "small-radar": [],
      "large-radar": [],
      other: [],
    };
    for (const id of pool) {
      grouped[radarClassOf(id)].push(id);
    }
    if (grouped["small-radar"].length === 0 || grouped["large-radar"].length === 0) {
      return null;
    }
    return [
      grouped["small-radar"],
      grouped["large-radar"],
      ...(grouped.other.length > 0 ? [grouped.other] : []),
    ];
  }

  function splitRuleByRadarCategory(rule, comboSize) {
    if (rule.category_pools && rule.category_pools.length > 0) {
      const idx = rule.category_pools.findIndex((pool) => splitMixedRadarPool(pool));
      if (idx >= 0) {
        const splitPools = splitMixedRadarPool(rule.category_pools[idx]);
        return splitPools.map((subPool) => {
          const cloned = { ...rule };
          cloned.category_pools = rule.category_pools.map((pool, i) =>
            i === idx ? subPool : pool,
          );
          return cloned;
        });
      }
    }

    if (rule.fixed_items && rule.free_pool && rule.free_pool.length > 0) {
      const remainingPick =
        typeof rule.free_pick_count === "number"
          ? rule.free_pick_count
          : comboSize - rule.fixed_items.length;
      if (remainingPick === 1) {
        const splitPools = splitMixedRadarPool(rule.free_pool);
        if (splitPools) {
          return splitPools.map((subPool) => ({ ...rule, free_pool: subPool }));
        }
      }
    }

    return [rule];
  }

  const radarSplitRules = [];
  for (const rule of rules) {
    const firstSplit = splitRuleByRadarCategory(rule, comboSize);
    for (const candidate of firstSplit) {
      const secondSplit = splitRuleByRadarCategory(candidate, comboSize);
      radarSplitRules.push(...secondSplit);
    }
  }

  // Merge identical synergy rules to massively compress JSON size
  const mergedRules = [];
  const categoryGroups = new Map();

  function sortedPoolsForMerge(categoryPools) {
    return [...categoryPools].sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      const minA = Math.min(...a);
      const minB = Math.min(...b);
      return minA - minB;
    });
  }

  function radarProfileOfPool(pool) {
    let hasSmall = false;
    let hasLarge = false;
    for (const id of pool) {
      const cls = radarClassOf(id);
      if (cls === "small-radar") hasSmall = true;
      if (cls === "large-radar") hasLarge = true;
    }
    if (hasSmall && hasLarge) return "mixed-radar";
    if (hasSmall) return "small-radar";
    if (hasLarge) return "large-radar";
    return "other";
  }

  for (const rule of radarSplitRules) {
    if (rule.category_pools && !rule.item_pool && !rule.fixed_items && !rule.implicants && !rule.combos_b64) {
      const sortedPools = sortedPoolsForMerge(rule.category_pools);
      const radarProfileSig = sortedPools.map(radarProfileOfPool).join(",");
      const sig = JSON.stringify(rule.synergy) + (rule.cancels_single ? "|C" : "") + `|len:${rule.category_pools.length}|radar:${radarProfileSig}`;
      if (!categoryGroups.has(sig)) categoryGroups.set(sig, []);
      categoryGroups.get(sig).push(rule);
    } else {
      mergedRules.push(rule);
    }
  }

  for (const group of categoryGroups.values()) {
    if (group.length === 1) {
      mergedRules.push(group[0]);
      continue;
    }

    const poolCount = group[0].category_pools.length;
    const unionedPools = Array.from({ length: poolCount }, () => new Set());
    const unionedShips = new Set();

    for (const rule of group) {
      for (const ship of rule.ships) unionedShips.add(ship);
      
      const sortedPools = sortedPoolsForMerge(rule.category_pools);

      for (let i = 0; i < poolCount; i++) {
        for (const item of sortedPools[i]) {
          unionedPools[i].add(item);
        }
      }
    }

    const mergedRule = {
      ships: Array.from(unionedShips).sort((a, b) => a - b),
      synergy: group[0].synergy,
      category_pools: unionedPools.map(s => Array.from(s).sort((a, b) => a - b))
    };
    if (group[0].cancels_single) mergedRule.cancels_single = true;
    mergedRules.push(mergedRule);
  }

  console.log(`  [Merge] category_pools compressed from ${radarSplitRules.length} to ${mergedRules.length} rules.`);
  
  mergedRules.sort((a, b) => a.ships[0] - b.ships[0]);
  return mergedRules;
}

// Recount final values from expanded data
let finalSynergyCount = 0;
for (const [, pm] of synergies) {
  for (const { ships } of pm.values()) {
    finalSynergyCount += ships.length;
  }
}
let finalTripleCount = 0;
for (const [, pm] of tripleSynergies) {
  for (const { ships } of pm.values()) {
    finalTripleCount += ships.length;
  }
}
let finalQuadCount = 0;
for (const [, pm] of quadSynergies) {
  for (const { ships } of pm.values()) {
    finalQuadCount += ships.length;
  }
}
let finalPentaCount = 0;
for (const [, pm] of pentaSynergies) {
  for (const { ships } of pm.values()) {
    finalPentaCount += ships.length;
  }
}
let finalHexaCount = 0;
for (const [, pm] of hexaSynergies) {
  for (const { ships } of pm.values()) {
    finalHexaCount += ships.length;
  }
}

const effectRules = buildEffectRules(equipResults);
const crossRules = pairRules;
const hexaRules = buildRules(hexaSynergies, 6);

function buildEquipIndex(rules) {
  const index = {};
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const items = new Set();
    if (rule.items) rule.items.forEach(id => items.add(id));
    if (rule.item_pool) rule.item_pool.forEach(id => items.add(id));
    if (rule.fixed_items) rule.fixed_items.forEach(id => items.add(id));
    if (rule.free_pool) rule.free_pool.forEach(id => items.add(id));
    if (rule.category_pools) {
      for (const pool of rule.category_pools) {
        pool.forEach(id => items.add(id));
      }
    }
    if (rule.pairs) {
      for (const pair of rule.pairs) {
        pair.forEach(id => items.add(id));
      }
    }
    if (rule.combos) {
      for (const combo of rule.combos) {
        combo.forEach(id => items.add(id));
      }
    }
    if (rule.implicants) {
      for (const imp of rule.implicants) {
        for (const term of imp) {
          term.forEach(id => items.add(id));
        }
      }
    }
    for (const id of items) {
      if (!index[id]) index[id] = [];
      index[id].push(i);
    }
  }
  return index;
}

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

// --- Post-processing: Resolve Exclusive Groups and Eliminate Negative Rules ---
function isNegative(synergy) {
  return Object.values(synergy).some(v => v < 0);
}
// Existing statsEqual function is used
function negate(synergy) {
  const res = {};
  for (const k in synergy) {
    if (synergy[k]) res[k] = -synergy[k];
  }
  return res;
}
function extractItems(rule) {
  const items = new Set();
  if (rule.category_pools) {
    rule.category_pools.forEach(p => p.forEach(id => items.add(id)));
  }
  if (rule.implicants) {
    rule.implicants.forEach(imp => imp.forEach(p => p.forEach(id => items.add(id))));
  }
  if (rule.items) {
    rule.items.forEach(id => items.add(id));
  }
  if (rule.item_pool) rule.item_pool.forEach(id => items.add(id));
  if (rule.free_pool) rule.free_pool.forEach(id => items.add(id));
  if (rule.fixed_items) rule.fixed_items.forEach(id => items.add(id));
  if (rule.combos) rule.combos.forEach(c => c.forEach(id => items.add(id)));
  return items;
}

function resolveExclusiveGroups(rulesLower, rulesHigher, nextIdRef) {
  for (let i = 0; i < rulesHigher.length; i++) {
    const neg = rulesHigher[i];
    if (!isNegative(neg.synergy)) continue;
    
    const negated = negate(neg.synergy);
    const loserIdx = rulesLower.findIndex(r => statsEqual(r.synergy, negated));
    if (loserIdx === -1) {
      // Unresolved negative rule (no matching lower rule). Keep as-is.
      continue;
    }
    
    const loser = rulesLower[loserIdx];
    const loserItems = extractItems(loser);
    const negItems = extractItems(neg);
    
    let resolved = false;
    for (let j = 0; j < rulesLower.length; j++) {
      if (j === loserIdx) continue;
      const winnerItems = extractItems(rulesLower[j]);
      
      let isSubset = true;
      for (const item of winnerItems) {
        if (!negItems.has(item)) isSubset = false;
      }
      let sharesItem = false;
      for (const item of winnerItems) {
        if (loserItems.has(item)) sharesItem = true;
      }
      
      if (isSubset && sharesItem) {
        const gId = rulesLower[j].exclusive_group || loser.exclusive_group || nextIdRef.val++;
        rulesLower[j].exclusive_group = gId;
        loser.exclusive_group = gId;
        resolved = true;
      }
    }
    
  }
}
const nextIdRef = { val: 1 };
resolveExclusiveGroups(crossRules, tripleRules, nextIdRef);
resolveExclusiveGroups(tripleRules, quadRules, nextIdRef);
resolveExclusiveGroups(quadRules, pentaRules, nextIdRef);
resolveExclusiveGroups(pentaRules, hexaRules, nextIdRef);

finalTripleCount = tripleRules.length;
finalQuadCount = quadRules.length;

const output = {
  _meta: {
    generated: deterministic
      ? "1970-01-01T00:00:00.000Z"
      : new Date().toISOString(),
    generator_version: pkgVersion,
    api_start2_batch_hash: apiStart2BatchHash,
    period_tag: scanPeriodTag,
    strict_nminus1: strictNMinusOne,
    deterministic,
    source: path.basename(useMain ? "main.js" : "output/deobfuscated.js"),
    total_ships: mstShips.length,
    total_items: mstSlotitems.length,
    total_single_bonuses: nonZeroCount,
    total_cross_synergies: finalSynergyCount,
    total_triple_synergies: finalTripleCount,
    unique_items_with_bonus: equipResults.size,
    unique_synergy_pairs: synergies.size,
    unique_synergy_triples: tripleSynergies.size,
    total_quad_corrections: finalQuadCount,
    unique_synergy_quads: quadSynergies.size,
    total_penta_corrections: finalPentaCount,
    unique_synergy_pentas: pentaSynergies.size,
    total_hexa_corrections: finalHexaCount,
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
  effect_rules_equip_index: buildEquipIndex(effectRules),
  cross_rules_equip_index: buildEquipIndex(crossRules),
  triple_rules_equip_index: buildEquipIndex(tripleRules),
  quad_rules_equip_index: buildEquipIndex(quadRules),
  penta_rules_equip_index: buildEquipIndex(pentaRules),
  hexa_rules_equip_index: buildEquipIndex(hexaRules),
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
