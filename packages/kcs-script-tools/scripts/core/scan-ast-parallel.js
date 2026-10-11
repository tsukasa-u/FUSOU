#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const readline = require("readline");
const path = require("path");
const { spawn } = require("child_process");
const { ROOT, findMasterData, parseMasterData } = require("../../lib/loader");

function parseArgs(argv) {
  const defaultValidatedWorkers = Math.max(1, Math.min(os.cpus().length, 8));
  const opts = {
    workers: defaultValidatedWorkers,
    scheduleShards: 256,
    progressIntervalMs: 2000,
    periodTag: null,
    outputPath: null,
    ships: null,
    shipRange: null,
    v8Flags: [],
    profileV8: false,
    maxComboSize: 6,
    strictNMinusOne: true,
    allowDuplicateItems: true,
    astCandidateShips: null,
    maxOldSpaceMb: Number.parseInt(process.env.SCAN_AST_MAX_OLD_SPACE_MB || "8192", 10),
    scanFlags: {
      main: false,
      volatileGenerated: false,
      noPruneInvisible: false,
    },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === "--workers") {
      if (!next || next.startsWith("--")) throw new Error("--workers requires a value");
      opts.workers = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (a === "--schedule-shards") {
      if (!next || next.startsWith("--")) throw new Error("--schedule-shards requires a value");
      opts.scheduleShards = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (a === "--progress-interval-ms") {
      if (!next || next.startsWith("--")) throw new Error("--progress-interval-ms requires a value");
      opts.progressIntervalMs = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (a === "--period-tag") {
      if (!next || next.startsWith("--")) throw new Error("--period-tag requires a value");
      opts.periodTag = next;
      i += 1;
      continue;
    }
    if (a === "--output") {
      if (!next || next.startsWith("--")) throw new Error("--output requires a value");
      opts.outputPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (a === "--ships") {
      if (!next || next.startsWith("--")) throw new Error("--ships requires a value");
      opts.ships = next
        .split(",")
        .map((n) => Number.parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n));
      i += 1;
      continue;
    }
    if (a === "--ship-range") {
      if (!next || next.startsWith("--")) throw new Error("--ship-range requires a value");
      const m = String(next).match(/^(\d+)\s*[-.:]{1,2}\s*(\d+)$/);
      if (!m) throw new Error(`invalid --ship-range value: ${next}`);
      opts.shipRange = [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
      i += 1;
      continue;
    }
    if (a === "--v8-flags") {
      if (!next) throw new Error("--v8-flags requires a value");
      opts.v8Flags = next.split(/\s+/).filter(Boolean);
      i += 1;
      continue;
    }
    if (a === "--profile-v8") {
      opts.profileV8 = true;
      continue;
    }
    if (a === "--max-combo-size") {
      if (!next || next.startsWith("--")) throw new Error("--max-combo-size requires a value");
      opts.maxComboSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (a === "--ast-candidate-ships") {
      if (!next || next.startsWith("--")) throw new Error("--ast-candidate-ships requires a value");
      const raw = String(next).trim();
      if (raw.toLowerCase() === "all") {
        opts.astCandidateShips = "all";
      } else {
        const ids = raw
          .split(",")
          .map((v) => Number.parseInt(v.trim(), 10))
          .filter((n) => Number.isFinite(n));
        if (ids.length === 0) {
          throw new Error(`invalid --ast-candidate-ships value: ${next}`);
        }
        opts.astCandidateShips = new Set(ids);
      }
      i += 1;
      continue;
    }
    if (a === "--max-old-space-mb") {
      if (!next || next.startsWith("--")) throw new Error("--max-old-space-mb requires a value");
      opts.maxOldSpaceMb = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (a === "--strict-nminus1") {
      opts.strictNMinusOne = true;
      continue;
    }
    if (a === "--no-strict-nminus1") {
      opts.strictNMinusOne = false;
      continue;
    }
    if (a === "--allow-duplicate-items") {
      opts.allowDuplicateItems = true;
      continue;
    }
    if (a === "--no-allow-duplicate-items") {
      opts.allowDuplicateItems = false;
      continue;
    }

    if (a === "--main") {
      opts.scanFlags.main = true;
      continue;
    }
    if (a === "--volatile-generated") {
      opts.scanFlags.volatileGenerated = true;
      continue;
    }
    if (a === "--no-prune-invisible") {
      opts.scanFlags.noPruneInvisible = true;
      continue;
    }

    throw new Error(`unknown option: ${a}`);
  }

  if (!Number.isFinite(opts.workers) || opts.workers < 1) opts.workers = 1;
  if (!Number.isFinite(opts.scheduleShards) || opts.scheduleShards < 0) opts.scheduleShards = 256;
  if (!Number.isFinite(opts.progressIntervalMs) || opts.progressIntervalMs < 250) opts.progressIntervalMs = 2000;
  if (!Number.isFinite(opts.maxOldSpaceMb) || opts.maxOldSpaceMb <= 0) opts.maxOldSpaceMb = 8192;
  if (!Number.isFinite(opts.maxComboSize) || opts.maxComboSize < 2 || opts.maxComboSize > 6) {
    throw new Error(`--max-combo-size must be integer in [2, 6], got: ${opts.maxComboSize}`);
  }

  return opts;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i += 1) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

function combCount(n, k, allowDuplicates) {
  if (allowDuplicates) return choose(n + k - 1, k);
  return choose(n, k);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function mergeRuleSet(ruleSets, mergeArrayField = null) {
  const map = new Map();
  for (const rules of ruleSets) {
    for (const rule of rules || []) {
      const ships = rule.ships || [];
      const rest = { ...rule };
      delete rest.ships;
      const key = stableStringify(rest);
      if (!map.has(key)) {
        const next = { ...rest, ships: [] };
        if (mergeArrayField && Array.isArray(rest[mergeArrayField])) {
          next[mergeArrayField] = [];
        }
        map.set(key, next);
      }
      const target = map.get(key);
      target.ships.push(...ships);
      if (mergeArrayField && Array.isArray(rule[mergeArrayField])) {
        target[mergeArrayField].push(...rule[mergeArrayField]);
      }
    }
  }

  const merged = [];
  for (const v of map.values()) {
    v.ships = [...new Set(v.ships)].sort((a, b) => a - b);
    if (mergeArrayField && Array.isArray(v[mergeArrayField])) {
      const uniq = new Map();
      for (const x of v[mergeArrayField]) uniq.set(stableStringify(x), x);
      v[mergeArrayField] = [...uniq.values()].sort((a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
            if (a[i] !== b[i]) return a[i] - b[i];
          }
          return a.length - b.length;
        }
        return stableStringify(a).localeCompare(stableStringify(b));
      });
    }
    merged.push(v);
  }
  merged.sort((a, b) => (a.ships[0] || 0) - (b.ships[0] || 0));
  return merged;
}

function buildEquipIndex(rules) {
  const index = {};
  for (let i = 0; i < rules.length; i += 1) {
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

function createShipEstimator(masterData) {
  const mstShips = [...(masterData.api_mst_ship || [])]
    .filter((s) => s.api_id < 1500)
    .sort((a, b) => a.api_id - b.api_id);
  const mstSlotitems = [...(masterData.api_mst_slotitem || [])].sort((a, b) => a.api_id - b.api_id);

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
      return {
        allowedTypes,
        itemAllowListByType,
        restrictions: parseNormalSlotTypeRestrictions(override),
      };
    }
    const allowedTypes = stypeEquipTypeSet[shipData.api_stype] || new Set();
    return { allowedTypes, itemAllowListByType: new Map(), restrictions: [] };
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

  function canEquipItem(shipData, itemId) {
    const equipType = itemEquipType2[itemId];
    if (!equipType) return false;

    const normalRule = getNormalSlotRule(shipData);
    if (normalRule.allowedTypes.has(equipType)) {
      const allowItems = normalRule.itemAllowListByType.get(equipType);
      const itemAllowed = !allowItems || allowItems.has(itemId);
      if (itemAllowed) {
        const slotCount = shipData.api_slot_num || 0;
        for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
          if (passesNormalSlotRestriction(normalRule.restrictions, slotIdx, equipType)) {
            return true;
          }
        }
      }
    }

    return getExslotRequirement(shipData, itemId) != null;
  }

  function estimateShip(shipData, maxComboSize, strictNMinusOne, allowDuplicateItems) {
    let equippableCount = 0;
    for (const si of mstSlotitems) {
      if (canEquipItem(shipData, si.api_id)) equippableCount += 1;
    }

    const effectiveSlots = (shipData.api_slot_num || 0) + 1;
    const maxK = Math.min(maxComboSize, effectiveSlots, 6);

    const c2 = maxK >= 2 ? combCount(equippableCount, 2, allowDuplicateItems) : 0;
    const c3 = maxK >= 3 ? combCount(equippableCount, 3, allowDuplicateItems) : 0;
    const c4 = maxK >= 4 ? combCount(equippableCount, 4, allowDuplicateItems) : 0;
    const c5 = maxK >= 5 ? combCount(equippableCount, 5, allowDuplicateItems) : 0;
    const c6 = maxK >= 6 ? combCount(equippableCount, 6, allowDuplicateItems) : 0;

    const phase4Factor = strictNMinusOne ? 1.0 : 0.35;
    const phase5Factor = strictNMinusOne ? 0.20 : 0.08;
    const phase6Factor = strictNMinusOne ? 0.06 : 0.02;

    const estimatedTests =
      Math.round(c2 * 0.18) +
      Math.round(c3 * 0.24) +
      Math.round(c4 * phase4Factor) +
      Math.round(c5 * phase5Factor) +
      Math.round(c6 * phase6Factor);

    return {
      shipId: shipData.api_id,
      shipName: shipData.api_name,
      effectiveSlots,
      equippableCount,
      c2,
      c3,
      c4,
      c5,
      c6,
      estimatedTests,
    };
  }

  return { mstShips, estimateShip };
}

function buildWeightedShards(estimates, shardCount) {
  const shards = Array.from({ length: shardCount }, (_, idx) => ({
    shardId: idx + 1,
    ships: [],
    estimatedTests: 0,
  }));

  const sorted = [...estimates].sort((a, b) => b.estimatedTests - a.estimatedTests);
  for (const info of sorted) {
    let target = shards[0];
    for (const shard of shards) {
      if (shard.estimatedTests < target.estimatedTests) target = shard;
    }
    target.ships.push(info.shipId);
    target.estimatedTests += info.estimatedTests;
  }

  return shards.filter((s) => s.ships.length > 0).sort((a, b) => b.estimatedTests - a.estimatedTests);
}

function buildTasks(estimates, workers, requestedShards) {
  const totalEstimated = estimates.reduce((acc, e) => acc + e.estimatedTests, 0);
  const targetWeight = Math.max(1, Math.floor(totalEstimated / Math.max(workers * 4, 1)));
  const heavySplitThreshold = Math.max(targetWeight * 3, 2_000_000);
  const minHeavySplits = 10;
  const maxSplitsPerShip = Math.max(
    minHeavySplits,
    Math.min(64, Math.max(workers * 8, Math.floor(requestedShards / 2))),
  );
  const tasks = [];

  for (const info of [...estimates].sort((a, b) => b.estimatedTests - a.estimatedTests)) {
    const canSplitByFirstIndex = info.effectiveSlots >= 3 && info.c3 > 0;
    const intrinsicHeavy =
      info.c3 >= 1_500_000 ||
      info.c4 >= 100_000_000 ||
      info.estimatedTests >= 1_000_000_000;
    let splitCount = 1;
    if (canSplitByFirstIndex && info.estimatedTests > targetWeight) {
      splitCount = Math.max(2, Math.ceil(info.estimatedTests / Math.max(targetWeight, 1)));
    }
    if (
      canSplitByFirstIndex &&
      (info.estimatedTests >= heavySplitThreshold || intrinsicHeavy)
    ) {
      splitCount = Math.max(splitCount, minHeavySplits);
    }
    splitCount = Math.min(maxSplitsPerShip, Math.max(1, splitCount));

    if (splitCount === 1) {
      tasks.push({
        kind: "ship",
        shipId: info.shipId,
        shipName: info.shipName,
        estimatedTests: info.estimatedTests,
        effectiveSlots: info.effectiveSlots,
      });
      continue;
    }

    const totalIndexSpace = Math.max(info.equippableCount, splitCount);
    for (let i = 0; i < splitCount; i += 1) {
      const start = Math.floor((totalIndexSpace * i) / splitCount);
      const end = Math.floor((totalIndexSpace * (i + 1)) / splitCount);
      tasks.push({
        kind: "ship-first-index-split",
        shipId: info.shipId,
        shipName: info.shipName,
        estimatedTests: Math.ceil(info.estimatedTests / splitCount),
        effectiveSlots: info.effectiveSlots,
        firstIndexRange: [start, end],
      });
    }
  }

  tasks.sort((a, b) => b.estimatedTests - a.estimatedTests);
  return tasks;
}

function expandShipRange(shipRange) {
  if (!shipRange) return null;
  const [start, end] = shipRange;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const out = [];
  for (let id = lo; id <= hi; id += 1) out.push(id);
  return out;
}

function buildScanArgs(opts, task, outputPath) {
  const args = [];
  if (opts.scanFlags.main) args.push("--main");
  if (opts.scanFlags.volatileGenerated) args.push("--volatile-generated");
  if (opts.scanFlags.noPruneInvisible) args.push("--no-prune-invisible");
  if (opts.periodTag) args.push("--period-tag", opts.periodTag);
  args.push(opts.strictNMinusOne ? "--strict-nminus1" : "--no-strict-nminus1");
  args.push(opts.allowDuplicateItems ? "--allow-duplicate-items" : "--no-allow-duplicate-items");
  args.push("--max-combo-size", String(opts.maxComboSize));
  args.push("--ships", String(task.shipId));
  if (
    opts.astCandidateShips === "all" ||
    (opts.astCandidateShips instanceof Set && opts.astCandidateShips.has(task.shipId))
  ) {
    args.push("--ast-candidate-ships", String(task.shipId));
  }
  if (task.firstIndexRange) {
    args.push(
      "--first-index-range",
      `${task.firstIndexRange[0]}-${task.firstIndexRange[1]}`,
    );
  }
  args.push("--output", outputPath);
  return args;
}

function createLineHandler(state) {
  return (line) => {
    const text = line.trim();
    if (!text) return;
    state.lastSeenAt = Date.now();
    state.lastLine = text;

    if (text.startsWith("[Phase")) {
      state.phase = text;
      // Keep parsing the same line because many progress lines start with
      // "[Phase ...]" and still contain tests/progress counters.
    }

    const prog = text.match(/(\d+)\/(\d+)[^|]*\|\s*([\d,]+)\s*(?:bonuses|synergies|corrections)\s*\|\s*([\d,]+)\s*tests\s*\|\s*([\d.]+)s/);
    if (prog) {
      state.progress = `${prog[1]}/${prog[2]}`;
      state.metrics = prog[3];
      state.tests = prog[4];
      state.elapsedSec = prog[5];
      return;
    }

    const prog2 = text.match(/(\d+)\/(\d+)[^|]*\|\s*([\d,]+)\s*tests\s*\|\s*([\d.]+)s/);
    if (prog2) {
      state.progress = `${prog2[1]}/${prog2[2]}`;
      state.tests = prog2[3];
      state.elapsedSec = prog2[4];
      return;
    }

    if (/Fatal:|Error:/.test(text)) {
      state.errors.push(text);
      return;
    }

    if (/\[Phase \d+\] Done:/.test(text)) {
      return;
    }

    if (/^\[scan\]/.test(text) || /^\[output\]/.test(text)) {
      return;
    }
  };
}

function createStreamParser(onLine) {
  let buf = "";
  return (chunk) => {
    buf += chunk.toString("utf8").replace(/\r/g, "\n");
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx < 0) break;
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      onLine(line);
    }
  };
}

async function runShard(scanPath, opts, shard, slot, tmpDir, sharedState) {
  const outPath = path.join(tmpDir, `chunk-${shard.shardId}.json`);
  const args = buildScanArgs(opts, shard, outPath);

  const state = {
    slot,
    shardId: shard.shardId,
    shipId: shard.shipId,
    shipName: shard.shipName,
    taskKind: shard.kind,
    firstIndexRange: shard.firstIndexRange || null,
    ships: 1,
    estimatedTests: shard.estimatedTests,
    phase: "boot",
    progress: "0/0",
    metrics: "0",
    tests: "0",
    elapsedSec: "0.0",
    lastLine: "starting",
    lastSeenAt: Date.now(),
    errors: [],
    startedAt: Date.now(),
  };
  sharedState.active.set(slot, state);

  const env = {
    ...process.env,
    SCAN_AST_MAX_OLD_SPACE_MB: String(opts.maxOldSpaceMb),
  };

  await new Promise((resolve, reject) => {
    const execArgs = [...opts.v8Flags];
    if (opts.profileV8) execArgs.push("--prof");
    const p = spawn(process.execPath, [...execArgs, scanPath, ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.pid = p.pid || null;

    const onStdout = createStreamParser(createLineHandler(state));
    const onStderr = createStreamParser(createLineHandler(state));

    p.stdout.on("data", onStdout);
    p.stderr.on("data", onStderr);
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const e = new Error(`slot-${slot} shard-${shard.shardId} exited with code ${code}`);
        e.workerErrors = state.errors;
        reject(e);
      }
    });
  });

  sharedState.active.delete(slot);
  sharedState.doneShards += 1;
  const shipProg = sharedState.shipProgress.get(shard.shipId);
  if (shipProg) {
    shipProg.doneEstimated = Math.max(
      0,
      Math.min(shipProg.totalEstimated, shipProg.doneEstimated + Number(shard.estimatedTests || 0)),
    );
  }
  sharedState.completed.push({
    shardId: shard.shardId,
    slot,
    ships: 1,
    estimatedTests: shard.estimatedTests,
    durationSec: ((Date.now() - state.startedAt) / 1000).toFixed(1),
    tests: state.tests,
    outputPath: outPath,
  });

  return outPath;
}

function renderProgress(sharedState, totalEstimated) {
  const elapsedSec = ((Date.now() - sharedState.startedAt) / 1000).toFixed(1);
  const active = [...sharedState.active.values()].sort((a, b) => a.slot - b.slot);
  const queued = sharedState.queue.length;
  const done = sharedState.doneShards;
  const total = sharedState.totalShards;

  const activeTestsByShip = new Map();
  for (const st of active) {
    const testsDone = Number.parseInt(String(st.tests).replace(/,/g, ""), 10) || 0;
    const estTests = Math.max(1, Number(st.estimatedTests) || 1);
    const capped = Math.max(0, Math.min(estTests, testsDone));
    activeTestsByShip.set(st.shipId, (activeTestsByShip.get(st.shipId) || 0) + capped);
  }

  const lines = [];
  lines.push(`[parallel-scan] done=${done}/${total} active=${active.length} queued=${queued} elapsed=${elapsedSec}s total_tests=${totalEstimated}`);
  for (const st of active) {
    const testsDone = Number.parseInt(String(st.tests).replace(/,/g, ""), 10) || 0;
    const estTests = Math.max(1, Number(st.estimatedTests) || 1);
    const staleSec = ((Date.now() - st.lastSeenAt) / 1000).toFixed(1);
    const shipProg = sharedState.shipProgress.get(st.shipId);
    const shipTotal = Math.max(1, Number(shipProg?.totalEstimated) || estTests);
    const shipDone = Math.max(
      0,
      Math.min(
        shipTotal,
        Number(shipProg?.doneEstimated || 0) + Number(activeTestsByShip.get(st.shipId) || 0),
      ),
    );
    const runSec = ((Date.now() - st.startedAt) / 1000).toFixed(1);
    const phaseRaw = String(st.phase || "boot");
    const phaseMatch = phaseRaw.match(/^\[?Phase\s*(\d+)\]?\s*(.*)$/i);
    const phaseText = phaseMatch
      ? `P${phaseMatch[1]}${/\bDone\b/i.test(phaseMatch[2]) ? " Done" : ""}`
      : phaseRaw;
    lines.push(
      `  [slot-${st.slot}] ship=${st.shipId} phase=${phaseText} tests=${testsDone}/${st.estimatedTests} ship_tests=${shipDone}/${shipTotal} run=${runSec}s idle=${staleSec}s`,
    );
  }
  if (active.length === 0 && queued === 0) {
    lines.push("  all shards completed.");
  }
  const text = lines.join("\n");
  if (process.stdout.isTTY) {
    if (sharedState.renderedLines > 0) {
      readline.moveCursor(process.stdout, 0, -sharedState.renderedLines);
      readline.clearScreenDown(process.stdout);
    }
    process.stdout.write(text + "\n");
    sharedState.renderedLines = lines.length;
  } else {
    const shouldEmit =
      sharedState.lastNonTTYDone !== done ||
      !sharedState.lastNonTTYAt ||
      Date.now() - sharedState.lastNonTTYAt >= 30000;
    if (shouldEmit) {
      console.log(text);
      sharedState.lastNonTTYDone = done;
      sharedState.lastNonTTYAt = Date.now();
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scanPath = path.join(ROOT, "scripts", "core", "scan-ast.js");

  const masterPath = findMasterData(opts.periodTag);
  if (!masterPath) throw new Error("No master data found for parallel scan.");
  const masterData = parseMasterData(masterPath);

  const { mstShips, estimateShip } = createShipEstimator(masterData);
  const allShips = mstShips.map((s) => s.api_id);
  const targetShipSet =
    opts.ships && opts.ships.length > 0
      ? new Set(opts.ships)
      : opts.shipRange
        ? new Set(expandShipRange(opts.shipRange))
        : new Set(allShips);

  const targetShips = mstShips.filter((s) => targetShipSet.has(s.api_id));
  if (targetShips.length === 0) throw new Error("No target ships resolved.");

  const estimates = targetShips.map((ship) =>
    estimateShip(ship, opts.maxComboSize, opts.strictNMinusOne, opts.allowDuplicateItems),
  );

  const estimateOutName = opts.periodTag
    ? `scan_estimated_tests_${opts.periodTag}.json`
    : "scan_estimated_tests.json";
  const estimatePath = path.join(ROOT, "output", estimateOutName);
  fs.mkdirSync(path.dirname(estimatePath), { recursive: true });
  fs.writeFileSync(
    estimatePath,
    JSON.stringify(
      {
        period_tag: opts.periodTag,
        strict_nminus1: opts.strictNMinusOne,
        allow_duplicate_items: opts.allowDuplicateItems,
        max_combo_size: opts.maxComboSize,
        ships: estimates.sort((a, b) => b.estimatedTests - a.estimatedTests),
      },
      null,
      2,
    ),
    "utf8",
  );

  const cpuCount = os.cpus().length;
  const workers = Math.max(1, Math.min(opts.workers, cpuCount, targetShips.length));

  const shardCount =
    opts.scheduleShards > 0
      ? Math.max(workers, Math.min(opts.scheduleShards, targetShips.length))
      : targetShips.length;

  const tasks = buildTasks(estimates, workers, shardCount).map((task, index) => ({
    ...task,
    shardId: index + 1,
  }));
  const totalEstimated = tasks.reduce((acc, s) => acc + s.estimatedTests, 0);

  console.log(
    `[parallel-scan] workers=${workers}, shards=${tasks.length}, ships=${targetShips.length}, period=${opts.periodTag || "(latest)"}`,
  );
  console.log(
    `[parallel-scan] scheduling=weighted-lpt-dynamic, strict=${opts.strictNMinusOne}, duplicate=${opts.allowDuplicateItems}, max_combo=${opts.maxComboSize}`,
  );
  console.log(`[parallel-scan] ship test estimates: ${path.relative(ROOT, estimatePath)}`);

  const top = [...estimates]
    .sort((a, b) => b.estimatedTests - a.estimatedTests)
    .slice(0, Math.min(12, estimates.length));
  for (const s of top) {
    console.log(
      `  [heavy] ship=${s.shipId} ${s.shipName} est=${s.estimatedTests} equip=${s.equippableCount} slots=${s.effectiveSlots} c4=${s.c4}`,
    );
  }

  const tmpDir = path.join(ROOT, "output", `.scan-ast-parallel-${Date.now()}-${process.pid}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const sharedState = {
    startedAt: Date.now(),
    queue: [...tasks],
    active: new Map(),
    doneShards: 0,
    totalShards: tasks.length,
    completed: [],
    renderedLines: 0,
    shipProgress: new Map(),
    lastNonTTYDone: -1,
    lastNonTTYAt: 0,
  };

  for (const task of tasks) {
    const cur = sharedState.shipProgress.get(task.shipId);
    if (cur) {
      cur.totalEstimated += Number(task.estimatedTests || 0);
      continue;
    }
    sharedState.shipProgress.set(task.shipId, {
      shipName: task.shipName,
      totalEstimated: Number(task.estimatedTests || 0),
      doneEstimated: 0,
    });
  }

  const timer = setInterval(() => {
    renderProgress(sharedState, totalEstimated);
  }, opts.progressIntervalMs);

  const outputs = [];

  async function workerLoop(slot) {
    while (true) {
      const shard = sharedState.queue.shift();
      if (!shard) break;
      const outPath = await runShard(scanPath, opts, shard, slot, tmpDir, sharedState);
      outputs.push(outPath);
    }
  }

  try {
    await Promise.all(Array.from({ length: workers }, (_, i) => workerLoop(i + 1)));
  } finally {
    clearInterval(timer);
    renderProgress(sharedState, totalEstimated);
  }

  const docs = outputs.map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
  const base = docs[0];
  const sumMeta = (key) => docs.reduce((acc, d) => acc + (Number(d?._meta?.[key]) || 0), 0);

  const outName = opts.periodTag
    ? `slot_item_effects_${opts.periodTag}.json`
    : "slot_item_effects_ast.json";
  const finalOutputPath = opts.outputPath || path.join(ROOT, "output", outName);

  const merged = {
    _meta: {
      ...base._meta,
      parallel_scan: true,
      parallel_workers: workers,
      schedule_shards: tasks.length,
      strict_nminus1: opts.strictNMinusOne,
      allow_duplicate_items: opts.allowDuplicateItems,
      max_combo_size: opts.maxComboSize,
      total_ships: Object.keys(Object.assign({}, ...docs.map((d) => d.ships || {}))).length,
      total_single_bonuses: sumMeta("total_single_bonuses"),
      total_cross_synergies: sumMeta("total_cross_synergies"),
      total_triple_synergies: sumMeta("total_triple_synergies"),
      total_quad_corrections: sumMeta("total_quad_corrections"),
      total_penta_corrections: sumMeta("total_penta_corrections"),
      total_hexa_corrections: sumMeta("total_hexa_corrections"),
    },
    ships: Object.assign({}, ...docs.map((d) => d.ships || {})),
    items: base.items || {},
  };

  merged.effect_rules = mergeRuleSet(docs.map((d) => d.effect_rules || []), "items");
  merged.cross_rules = mergeRuleSet(docs.map((d) => d.cross_rules || []), "pairs");
  merged.triple_rules = mergeRuleSet(docs.map((d) => d.triple_rules || []));
  merged.quad_rules = mergeRuleSet(docs.map((d) => d.quad_rules || []));
  merged.penta_rules = mergeRuleSet(docs.map((d) => d.penta_rules || []));
  merged.hexa_rules = mergeRuleSet(docs.map((d) => d.hexa_rules || []));

  merged.effect_rules_equip_index = buildEquipIndex(merged.effect_rules);
  merged.cross_rules_equip_index = buildEquipIndex(merged.cross_rules);
  merged.triple_rules_equip_index = buildEquipIndex(merged.triple_rules);
  merged.quad_rules_equip_index = buildEquipIndex(merged.quad_rules);
  merged.penta_rules_equip_index = buildEquipIndex(merged.penta_rules);
  merged.hexa_rules_equip_index = buildEquipIndex(merged.hexa_rules);

  merged._meta.effect_rule_count = merged.effect_rules.length;
  merged._meta.cross_rule_count = merged.cross_rules.length;
  merged._meta.triple_rule_count = merged.triple_rules.length;
  merged._meta.quad_rule_count = merged.quad_rules.length;
  merged._meta.penta_rule_count = merged.penta_rules.length;
  merged._meta.hexa_rule_count = merged.hexa_rules.length;

  fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
  fs.writeFileSync(finalOutputPath, JSON.stringify(merged), "utf8");
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`[parallel-scan] merged output: ${path.relative(ROOT, finalOutputPath)}`);
}

main().catch((err) => {
  console.error(`[parallel-scan] Fatal: ${err?.message || err}`);
  process.exit(1);
});
