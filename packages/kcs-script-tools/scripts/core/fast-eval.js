/**
 * Zero-allocation, pre-compiled evaluation primitives for KanColle synergy scanning.
 *
 * All optimizations here are mathematically equivalent to the reference
 * implementations in scan-ast.js:
 *   1. Fixed Int32Array(10) stat buffers instead of per-test JS objects & JSON.stringify.
 *   2. 6-bit slot bitmask assignment checker instead of per-test map/sort/Set backtracking.
 *   3. O(1) ship-local single-bonus profile lookup & baseline evaluator.
 *   4. Pre-compiled rule evaluator with trigger-item inverted index and packed-integer
 *      subset lookup (eliminating per-test base64 decode, Map/Set alloc, and full scans).
 *   5. Reusable level-0 SlotItemEffectParamModel wrapper (verified against the bundle's
 *      original WrapperClass at startup, with automatic fallback if fields ever change).
 */

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
const STAT_COUNT = STAT_KEYS.length; // 10

const ZERO_LEVEL_ARR = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const LEVEL0_ARRS = Array.from({ length: 16 }, (_, n) =>
  Object.freeze([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
);

function statObjToInt32(obj) {
  const arr = new Int32Array(STAT_COUNT);
  if (!obj) return arr;
  for (let i = 0; i < STAT_COUNT; i++) {
    const v = obj[STAT_KEYS[i]];
    if (v) arr[i] = v | 0;
  }
  return arr;
}

function int32ToStatObj(arr) {
  let obj = null;
  for (let i = 0; i < STAT_COUNT; i++) {
    const v = arr[i];
    if (v !== 0) {
      if (!obj) obj = {};
      obj[STAT_KEYS[i]] = v;
    }
  }
  return obj;
}

function isZeroInt32(arr) {
  for (let i = 0; i < STAT_COUNT; i++) {
    if (arr[i] !== 0) return false;
  }
  return true;
}

function int32Equal(a, b) {
  for (let i = 0; i < STAT_COUNT; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractNonZeroInto(result, outArr) {
  outArr.fill(0);
  if (!result) return false;
  let any = false;
  for (let i = 0; i < STAT_COUNT; i++) {
    const raw = result[STAT_KEYS[i]];
    if (raw == null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const iv = Math.trunc(v);
    if (iv !== v) {
      throw new Error(
        `[scan] non-integer bonus detected: stat=${STAT_KEYS[i]}, value=${String(raw)}`,
      );
    }
    if (iv !== 0) {
      outArr[i] = iv;
      any = true;
    }
  }
  return any;
}

// ── 1. Fast Bitmask Slot Assigner ───────────────────────────────────
// Ships have at most 5 normal slots + 1 exslot = 6 positions (bits 0..5).
function createFastSlotAssigner(mstShips, maxItemId, getAllowedPositions) {
  const shipMaskTable = Object.create(null);
  const shipMeta = Object.create(null);

  for (const shipData of mstShips) {
    const shipId = shipData.api_id;
    const slotNum = shipData.api_slot_num || 0;
    const normalFullMask = slotNum > 0 ? (1 << slotNum) - 1 : 0;
    const exslotBit = 1 << slotNum;
    const masks = new Uint8Array(maxItemId + 1);
    let hasRestrictedNormal = false;

    for (let itemId = 1; itemId <= maxItemId; itemId++) {
      const positions = getAllowedPositions(shipData, itemId);
      if (!positions || positions.length === 0) continue;
      let m = 0;
      for (let i = 0; i < positions.length; i++) {
        m |= 1 << positions[i];
      }
      masks[itemId] = m;
      const normalPart = m & normalFullMask;
      if (normalPart !== 0 && normalPart !== normalFullMask) {
        hasRestrictedNormal = true;
      }
    }

    shipMaskTable[shipId] = masks;
    shipMeta[shipId] = {
      slotNum,
      normalFullMask,
      exslotBit,
      hasRestrictedNormal,
    };
  }

  // Scratch buffers for general backtrack (size <= 6, zero allocation)
  const mBuf = new Uint8Array(8);

  function backtrackMask(idx, len, usedMask) {
    if (idx === len) return true;
    let avail = mBuf[idx] & ~usedMask;
    while (avail !== 0) {
      const bit = avail & -avail;
      if (backtrackMask(idx + 1, len, usedMask | bit)) return true;
      avail ^= bit;
    }
    return false;
  }

  function canAssignCombo(shipId, items) {
    const masks = shipMaskTable[shipId];
    if (!masks) return false;
    const meta = shipMeta[shipId];
    const len = items.length;
    if (len > meta.slotNum + 1) return false;

    if (!meta.hasRestrictedNormal) {
      // Fast path (covers >98% of ships): every item either fits all normal slots
      // or fits exslot or both.
      const normalFullMask = meta.normalFullMask;
      const exslotBit = meta.exslotBit;
      let normalOnly = 0;
      let exslotOnly = 0;
      let both = 0;
      for (let i = 0; i < len; i++) {
        const m = masks[items[i]];
        if (m === 0) return false;
        const canNormal = (m & normalFullMask) !== 0;
        const canEx = (m & exslotBit) !== 0;
        if (canNormal && canEx) both++;
        else if (canNormal) normalOnly++;
        else exslotOnly++;
      }
      if (exslotOnly > 1) return false;
      if (normalOnly > meta.slotNum) return false;
      if (len === meta.slotNum + 1) {
        return exslotOnly + both >= 1;
      }
      return true;
    }

    // General bitmask backtrack for ships with slot-index restrictions
    for (let i = 0; i < len; i++) {
      const m = masks[items[i]];
      if (m === 0) return false;
      mBuf[i] = m;
    }
    // Insertion sort by popcount (len <= 6) for MRV pruning
    for (let i = 1; i < len; i++) {
      const v = mBuf[i];
      let pv = v;
      pv = pv - ((pv >> 1) & 0x55);
      pv = (pv & 0x33) + ((pv >> 2) & 0x33);
      const cv = (pv + (pv >> 4)) & 0x0f;
      let j = i - 1;
      while (j >= 0) {
        let pj = mBuf[j];
        pj = pj - ((pj >> 1) & 0x55);
        pj = (pj & 0x33) + ((pj >> 2) & 0x33);
        const cj = (pj + (pj >> 4)) & 0x0f;
        if (cj <= cv) break;
        mBuf[j + 1] = mBuf[j];
        j--;
      }
      mBuf[j + 1] = v;
    }
    return backtrackMask(0, len, 0);
  }

  return { canAssignCombo, shipMaskTable, shipMeta };
}

// ── 2. Fast O(1) Single-Bonus Baseline Evaluator ────────────────────
function createFastBaselineEvaluator(equipResults, maxItemId) {
  // Map each shipId -> { itemToProf: Int32Array(maxItemId + 1), profiles: [...] }
  const byShip = Object.create(null);

  function getOrCreateShip(shipId) {
    let entry = byShip[shipId];
    if (!entry) {
      const itemToProf = new Int32Array(maxItemId + 1);
      itemToProf.fill(-1);
      entry = {
        itemToProf,
        pkToIdx: new Map(),
        profiles: [],
      };
      byShip[shipId] = entry;
    }
    return entry;
  }

  for (const [itemId, pm] of equipResults) {
    for (const [pk, data] of pm.entries()) {
      const prof = data.profile;
      const bArr = statObjToInt32(prof.b);
      const hasC2 = !!prof.c2;
      const c2Arr = hasC2 ? statObjToInt32(prof.c2) : null;
      const hasC3 = !!prof.c3;
      const c3Arr = hasC3 ? statObjToInt32(prof.c3) : null;
      const c2EqB = hasC2 ? int32Equal(bArr, c2Arr) : false;
      const c3EqC2 = hasC3
        ? int32Equal(hasC2 ? c2Arr : new Int32Array(STAT_COUNT), c3Arr)
        : false;
      const compiledProf = { bArr, hasC2, c2Arr, hasC3, c3Arr, c2EqB, c3EqC2 };

      for (let i = 0; i < data.ships.length; i++) {
        const shipId = data.ships[i];
        const entry = getOrCreateShip(shipId);
        let idx = entry.pkToIdx.get(pk);
        if (idx === undefined) {
          idx = entry.profiles.length;
          entry.pkToIdx.set(pk, idx);
          entry.profiles.push(compiledProf);
        }
        entry.itemToProf[itemId] = idx;
      }
    }
  }

  // Scratch buffers (max 6 items in a combo) — group by itemId (NOT profileIdx!)
  // so two distinct items that happen to share a c2/c3-capped profile are evaluated
  // independently rather than erroneously merged into count=2.
  const seenItemId = new Int32Array(8);
  const seenItemProfIdx = new Int32Array(8);
  const seenItemCount = new Int32Array(8);

  function computeBaselineInto(shipId, items, outArr) {
    outArr.fill(0);
    const entry = byShip[shipId];
    if (!entry) return false;
    const itemToProf = entry.itemToProf;
    const profiles = entry.profiles;

    let uniqueCount = 0;
    for (let i = 0; i < items.length; i++) {
      const itemId = items[i];
      const pIdx = itemToProf[itemId];
      if (pIdx < 0) continue;
      let found = -1;
      for (let j = 0; j < uniqueCount; j++) {
        if (seenItemId[j] === itemId) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        seenItemCount[found]++;
      } else {
        seenItemId[uniqueCount] = itemId;
        seenItemProfIdx[uniqueCount] = pIdx;
        seenItemCount[uniqueCount] = 1;
        uniqueCount++;
      }
    }

    if (uniqueCount === 0) return false;

    for (let g = 0; g < uniqueCount; g++) {
      const prof = profiles[seenItemProfIdx[g]];
      const count = seenItemCount[g];
      const bArr = prof.bArr;
      if (count === 1) {
        for (let k = 0; k < STAT_COUNT; k++) outArr[k] += bArr[k];
      } else if (count >= 3 && prof.hasC3) {
        const c3Arr = prof.c3Arr;
        if (count > 3 && !prof.c3EqC2) {
          const extraMul = count - 3;
          for (let k = 0; k < STAT_COUNT; k++) {
            outArr[k] += c3Arr[k] + bArr[k] * extraMul;
          }
        } else {
          for (let k = 0; k < STAT_COUNT; k++) outArr[k] += c3Arr[k];
        }
      } else if (count >= 2 && prof.hasC2) {
        const c2Arr = prof.c2Arr;
        if (count > 2 && !prof.c2EqB) {
          const extraMul = count - 2;
          for (let k = 0; k < STAT_COUNT; k++) {
            outArr[k] += c2Arr[k] + bArr[k] * extraMul;
          }
        } else {
          for (let k = 0; k < STAT_COUNT; k++) outArr[k] += c2Arr[k];
        }
      } else {
        for (let k = 0; k < STAT_COUNT; k++) outArr[k] += bArr[k] * count;
      }
    }

    return !isZeroInt32(outArr);
  }

  return { computeBaselineInto };
}

// ── 3. Pre-Compiled Rule Evaluator (replaces simulateRules) ─────────
// Rule kinds:
//   0: category_pools
//   1: item_pool
//   2: fixed_items + free_pool
//   3: combo_set (compiled from combos_b64 / combos_u16_b64 / combos_u32_b64 / combos)
//   4: implicants
//   5: items (exact required multiset)
const PACK_RADIX = 2048; // supports item IDs up to 2047 (current max ~750)
const PACK_RADIX_2 = PACK_RADIX * PACK_RADIX;
const PACK_RADIX_3 = PACK_RADIX_2 * PACK_RADIX;

function packSortedCombo(arr, comboSize) {
  if (comboSize === 2) return arr[0] * PACK_RADIX + arr[1];
  if (comboSize === 3) return arr[0] * PACK_RADIX_2 + arr[1] * PACK_RADIX + arr[2];
  if (comboSize === 4) {
    return (
      arr[0] * PACK_RADIX_3 +
      arr[1] * PACK_RADIX_2 +
      arr[2] * PACK_RADIX +
      arr[3]
    );
  }
  return arr.join(":");
}

function decodeCombosToSet(rule, comboSize) {
  const set = new Set();
  const triggerSet = new Set();
  const tmp = new Array(comboSize);

  const addCombo = () => {
    tmp.sort((a, b) => a - b);
    triggerSet.add(tmp[0]);
    set.add(packSortedCombo(tmp, comboSize));
  };

  if (rule.combos_gz_b64 && rule.items) {
    const raw = require("zlib").gunzipSync(Buffer.from(rule.combos_gz_b64, "base64"));
    const codec = rule.combos_codec || "u8";
    const buf =
      codec === "u16"
        ? new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
        : codec === "u32"
          ? new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
          : raw;
    const count = buf.length / comboSize;
    for (let ci = 0; ci < count; ci++) {
      const base = ci * comboSize;
      for (let j = 0; j < comboSize; j++) tmp[j] = rule.items[buf[base + j]];
      addCombo();
    }
  } else if (rule.combos_b64 && rule.items) {
    const buf = Buffer.from(rule.combos_b64, "base64");
    const count = buf.length / comboSize;
    for (let ci = 0; ci < count; ci++) {
      const base = ci * comboSize;
      for (let j = 0; j < comboSize; j++) tmp[j] = rule.items[buf[base + j]];
      addCombo();
    }
  } else if (rule.combos_u16_b64 && rule.items) {
    const raw = Buffer.from(rule.combos_u16_b64, "base64");
    const buf = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    const count = buf.length / comboSize;
    for (let ci = 0; ci < count; ci++) {
      const base = ci * comboSize;
      for (let j = 0; j < comboSize; j++) tmp[j] = rule.items[buf[base + j]];
      addCombo();
    }
  } else if (rule.combos_u32_b64 && rule.items) {
    const raw = Buffer.from(rule.combos_u32_b64, "base64");
    const buf = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const count = buf.length / comboSize;
    for (let ci = 0; ci < count; ci++) {
      const base = ci * comboSize;
      for (let j = 0; j < comboSize; j++) tmp[j] = rule.items[buf[base + j]];
      addCombo();
    }
  } else if (rule.combos) {
    for (let ci = 0; ci < rule.combos.length; ci++) {
      const c = rule.combos[ci];
      if (c.length !== comboSize) continue;
      for (let j = 0; j < comboSize; j++) tmp[j] = c[j];
      addCombo();
    }
  }

  return { set, triggers: [...triggerSet] };
}

function compileSingleRule(rule, comboSize, maxItemId) {
  const syn = statObjToInt32(rule.synergy);
  const synNonZeroIdx = [];
  const synNonZeroVal = [];
  for (let k = 0; k < STAT_COUNT; k++) {
    if (syn[k] !== 0) {
      synNonZeroIdx.push(k);
      synNonZeroVal.push(syn[k]);
    }
  }
  const synIdxArr = new Int8Array(synNonZeroIdx);
  const synValArr = new Int32Array(synNonZeroVal);

  if (rule.category_pools) {
    const poolMap = new Map();
    for (const pool of rule.category_pools) {
      const key = pool.join(",");
      if (!poolMap.has(key)) poolMap.set(key, { pool, count: 0 });
      poolMap.get(key).count++;
    }
    const groups = [];
    let smallestPool = null;
    for (const { pool, count } of poolMap.values()) {
      const bits = new Uint8Array(maxItemId + 1);
      const uniqueIds = [];
      for (const id of pool) {
        if (id >= 0 && id <= maxItemId && !bits[id]) {
          bits[id] = 1;
          uniqueIds.push(id);
        }
      }
      groups.push({ bits, ids: Int32Array.from(uniqueIds), count });
      if (!smallestPool || uniqueIds.length < smallestPool.length) {
        smallestPool = uniqueIds;
      }
    }
    // Evaluate smallest/strictest groups first
    groups.sort((a, b) => a.ids.length - b.ids.length);
    return {
      compiled: { kind: 0, groups, synIdxArr, synValArr },
      triggers: smallestPool || [],
    };
  }

  if (rule.item_pool) {
    const bits = new Uint8Array(maxItemId + 1);
    const ids = [];
    for (const id of rule.item_pool) {
      if (id >= 0 && id <= maxItemId && !bits[id]) {
        bits[id] = 1;
        ids.push(id);
      }
    }
    return {
      compiled: { kind: 1, bits, comboSize, synIdxArr, synValArr },
      triggers: ids,
    };
  }

  if (rule.fixed_items && rule.free_pool) {
    const reqMap = new Map();
    for (const id of rule.fixed_items) {
      reqMap.set(id, (reqMap.get(id) || 0) + 1);
    }
    const fixedIds = [];
    const fixedNeeds = [];
    for (const [id, need] of reqMap.entries()) {
      fixedIds.push(id);
      fixedNeeds.push(need);
    }
    const freeBits = new Uint8Array(maxItemId + 1);
    const freeIds = [];
    for (const id of rule.free_pool) {
      if (id >= 0 && id <= maxItemId && !freeBits[id]) {
        freeBits[id] = 1;
        freeIds.push(id);
      }
    }
    const needed =
      typeof rule.free_pick_count === "number"
        ? rule.free_pick_count
        : comboSize - rule.fixed_items.length;
    const triggers = fixedIds.length > 0 ? [fixedIds[0]] : freeIds;
    return {
      compiled: {
        kind: 2,
        fixedIds: Int32Array.from(fixedIds),
        fixedNeeds: Int32Array.from(fixedNeeds),
        freeBits,
        needed,
        withReplacement: !!rule.free_pool_with_replacement,
        synIdxArr,
        synValArr,
      },
      triggers,
    };
  }

  if (
    (rule.combos_gz_b64 && rule.items) ||
    (rule.combos_b64 && rule.items) ||
    (rule.combos_u16_b64 && rule.items) ||
    (rule.combos_u32_b64 && rule.items) ||
    rule.combos
  ) {
    const { set, triggers } = decodeCombosToSet(rule, comboSize);
    return {
      compiled: { kind: 3, set, comboSize, synIdxArr, synValArr },
      triggers,
    };
  }

  if (rule.implicants) {
    const imps = [];
    const triggerSet = new Set();
    for (const imp of rule.implicants) {
      const terms = [];
      let minTerm = null;
      for (const term of imp) {
        const bits = new Uint8Array(maxItemId + 1);
        const ids = [];
        for (const id of term) {
          if (id >= 0 && id <= maxItemId && !bits[id]) {
            bits[id] = 1;
            ids.push(id);
          }
        }
        terms.push(bits);
        if (!minTerm || ids.length < minTerm.length) minTerm = ids;
      }
      imps.push(terms);
      if (minTerm) {
        for (const id of minTerm) triggerSet.add(id);
      }
    }
    return {
      compiled: { kind: 4, imps, synIdxArr, synValArr },
      triggers: [...triggerSet],
    };
  }

  if (rule.items) {
    const reqMap = new Map();
    for (const id of rule.items) {
      reqMap.set(id, (reqMap.get(id) || 0) + 1);
    }
    const reqIds = [];
    const reqNeeds = [];
    for (const [id, need] of reqMap.entries()) {
      reqIds.push(id);
      reqNeeds.push(need);
    }
    return {
      compiled: {
        kind: 5,
        reqIds: Int32Array.from(reqIds),
        reqNeeds: Int32Array.from(reqNeeds),
        synIdxArr,
        synValArr,
      },
      triggers: reqIds.length > 0 ? [reqIds[0]] : [],
    };
  }

  return null;
}

function compileRulesForShip(rulesForShip, comboSize, maxItemId) {
  if (!rulesForShip || rulesForShip.length === 0) return null;
  const compiledList = [];
  const triggerBuckets = new Array(maxItemId + 1);
  const alwaysCheck = [];

  for (let i = 0; i < rulesForShip.length; i++) {
    const res = compileSingleRule(rulesForShip[i], comboSize, maxItemId);
    if (!res) continue;
    const ruleIdx = compiledList.length;
    compiledList.push(res.compiled);
    if (res.triggers.length === 0) {
      alwaysCheck.push(ruleIdx);
    } else {
      for (let t = 0; t < res.triggers.length; t++) {
        const tid = res.triggers[t];
        if (tid < 0 || tid > maxItemId) continue;
        if (!triggerBuckets[tid]) triggerBuckets[tid] = [];
        triggerBuckets[tid].push(ruleIdx);
      }
    }
  }

  if (compiledList.length === 0) return null;

  const triggerIndex = new Array(maxItemId + 1);
  for (let id = 0; id <= maxItemId; id++) {
    if (triggerBuckets[id]) {
      triggerIndex[id] = Int32Array.from(triggerBuckets[id]);
    }
  }

  return {
    comboSize,
    rules: compiledList,
    triggerIndex,
    alwaysCheck: Int32Array.from(alwaysCheck),
    seenVer: new Uint32Array(compiledList.length),
    ver: 0,
  };
}

function createCompiledRuleEvaluator(maxItemId) {
  const counts = new Int32Array(maxItemId + 1);
  const uniqueIds = new Int32Array(8);
  const sortedBuf = new Int32Array(8);
  const tmpArr = new Array(6);

  function matchComboSet(set, comboSize, sorted, len) {
    if (len < comboSize) return false;
    if (comboSize === 2) {
      for (let i = 0; i < len - 1; i++) {
        const a = sorted[i] * PACK_RADIX;
        for (let j = i + 1; j < len; j++) {
          if (set.has(a + sorted[j])) return true;
        }
      }
      return false;
    }
    if (comboSize === 3) {
      for (let i = 0; i < len - 2; i++) {
        const a = sorted[i] * PACK_RADIX_2;
        for (let j = i + 1; j < len - 1; j++) {
          const ab = a + sorted[j] * PACK_RADIX;
          for (let k = j + 1; k < len; k++) {
            if (set.has(ab + sorted[k])) return true;
          }
        }
      }
      return false;
    }
    if (comboSize === 4) {
      for (let i = 0; i < len - 3; i++) {
        const a = sorted[i] * PACK_RADIX_3;
        for (let j = i + 1; j < len - 2; j++) {
          const ab = a + sorted[j] * PACK_RADIX_2;
          for (let k = j + 1; k < len - 1; k++) {
            const abc = ab + sorted[k] * PACK_RADIX;
            for (let l = k + 1; l < len; l++) {
              if (set.has(abc + sorted[l])) return true;
            }
          }
        }
      }
      return false;
    }
    // comboSize === 5 (only reached when len === 5 or 6)
    if (comboSize === 5) {
      for (let i = 0; i < len - 4; i++) {
        tmpArr[0] = sorted[i];
        for (let j = i + 1; j < len - 3; j++) {
          tmpArr[1] = sorted[j];
          for (let k = j + 1; k < len - 2; k++) {
            tmpArr[2] = sorted[k];
            for (let l = k + 1; l < len - 1; l++) {
              tmpArr[3] = sorted[l];
              for (let m = l + 1; m < len; m++) {
                tmpArr[4] = sorted[m];
                const key = `${tmpArr[0]}:${tmpArr[1]}:${tmpArr[2]}:${tmpArr[3]}:${tmpArr[4]}`;
                if (set.has(key)) return true;
              }
            }
          }
        }
      }
      return false;
    }
    return false;
  }

  function evalSingleCompiledRule(r, uLen, len) {
    const kind = r.kind;
    if (kind === 0) {
      // category_pools
      const groups = r.groups;
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const bits = g.bits;
        let overlap = 0;
        for (let u = 0; u < uLen; u++) {
          if (bits[uniqueIds[u]]) overlap++;
        }
        if (overlap < g.count) return false;
      }
      return true;
    }
    if (kind === 1) {
      // item_pool
      const bits = r.bits;
      let overlap = 0;
      for (let u = 0; u < uLen; u++) {
        if (bits[uniqueIds[u]]) overlap++;
      }
      return overlap >= r.comboSize;
    }
    if (kind === 2) {
      // fixed_items + free_pool
      const fIds = r.fixedIds;
      const fNeeds = r.fixedNeeds;
      for (let fi = 0; fi < fIds.length; fi++) {
        if (counts[fIds[fi]] < fNeeds[fi]) return false;
      }
      const freeBits = r.freeBits;
      let avail = 0;
      if (r.withReplacement) {
        for (let u = 0; u < uLen; u++) {
          const id = uniqueIds[u];
          if (freeBits[id]) avail += counts[id];
        }
        // Subtract items already consumed by fixed_items (matches FUSOU-WEB equip-calc.ts)
        for (let fi = 0; fi < fIds.length; fi++) {
          if (freeBits[fIds[fi]]) avail -= fNeeds[fi];
        }
      } else {
        for (let u = 0; u < uLen; u++) {
          const id = uniqueIds[u];
          if (!freeBits[id]) continue;
          let remaining = counts[id];
          for (let fi = 0; fi < fIds.length; fi++) {
            if (fIds[fi] === id) {
              remaining -= fNeeds[fi];
              break;
            }
          }
          if (remaining > 0) avail++;
        }
      }
      return avail >= r.needed;
    }
    if (kind === 3) {
      return matchComboSet(r.set, r.comboSize, sortedBuf, len);
    }
    if (kind === 4) {
      // implicants
      const imps = r.imps;
      for (let ii = 0; ii < imps.length; ii++) {
        const terms = imps[ii];
        let match = true;
        for (let ti = 0; ti < terms.length; ti++) {
          const bits = terms[ti];
          let termMatch = false;
          for (let u = 0; u < uLen; u++) {
            if (bits[uniqueIds[u]]) {
              termMatch = true;
              break;
            }
          }
          if (!termMatch) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
      return false;
    }
    if (kind === 5) {
      // items
      const reqIds = r.reqIds;
      const reqNeeds = r.reqNeeds;
      for (let ri = 0; ri < reqIds.length; ri++) {
        if (counts[reqIds[ri]] < reqNeeds[ri]) return false;
      }
      return true;
    }
    return false;
  }

  function addSimulatedInto(compiledShipRules, items, outArr) {
    if (!compiledShipRules) return false;
    const len = items.length;
    if (len < compiledShipRules.comboSize) return false;

    // Populate counts, uniqueIds, and sortedBuf
    let uLen = 0;
    let isSorted = true;
    for (let i = 0; i < len; i++) {
      const id = items[i];
      sortedBuf[i] = id;
      if (i > 0 && id < items[i - 1]) isSorted = false;
      if (counts[id] === 0) {
        uniqueIds[uLen++] = id;
      }
      counts[id]++;
    }
    if (!isSorted) {
      for (let i = 1; i < len; i++) {
        const v = sortedBuf[i];
        let j = i - 1;
        while (j >= 0 && sortedBuf[j] > v) {
          sortedBuf[j + 1] = sortedBuf[j];
          j--;
        }
        sortedBuf[j + 1] = v;
      }
    }

    const rules = compiledShipRules.rules;
    const triggerIndex = compiledShipRules.triggerIndex;
    const seenVer = compiledShipRules.seenVer;
    let ver = ++compiledShipRules.ver;
    if (ver === 0xffffffff) {
      seenVer.fill(0);
      ver = compiledShipRules.ver = 1;
    }

    let any = false;
    const alwaysCheck = compiledShipRules.alwaysCheck;
    for (let i = 0; i < alwaysCheck.length; i++) {
      const rIdx = alwaysCheck[i];
      seenVer[rIdx] = ver;
      const r = rules[rIdx];
      if (evalSingleCompiledRule(r, uLen, len)) {
        const idxArr = r.synIdxArr;
        const valArr = r.synValArr;
        for (let k = 0; k < idxArr.length; k++) {
          outArr[idxArr[k]] += valArr[k];
        }
        any = true;
      }
    }

    for (let u = 0; u < uLen; u++) {
      const bucket = triggerIndex[uniqueIds[u]];
      if (!bucket) continue;
      for (let bi = 0; bi < bucket.length; bi++) {
        const rIdx = bucket[bi];
        if (seenVer[rIdx] === ver) continue;
        seenVer[rIdx] = ver;
        const r = rules[rIdx];
        if (evalSingleCompiledRule(r, uLen, len)) {
          const idxArr = r.synIdxArr;
          const valArr = r.synValArr;
          for (let k = 0; k < idxArr.length; k++) {
            outArr[idxArr[k]] += valArr[k];
          }
          any = true;
        }
      }
    }

    // Clear counts
    for (let u = 0; u < uLen; u++) {
      counts[uniqueIds[u]] = 0;
    }

    return any;
  }

  const tmpOut = new Int32Array(STAT_COUNT);
  function simulateToObj(compiledShipRules, items) {
    tmpOut.fill(0);
    if (!addSimulatedInto(compiledShipRules, items, tmpOut)) return null;
    return int32ToStatObj(tmpOut);
  }

  return { addSimulatedInto, simulateToObj };
}

// ── 4. Fast SlotItemEffectUtil with Verified Reusable Wrapper ───────
function createFastSlotItemEffectUtil({
  kcsRequire,
  kcsCache,
  getMstFn,
  astRules,
  maxItemId,
  patchGetMstInCache,
}) {
  patchGetMstInCache(kcsCache, getMstFn);

  const allSynergies = kcsRequire(87618);
  let WrapperClass = null;
  try {
    WrapperClass = kcsRequire(98672).SlotItemEffectParamModel;
  } catch {}
  if (!WrapperClass) {
    for (const mod of Object.values(kcsCache || {})) {
      if (mod?.exports?.SlotItemEffectParamModel) {
        WrapperClass = mod.exports.SlotItemEffectParamModel;
        break;
      }
    }
  }

  // Precompute radar classification flags per itemId (matches WrapperClass.get_have_rader_nums)
  // bit 0: water_rader (sakuteki >= 5)
  // bit 1: high_water_rader (meichu >= 8)
  // bit 2: air_rader (taiku >= 2)
  const radarFlagsById = new Uint8Array(maxItemId + 1);
  for (let id = 1; id <= maxItemId; id++) {
    const mst = getMstFn(id);
    if (!mst) continue;
    const et = mst.equipType;
    if (et === 12 || et === 13) {
      let flags = 0;
      if (mst.sakuteki >= 5) flags |= 1;
      if (mst.meichu >= 8) flags |= 2;
      if (mst.taiku >= 2) flags |= 4;
      radarFlagsById[id] = flags;
    }
  }

  // Verify WrapperClass internal layout once so fast wrapper is 100% safe across bundle updates.
  let canUseFastWrapper = false;
  try {
    const probeShip = { mstID: 1, yomi: "", shipTypeID: 2, getClassType: () => 1 };
    const probeItem = { mstID: 27, equipType: 12, level: 0 };
    const probe = new WrapperClass(probeShip, [probeItem]);
    const expectedKeys = [
      "SLOT_LEVEL_MAX",
      "_have_slots_dict",
      "_have_slotnums_dict",
      "_have_type3nums_dict",
      "_have_level_num_dict",
      "_have_level_num_over_dict",
      "_ship_id",
      "_yomi",
      "_stype",
      "_ctype",
    ];
    const actualKeys = Object.keys(probe);
    const radarProbe = probe.get_have_rader_nums();
    const expectedWater = (radarFlagsById[27] & 1) ? 1 : 0;
    const expectedHighWater = (radarFlagsById[27] & 2) ? 1 : 0;
    const expectedAir = (radarFlagsById[27] & 4) ? 1 : 0;
    const radarMatches =
      radarProbe &&
      radarProbe.water_rader === expectedWater &&
      radarProbe.high_water_rader === expectedHighWater &&
      radarProbe.air_rader === expectedAir;
    canUseFastWrapper =
      actualKeys.length === expectedKeys.length &&
      expectedKeys.every((k) => Object.prototype.hasOwnProperty.call(probe, k)) &&
      !!radarMatches;
  } catch {
    canUseFastWrapper = false;
  }

  const EMPTY_ARR = Object.freeze([]);

  // Fast wrapper prototype overrides hot level-0 & radar methods to avoid
  // per-call Array.apply(null, new Array(11)).map(() => 0), Object.keys, and hash-dict delete overhead.
  let FastWrapperProto = null;
  if (canUseFastWrapper) {
    FastWrapperProto = Object.create(WrapperClass.prototype);
    FastWrapperProto.get_slotnums = function (id) {
      return this._slotNumsArr[id] || 0;
    };
    FastWrapperProto.get_type3_nums = function (t) {
      return this._type3NumsArr[t] || 0;
    };
    FastWrapperProto.haveSlotLevelNum = function (id) {
      const c = this._slotNumsArr[id] || 0;
      return c === 0 ? EMPTY_ARR : (LEVEL0_ARRS[c] || [c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    };
    FastWrapperProto.haveSlotLevelNumOver = function (id) {
      const c = this._slotNumsArr[id] || 0;
      return c === 0 ? ZERO_LEVEL_ARR : (LEVEL0_ARRS[c] || [c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    };
    FastWrapperProto.have_slot_ids = function () {
      const uIds = this._usedIds;
      const uLen = this._uIdCount;
      const out = new Array(uLen);
      for (let i = 0; i < uLen; i++) out[i] = String(uIds[i]);
      return out;
    };
    FastWrapperProto.get_each_level_nums = function (id) {
      const c = this._slotNumsArr[id] || 0;
      return c === 0 ? ZERO_LEVEL_ARR : (LEVEL0_ARRS[c] || [c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    };
    FastWrapperProto.get_each_level_over_nums = function (ids) {
      // All items are level 0, so levels 1..10 are strictly 0.
      const slot = [];
      for (let i = 0; i < ids.length; i++) {
        slot[ids[i]] = ZERO_LEVEL_ARR;
      }
      return { slot, total: ZERO_LEVEL_ARR };
    };
    FastWrapperProto.getTotalCountWithOverLeveledItem = function (ids) {
      let sum = 0;
      const arr = this._slotNumsArr;
      for (let i = 0; i < ids.length; i++) {
        const c = arr[ids[i]];
        if (c) sum += c;
      }
      if (sum === 0) return ZERO_LEVEL_ARR;
      return LEVEL0_ARRS[sum] || [sum, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    };
    FastWrapperProto.get_have_rader_nums = function () {
      if (!this._raderCached) {
        let w = 0;
        let hw = 0;
        let a = 0;
        const uIds = this._usedIds;
        const uLen = this._uIdCount;
        const nums = this._slotNumsArr;
        for (let i = 0; i < uLen; i++) {
          const id = uIds[i];
          const f = radarFlagsById[id];
          if (f) {
            const c = nums[id];
            if (f & 1) w += c;
            if (f & 2) hw += c;
            if (f & 4) a += c;
          }
        }
        this._raderResult.water_rader = w;
        this._raderResult.high_water_rader = hw;
        this._raderResult.air_rader = a;
        this._raderCached = true;
      }
      return this._raderResult;
    };
    // Lazy getters for rare direct dict access (avoids per-combo object creation & delete)
    Object.defineProperty(FastWrapperProto, "have_slots_dict", {
      get() {
        if (!this._lazySlotsDict) {
          const dict = Object.create(null);
          const items = this._currentItems;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const id = it.mstID;
            if (!dict[id]) dict[id] = [it];
            else dict[id].push(it);
          }
          this._lazySlotsDict = dict;
        }
        return this._lazySlotsDict;
      },
      configurable: true,
    });
    Object.defineProperty(FastWrapperProto, "have_level_num_over_dict", {
      get() {
        if (!this._lazyLvOverDict) {
          const dict = Object.create(null);
          const uIds = this._usedIds;
          const uLen = this._uIdCount;
          const nums = this._slotNumsArr;
          for (let i = 0; i < uLen; i++) {
            const id = uIds[i];
            const c = nums[id];
            dict[id] = LEVEL0_ARRS[c] || [c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          }
          this._lazyLvOverDict = dict;
        }
        return this._lazyLvOverDict;
      },
      configurable: true,
    });
  }

  // Direct dense arrays for rule lookup (avoiding string-keyed object hashing)
  const itemIdToFuncs = new Array(maxItemId + 1);
  const itemTypeToFuncs = new Array(256);
  const funcList = [];
  const funcReqIds = [];
  const funcReqTypes = [];
  const seenFuncIndices = new Uint32Array(astRules.length + 1);
  const matchedFuncIdx = new Int32Array(astRules.length + 1);

  const idBuckets = new Array(maxItemId + 1);
  const typeBuckets = new Array(256);

  for (let i = 0; i < astRules.length; i++) {
    const rule = astRules[i];
    const fn = allSynergies[rule.funcName];
    if (!fn) continue;
    const fIdx = funcList.length;
    funcList.push(fn);
    const rIds = [];
    const rTypes = [];

    for (const id of rule.requiredItemIds) {
      if (id < 0 || id > maxItemId) continue;
      rIds.push(id);
      if (!idBuckets[id]) idBuckets[id] = [];
      idBuckets[id].push(fIdx);
    }
    for (const type of rule.requiredItemTypes) {
      if (type < 0 || type >= 256) continue;
      rTypes.push(type);
      if (!typeBuckets[type]) typeBuckets[type] = [];
      typeBuckets[type].push(fIdx);
    }
    funcReqIds.push(rIds);
    funcReqTypes.push(rTypes);
  }

  for (let i = 0; i <= maxItemId; i++) {
    if (idBuckets[i]) itemIdToFuncs[i] = Int32Array.from(idBuckets[i]);
  }
  for (let i = 0; i < 256; i++) {
    if (typeBuckets[i]) itemTypeToFuncs[i] = Int32Array.from(typeBuckets[i]);
  }

  // Per-ship pruned dispatch tables (mathematically exact: drops functions that
  // never touch any item property on this ship and return all zeros).
  const shipDispatchCache = Object.create(null);
  const SHIP_ONLY_PROPS = new Set([
    "ship_id",
    "yomi",
    "stype",
    "ctype",
    "getCountryName",
    "SLOT_LEVEL_MAX",
    "_ship_id",
    "_yomi",
    "_stype",
    "_ctype",
  ]);

  function getShipDispatch(ship) {
    const sid = ship.mstID;
    let cached = shipDispatchCache[sid];
    if (cached) return cached;

    const probeWrapper = new WrapperClass(ship, []);
    const sIdBuckets = new Array(maxItemId + 1);
    const sTypeBuckets = new Array(256);

    for (let fIdx = 0; fIdx < funcList.length; fIdx++) {
      let touchedItem = false;
      const proxy = new Proxy(probeWrapper, {
        get(target, prop) {
          if (!SHIP_ONLY_PROPS.has(prop)) touchedItem = true;
          const val = Reflect.get(target, prop, target);
          return typeof val === "function" ? val.bind(target) : val;
        },
      });
      let eff = null;
      let threw = false;
      try {
        eff = funcList[fIdx](proxy);
      } catch {
        threw = true;
      }
      let nonZero = false;
      if (eff) {
        for (let k = 0; k < STAT_COUNT; k++) {
          if (eff[STAT_KEYS[k]]) {
            nonZero = true;
            break;
          }
        }
      }
      // If the function never accessed any item property, didn't throw, and returned zero,
      // it is identically zero for this ship regardless of equipment!
      if (!touchedItem && !threw && !nonZero) continue;

      const rIds = funcReqIds[fIdx];
      for (let i = 0; i < rIds.length; i++) {
        const id = rIds[i];
        if (!sIdBuckets[id]) sIdBuckets[id] = [];
        sIdBuckets[id].push(fIdx);
      }
      const rTypes = funcReqTypes[fIdx];
      for (let i = 0; i < rTypes.length; i++) {
        const t = rTypes[i];
        if (!sTypeBuckets[t]) sTypeBuckets[t] = [];
        sTypeBuckets[t].push(fIdx);
      }
    }

    const sItemIdToFuncs = new Array(maxItemId + 1);
    const sItemTypeToFuncs = new Array(256);
    for (let i = 0; i <= maxItemId; i++) {
      if (sIdBuckets[i]) sItemIdToFuncs[i] = Int32Array.from(sIdBuckets[i]);
    }
    for (let i = 0; i < 256; i++) {
      if (sTypeBuckets[i]) sItemTypeToFuncs[i] = Int32Array.from(sTypeBuckets[i]);
    }

    cached = { itemIdToFuncs: sItemIdToFuncs, itemTypeToFuncs: sItemTypeToFuncs };
    shipDispatchCache[sid] = cached;
    return cached;
  }

  let evalVersion = 0;

  // Reusable level-0 wrapper instance (zero hash-dict mutation, pure Int32Array counters)
  const fastWrapper = canUseFastWrapper ? Object.create(FastWrapperProto) : null;
  const usedIds = new Int32Array(16);
  const usedTypes = new Int32Array(16);
  if (fastWrapper) {
    fastWrapper.SLOT_LEVEL_MAX = 10;
    fastWrapper._slotNumsArr = new Int32Array(maxItemId + 1);
    fastWrapper._type3NumsArr = new Int32Array(256);
    fastWrapper._usedIds = usedIds;
    fastWrapper._uIdCount = 0;
    fastWrapper._currentItems = null;
    fastWrapper._lazySlotsDict = null;
    fastWrapper._lazyLvOverDict = null;
    fastWrapper._raderCached = false;
    fastWrapper._raderResult = { water_rader: 0, high_water_rader: 0, air_rader: 0 };
  }

  function populateFastWrapperLevel0(ship, items) {
    fastWrapper._ship_id = ship.mstID;
    fastWrapper._yomi = ship.yomi;
    fastWrapper._stype = ship.shipTypeID;
    fastWrapper._ctype = ship.getClassType();
    fastWrapper._currentItems = items;
    fastWrapper._lazySlotsDict = null;
    fastWrapper._lazyLvOverDict = null;
    fastWrapper._raderCached = false;

    const slotNumsArr = fastWrapper._slotNumsArr;
    const type3NumsArr = fastWrapper._type3NumsArr;

    let uIdCount = 0;
    let uTypeCount = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = it.mstID;
      const t = it.equipType;

      const cur = slotNumsArr[id];
      if (cur === 0) {
        slotNumsArr[id] = 1;
        usedIds[uIdCount++] = id;
      } else {
        slotNumsArr[id] = cur + 1;
      }

      const tCur = type3NumsArr[t];
      if (tCur === 0) {
        type3NumsArr[t] = 1;
        usedTypes[uTypeCount++] = t;
      } else {
        type3NumsArr[t] = tCur + 1;
      }
    }

    fastWrapper._uIdCount = uIdCount;
    return { uIdCount, uTypeCount };
  }

  function clearFastWrapper(uIdCount, uTypeCount) {
    const slotNumsArr = fastWrapper._slotNumsArr;
    const type3NumsArr = fastWrapper._type3NumsArr;

    for (let i = 0; i < uIdCount; i++) {
      slotNumsArr[usedIds[i]] = 0;
    }
    for (let i = 0; i < uTypeCount; i++) {
      type3NumsArr[usedTypes[i]] = 0;
    }
    fastWrapper._uIdCount = 0;
  }

  function collectMatchedFuncs(ship, items) {
    const dispatch = getShipDispatch(ship);
    const idMap = dispatch.itemIdToFuncs;
    const typeMap = dispatch.itemTypeToFuncs;

    evalVersion++;
    if (evalVersion === 0xffffffff) {
      seenFuncIndices.fill(0);
      evalVersion = 1;
    }
    let matchedCount = 0;
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const byId = idMap[item.mstID];
      if (byId) {
        for (let i = 0; i < byId.length; i++) {
          const fIdx = byId[i];
          if (seenFuncIndices[fIdx] !== evalVersion) {
            seenFuncIndices[fIdx] = evalVersion;
            matchedFuncIdx[matchedCount++] = fIdx;
          }
        }
      }
      const byType = typeMap[item.equipType];
      if (byType) {
        for (let i = 0; i < byType.length; i++) {
          const fIdx = byType[i];
          if (seenFuncIndices[fIdx] !== evalVersion) {
            seenFuncIndices[fIdx] = evalVersion;
            matchedFuncIdx[matchedCount++] = fIdx;
          }
        }
      }
    }
    return matchedCount;
  }

  /**
   * Level-0 fast path writing directly into an Int32Array(10).
   * Returns true if any stat is non-zero.
   */
  function getSlotitemEffectLevel0Into(ship, items, outArr) {
    outArr.fill(0);
    const matchedCount = collectMatchedFuncs(ship, items);
    if (matchedCount === 0) return false;

    let any = false;
    if (canUseFastWrapper && items.length <= 16) {
      const { uIdCount, uTypeCount } = populateFastWrapperLevel0(ship, items);
      for (let i = 0; i < matchedCount; i++) {
        let eff = null;
        try {
          eff = funcList[matchedFuncIdx[i]](fastWrapper);
        } catch {}
        if (eff) {
          for (let k = 0; k < STAT_COUNT; k++) {
            const raw = eff[STAT_KEYS[k]];
            if (raw) {
              const v = Number(raw);
              if (Number.isFinite(v) && v !== 0) {
                const iv = Math.trunc(v);
                if (iv !== v) {
                  clearFastWrapper(uIdCount, uTypeCount);
                  throw new Error(
                    `[scan] non-integer bonus detected: stat=${STAT_KEYS[k]}, value=${String(raw)}`,
                  );
                }
                outArr[k] += iv;
                any = true;
              }
            }
          }
        }
      }
      clearFastWrapper(uIdCount, uTypeCount);
    } else {
      const wrapper = new WrapperClass(ship, items);
      for (let i = 0; i < matchedCount; i++) {
        let eff = null;
        try {
          eff = funcList[matchedFuncIdx[i]](wrapper);
        } catch {}
        if (eff) {
          for (let k = 0; k < STAT_COUNT; k++) {
            const raw = eff[STAT_KEYS[k]];
            if (raw) {
              const v = Number(raw);
              if (Number.isFinite(v) && v !== 0) {
                const iv = Math.trunc(v);
                if (iv !== v) {
                  throw new Error(
                    `[scan] non-integer bonus detected: stat=${STAT_KEYS[k]}, value=${String(raw)}`,
                  );
                }
                outArr[k] += iv;
                any = true;
              }
            }
          }
        }
      }
    }

    if (!any) return false;
    return !isZeroInt32(outArr);
  }

  /**
   * General path (supports any improvement star level 0..10), returns plain object or null.
   */
  const EXT_STAT_KEYS = [
    "houg",
    "raig",
    "tyku",
    "tais",
    "souk",
    "kaih",
    "saku",
    "baku",
    "houm",
    "raim",
    "leng",
  ];
  function getSlotitemEffect(ship, items) {
    const matchedCount = collectMatchedFuncs(ship, items);
    if (matchedCount === 0) return null;

    let allLevelZero = canUseFastWrapper && items.length <= 16;
    if (allLevelZero) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].level !== 0) {
          allLevelZero = false;
          break;
        }
      }
    }

    let hasBonus = false;
    const outStats = {};

    if (allLevelZero) {
      const { uIdCount, uTypeCount } = populateFastWrapperLevel0(ship, items);
      for (let i = 0; i < matchedCount; i++) {
        let eff = null;
        try {
          eff = funcList[matchedFuncIdx[i]](fastWrapper);
        } catch {}
        if (eff) {
          for (let k = 0; k < EXT_STAT_KEYS.length; k++) {
            const key = EXT_STAT_KEYS[k];
            if (eff[key]) {
              outStats[key] = (outStats[key] || 0) + eff[key];
              hasBonus = true;
            }
          }
        }
      }
      clearFastWrapper(uIdCount, uTypeCount);
    } else {
      const wrapper = new WrapperClass(ship, items);
      for (let i = 0; i < matchedCount; i++) {
        let eff = null;
        try {
          eff = funcList[matchedFuncIdx[i]](wrapper);
        } catch {}
        if (eff) {
          for (let k = 0; k < EXT_STAT_KEYS.length; k++) {
            const key = EXT_STAT_KEYS[k];
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

  return {
    getSlotitemEffect,
    getSlotitemEffectLevel0Into,
    canUseFastWrapper,
  };
}

module.exports = {
  STAT_KEYS,
  STAT_COUNT,
  statObjToInt32,
  int32ToStatObj,
  isZeroInt32,
  int32Equal,
  extractNonZeroInto,
  createFastSlotAssigner,
  createFastBaselineEvaluator,
  compileRulesForShip,
  createCompiledRuleEvaluator,
  createFastSlotItemEffectUtil,
};
