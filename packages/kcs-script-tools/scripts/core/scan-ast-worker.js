#!/usr/bin/env node
/**
 * Resident IPC worker for parallel synergy scanning.
 *
 * Loads deobfuscated.js, master data, and AST rules ONCE per worker process,
 * then executes dynamically scheduled chunks across Phases 1-6 via IPC.
 */

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  parseMasterData,
  buildMstDict,
  createGetMst,
  loadBundle,
} = require("../../lib/loader");
const {
  STAT_KEYS,
  STAT_COUNT,
  statObjToInt32,
  int32ToStatObj,
  extractNonZeroInto,
  createFastSlotAssigner,
  createFastBaselineEvaluator,
  compileRulesForShip,
  createCompiledRuleEvaluator,
  createFastSlotItemEffectUtil,
} = require("./fast-eval");
const {
  bkey,
  statsEqual,
  statsSub,
  isMeaninglessSynergy,
  indexRulesByShip,
  createMasterContext,
} = require("./rule-builder");

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
          if (name === "getMst" && typeof desc.value === "function") {
            node[name] = getMstFn;
            patched++;
            continue;
          }
          if (
            desc.value &&
            (typeof desc.value === "object" || typeof desc.value === "function")
          ) {
            stack.push(desc.value);
          }
        } catch {}
      }
    }
  }
  for (const mod of Object.values(kcsCache || {})) {
    if (mod && typeof mod === "object") {
      patchNode(mod.exports);
      patchNode(mod.exports?.default);
    }
  }
  return patched;
}

// Worker state (initialized once on `init`)
let ctx = null;
let SlotItemEffectUtil = null;
let fastSlotAssigner = null;
let compiledRuleEval = null;
let fastBaseline = null;
let slotObjLevel0ById = null;
let slotObjCache = {};
let shipObjectCache = {};
let aloneCache = {};
let maxItemId = 0;
let astShipConditionMatchedItems = {};

// Per-phase raw & lazily-compiled rules by shipId (avoid duplicating compilation across workers)
const rawRulesBySize = {
  2: Object.create(null),
  3: Object.create(null),
  4: Object.create(null),
  5: Object.create(null),
};
const compiledRulesBySize = {
  2: Object.create(null),
  3: Object.create(null),
  4: Object.create(null),
  5: Object.create(null),
};

function getCompiledRulesForShip(comboSize, shipId) {
  const cache = compiledRulesBySize[comboSize];
  if (shipId in cache) return cache[shipId];
  const raw = rawRulesBySize[comboSize][shipId];
  const compiled = raw && raw.length > 0 ? compileRulesForShip(raw, comboSize, maxItemId) : null;
  cache[shipId] = compiled;
  return compiled;
}

// Reusable scratch buffers
const combinedBuf = new Int32Array(STAT_COUNT);
const expectedBuf = new Int32Array(STAT_COUNT);
const residualBuf = new Int32Array(STAT_COUNT);
const tmpBuf = new Int32Array(STAT_COUNT);
const slotBuf2 = [null, null];
const slotBuf3 = [null, null, null];
const slotBuf4 = [null, null, null, null];
const slotBuf5 = [null, null, null, null, null];
const slotBuf6 = [null, null, null, null, null, null];

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

function getMakeSlot(id, level) {
  if (!level) {
    const fast = slotObjLevel0ById[id];
    if (fast) return fast;
  }
  const key = `${id}:${level}`;
  if (!slotObjCache[key]) {
    const s = ctx.slotById[id];
    slotObjCache[key] = { mstID: id, equipType: s ? s.equipType : 0, level: level || 0 };
  }
  return slotObjCache[key];
}

function getAlone(ship, itemId) {
  const key = `${ship.mstID}:${itemId}`;
  if (!(key in aloneCache)) {
    const slot = getMakeSlot(itemId, 0);
    aloneCache[key] = SlotItemEffectUtil.getSlotitemEffectLevel0Into(ship, [slot], tmpBuf)
      ? int32ToStatObj(tmpBuf)
      : null;
  }
  return aloneCache[key];
}

function computeResidualInto(combined, expected, out) {
  let any = false;
  for (let k = 0; k < STAT_COUNT; k++) {
    const d = combined[k] - expected[k];
    out[k] = d;
    if (d !== 0) any = true;
  }
  return any;
}

const aloneInt32Cache = Object.create(null);
const ZERO_STAT_INT32 = new Int32Array(STAT_COUNT);
const subEvalBuf = new Int32Array(STAT_COUNT);
const subCombo2 = [0, 0];
const subCombo3 = [0, 0, 0];
const subCombo4 = [0, 0, 0, 0];
const subCombo5 = [0, 0, 0, 0, 0];

// Bitmask table for zero-alloc calculateSuppressedComponentsFast (max 6 items -> 64 subsets)
const supSynTable = new Int32Array(64 * STAT_COUNT);
const supSynComputed = new Uint8Array(64);
const supSlotScratch = [null, null, null, null, null, null];
const supMarginalFull = new Int32Array(STAT_COUNT);

function getAloneInt32(ship, itemId) {
  const key = `${ship.mstID}:${itemId}`;
  let cached = aloneInt32Cache[key];
  if (cached !== undefined) return cached;
  const obj = getAlone(ship, itemId);
  cached = obj ? statObjToInt32(obj) : ZERO_STAT_INT32;
  aloneInt32Cache[key] = cached;
  return cached;
}

function isNegatedMatch(residualArr, compArr) {
  let anyNonZero = false;
  for (let k = 0; k < STAT_COUNT; k++) {
    const cv = compArr[k];
    if (cv !== 0) anyNonZero = true;
    if (residualArr[k] !== -cv) return false;
  }
  return anyNonZero;
}

function isCancelFast(ship, items, _expectedArr, residualArr) {
  // Only mark cancels_single when the residual actually reduces stats (has negative value)
  // AND exactly negates one of the equipped items' single-item bonuses.
  // Never match negated negative lower-order rules (which caused positive +2/+2 corrections
  // to be falsely tagged as cancels_single) or pure pair/triple overlap reductions.
  let hasNegative = false;
  for (let k = 0; k < STAT_COUNT; k++) {
    if (residualArr[k] < 0) {
      hasNegative = true;
      break;
    }
  }
  if (!hasNegative) return false;

  const len = items.length;
  for (let i = 0; i < len; i++) {
    if (isNegatedMatch(residualArr, getAloneInt32(ship, items[i]))) return true;
  }
  return false;
}

function calculateSuppressedComponentsFast(ship, items, residualArr, fullCombinedArr) {
  let hasNegative = false;
  for (let k = 0; k < STAT_COUNT; k++) {
    if (residualArr[k] < 0) {
      hasNegative = true;
      break;
    }
  }
  if (!hasNegative) return null;

  const len = items.length;
  const fullMask = (1 << len) - 1;
  supSynComputed.fill(0, 0, fullMask + 1);

  // Mask 0 = all zeros
  supSynComputed[0] = 1;
  for (let k = 0; k < STAT_COUNT; k++) supSynTable[k] = 0;

  // Full mask already computed as fullCombinedArr!
  supSynComputed[fullMask] = 1;
  const fullOff = fullMask * STAT_COUNT;
  for (let k = 0; k < STAT_COUNT; k++) supSynTable[fullOff + k] = fullCombinedArr[k];

  function ensureSubsetSyn(mask) {
    const off = mask * STAT_COUNT;
    if (supSynComputed[mask]) return off;
    supSynComputed[mask] = 1;
    // Popcount == 1 -> use alone cache
    if ((mask & (mask - 1)) === 0) {
      const bitIdx = 31 - Math.clz32(mask);
      const a = getAloneInt32(ship, items[bitIdx]);
      for (let k = 0; k < STAT_COUNT; k++) supSynTable[off + k] = a[k];
      return off;
    }
    let cnt = 0;
    for (let j = 0; j < len; j++) {
      if (mask & (1 << j)) {
        const id = items[j];
        supSlotScratch[cnt++] = slotObjLevel0ById[id] || getMakeSlot(id, 0);
      }
    }
    const subSlots =
      cnt === 2
        ? ((slotBuf2[0] = supSlotScratch[0]), (slotBuf2[1] = supSlotScratch[1]), slotBuf2)
        : cnt === 3
          ? ((slotBuf3[0] = supSlotScratch[0]),
            (slotBuf3[1] = supSlotScratch[1]),
            (slotBuf3[2] = supSlotScratch[2]),
            slotBuf3)
          : cnt === 4
            ? ((slotBuf4[0] = supSlotScratch[0]),
              (slotBuf4[1] = supSlotScratch[1]),
              (slotBuf4[2] = supSlotScratch[2]),
              (slotBuf4[3] = supSlotScratch[3]),
              slotBuf4)
            : ((slotBuf5[0] = supSlotScratch[0]),
              (slotBuf5[1] = supSlotScratch[1]),
              (slotBuf5[2] = supSlotScratch[2]),
              (slotBuf5[3] = supSlotScratch[3]),
              (slotBuf5[4] = supSlotScratch[4]),
              slotBuf5);
    SlotItemEffectUtil.getSlotitemEffectLevel0Into(ship, subSlots, tmpBuf);
    for (let k = 0; k < STAT_COUNT; k++) supSynTable[off + k] = tmpBuf[k];
    return off;
  }

  let suppressed = null;
  for (let i = 0; i < len; i++) {
    const bit = 1 << i;
    const withoutMask = fullMask ^ bit;
    const withoutOff = ensureSubsetSyn(withoutMask);
    for (let k = 0; k < STAT_COUNT; k++) {
      supMarginalFull[k] = supSynTable[fullOff + k] - supSynTable[withoutOff + k];
    }

    let isSuppressed = false;
    // Iterate all proper submasks of withoutMask (including 0)
    for (let sub = (withoutMask - 1) & withoutMask; ; sub = (sub - 1) & withoutMask) {
      const subOff = ensureSubsetSyn(sub);
      const subWithOff = ensureSubsetSyn(sub | bit);
      for (let k = 0; k < STAT_COUNT; k++) {
        const vSub = supSynTable[subWithOff + k] - supSynTable[subOff + k];
        if (supMarginalFull[k] < vSub) {
          isSuppressed = true;
          break;
        }
      }
      if (isSuppressed || sub === 0) break;
    }

    if (isSuppressed) {
      if (!suppressed) suppressed = new Set();
      suppressed.add(items[i]);
    }
  }

  return suppressed ? Array.from(suppressed).sort((a, b) => a - b) : null;
}

/**
 * Compactly group chunk hits by (residual, isCancel, suppressedComponents)
 * to shrink IPC payloads by >10x on heavy ships.
 */
function createChunkHitCollector() {
  const map = new Map();
  let totalHits = 0;
  return {
    add(items, residual, isCancel, suppressedComponents) {
      const pk =
        bkey(residual) +
        (isCancel ? "|C" : "") +
        (suppressedComponents ? "|S:" + suppressedComponents.join(",") : "");
      let g = map.get(pk);
      if (!g) {
        g = { residual, isCancel, suppressedComponents, flatItems: [] };
        map.set(pk, g);
      }
      for (let i = 0; i < items.length; i++) g.flatItems.push(items[i]);
      totalHits++;
    },
    finish() {
      return { groups: [...map.values()], hitCount: totalHits };
    },
  };
}

function handleInit(msg) {
  const { periodTag, useMain, masterPath, astRulesPath, targetShips, targetShipRange } = msg;
  const masterData = parseMasterData(masterPath);
  ctx = createMasterContext(masterData, targetShips, targetShipRange);
  maxItemId = ctx.maxItemId;

  const rawAst = JSON.parse(fs.readFileSync(astRulesPath, "utf8"));
  const astRules = rawAst.map((rule) => ({
    ...rule,
    requiredItemIds: Array.isArray(rule.requiredItemIds)
      ? rule.requiredItemIds.map(Number).filter(Number.isFinite)
      : [],
    requiredItemTypes: Array.isArray(rule.requiredItemTypes)
      ? rule.requiredItemTypes.map(Number).filter(Number.isFinite)
      : [],
  }));

  const mstDict = buildMstDict(ctx.mstSlotitems);
  const getMst = createGetMst(mstDict);

  const { kcsRequire, kcsCache } = loadBundle({
    useMain: !!useMain,
    getMst,
    silent: true,
    periodTag: periodTag || null,
  });

  SlotItemEffectUtil = createFastSlotItemEffectUtil({
    kcsRequire,
    kcsCache,
    getMstFn: getMst,
    astRules,
    maxItemId,
    patchGetMstInCache,
  });

  fastSlotAssigner = createFastSlotAssigner(
    ctx.mstShips,
    maxItemId,
    ctx.getAllowedPositions,
  );
  compiledRuleEval = createCompiledRuleEvaluator(maxItemId);

  slotObjLevel0ById = new Array(maxItemId + 1);
  for (const s of ctx.slotInfos) {
    const obj = { mstID: s.id, equipType: s.equipType, level: 0 };
    slotObjLevel0ById[s.id] = obj;
    slotObjCache[`${s.id}:0`] = obj;
  }

  // Precompute AST condition-matched items per ship
  const astTokens = astRules.map((r) => ({
    ids: [...new Set(r.requiredItemIds)],
    types: [...new Set(r.requiredItemTypes)],
  }));
  astShipConditionMatchedItems = {};
  for (const shipData of ctx.mstShips) {
    const sid = shipData.api_id;
    const eqSet = ctx.equippableByShipSet[sid];
    if (!eqSet) continue;
    const matched = new Set();
    for (const tok of astTokens) {
      for (const id of tok.ids) {
        if (eqSet.has(id)) matched.add(id);
      }
      for (const type of tok.types) {
        const ids = ctx.itemsByType2[type] || [];
        for (const id of ids) {
          if (eqSet.has(id)) matched.add(id);
        }
      }
    }
    astShipConditionMatchedItems[sid] = [...matched].sort((a, b) => a - b);
  }

  return { ok: true, fastWrapper: SlotItemEffectUtil.canUseFastWrapper };
}

function handlePhase1(msg) {
  const { shipIds } = msg;
  const results = [];
  const { getSlotitemEffect, getSlotitemEffectLevel0Into } = SlotItemEffectUtil;

  for (let si = 0; si < shipIds.length; si++) {
    const shipId = shipIds[si];
    const shipData = ctx.shipById[shipId];
    if (!shipData) continue;
    const ship = getShipObject(shipData);
    const equippable = ctx.equippableByShip[shipId] || [];

    for (let ei = 0; ei < equippable.length; ei++) {
      const itemId = equippable[ei];
      const slot0 = getMakeSlot(itemId, 0);
      const has0 = getSlotitemEffectLevel0Into(ship, [slot0], tmpBuf);
      const b = has0 ? int32ToStatObj(tmpBuf) : null;
      aloneCache[`${shipId}:${itemId}`] = b;
      if (!b) continue;

      // ★1..★10 ×1
      const improvementTransitions = [];
      let prevLevelStats = b;
      for (let star = 1; star <= 10; star++) {
        const rStar = getSlotitemEffect(ship, [getMakeSlot(itemId, star)]);
        const sStar = extractNonZeroInto(rStar, tmpBuf) ? int32ToStatObj(tmpBuf) : null;
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
      slotBuf2[0] = slot0;
      slotBuf2[1] = slot0;
      const c2raw = getSlotitemEffectLevel0Into(ship, slotBuf2, tmpBuf)
        ? int32ToStatObj(tmpBuf)
        : null;
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
      slotBuf3[0] = slot0;
      slotBuf3[1] = slot0;
      slotBuf3[2] = slot0;
      const c3raw = getSlotitemEffectLevel0Into(ship, slotBuf3, tmpBuf)
        ? int32ToStatObj(tmpBuf)
        : null;
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

      results.push({ shipId, itemId, b, pk: bkey(profile), profile });
    }
  }

  return { results };
}

function handleSetBaseline(msg) {
  const payload = msg.filePath
    ? JSON.parse(fs.readFileSync(msg.filePath, "utf8"))
    : msg;
  const { equipResultsSerialized, aloneSerialized } = payload;
  const equipResultsMap = new Map();
  for (const [itemId, entries] of equipResultsSerialized) {
    const pm = new Map();
    for (const [pk, data] of entries) {
      pm.set(pk, data);
    }
    equipResultsMap.set(itemId, pm);
  }
  fastBaseline = createFastBaselineEvaluator(equipResultsMap, maxItemId);
  for (const [k, v] of aloneSerialized) {
    aloneCache[k] = v;
  }
  return { ok: true };
}

function handlePhase2(msg) {
  const { tasks, pruneInvisible, useAstFilterSet } = msg;
  const astSet = useAstFilterSet ? new Set(useAstFilterSet) : null;
  const found = [];
  let pairsTested = 0;
  let astHits = 0;
  let astFallbacks = 0;
  let astCandidatesSum = 0;

  const { getSlotitemEffectLevel0Into } = SlotItemEffectUtil;
  const pairCombo = [0, 0];

  for (let ti = 0; ti < tasks.length; ti++) {
    const { shipId, triggerItems } = tasks[ti];
    const shipData = ctx.shipById[shipId];
    if (!shipData) continue;
    const ship = getShipObject(shipData);

    let equippable = ctx.equippableByShip[shipId] || [];
    const filterThisShip = astSet && astSet.has(shipId);
    const astCandidates = filterThisShip
      ? astShipConditionMatchedItems[shipId] || []
      : null;

    for (let ai = 0; ai < triggerItems.length; ai++) {
      const itemA = triggerItems[ai];
      let targetB = equippable;
      if (filterThisShip) {
        if (astCandidates.length > 0) {
          targetB = astCandidates;
          astHits++;
          astCandidatesSum += astCandidates.length;
        } else {
          astFallbacks++;
        }
      }

      pairCombo[0] = itemA;
      slotBuf2[0] = slotObjLevel0ById[itemA] || getMakeSlot(itemA, 0);

      for (let bi = 0; bi < targetB.length; bi++) {
        const itemB = targetB[bi];
        if (itemB === itemA) continue;
        pairCombo[1] = itemB;
        if (!fastSlotAssigner.canAssignCombo(shipId, pairCombo)) continue;
        pairsTested++;

        slotBuf2[1] = slotObjLevel0ById[itemB] || getMakeSlot(itemB, 0);
        getSlotitemEffectLevel0Into(ship, slotBuf2, combinedBuf);
        fastBaseline.computeBaselineInto(shipId, pairCombo, expectedBuf);
        if (!computeResidualInto(combinedBuf, expectedBuf, residualBuf)) continue;

        const synDelta = int32ToStatObj(residualBuf);
        if (!synDelta) continue;
        if (pruneInvisible && isMeaninglessSynergy(synDelta)) continue;

        const isCancel =
          isNegatedMatch(residualBuf, getAloneInt32(ship, itemA)) ||
          isNegatedMatch(residualBuf, getAloneInt32(ship, itemB));
        const pairKey = `${Math.min(itemA, itemB)}:${Math.max(itemA, itemB)}`;
        const suppressedComponents = calculateSuppressedComponentsFast(
          ship,
          pairCombo,
          residualBuf,
          combinedBuf,
        );

        found.push({
          shipId,
          pairKey,
          synDelta,
          cancelsSingle: isCancel,
          suppressedComponents,
        });
      }
    }
  }

  return { found, pairsTested, astHits, astFallbacks, astCandidatesSum };
}

function handleSetCompiledRules(msg) {
  const { comboSize, filePath, rulesByShip } = msg;
  if (filePath) {
    const rules = JSON.parse(fs.readFileSync(filePath, "utf8"));
    rawRulesBySize[comboSize] = indexRulesByShip(rules);
  } else {
    rawRulesBySize[comboSize] = rulesByShip || Object.create(null);
  }
  compiledRulesBySize[comboSize] = Object.create(null);
  return { ok: true };
}

function handlePhase3Chunk(msg) {
  const { shipId, bItems, allowDuplicateItems, pruneInvisible, ranges } = msg;
  const shipData = ctx.shipById[shipId];
  if (!shipData) return { found: [], tested: 0 };
  const ship = getShipObject(shipData);
  const pairComp = getCompiledRulesForShip(2, shipId);
  const { getSlotitemEffectLevel0Into } = SlotItemEffectUtil;

  const n = bItems.length;
  const collector = createChunkHitCollector();
  let tested = 0;
  const combo3 = [0, 0, 0];

  for (let ri = 0; ri < ranges.length; ri++) {
    const { a, bStart, bEnd } = ranges[ri];
    const itemA = bItems[a];
    combo3[0] = itemA;
    slotBuf3[0] = slotObjLevel0ById[itemA] || getMakeSlot(itemA, 0);

    for (let bi = bStart; bi < bEnd; bi++) {
      const itemB = bItems[bi];
      combo3[1] = itemB;
      slotBuf3[1] = slotObjLevel0ById[itemB] || getMakeSlot(itemB, 0);
      const cStart = allowDuplicateItems ? bi : bi + 1;

      for (let ci = cStart; ci < n; ci++) {
        const itemC = bItems[ci];
        combo3[2] = itemC;
        if (!fastSlotAssigner.canAssignCombo(shipId, combo3)) continue;
        tested++;

        slotBuf3[2] = slotObjLevel0ById[itemC] || getMakeSlot(itemC, 0);
        getSlotitemEffectLevel0Into(ship, slotBuf3, combinedBuf);
        fastBaseline.computeBaselineInto(shipId, combo3, expectedBuf);
        if (pairComp) compiledRuleEval.addSimulatedInto(pairComp, combo3, expectedBuf);

        if (!computeResidualInto(combinedBuf, expectedBuf, residualBuf)) continue;
        const residual = int32ToStatObj(residualBuf);
        if (!residual) continue;
        if (pruneInvisible && isMeaninglessSynergy(residual)) continue;

        const isCancel = isCancelFast(ship, combo3, expectedBuf, residualBuf, pairComp, null, null, null);
        // Omit per-combo suppressed_components on comboSize >= 3 to prevent 20-33x rule fragmentation;
        // FUSOU-WEB computes suppressed items dynamically for active loadouts.
        collector.add(combo3, residual, isCancel, null);
      }
    }
  }

  return { ...collector.finish(), tested };
}

function handlePhase4Chunk(msg) {
  const {
    shipId,
    bItems,
    allowDuplicateItems,
    strictNMinusOne,
    pruneInvisible,
    tripleKeySetArr,
    ranges,
  } = msg;
  const shipData = ctx.shipById[shipId];
  if (!shipData) return { found: [], tested: 0 };
  const ship = getShipObject(shipData);
  const pairComp = getCompiledRulesForShip(2, shipId);
  const tripleComp = getCompiledRulesForShip(3, shipId);
  const tripleKeySet = !strictNMinusOne && tripleKeySetArr ? new Set(tripleKeySetArr) : null;
  const { getSlotitemEffectLevel0Into } = SlotItemEffectUtil;

  const n = bItems.length;
  const collector = createChunkHitCollector();
  let tested = 0;
  const combo4 = [0, 0, 0, 0];

  for (let ri = 0; ri < ranges.length; ri++) {
    const { a, bStart, bEnd } = ranges[ri];
    const A = bItems[a];
    combo4[0] = A;
    slotBuf4[0] = slotObjLevel0ById[A] || getMakeSlot(A, 0);

    for (let bi = bStart; bi < bEnd; bi++) {
      const B = bItems[bi];
      combo4[1] = B;
      slotBuf4[1] = slotObjLevel0ById[B] || getMakeSlot(B, 0);
      const cStart = allowDuplicateItems ? bi : bi + 1;

      for (let ci = cStart; ci < n; ci++) {
        const C = bItems[ci];
        combo4[2] = C;
        slotBuf4[2] = slotObjLevel0ById[C] || getMakeSlot(C, 0);
        const dStart = allowDuplicateItems ? ci : ci + 1;

        for (let di = dStart; di < n; di++) {
          const D = bItems[di];
          combo4[3] = D;
          if (!fastSlotAssigner.canAssignCombo(shipId, combo4)) continue;

          if (tripleKeySet) {
            if (
              !tripleKeySet.has(`${A}:${B}:${C}`) &&
              !tripleKeySet.has(`${A}:${B}:${D}`) &&
              !tripleKeySet.has(`${A}:${C}:${D}`) &&
              !tripleKeySet.has(`${B}:${C}:${D}`)
            ) {
              continue;
            }
          }

          tested++;
          slotBuf4[3] = slotObjLevel0ById[D] || getMakeSlot(D, 0);
          getSlotitemEffectLevel0Into(ship, slotBuf4, combinedBuf);

          fastBaseline.computeBaselineInto(shipId, combo4, expectedBuf);
          if (pairComp) compiledRuleEval.addSimulatedInto(pairComp, combo4, expectedBuf);
          if (tripleComp) compiledRuleEval.addSimulatedInto(tripleComp, combo4, expectedBuf);

          if (!computeResidualInto(combinedBuf, expectedBuf, residualBuf)) continue;
          const residual = int32ToStatObj(residualBuf);
          if (!residual) continue;
          if (pruneInvisible && isMeaninglessSynergy(residual)) continue;

          const isCancel = isCancelFast(
            ship,
            combo4,
            expectedBuf,
            residualBuf,
            pairComp,
            tripleComp,
            null,
            null,
          );
          collector.add(combo4, residual, isCancel, null);
        }
      }
    }
  }

  return { ...collector.finish(), tested };
}

function handlePhase5Chunk(msg) {
  const {
    shipId,
    filteredPool,
    allowDuplicateItems,
    strictNMinusOne,
    pruneInvisible,
    quadKeySetArr,
    ranges,
  } = msg;
  const shipData = ctx.shipById[shipId];
  if (!shipData) return { found: [], tested: 0 };
  const ship = getShipObject(shipData);
  const pairComp = getCompiledRulesForShip(2, shipId);
  const tripleComp = getCompiledRulesForShip(3, shipId);
  const quadComp = getCompiledRulesForShip(4, shipId);
  const quadKeySet = !strictNMinusOne && quadKeySetArr ? new Set(quadKeySetArr) : null;
  const { getSlotitemEffectLevel0Into } = SlotItemEffectUtil;

  const n = filteredPool.length;
  const collector = createChunkHitCollector();
  let tested = 0;
  const combo5 = [0, 0, 0, 0, 0];

  for (let ri = 0; ri < ranges.length; ri++) {
    const { a, bStart, bEnd } = ranges[ri];
    const A = filteredPool[a];
    combo5[0] = A;
    slotBuf5[0] = slotObjLevel0ById[A] || getMakeSlot(A, 0);

    for (let bi = bStart; bi < bEnd; bi++) {
      const B = filteredPool[bi];
      combo5[1] = B;
      slotBuf5[1] = slotObjLevel0ById[B] || getMakeSlot(B, 0);
      const cStart = allowDuplicateItems ? bi : bi + 1;

      for (let ci = cStart; ci < n; ci++) {
        const C = filteredPool[ci];
        combo5[2] = C;
        slotBuf5[2] = slotObjLevel0ById[C] || getMakeSlot(C, 0);
        const dStart = allowDuplicateItems ? ci : ci + 1;

        for (let di = dStart; di < n; di++) {
          const D = filteredPool[di];
          combo5[3] = D;
          slotBuf5[3] = slotObjLevel0ById[D] || getMakeSlot(D, 0);
          const eStart = allowDuplicateItems ? di : di + 1;

          for (let ei = eStart; ei < n; ei++) {
            const E = filteredPool[ei];
            combo5[4] = E;
            if (!fastSlotAssigner.canAssignCombo(shipId, combo5)) continue;

            if (quadKeySet) {
              if (
                !quadKeySet.has(`${A}:${B}:${C}:${D}`) &&
                !quadKeySet.has(`${A}:${B}:${C}:${E}`) &&
                !quadKeySet.has(`${A}:${B}:${D}:${E}`) &&
                !quadKeySet.has(`${A}:${C}:${D}:${E}`) &&
                !quadKeySet.has(`${B}:${C}:${D}:${E}`)
              ) {
                continue;
              }
            }

            tested++;
            slotBuf5[4] = slotObjLevel0ById[E] || getMakeSlot(E, 0);
            getSlotitemEffectLevel0Into(ship, slotBuf5, combinedBuf);

            fastBaseline.computeBaselineInto(shipId, combo5, expectedBuf);
            if (pairComp) compiledRuleEval.addSimulatedInto(pairComp, combo5, expectedBuf);
            if (tripleComp) compiledRuleEval.addSimulatedInto(tripleComp, combo5, expectedBuf);
            if (quadComp) compiledRuleEval.addSimulatedInto(quadComp, combo5, expectedBuf);

            if (!computeResidualInto(combinedBuf, expectedBuf, residualBuf)) continue;
            const residual = int32ToStatObj(residualBuf);
            if (!residual) continue;
            if (pruneInvisible && isMeaninglessSynergy(residual)) continue;

            const isCancel = isCancelFast(
              ship,
              combo5,
              expectedBuf,
              residualBuf,
              pairComp,
              tripleComp,
              quadComp,
              null,
            );
            collector.add(combo5, residual, isCancel, null);
          }
        }
      }
    }
  }

  return { ...collector.finish(), tested };
}

function handlePhase6Chunk(msg) {
  const {
    shipId,
    filteredPool,
    allowDuplicateItems,
    strictNMinusOne,
    pruneInvisible,
    pentaKeySetArr,
    ranges,
  } = msg;
  const shipData = ctx.shipById[shipId];
  if (!shipData) return { found: [], tested: 0 };
  const ship = getShipObject(shipData);
  const pairComp = getCompiledRulesForShip(2, shipId);
  const tripleComp = getCompiledRulesForShip(3, shipId);
  const quadComp = getCompiledRulesForShip(4, shipId);
  const pentaComp = getCompiledRulesForShip(5, shipId);
  const pentaKeySet = !strictNMinusOne && pentaKeySetArr ? new Set(pentaKeySetArr) : null;
  const { getSlotitemEffectLevel0Into } = SlotItemEffectUtil;

  const n = filteredPool.length;
  const collector = createChunkHitCollector();
  let tested = 0;
  const combo6 = [0, 0, 0, 0, 0, 0];

  for (let ri = 0; ri < ranges.length; ri++) {
    const { a, bStart, bEnd } = ranges[ri];
    const A = filteredPool[a];
    combo6[0] = A;
    slotBuf6[0] = slotObjLevel0ById[A] || getMakeSlot(A, 0);

    for (let bi = bStart; bi < bEnd; bi++) {
      const B = filteredPool[bi];
      combo6[1] = B;
      slotBuf6[1] = slotObjLevel0ById[B] || getMakeSlot(B, 0);
      const cStart = allowDuplicateItems ? bi : bi + 1;

      for (let ci = cStart; ci < n; ci++) {
        const C = filteredPool[ci];
        combo6[2] = C;
        slotBuf6[2] = slotObjLevel0ById[C] || getMakeSlot(C, 0);
        const dStart = allowDuplicateItems ? ci : ci + 1;

        for (let di = dStart; di < n; di++) {
          const D = filteredPool[di];
          combo6[3] = D;
          slotBuf6[3] = slotObjLevel0ById[D] || getMakeSlot(D, 0);
          const eStart = allowDuplicateItems ? di : di + 1;

          for (let ei = eStart; ei < n; ei++) {
            const E = filteredPool[ei];
            combo6[4] = E;
            slotBuf6[4] = slotObjLevel0ById[E] || getMakeSlot(E, 0);
            const fStart = allowDuplicateItems ? ei : ei + 1;

            for (let fi = fStart; fi < n; fi++) {
              const F = filteredPool[fi];
              combo6[5] = F;
              if (!fastSlotAssigner.canAssignCombo(shipId, combo6)) continue;

              if (pentaKeySet) {
                if (
                  !pentaKeySet.has(`${A}:${B}:${C}:${D}:${E}`) &&
                  !pentaKeySet.has(`${A}:${B}:${C}:${D}:${F}`) &&
                  !pentaKeySet.has(`${A}:${B}:${C}:${E}:${F}`) &&
                  !pentaKeySet.has(`${A}:${B}:${D}:${E}:${F}`) &&
                  !pentaKeySet.has(`${A}:${C}:${D}:${E}:${F}`) &&
                  !pentaKeySet.has(`${B}:${C}:${D}:${E}:${F}`)
                ) {
                  continue;
                }
              }

              tested++;
              slotBuf6[5] = slotObjLevel0ById[F] || getMakeSlot(F, 0);
              getSlotitemEffectLevel0Into(ship, slotBuf6, combinedBuf);

              fastBaseline.computeBaselineInto(shipId, combo6, expectedBuf);
              if (pairComp) compiledRuleEval.addSimulatedInto(pairComp, combo6, expectedBuf);
              if (tripleComp) compiledRuleEval.addSimulatedInto(tripleComp, combo6, expectedBuf);
              if (quadComp) compiledRuleEval.addSimulatedInto(quadComp, combo6, expectedBuf);
              if (pentaComp) compiledRuleEval.addSimulatedInto(pentaComp, combo6, expectedBuf);

              if (!computeResidualInto(combinedBuf, expectedBuf, residualBuf)) continue;
              const residual = int32ToStatObj(residualBuf);
              if (!residual) continue;
              if (pruneInvisible && isMeaninglessSynergy(residual)) continue;

              const isCancel = isCancelFast(
                ship,
                combo6,
                expectedBuf,
                residualBuf,
                pairComp,
                tripleComp,
                quadComp,
                pentaComp,
              );
              collector.add(combo6, residual, isCancel, null);
            }
          }
        }
      }
    }
  }

  return { ...collector.finish(), tested };
}

process.on("message", (msg) => {
  if (!msg || !msg.type) return;
  const reqId = msg.reqId;
  try {
    let payload;
    if (msg.type === "init") payload = handleInit(msg);
    else if (msg.type === "phase1") payload = handlePhase1(msg);
    else if (msg.type === "setBaseline") payload = handleSetBaseline(msg);
    else if (msg.type === "phase2") payload = handlePhase2(msg);
    else if (msg.type === "setCompiledRules") payload = handleSetCompiledRules(msg);
    else if (msg.type === "phase3Chunk") payload = handlePhase3Chunk(msg);
    else if (msg.type === "phase4Chunk") payload = handlePhase4Chunk(msg);
    else if (msg.type === "phase5Chunk") payload = handlePhase5Chunk(msg);
    else if (msg.type === "phase6Chunk") payload = handlePhase6Chunk(msg);
    else if (msg.type === "shutdown") {
      process.send({ reqId, ok: true });
      process.exit(0);
    } else {
      throw new Error(`Unknown worker message type: ${msg.type}`);
    }
    process.send({ reqId, ok: true, payload });
  } catch (err) {
    process.send({
      reqId,
      ok: false,
      error: err?.stack || err?.message || String(err),
    });
  }
});
