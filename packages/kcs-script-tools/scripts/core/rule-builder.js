/**
 * Shared rule construction, equipment permission, and compression utilities
 * used by both single-process scan-ast.js and resident-pool scan-ast-parallel.js.
 *
 * Sharing this module guarantees identical rule compression, radar splitting,
 * exclusive-group resolution, and output structure across single- and multi-worker runs.
 */

const zlib = require("zlib");
const { compressWithZDD } = require("../utils/zdd");
const { STAT_KEYS } = require("./fast-eval");

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
  if (!a && !b) return null;
  const out = {};
  let any = false;
  for (const k of STAT_KEYS) {
    const v = (a ? a[k] || 0 : 0) - (b ? b[k] || 0 : 0);
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

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

function combCount(n, k, allowDuplicates) {
  if (k < 0 || n <= 0) return 0;
  if (allowDuplicates) return choose(n + k - 1, k);
  return choose(n, k);
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
  if (codec === "u8") return { items: pool, combos_b64: plainB64 };
  if (codec === "u16") return { items: pool, combos_u16_b64: plainB64 };
  return { items: pool, combos_u32_b64: plainB64 };
}

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

function createMasterContext(masterData, targetShips = null, targetShipRange = null) {
  const mstShips = [...(masterData.api_mst_ship || [])]
    .filter((s) => {
      if (targetShips && targetShips.length > 0) return targetShips.includes(s.api_id);
      if (targetShipRange) {
        return s.api_id >= targetShipRange[0] && s.api_id <= targetShipRange[1];
      }
      return s.api_id < 1500;
    })
    .sort((a, b) => a.api_id - b.api_id);

  const mstSlotitems = [...(masterData.api_mst_slotitem || [])].sort(
    (a, b) => a.api_id - b.api_id,
  );
  const maxItemId = mstSlotitems.reduce((acc, si) => Math.max(acc, si.api_id), 0);

  const slotInfos = mstSlotitems.map((si) => ({
    id: si.api_id,
    equipType: (si.api_type && si.api_type[2]) || 0,
  }));
  const slotById = {};
  for (const s of slotInfos) slotById[s.id] = s;

  const shipById = {};
  for (const s of mstShips) shipById[s.api_id] = s;

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
  for (const [itemIdStr, info] of Object.entries(
    masterData.api_mst_equip_exslot_ship || {},
  )) {
    exslotShipRuleMap[parseInt(itemIdStr, 10)] = info;
  }

  const exslotLimitMap = {};
  for (const [shipIdStr, info] of Object.entries(
    masterData.api_mst_equip_limit_exslot || {},
  )) {
    const equip = Array.isArray(info?.api_equip) ? info.api_equip.map(Number) : [];
    exslotLimitMap[parseInt(shipIdStr, 10)] = new Set(equip);
  }

  const itemEquipType2 = {};
  const itemsByType2 = {};
  for (const si of mstSlotitems) {
    const t = (si.api_type && si.api_type[2]) || 0;
    itemEquipType2[si.api_id] = t;
    if (!itemsByType2[t]) itemsByType2[t] = [];
    itemsByType2[t].push(si.api_id);
  }

  const normalRuleCache = {};
  function getNormalSlotRule(shipData) {
    const sid = shipData.api_id;
    if (normalRuleCache[sid]) return normalRuleCache[sid];
    const override = shipEquipOverrideMap[sid];
    let res;
    if (override?.api_equip_type) {
      const allowedTypes = new Set();
      const itemAllowListByType = new Map();
      for (const [typeIdStr, value] of Object.entries(override.api_equip_type)) {
        const typeId = Number(typeIdStr);
        if (!Number.isFinite(typeId)) continue;
        allowedTypes.add(typeId);
        if (Array.isArray(value)) {
          itemAllowListByType.set(typeId, new Set(value.map(Number)));
        }
      }
      res = {
        allowedTypes,
        itemAllowListByType,
        restrictions: parseNormalSlotTypeRestrictions(override),
      };
    } else {
      const allowedTypes = stypeEquipTypeSet[shipData.api_stype] || new Set();
      res = { allowedTypes, itemAllowListByType: new Map(), restrictions: [] };
    }
    normalRuleCache[sid] = res;
    return res;
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
    if (allowedPositionsByShipItem[shipId][itemId]) {
      return allowedPositionsByShipItem[shipId][itemId];
    }

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

  const equippableByShip = {};
  const equippableByShipSet = {};
  const effectiveSlotsOf = {};
  for (const shipData of mstShips) {
    const sid = shipData.api_id;
    const list = [];
    for (const si of slotInfos) {
      if (canEquipItem(shipData, si.id)) list.push(si.id);
    }
    equippableByShip[sid] = list;
    equippableByShipSet[sid] = new Set(list);
    effectiveSlotsOf[sid] = (shipData.api_slot_num || 0) + 1;
  }

  return {
    mstShips,
    mstSlotitems,
    maxItemId,
    slotInfos,
    slotById,
    shipById,
    itemEquipType2,
    itemsByType2,
    getAllowedPositions,
    canEquipItem,
    findComboAssignment,
    getComboPlacementSummaries,
    equippableByShip,
    equippableByShipSet,
    effectiveSlotsOf,
  };
}

function buildEffectRules(equipResultsMap) {
  const rulesMap = new Map();
  for (const [itemId, profileMap] of equipResultsMap) {
    for (const { ships, profile } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const profNorm = {
        b: Object.fromEntries(Object.entries(profile.b).sort()),
      };
      if (profile.l) {
        profNorm.l = Object.fromEntries(Object.entries(profile.l).sort());
      }
      if (profile.i) {
        profNorm.i = profile.i.map(([lv, stats]) => [
          lv,
          Object.fromEntries(Object.entries(stats).sort()),
        ]);
      }
      if (profile.c2) {
        profNorm.c2 = Object.fromEntries(Object.entries(profile.c2).sort());
      }
      if (profile.c3) {
        profNorm.c3 = Object.fromEntries(Object.entries(profile.c3).sort());
      }
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

function buildRules(synergyMap, comboSize, itemEquipType2, { silent = false } = {}) {
  function tryNormalizeDuplicateCombos(combos, size) {
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
      const remainingSize = size - fixedItems.length;
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
        // category_pools evaluates via distinct equippedSet membership, so it is ONLY
        // mathematically valid when fixedItems has no duplicates and is disjoint from all pools.
        const fixedUnique = new Set(fixedItems);
        let disjoint = fixedUnique.size === fixedItems.length;
        if (disjoint) {
          for (const cp of categoryPools) {
            for (const id of cp) {
              if (fixedUnique.has(id)) {
                disjoint = false;
                break;
              }
            }
            if (!disjoint) break;
          }
        }
        if (disjoint) {
          return {
            category_pools: [
              ...fixedItems.map((id) => [id]),
              ...categoryPools,
            ],
          };
        }
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

    const positiveRep = searchBest(true);
    if (positiveRep) return positiveRep;
    return searchBest(false);
  }

  const rulesMap = new Map();
  for (const [key, profileMap] of synergyMap) {
    const items = key.split(":").map(Number);
    for (const {
      ships,
      synergy,
      cancels_single,
      suppressed_components,
      placements,
    } of profileMap.values()) {
      const shipsSorted = [...ships].sort((a, b) => a - b);
      const synSorted = Object.fromEntries(Object.entries(synergy).sort());
      const groupKey =
        shipsSorted.join(",") +
        "|" +
        JSON.stringify(synSorted) +
        (cancels_single ? "|C" : "") +
        (suppressed_components ? "|S:" + suppressed_components.join(",") : "");
      if (!rulesMap.has(groupKey)) {
        rulesMap.set(groupKey, {
          ships: shipsSorted,
          synergy: synSorted,
          cancels_single,
          suppressed_components,
          combos: [],
          placements: [],
          _allItems: new Set(),
        });
      }
      const rule = rulesMap.get(groupKey);
      rule.combos.push(items);
      if (placements && placements.length > 0) {
        for (const placement of placements) {
          if (
            !rule.placements.some(
              (p) => p.normal === placement.normal && p.exslot === placement.exslot,
            )
          ) {
            rule.placements.push(placement);
          }
        }
      }
      for (const id of items) rule._allItems.add(id);
    }
  }
  function findCategoryPools(combos, p, size) {
    if (combos.length === 0 || p.length === 0) return null;
    const appearTogether = new Map();
    for (const id of p) appearTogether.set(id, new Set());
    for (const combo of combos) {
      for (let a = 0; a < combo.length; a++) {
        for (let b = a + 1; b < combo.length; b++) {
          appearTogether.get(combo[a]).add(combo[b]);
          appearTogether.get(combo[b]).add(combo[a]);
        }
      }
    }
    const visited = new Set();
    const components = [];
    for (const id of p) {
      if (visited.has(id)) continue;
      const comp = [];
      const queue = [id];
      visited.add(id);
      while (queue.length > 0) {
        const curr = queue.shift();
        comp.push(curr);
        for (const neighbor of p) {
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
    if (components.length !== size) return null;
    for (const comp of components) {
      for (let a = 0; a < comp.length; a++) {
        for (let b = a + 1; b < comp.length; b++) {
          if (appearTogether.get(comp[a]).has(comp[b])) return null;
        }
      }
    }
    let expectedCombos = 1;
    for (const comp of components) expectedCombos *= comp.length;
    if (combos.length !== expectedCombos) return null;
    return components;
  }

  function findRepeatedCategoryPools(combos, p, size) {
    if (combos.length === 0 || p.length === 0) return null;
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
    if (totalAssignedSize !== size) return null;
    if (expectedCombos !== combos.length) return null;
    const compSets = components.map((c) => new Set(c));
    for (const combo of combos) {
      const matchCounts = new Array(components.length).fill(0);
      for (const id of combo) {
        for (let ci = 0; ci < compSets.length; ci++) {
          if (compSets[ci].has(id)) {
            matchCounts[ci]++;
            break;
          }
        }
      }
      for (let ci = 0; ci < components.length; ci++) {
        if (matchCounts[ci] !== counts[ci]) return null;
      }
    }
    const result = [];
    for (let ci = 0; ci < components.length; ci++) {
      for (let j = 0; j < counts[ci]; j++) {
        result.push(components[ci]);
      }
    }
    return result;
  }

  function compressDistinctCombos(combos, pool, size) {
    if (pool.length >= size && choose(pool.length, size) === combos.length) {
      return { item_pool: pool };
    }
    if (size > 1 && combos.length > 0) {
      const comboCount = combos.length;
      const freq = new Map();
      for (const combo of combos) {
        for (const id of combo) freq.set(id, (freq.get(id) || 0) + 1);
      }
      const fixedItems = pool.filter((id) => freq.get(id) === comboCount);
      if (fixedItems.length > 0 && fixedItems.length < size) {
        const fixedSet = new Set(fixedItems);
        const freePool = pool.filter((id) => !fixedSet.has(id));
        const remainingSize = size - fixedItems.length;
        const freeCombos = combos.map((combo) =>
          combo.filter((id) => !fixedSet.has(id)),
        );
        const freeCatPools =
          remainingSize > 0
            ? findCategoryPools(freeCombos, freePool, remainingSize)
            : null;
        const freeRepPools =
          !freeCatPools && remainingSize > 0
            ? findRepeatedCategoryPools(freeCombos, freePool, remainingSize)
            : null;
        if (freeCatPools || freeRepPools) {
          return {
            category_pools: [
              ...fixedItems.map((id) => [id]),
              ...(freeCatPools || freeRepPools),
            ],
          };
        }
        if (choose(freePool.length, remainingSize) === comboCount) {
          return { fixed_items: fixedItems, free_pool: freePool };
        }
      }
    }

    const catPools = findCategoryPools(combos, pool, size);
    if (catPools) return { category_pools: catPools };

    const repPools = findRepeatedCategoryPools(combos, pool, size);
    if (repPools) return { category_pools: repPools };

    const implicants = compressWithZDD(combos);
    if (implicants) {
      const encoded = encodeCombosB64(combos, pool, size);
      const impLen = JSON.stringify(implicants).length;
      const encLen = JSON.stringify(encoded).length;
      if (impLen < encLen) {
        return { implicants };
      }
      return encoded;
    }

    return encodeCombosB64(combos, pool, size);
  }

  function hasDuplicateItem(combo) {
    for (let j = 1; j < combo.length; j++) {
      if (combo[j] === combo[j - 1]) return true;
    }
    return false;
  }

  function poolOfCombos(combos) {
    const s = new Set();
    for (let i = 0; i < combos.length; i++) {
      const c = combos[i];
      for (let j = 0; j < c.length; j++) s.add(c[j]);
    }
    return [...s].sort((a, b) => a - b);
  }

  const rawRules = [...rulesMap.values()];
  const rules = [];
  for (let i = 0; i < rawRules.length; i++) {
    const rule = rawRules[i];
    if (!silent && (i === rawRules.length - 1 || i % 100 === 0)) {
      process.stdout.write(`\r  [Building Size ${comboSize}] Group ${i + 1}/${rawRules.length}... `);
    }
    rule.combos.sort((a, b) => {
      for (let j = 0; j < a.length; j++) {
        if (a[j] !== b[j]) return a[j] - b[j];
      }
      return 0;
    });
    const pool = [...rule._allItems].sort((a, b) => a - b);
    delete rule._allItems;

    if (rule.placements) {
      rule.placements.sort((a, b) => a.exslot - b.exslot || a.normal - b.normal);
    }

    let hasDuplicateInCombos = false;
    for (let c = 0; c < rule.combos.length; c++) {
      if (hasDuplicateItem(rule.combos[c])) {
        hasDuplicateInCombos = true;
        break;
      }
    }

    if (hasDuplicateInCombos) {
      const normalized = tryNormalizeDuplicateCombos(rule.combos, comboSize);
      if (normalized) {
        Object.assign(rule, normalized);
        delete rule.combos;
        rules.push(rule);
        continue;
      }

      // Split into distinct-item combos (which compress heavily via pools/ZDD)
      // and duplicate-item combos (which are a small residual subset).
      const distinctCombos = [];
      const dupCombos = [];
      for (let c = 0; c < rule.combos.length; c++) {
        const combo = rule.combos[c];
        if (hasDuplicateItem(combo)) dupCombos.push(combo);
        else distinctCombos.push(combo);
      }

      if (distinctCombos.length > 0 && dupCombos.length > 0) {
        const baseMeta = {
          ships: rule.ships,
          synergy: rule.synergy,
        };
        if (rule.cancels_single) baseMeta.cancels_single = true;
        if (rule.suppressed_components) {
          baseMeta.suppressed_components = rule.suppressed_components;
        }
        if (rule.placements) baseMeta.placements = rule.placements;

        const distinctPool = poolOfCombos(distinctCombos);
        const distinctRule = {
          ...baseMeta,
          ...compressDistinctCombos(distinctCombos, distinctPool, comboSize),
        };
        rules.push(distinctRule);

        const dupNorm = tryNormalizeDuplicateCombos(dupCombos, comboSize);
        const dupPool = poolOfCombos(dupCombos);
        const dupRule = {
          ...baseMeta,
          ...(dupNorm || encodeCombosB64(dupCombos, dupPool, comboSize)),
        };
        rules.push(dupRule);
        continue;
      }

      Object.assign(rule, encodeCombosB64(rule.combos, pool, comboSize));
      delete rule.combos;
      rules.push(rule);
      continue;
    }

    const rep = compressDistinctCombos(rule.combos, pool, comboSize);
    delete rule.combos;
    Object.assign(rule, rep);
    rules.push(rule);
  }

  function radarClassOf(itemId) {
    const type2 = itemEquipType2[itemId] || 0;
    if (type2 === 12) return "small-radar";
    if (type2 === 13) return "large-radar";
    return "other";
  }

  function splitMixedRadarPool(pool) {
    const grouped = { "small-radar": [], "large-radar": [], other: [] };
    for (const id of pool) grouped[radarClassOf(id)].push(id);
    if (grouped["small-radar"].length === 0 || grouped["large-radar"].length === 0) {
      return null;
    }
    return [
      grouped["small-radar"],
      grouped["large-radar"],
      ...(grouped.other.length > 0 ? [grouped.other] : []),
    ];
  }

  function splitRuleByRadarCategory(rule, size) {
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
          : size - rule.fixed_items.length;
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

  function sortedPoolsForMerge(categoryPools) {
    return [...categoryPools].sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return Math.min(...a) - Math.min(...b);
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

  /**
   * Mathematically exact category_pools merge:
   *  Pass A: Identical category_pools (and metadata) -> union `ships`.
   *  Pass B: Identical `ships` (and metadata) + (k - 1) identical pools -> union the 1 differing pool.
   * Unlike naive cross-ship pool unioning, this NEVER introduces false (ship, combo) pairs.
   */
  function exactMergeCategoryPoolRules(inputRules) {
    function canonicalPoolKey(pools) {
      return pools.map((p) => p.join(",")).sort().join("|");
    }

    const metaSig = (rule) =>
      JSON.stringify(rule.synergy) +
      (rule.cancels_single ? "|C" : "") +
      (rule.suppressed_components ? "|S:" + rule.suppressed_components.join(",") : "");

    const isPureCategoryPoolRule = (rule) =>
      !!rule.category_pools &&
      !rule.item_pool &&
      !rule.fixed_items &&
      !rule.implicants &&
      !rule.combos_b64 &&
      !rule.combos_u16_b64 &&
      !rule.combos_u32_b64 &&
      !rule.combos_gz_b64;

    const nonCat = [];
    let catRules = [];
    for (const rule of inputRules) {
      if (isPureCategoryPoolRule(rule)) catRules.push(rule);
      else nonCat.push(rule);
    }

    // Repeat Pass B (merge 1 differing pool for identical ships) + Pass A (merge identical pools across ships)
    for (let iter = 0; iter < 4; iter++) {
      let changed = false;

      // Pass A: Exact same category_pools + radarProfile -> union ships
      const byPools = new Map();
      for (const rule of catRules) {
        const sortedPools = sortedPoolsForMerge(rule.category_pools);
        const radarSig = sortedPools.map(radarProfileOfPool).join(",");
        const key = `${metaSig(rule)}|r:${radarSig}|p:${canonicalPoolKey(sortedPools)}`;
        const existing = byPools.get(key);
        if (!existing) {
          byPools.set(key, {
            ...rule,
            ships: [...rule.ships],
            category_pools: sortedPools.map((p) => [...p]),
          });
        } else {
          for (const s of rule.ships) existing.ships.push(s);
          if (rule.placements && existing.placements) {
            for (const pl of rule.placements) {
              if (!existing.placements.some((x) => x.normal === pl.normal && x.exslot === pl.exslot)) {
                existing.placements.push(pl);
              }
            }
          }
          changed = true;
        }
      }
      catRules = [];
      for (const r of byPools.values()) {
        r.ships = [...new Set(r.ships)].sort((a, b) => a - b);
        if (r.placements) r.placements.sort((a, b) => a.exslot - b.exslot || a.normal - b.normal);
        catRules.push(r);
      }

      // Pass B: Exact same ships + metadata + radarSig + (k - 1) identical pools -> union 1 differing pool
      const byShipGroup = new Map();
      for (const rule of catRules) {
        const sortedPools = sortedPoolsForMerge(rule.category_pools);
        const radarSig = sortedPools.map(radarProfileOfPool).join(",");
        const key = `${rule.ships.join(",")}|${metaSig(rule)}|len:${sortedPools.length}|r:${radarSig}`;
        let list = byShipGroup.get(key);
        if (!list) {
          list = [];
          byShipGroup.set(key, list);
        }
        list.push(rule);
      }

      const nextCat = [];
      for (const list of byShipGroup.values()) {
        if (list.length === 1) {
          nextCat.push(list[0]);
          continue;
        }
        const used = new Uint8Array(list.length);
        const buckets = new Map();
        for (let i = 0; i < list.length; i++) {
          const pools = list[i].category_pools;
          const k = pools.length;
          const strs = pools.map((p) => p.join(","));
          for (let skip = 0; skip < k; skip++) {
            const others = [];
            for (let c = 0; c < k; c++) if (c !== skip) others.push(strs[c]);
            others.sort();
            const bKey = `${radarProfileOfPool(pools[skip])}|${others.join(";")}`;
            let bList = buckets.get(bKey);
            if (!bList) {
              bList = [];
              buckets.set(bKey, bList);
            }
            bList.push(i, skip);
          }
        }
        const mergeable = [...buckets.values()].filter((b) => b.length >= 4);
        mergeable.sort((a, b) => b.length - a.length);
        for (const bList of mergeable) {
          const picked = [];
          const skips = [];
          for (let p = 0; p < bList.length; p += 2) {
            const idx = bList[p];
            if (used[idx] || picked.includes(idx)) continue;
            picked.push(idx);
            skips.push(bList[p + 1]);
          }
          if (picked.length < 2) continue;
          const base = list[picked[0]];
          const baseSkip = skips[0];
          const mergedPoolSet = new Set(base.category_pools[baseSkip]);
          for (let m = 1; m < picked.length; m++) {
            for (const id of list[picked[m]].category_pools[skips[m]]) {
              mergedPoolSet.add(id);
            }
          }
          // Safety: ensure mergedPool does not overlap other pools unless identical (no duplicate combos introduced)
          let safe = true;
          for (let c = 0; c < base.category_pools.length; c++) {
            if (c === baseSkip) continue;
            for (const id of base.category_pools[c]) {
              if (mergedPoolSet.has(id)) {
                safe = false;
                break;
              }
            }
            if (!safe) break;
          }
          if (!safe) continue;

          const newPools = base.category_pools.map((p, c) =>
            c === baseSkip ? [...mergedPoolSet].sort((a, b) => a - b) : [...p],
          );
          const mergedRule = { ...base, category_pools: newPools };
          for (let m = 0; m < picked.length; m++) used[picked[m]] = 1;
          nextCat.push(mergedRule);
          changed = true;
        }
        for (let i = 0; i < list.length; i++) {
          if (!used[i]) nextCat.push(list[i]);
        }
      }
      catRules = nextCat;
      if (!changed) break;
    }

    return [...nonCat, ...catRules];
  }

  const mergedRules = exactMergeCategoryPoolRules(radarSplitRules);

  if (!silent) {
    console.log(
      `\r  [Merge Size ${comboSize}] category_pools compressed from ${radarSplitRules.length} to ${mergedRules.length} rules.`,
    );
  }

  mergedRules.sort((a, b) => a.ships[0] - b.ships[0]);
  return mergedRules;
}

/**
 * Merge compressed rules produced per representative ship group into a single
 * deduplicated and category-pool-merged rule array.
 * Keeps peak memory O(single ship) during streaming parallel phases.
 */
function mergeCompressedRules(ruleLists, itemEquipType2) {
  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }

  // 1. Merge exact duplicate rules across ships (identical rule body except `ships` and `placements`)
  const exactMap = new Map();
  for (const list of ruleLists) {
    for (const rule of list || []) {
      const { ships, placements, ...rest } = rule;
      const key = stableStringify(rest);
      if (!exactMap.has(key)) {
        exactMap.set(key, {
          ...rest,
          ...(placements ? { placements: [...placements] } : {}),
          ships: [],
        });
      }
      const target = exactMap.get(key);
      for (const s of ships || []) target.ships.push(s);
      if (placements && target.placements) {
        for (const pl of placements) {
          if (!target.placements.some((x) => x.normal === pl.normal && x.exslot === pl.exslot)) {
            target.placements.push(pl);
          }
        }
      }
    }
  }
  const mergedRules = [];
  for (const r of exactMap.values()) {
    r.ships = [...new Set(r.ships)].sort((a, b) => a - b);
    if (r.placements) r.placements.sort((a, b) => a.exslot - b.exslot || a.normal - b.normal);
    mergedRules.push(r);
  }

  mergedRules.sort((a, b) => (a.ships[0] || 0) - (b.ships[0] || 0));
  return mergedRules;
}

function buildEquipIndex(rules) {
  const index = {};
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const items = new Set();
    if (rule.items) rule.items.forEach((id) => items.add(id));
    if (rule.item_pool) rule.item_pool.forEach((id) => items.add(id));
    if (rule.fixed_items) rule.fixed_items.forEach((id) => items.add(id));
    if (rule.free_pool) rule.free_pool.forEach((id) => items.add(id));
    if (rule.category_pools) {
      for (const pool of rule.category_pools) pool.forEach((id) => items.add(id));
    }
    if (rule.pairs) {
      for (const pair of rule.pairs) pair.forEach((id) => items.add(id));
    }
    if (rule.combos) {
      for (const combo of rule.combos) combo.forEach((id) => items.add(id));
    }
    if (rule.implicants) {
      for (const imp of rule.implicants) {
        for (const term of imp) term.forEach((id) => items.add(id));
      }
    }
    for (const id of items) {
      if (!index[id]) index[id] = [];
      index[id].push(i);
    }
  }
  return index;
}

function isNegative(synergy) {
  return Object.values(synergy).some((v) => v < 0);
}

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
    rule.category_pools.forEach((p) => p.forEach((id) => items.add(id)));
  }
  if (rule.implicants) {
    rule.implicants.forEach((imp) => imp.forEach((p) => p.forEach((id) => items.add(id))));
  }
  if (rule.items) rule.items.forEach((id) => items.add(id));
  if (rule.item_pool) rule.item_pool.forEach((id) => items.add(id));
  if (rule.free_pool) rule.free_pool.forEach((id) => items.add(id));
  if (rule.fixed_items) rule.fixed_items.forEach((id) => items.add(id));
  if (rule.combos) rule.combos.forEach((c) => c.forEach((id) => items.add(id)));
  return items;
}

function resolveExclusiveGroups(rulesLower, rulesHigher, nextIdRef) {
  if (
    !rulesLower ||
    rulesLower.length === 0 ||
    !rulesHigher ||
    rulesHigher.length === 0
  ) {
    return;
  }

  // Precompute:
  // 1) firstBySynKey: first index per synergy key (exact equivalent of Array.findIndex)
  // 2) lowerItemsArr: flat item arrays for each lower rule
  // 3) rarestBuckets: each non-empty lower rule j is indexed ONLY under its single rarest item.
  //    Proof of exactness: if winnerItems ⊆ negItems and winnerItems ≠ ∅, then rarestItem(j) ∈ negItems,
  //    so scanning rarestBuckets[item] for item ∈ negItems visits every valid winner at most once.
  const firstBySynKey = new Map();
  const lowerItemsArr = new Array(rulesLower.length);
  const itemFreq = new Map();
  let maxId = 0;

  for (let j = 0; j < rulesLower.length; j++) {
    const r = rulesLower[j];
    const sk = bkey(r.synergy);
    if (!firstBySynKey.has(sk)) firstBySynKey.set(sk, j);
    const itemsSet = extractItems(r);
    const arr = new Int32Array(itemsSet.size);
    let p = 0;
    for (const id of itemsSet) {
      arr[p++] = id;
      if (id > maxId) maxId = id;
      itemFreq.set(id, (itemFreq.get(id) || 0) + 1);
    }
    lowerItemsArr[j] = arr;
  }

  const rarestBuckets = new Map();
  for (let j = 0; j < rulesLower.length; j++) {
    const arr = lowerItemsArr[j];
    if (arr.length === 0) continue;
    let rarestId = arr[0];
    let minFreq = itemFreq.get(rarestId);
    for (let k = 1; k < arr.length; k++) {
      const id = arr[k];
      const f = itemFreq.get(id);
      if (f < minFreq) {
        minFreq = f;
        rarestId = id;
      }
    }
    let bucket = rarestBuckets.get(rarestId);
    if (!bucket) {
      bucket = [];
      rarestBuckets.set(rarestId, bucket);
    }
    bucket.push(j);
  }

  // Stamp arrays for O(1) membership checks without Set allocations
  let negStamp = new Uint32Array(maxId + 1);
  let loserStamp = new Uint32Array(maxId + 1);
  let stampVer = 0;

  function ensureStampCapacity(id) {
    if (id >= negStamp.length) {
      const nextLen = Math.max(id + 1, negStamp.length * 2);
      const nextNeg = new Uint32Array(nextLen);
      nextNeg.set(negStamp);
      negStamp = nextNeg;
      const nextLoser = new Uint32Array(nextLen);
      nextLoser.set(loserStamp);
      loserStamp = nextLoser;
    }
  }

  const matchedWinners = [];

  for (let i = 0; i < rulesHigher.length; i++) {
    const neg = rulesHigher[i];
    if (!isNegative(neg.synergy)) continue;

    const negatedKey = bkey(negate(neg.synergy));
    const loserIdx = firstBySynKey.get(negatedKey);
    if (loserIdx === undefined) continue;

    const loserArr = lowerItemsArr[loserIdx];
    if (loserArr.length === 0) continue;

    const negItems = extractItems(neg);
    const negSize = negItems.size;
    if (negSize === 0) continue;

    stampVer++;
    if (stampVer === 0xffffffff) {
      negStamp.fill(0);
      loserStamp.fill(0);
      stampVer = 1;
    }

    for (const id of negItems) {
      if (id >= negStamp.length) ensureStampCapacity(id);
      negStamp[id] = stampVer;
    }

    // Quick necessary check: winnerItems ⊆ negItems and winnerItems ∩ loserItems ≠ ∅
    // implies loserItems ∩ negItems ≠ ∅.
    let loserNegOverlap = false;
    for (let m = 0; m < loserArr.length; m++) {
      const id = loserArr[m];
      loserStamp[id] = stampVer;
      if (negStamp[id] === stampVer) loserNegOverlap = true;
    }
    if (!loserNegOverlap) continue;

    matchedWinners.length = 0;
    for (const item of negItems) {
      const bucket = rarestBuckets.get(item);
      if (!bucket) continue;
      for (let b = 0; b < bucket.length; b++) {
        const j = bucket[b];
        if (j === loserIdx) continue;
        const wArr = lowerItemsArr[j];
        const wLen = wArr.length;
        if (wLen > negSize) continue;
        let isSubset = true;
        let hasOverlap = false;
        for (let m = 0; m < wLen; m++) {
          const id = wArr[m];
          if (negStamp[id] !== stampVer) {
            isSubset = false;
            break;
          }
          if (loserStamp[id] === stampVer) {
            hasOverlap = true;
          }
        }
        if (isSubset && hasOverlap) {
          matchedWinners.push(j);
        }
      }
    }

    if (matchedWinners.length === 0) continue;
    if (matchedWinners.length > 1) matchedWinners.sort((a, b) => a - b);

    const loser = rulesLower[loserIdx];
    for (let c = 0; c < matchedWinners.length; c++) {
      const j = matchedWinners[c];
      const gId = rulesLower[j].exclusive_group || loser.exclusive_group || nextIdRef.val++;
      rulesLower[j].exclusive_group = gId;
      loser.exclusive_group = gId;
    }
  }
}

function compressRuleCombosGzip(rules) {
  if (!rules || rules.length === 0) return;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    let key = null;
    let codec = null;
    if (rule.combos_b64) {
      key = "combos_b64";
      codec = "u8";
    } else if (rule.combos_u16_b64) {
      key = "combos_u16_b64";
      codec = "u16";
    } else if (rule.combos_u32_b64) {
      key = "combos_u32_b64";
      codec = "u32";
    }
    if (!key) continue;
    const plainB64 = rule[key];
    // Skip tiny payloads where gzip header + codec field overhead exceeds savings
    if (plainB64.length < 96) continue;
    const raw = Buffer.from(plainB64, "base64");
    const gzB64 = zlib.gzipSync(raw, { level: 9 }).toString("base64");
    if (gzB64.length + 28 < plainB64.length) {
      delete rule[key];
      rule.combos_gz_b64 = gzB64;
      rule.combos_codec = codec;
    }
  }
}

module.exports = {
  bkey,
  statsEqual,
  statsAdd,
  statsSub,
  isMeaninglessSynergy,
  choose,
  combCount,
  encodeCombosB64,
  compressRuleCombosGzip,
  indexRulesByShip,
  detectPoolsByShip,
  createMasterContext,
  buildEffectRules,
  buildRules,
  mergeCompressedRules,
  buildEquipIndex,
  resolveExclusiveGroups,
};
