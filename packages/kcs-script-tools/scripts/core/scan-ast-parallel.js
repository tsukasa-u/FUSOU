#!/usr/bin/env node
/**
 * Resident Worker Pool Parallel Synergy Scanner (Phase-synchronized).
 *
 * Key architectural improvements over the legacy per-shard spawn runner:
 *   1. Loads deobfuscated.js & master data ONCE per worker (instead of 250+ cold spawns).
 *   2. Runs full-fleet Ship Deduplication after Phase 1 so identical bonus profiles
 *      are only scanned once across Phases 2-6.
 *   3. Phase barrier synchronization guarantees 100% complete lower-order rules
 *      before entering Phases 4-6 — eliminating the cross-shard divergence bug and
 *      making high worker counts (up to 16 logical threads) strictly equivalent to
 *      single-process scan-ast.js.
 *   4. Balanced combinatorial chunking (splitting heavy ships down to (ai, bi) ranges
 *      by exact combo count rather than uniform index width) eliminates tail stalls.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createHash } = require("crypto");
const { fork } = require("child_process");
const { ROOT, findMasterData, parseMasterData } = require("../../lib/loader");
const { createFastSlotAssigner } = require("./fast-eval");
const {
  bkey,
  combCount,
  detectPoolsByShip,
  createMasterContext,
  buildEffectRules,
  buildRules,
  mergeCompressedRules,
  compressRuleCombosGzip,
  resolveExclusiveGroups,
} = require("./rule-builder");

function parseArgs(argv) {
  const defaultWorkers = Math.max(1, Math.min(os.cpus().length, 16));
  const opts = {
    workers: defaultWorkers,
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
    skipBrotli: false,
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
    if (a === "--no-brotli") {
      opts.skipBrotli = true;
      continue;
    }

    throw new Error(`unknown option: ${a}`);
  }

  if (!Number.isFinite(opts.workers) || opts.workers < 1) opts.workers = 1;
  if (!Number.isFinite(opts.scheduleShards) || opts.scheduleShards < 0) opts.scheduleShards = 256;
  if (!Number.isFinite(opts.progressIntervalMs) || opts.progressIntervalMs < 250) {
    opts.progressIntervalMs = 2000;
  }
  if (!Number.isFinite(opts.maxOldSpaceMb) || opts.maxOldSpaceMb <= 0) opts.maxOldSpaceMb = 8192;
  if (!Number.isFinite(opts.maxComboSize) || opts.maxComboSize < 2 || opts.maxComboSize > 6) {
    throw new Error(`--max-combo-size must be integer in [2, 6], got: ${opts.maxComboSize}`);
  }

  return opts;
}

/**
 * Split all combinations of size k from n items into balanced chunks
 * of approximately `targetCombos` combinations each.
 * Each chunk is an array of `{ a, bStart, bEnd }` ranges covering every
 * valid (a, b, ...) tuple in strict lexicographic order with zero gaps/overlap.
 */
function buildBalancedComboChunks(n, k, allowDuplicates, targetCombos) {
  if (n < (allowDuplicates ? 1 : k)) return [];
  const chunks = [];
  let currentRanges = [];
  let currentWeight = 0;

  for (let a = 0; a < n; a++) {
    const bMin = allowDuplicates ? a : a + 1;
    let bStart = bMin;
    let rangeWeight = 0;

    for (let b = bMin; b < n; b++) {
      const remN = allowDuplicates ? n - b : n - 1 - b;
      const w = remN > 0 ? combCount(remN, k - 2, allowDuplicates) : 0;
      if (w === 0) continue;

      if (currentWeight + rangeWeight > 0 && currentWeight + rangeWeight + w > targetCombos) {
        if (b > bStart) {
          currentRanges.push({ a, bStart, bEnd: b });
          currentWeight += rangeWeight;
          bStart = b;
          rangeWeight = 0;
        }
        if (currentRanges.length > 0) {
          chunks.push({ ranges: currentRanges, weight: currentWeight });
          currentRanges = [];
          currentWeight = 0;
        }
      }
      rangeWeight += w;
    }

    if (bStart < n && rangeWeight > 0) {
      currentRanges.push({ a, bStart, bEnd: n });
      currentWeight += rangeWeight;
    }
  }

  if (currentRanges.length > 0) {
    chunks.push({ ranges: currentRanges, weight: currentWeight });
  }
  return chunks;
}

class WorkerPool {
  constructor(workerScript, count, execArgv) {
    this.workerScript = workerScript;
    this.count = count;
    this.execArgv = execArgv;
    this.workers = [];
    this.nextReqId = 1;
    this.destroyed = false;
  }

  start() {
    for (let i = 0; i < this.count; i++) {
      const child = fork(this.workerScript, [], {
        cwd: process.cwd(),
        execArgv: this.execArgv,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const pending = new Map();
      const entry = { id: i + 1, child, pending, exited: false };

      child.stdout.on("data", () => {});
      child.stderr.on("data", (buf) => {
        const text = buf.toString("utf8").trim();
        if (text) console.error(`[worker-${entry.id}] ${text}`);
      });

      child.on("message", (msg) => {
        const p = pending.get(msg.reqId);
        if (!p) return;
        pending.delete(msg.reqId);
        if (msg.ok) p.resolve(msg.payload);
        else p.reject(new Error(`worker-${entry.id}: ${msg.error}`));
      });

      child.on("error", (err) => {
        if (!this.destroyed && pending.size > 0) {
          for (const [, p] of pending) {
            p.reject(new Error(`worker-${entry.id} IPC error: ${err?.message || err}`));
          }
          pending.clear();
        }
      });

      child.on("exit", (code, signal) => {
        entry.exited = true;
        if (!this.destroyed && pending.size > 0) {
          for (const [, p] of pending) {
            p.reject(
              new Error(
                `worker-${entry.id} exited unexpectedly (code=${code}, signal=${signal})`,
              ),
            );
          }
          pending.clear();
        }
      });

      this.workers.push(entry);
    }
  }

  sendTo(entry, msg) {
    return new Promise((resolve, reject) => {
      if (entry.exited) {
        reject(new Error(`worker-${entry.id} already exited`));
        return;
      }
      const reqId = this.nextReqId++;
      entry.pending.set(reqId, { resolve, reject });
      entry.child.send({ ...msg, reqId });
    });
  }

  async broadcast(msg) {
    return Promise.all(this.workers.map((w) => this.sendTo(w, msg)));
  }

  /**
   * Dynamically dispatch `items` across all resident workers (work-stealing queue).
   * Returns results array indexed identically to `items`.
   */
  async runQueue(items, buildMsg, onProgress = null) {
    if (items.length === 0) return [];
    const results = new Array(items.length);
    let nextIdx = 0;
    let doneCount = 0;

    const runWorker = async (entry) => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= items.length) break;
        const msg = buildMsg(items[idx], idx);
        const res = await this.sendTo(entry, msg);
        results[idx] = res;
        doneCount++;
        if (onProgress) onProgress(doneCount, items.length, res, items[idx]);
      }
    };

    const activeCount = Math.min(this.workers.length, items.length);
    await Promise.all(
      this.workers.slice(0, activeCount).map((entry) => runWorker(entry)),
    );
    return results;
  }

  /**
   * Streaming work-stealing queue: invokes `onDone(doneCount, total, res, item)`
   * as each chunk finishes without retaining all chunk payloads in memory.
   */
  async runStreamingQueue(items, buildMsg, onDone) {
    if (items.length === 0) return;
    let nextIdx = 0;
    let doneCount = 0;

    const runWorker = async (entry) => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= items.length) break;
        const item = items[idx];
        const msg = buildMsg(item, idx);
        const res = await this.sendTo(entry, msg);
        doneCount++;
        onDone(doneCount, items.length, res, item);
      }
    };

    const activeCount = Math.min(this.workers.length, items.length);
    await Promise.all(
      this.workers.slice(0, activeCount).map((entry) => runWorker(entry)),
    );
  }

  async shutdown() {
    this.destroyed = true;
    await Promise.all(
      this.workers.map(async (entry) => {
        if (entry.exited) return;
        try {
          await Promise.race([
            this.sendTo(entry, { type: "shutdown" }),
            new Promise((r) => setTimeout(r, 1000)),
          ]);
        } catch {}
        if (!entry.exited) {
          try {
            entry.child.kill();
          } catch {}
        }
      }),
    );
  }
}

async function main() {
  const tTotal = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const deterministic = !opts.scanFlags.volatileGenerated;
  const pruneInvisible = !opts.scanFlags.noPruneInvisible;

  const masterPath = findMasterData(opts.periodTag);
  if (!masterPath) {
    throw new Error(
      `No valid *S@api_start2@getData* master data found in FUSOU-PROXY-DATA${opts.periodTag ? `/${opts.periodTag}/kcsapi` : ""}.`,
    );
  }
  const apiStart2BatchHash = createHash("sha256")
    .update(fs.readFileSync(masterPath))
    .digest("hex");
  const masterData = parseMasterData(masterPath);

  const ctx = createMasterContext(masterData, opts.ships, opts.shipRange);
  if (ctx.mstShips.length === 0) throw new Error("No target ships resolved.");

  const dictName = opts.periodTag ? `synergy_dict_${opts.periodTag}.json` : "synergy_dict.json";
  const astRulesPath = path.join(ROOT, "output", dictName);
  if (!fs.existsSync(astRulesPath)) {
    throw new Error(`Missing AST dictionary: ${path.relative(ROOT, astRulesPath)}. Run extract-ast first.`);
  }
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

  // Build AST candidate filter sets
  let astCandidateShipSet = null;
  if (opts.astCandidateShips === "all") {
    astCandidateShipSet = new Set(ctx.mstShips.map((s) => s.api_id));
  } else if (opts.astCandidateShips instanceof Set && opts.astCandidateShips.size > 0) {
    astCandidateShipSet = opts.astCandidateShips;
  }

  const astTokens = astRules.map((r) => ({
    ids: [...new Set(r.requiredItemIds)],
    types: [...new Set(r.requiredItemTypes)],
  }));
  const astShipConditionMatchedSet = {};
  if (astCandidateShipSet && astCandidateShipSet.size > 0) {
    for (const shipId of astCandidateShipSet) {
      const eqSet = ctx.equippableByShipSet[shipId];
      if (!eqSet) continue;
      const matched = new Set();
      for (const tok of astTokens) {
        for (const id of tok.ids) if (eqSet.has(id)) matched.add(id);
        for (const type of tok.types) {
          const ids = ctx.itemsByType2[type] || [];
          for (const id of ids) if (eqSet.has(id)) matched.add(id);
        }
      }
      astShipConditionMatchedSet[shipId] = matched;
    }
  }

  function getAstFilteredItemsForShip(shipId, items) {
    if (!astCandidateShipSet || !astCandidateShipSet.has(shipId)) return items;
    const matched = astShipConditionMatchedSet[shipId];
    if (!matched || matched.size === 0) return items;
    const filtered = items.filter((id) => matched.has(id));
    return filtered.length > 0 ? filtered : items;
  }

  const fastSlotAssigner = createFastSlotAssigner(
    ctx.mstShips,
    ctx.maxItemId,
    ctx.getAllowedPositions,
  );
  function canAssignComboToShip(shipId, items) {
    return fastSlotAssigner.canAssignCombo(shipId, items);
  }

  const cpuCount = os.cpus().length;
  const workers = Math.max(1, Math.min(opts.workers, cpuCount));
  const workerHeapMb = Math.max(1024, Math.min(opts.maxOldSpaceMb, 4096));
  const execArgv = [`--max-old-space-size=${workerHeapMb}`, ...opts.v8Flags];
  if (opts.profileV8) execArgv.push("--prof");

  console.log(
    `[parallel-scan] resident-pool workers=${workers}, ships=${ctx.mstShips.length}, items=${ctx.mstSlotitems.length}, period=${opts.periodTag || "(latest)"}`,
  );
  console.log(
    `[parallel-scan] mode: phase-synced, strict=${opts.strictNMinusOne}, duplicate=${opts.allowDuplicateItems}, max_combo=${opts.maxComboSize}`,
  );
  console.log(`[parallel-scan] master: ${path.relative(ROOT, masterPath)}`);

  const workerScript = path.join(ROOT, "scripts", "core", "scan-ast-worker.js");
  const pool = new WorkerPool(workerScript, workers, execArgv);
  const ipcTmpDir = path.join(ROOT, "output", `.scan-ast-ipc-${Date.now()}-${process.pid}`);
  fs.mkdirSync(ipcTmpDir, { recursive: true });
  const cleanupIpcTmp = () => {
    try {
      if (fs.existsSync(ipcTmpDir)) {
        fs.rmSync(ipcTmpDir, { recursive: true, force: true });
      }
    } catch {}
  };
  const writeIpcJson = (name, data) => {
    const filePath = path.join(ipcTmpDir, name);
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
    return filePath;
  };

  const onSignal = async (sig) => {
    await pool.shutdown();
    cleanupIpcTmp();
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const tBoot = Date.now();
    pool.start();
    const initResults = await pool.broadcast({
      type: "init",
      periodTag: opts.periodTag,
      useMain: opts.scanFlags.main,
      masterPath,
      astRulesPath,
      targetShips: opts.ships,
      targetShipRange: opts.shipRange,
    });
    const fastWrapperOn = initResults.every((r) => r && r.fastWrapper);
    console.log(
      `[parallel-scan] ${workers} resident workers ready in ${((Date.now() - tBoot) / 1000).toFixed(2)}s (fast-wrapper=${fastWrapperOn ? "on" : "fallback"})`,
    );

    // ═══════════════════════════════════════════════════════════════
    // Phase 1: Single-item scan (parallel across all target ships)
    // ═══════════════════════════════════════════════════════════════
    const t1 = Date.now();
    const allShipIds = ctx.mstShips.map((s) => s.api_id);
    const p1ChunkSize = Math.max(1, Math.ceil(allShipIds.length / (workers * 4)));
    const p1Batches = [];
    for (let i = 0; i < allShipIds.length; i += p1ChunkSize) {
      p1Batches.push(allShipIds.slice(i, i + p1ChunkSize));
    }

    const p1BatchResults = await pool.runQueue(p1Batches, (shipIds) => ({
      type: "phase1",
      shipIds,
    }));

    const singleBonus = {};
    const equipResults = new Map();
    const aloneEntries = [];
    let nonZeroCount = 0;

    for (const batch of p1BatchResults) {
      for (const r of batch.results) {
        if (!singleBonus[r.shipId]) singleBonus[r.shipId] = {};
        singleBonus[r.shipId][r.itemId] = r.b;
        aloneEntries.push([`${r.shipId}:${r.itemId}`, r.b]);
        if (!equipResults.has(r.itemId)) equipResults.set(r.itemId, new Map());
        const pm = equipResults.get(r.itemId);
        if (!pm.has(r.pk)) pm.set(r.pk, { ships: [], profile: r.profile });
        pm.get(r.pk).ships.push(r.shipId);
        nonZeroCount++;
      }
    }
    console.log(
      `[Phase 1] Done: ${nonZeroCount} bonuses in ${((Date.now() - t1) / 1000).toFixed(2)}s`,
    );

    // ── Ship deduplication by bonus profile + equippable fingerprint ──
    function shipBonusFingerprint(shipId) {
      const bonuses = singleBonus[shipId];
      if (!bonuses) return "";
      const equippable = ctx.equippableByShip[shipId] || [];
      const bonusEntries = Object.entries(bonuses)
        .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
        .map(([id, stats]) => `${id}:${JSON.stringify(stats)}`);
      return bonusEntries.join("|") + "||" + equippable.join(",");
    }

    const shipGroups = new Map();
    const shipToGroup = {};
    for (const shipData of ctx.mstShips) {
      const shipId = shipData.api_id;
      const fp = shipBonusFingerprint(shipId);
      if (!shipGroups.has(fp)) shipGroups.set(fp, []);
      shipGroups.get(fp).push(shipId);
    }
    const groupMembersOf = {};
    for (const [, members] of shipGroups) {
      const rep = members[0];
      groupMembersOf[rep] = members;
      for (const sid of members) shipToGroup[sid] = rep;
    }
    const repShips = Object.keys(groupMembersOf)
      .map(Number)
      .sort((a, b) => a - b);

    console.log(
      `[Opt] ${ctx.mstShips.length} ships → ${repShips.length} unique bonus profiles (${((1 - repShips.length / ctx.mstShips.length) * 100).toFixed(1)}% dedup)`,
    );

    // Broadcast baseline to all workers via temp file (avoids Windows IPC pipe size limits)
    const equipResultsSerialized = [];
    for (const [itemId, pm] of equipResults) {
      const entries = [];
      for (const [pk, data] of pm.entries()) {
        entries.push([pk, data]);
      }
      equipResultsSerialized.push([itemId, entries]);
    }
    const baselineFile = writeIpcJson("baseline.json", {
      equipResultsSerialized,
      aloneSerialized: aloneEntries,
    });
    await pool.broadcast({
      type: "setBaseline",
      filePath: baselineFile,
    });

    function appendSynergyForRepShip(
      synergyMap,
      repShipId,
      items,
      synergy,
      cancelsSingle = false,
      suppressedComponents = null,
    ) {
      const key = items.join(":");
      if (!synergyMap.has(key)) synergyMap.set(key, new Map());
      const profileKey =
        bkey(synergy) +
        (cancelsSingle ? "|C" : "") +
        (suppressedComponents ? "|S:" + suppressedComponents.join(",") : "");
      const pm = synergyMap.get(key);
      if (!pm.has(profileKey)) {
        const entry = { ships: [], items, synergy, placements: [] };
        if (cancelsSingle) entry.cancels_single = true;
        if (suppressedComponents) entry.suppressed_components = suppressedComponents;
        pm.set(profileKey, entry);
      }

      const entry = pm.get(profileKey);
      const members = groupMembersOf[repShipId] || [repShipId];
      for (const memberId of members) {
        const memberEquippableSet = ctx.equippableByShipSet[memberId];
        if (!memberEquippableSet) continue;
        if (!items.every((id) => memberEquippableSet.has(id))) continue;
        if (!canAssignComboToShip(memberId, items)) continue;
        entry.ships.push(memberId);
        for (const placement of ctx.getComboPlacementSummaries(memberId, items)) {
          if (
            !entry.placements.some(
              (p) => p.normal === placement.normal && p.exslot === placement.exslot,
            )
          ) {
            entry.placements.push(placement);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 2: Cross-item pair synergy scan (parallel by rep ship)
    // ═══════════════════════════════════════════════════════════════
    const t2 = Date.now();
    const p2ShipTasks = [];
    for (const repShipId of repShips) {
      const bonuses = singleBonus[repShipId];
      if (!bonuses) continue;
      const triggerItems = Object.keys(bonuses)
        .map((s) => parseInt(s, 10))
        .sort((a, b) => a - b);
      if (triggerItems.length === 0) continue;
      p2ShipTasks.push({ shipId: repShipId, triggerItems });
    }
    const useAstFilterSetArr = astCandidateShipSet ? [...astCandidateShipSet] : null;
    const p2Results = await pool.runQueue(p2ShipTasks, (task) => ({
      type: "phase2",
      tasks: [task],
      pruneInvisible,
      useAstFilterSet: useAstFilterSetArr,
    }));

    const repSynergyResults = {};
    let pairsTested = 0;
    for (const res of p2Results) {
      pairsTested += res.pairsTested;
      for (const f of res.found) {
        if (!repSynergyResults[f.shipId]) repSynergyResults[f.shipId] = {};
        repSynergyResults[f.shipId][f.pairKey] = {
          synDelta: f.synDelta,
          cancelsSingle: f.cancelsSingle,
          suppressedComponents: f.suppressedComponents,
        };
      }
    }

    const synergies = new Map();
    let synergyCount = 0;
    for (const repShipId of repShips) {
      const pairMap = repSynergyResults[repShipId];
      if (!pairMap) continue;
      const members = groupMembersOf[repShipId] || [repShipId];
      for (const [pairKey, pairResult] of Object.entries(pairMap)) {
        const { synDelta, cancelsSingle } = pairResult;
        const [aStr, bStr] = pairKey.split(":");
        const itemA = parseInt(aStr, 10);
        const itemB = parseInt(bStr, 10);
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
            ...(pairResult.suppressedComponents
              ? { suppressed_components: pairResult.suppressedComponents }
              : {}),
          });
        }
        const entry = pm.get(profileKey);
        for (const memberId of members) {
          const memberEquippableSet = ctx.equippableByShipSet[memberId];
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

    const pairRules = buildRules(synergies, 2, ctx.itemEquipType2, { silent: true });
    console.log(
      `[Phase 2] Done: ${synergyCount} synergies from ${synergies.size} pairs (${pairsTested} tests, ${pairRules.length} rules) in ${((Date.now() - t2) / 1000).toFixed(2)}s`,
    );

    const pairRulesFile = writeIpcJson("rules_k2.json", pairRules);
    await pool.broadcast({
      type: "setCompiledRules",
      comboSize: 2,
      filePath: pairRulesFile,
    });

    // Build bonusItemsByRepShipArr (identical to scan-ast.js)
    const bonusItemsByRepShip = {};
    for (const [itemId, profileMap] of equipResults) {
      for (const { ships } of profileMap.values()) {
        for (const shipId of ships) {
          if (shipToGroup[shipId] !== shipId) continue;
          if (!bonusItemsByRepShip[shipId]) bonusItemsByRepShip[shipId] = new Set();
          bonusItemsByRepShip[shipId].add(itemId);
        }
      }
    }
    for (const [, profileMap] of synergies) {
      for (const { ships, items } of profileMap.values()) {
        for (const shipId of ships) {
          if (shipToGroup[shipId] !== shipId) continue;
          if (!bonusItemsByRepShip[shipId]) bonusItemsByRepShip[shipId] = new Set();
          for (const itemId of items) bonusItemsByRepShip[shipId].add(itemId);
        }
      }
    }
    const bonusItemsByRepShipArr = {};
    for (const [sid, itemSet] of Object.entries(bonusItemsByRepShip)) {
      bonusItemsByRepShipArr[sid] = [...itemSet].sort((a, b) => a - b);
    }
    const repShipIdsWithBonuses = Object.keys(bonusItemsByRepShipArr)
      .map(Number)
      .sort((a, b) => a - b);

    const PACK_RADIX = 2048;
    const PACK_RADIX_2 = PACK_RADIX * PACK_RADIX;
    const PACK_RADIX_3 = PACK_RADIX_2 * PACK_RADIX;
    function packComboUniqueKey(items, k) {
      if (k === 3) return items[0] * PACK_RADIX_2 + items[1] * PACK_RADIX + items[2];
      if (k === 4) {
        return (
          items[0] * PACK_RADIX_3 +
          items[1] * PACK_RADIX_2 +
          items[2] * PACK_RADIX +
          items[3]
        );
      }
      return items.join(":");
    }

    /**
     * Execute a combinatorial phase (3..6) with streaming per-ship compression:
     * chunks of each representative ship are queued contiguously (heaviest ships first).
     * As soon as all chunks of a ship complete, that ship's synergy map is compressed
     * via buildRules() and all raw chunk hits are immediately discarded to keep peak
     * coordinator heap tiny (~200 MB even for 10M+ full-fleet quad corrections).
     */
    async function runStreamingComboPhase({
      phaseLabel,
      comboSize,
      shipTaskGroups,
      buildMsg,
      extractPools,
      recordShipKeys,
    }) {
      const tStart = Date.now();
      // Sort heaviest ships first, keeping chunks of the same ship contiguous so
      // at most ~workers ships hold raw hits in memory simultaneously.
      const orderedShips = [...shipTaskGroups].sort((a, b) => b.totalWeight - a.totalWeight);
      const dispatchQueue = [];
      const shipPending = new Map();

      for (const sg of orderedShips) {
        if (sg.tasks.length === 0) continue;
        shipPending.set(sg.shipId, {
          remaining: sg.tasks.length,
          chunks: new Array(sg.tasks.length),
        });
        for (let ci = 0; ci < sg.tasks.length; ci++) {
          dispatchQueue.push({ ...sg.tasks[ci], shipId: sg.shipId, chunkIdx: ci });
        }
      }

      const compressedLists = [];
      const poolsByShip = {};
      const keysByShip = {};
      const shipsWithHits = new Set();
      const uniqueComboSet = new Set();
      let totalTests = 0;
      let totalRawHits = 0;
      let totalExpanded = 0;
      let shipsCompleted = 0;
      let lastLogAt = Date.now();

      await pool.runStreamingQueue(
        dispatchQueue,
        buildMsg,
        (done, total, res, task) => {
          totalTests += res.tested;
          totalRawHits += res.hitCount || 0;

          const state = shipPending.get(task.shipId);
          state.chunks[task.chunkIdx] = res.groups;
          state.remaining--;

          if (state.remaining === 0) {
            shipPending.delete(task.shipId);
            shipsCompleted++;

            const shipMap = new Map();
            let shipHasAny = false;
            for (let ci = 0; ci < state.chunks.length; ci++) {
              const groups = state.chunks[ci];
              state.chunks[ci] = null;
              if (!groups || groups.length === 0) continue;
              for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                const flat = g.flatItems;
                for (let off = 0; off < flat.length; off += comboSize) {
                  const items = flat.slice(off, off + comboSize);
                  appendSynergyForRepShip(
                    shipMap,
                    task.shipId,
                    items,
                    g.residual,
                    g.isCancel,
                    g.suppressedComponents,
                  );
                  uniqueComboSet.add(packComboUniqueKey(items, comboSize));
                  shipHasAny = true;
                }
              }
            }

            if (shipHasAny) {
              shipsWithHits.add(task.shipId);
              for (const [, pm] of shipMap) {
                for (const { ships } of pm.values()) {
                  totalExpanded += ships.length;
                }
              }
              if (recordShipKeys) {
                keysByShip[task.shipId] = [...shipMap.keys()];
              }
              if (extractPools) {
                const detected = detectPoolsByShip(shipMap, comboSize);
                for (const [sid, plist] of Object.entries(detected)) {
                  if (!poolsByShip[sid]) poolsByShip[sid] = [];
                  poolsByShip[sid].push(...plist);
                }
              }
              const shipRules = buildRules(shipMap, comboSize, ctx.itemEquipType2, {
                silent: true,
              });
              if (shipRules.length > 0) compressedLists.push(shipRules);
            }
          }

          const now = Date.now();
          if (now - lastLogAt >= opts.progressIntervalMs) {
            console.log(
              `[${phaseLabel}] chunks=${done}/${total} ships=${shipsCompleted}/${orderedShips.length} hits=${totalRawHits} tests=${totalTests} elapsed=${((now - tStart) / 1000).toFixed(1)}s`,
            );
            lastLogAt = now;
          }
        },
      );

      const rules = mergeCompressedRules(compressedLists, ctx.itemEquipType2);
      console.log(
        `[${phaseLabel}] Done: ${totalRawHits} hits (${uniqueComboSet.size} unique, ${totalTests} tests, ${rules.length} rules) in ${((Date.now() - tStart) / 1000).toFixed(2)}s`,
      );
      return {
        rules,
        poolsByShip,
        keysByShip,
        shipsWithHits,
        uniqueCount: uniqueComboSet.size,
        totalExpanded,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 3: Triple cross-item synergy scan (global merge for exact parity;
    // total hits across all ~870 ships are ~390k, comfortably small in memory)
    // ═══════════════════════════════════════════════════════════════
    const t3 = Date.now();
    const p3Tasks = [];
    for (const shipId of repShipIdsWithBonuses) {
      const bItems = getAstFilteredItemsForShip(shipId, bonusItemsByRepShipArr[shipId]);
      if (bItems.length < 3 || ctx.effectiveSlotsOf[shipId] < 3) continue;
      const chunks = buildBalancedComboChunks(bItems.length, 3, opts.allowDuplicateItems, 12000);
      for (let ci = 0; ci < chunks.length; ci++) {
        p3Tasks.push({
          shipId,
          bItems,
          chunkIdx: ci,
          ranges: chunks[ci].ranges,
          weight: chunks[ci].weight,
        });
      }
    }
    const p3DispatchOrder = p3Tasks
      .map((t, origIdx) => ({ ...t, origIdx }))
      .sort((a, b) => b.weight - a.weight);

    const p3OrderedGroups = new Array(p3Tasks.length);
    let p3Tests = 0;
    let p3Hits = 0;
    let p3LastLog = Date.now();
    await pool.runStreamingQueue(
      p3DispatchOrder,
      (task) => ({
        type: "phase3Chunk",
        shipId: task.shipId,
        bItems: task.bItems,
        allowDuplicateItems: opts.allowDuplicateItems,
        pruneInvisible,
        ranges: task.ranges,
      }),
      (done, total, res, task) => {
        p3Tests += res.tested;
        p3Hits += res.hitCount || 0;
        p3OrderedGroups[task.origIdx] = { shipId: task.shipId, groups: res.groups };
        const now = Date.now();
        if (now - p3LastLog >= opts.progressIntervalMs) {
          console.log(
            `[Phase 3] chunks=${done}/${total} hits=${p3Hits} tests=${p3Tests} elapsed=${((now - t3) / 1000).toFixed(1)}s`,
          );
          p3LastLog = now;
        }
      },
    );

    const tripleSynergies = new Map();
    const p3ShipsWithHits = new Set();
    const p3KeysByShip = {};
    for (let i = 0; i < p3OrderedGroups.length; i++) {
      const entry = p3OrderedGroups[i];
      p3OrderedGroups[i] = null;
      if (!entry || !entry.groups || entry.groups.length === 0) continue;
      for (let gi = 0; gi < entry.groups.length; gi++) {
        const g = entry.groups[gi];
        const flat = g.flatItems;
        for (let off = 0; off < flat.length; off += 3) {
          const items = flat.slice(off, off + 3);
          appendSynergyForRepShip(
            tripleSynergies,
            entry.shipId,
            items,
            g.residual,
            g.isCancel,
            g.suppressedComponents,
          );
        }
      }
    }
    for (const [tripleKey, profileMap] of tripleSynergies) {
      for (const { ships } of profileMap.values()) {
        for (const shipId of ships) {
          const repId = shipToGroup[shipId] || shipId;
          p3ShipsWithHits.add(repId);
          if (!opts.strictNMinusOne) {
            if (!p3KeysByShip[repId]) p3KeysByShip[repId] = [];
            p3KeysByShip[repId].push(tripleKey);
          }
        }
      }
    }
    const tripleRules = buildRules(tripleSynergies, 3, ctx.itemEquipType2, { silent: true });
    const p3 = {
      rules: tripleRules,
      shipsWithHits: p3ShipsWithHits,
      keysByShip: p3KeysByShip,
      uniqueCount: tripleSynergies.size,
    };
    tripleSynergies.clear();
    console.log(
      `[Phase 3] Done: ${p3Hits} hits (${p3.uniqueCount} unique, ${p3Tests} tests, ${tripleRules.length} rules) in ${((Date.now() - t3) / 1000).toFixed(2)}s`,
    );

    // ═══════════════════════════════════════════════════════════════
    // Phase 4: Quad cross-item correction scan (streaming per-ship compression)
    // ═══════════════════════════════════════════════════════════════
    let quadRules = [];
    let p4 = {
      rules: [],
      poolsByShip: {},
      keysByShip: {},
      shipsWithHits: new Set(),
      uniqueCount: 0,
      totalExpanded: 0,
    };

    if (opts.maxComboSize >= 4 && tripleRules.length > 0) {
      const tripleRulesFile = writeIpcJson("rules_k3.json", tripleRules);
      await pool.broadcast({
        type: "setCompiledRules",
        comboSize: 3,
        filePath: tripleRulesFile,
      });

      const p4ShipGroups = [];
      for (const shipId of repShipIdsWithBonuses) {
        const bItems = getAstFilteredItemsForShip(shipId, bonusItemsByRepShipArr[shipId]);
        if (bItems.length < 4 || ctx.effectiveSlotsOf[shipId] < 4) continue;
        if (!p3.shipsWithHits.has(shipId)) continue;
        const tripleKeySetArr = !opts.strictNMinusOne ? p3.keysByShip[shipId] || [] : null;
        const chunks = buildBalancedComboChunks(bItems.length, 4, opts.allowDuplicateItems, 12000);
        const totalWeight = chunks.reduce((a, c) => a + c.weight, 0);
        p4ShipGroups.push({
          shipId,
          totalWeight,
          tasks: chunks.map((c) => ({
            bItems,
            tripleKeySetArr,
            ranges: c.ranges,
            weight: c.weight,
          })),
        });
      }

      p4 = await runStreamingComboPhase({
        phaseLabel: "Phase 4",
        comboSize: 4,
        shipTaskGroups: p4ShipGroups,
        buildMsg: (task) => ({
          type: "phase4Chunk",
          shipId: task.shipId,
          bItems: task.bItems,
          allowDuplicateItems: opts.allowDuplicateItems,
          strictNMinusOne: opts.strictNMinusOne,
          pruneInvisible,
          tripleKeySetArr: task.tripleKeySetArr,
          ranges: task.ranges,
        }),
        extractPools: opts.maxComboSize >= 5,
        recordShipKeys: !opts.strictNMinusOne,
      });
      quadRules = p4.rules;
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 5: Penta cross-item correction scan (streaming per-ship compression)
    // ═══════════════════════════════════════════════════════════════
    let pentaRules = [];
    let p5 = {
      rules: [],
      poolsByShip: {},
      keysByShip: {},
      shipsWithHits: new Set(),
      uniqueCount: 0,
      totalExpanded: 0,
    };

    const repShipIdsForPenta = Object.keys(p4.poolsByShip)
      .map(Number)
      .filter((sid) => (shipToGroup[sid] || sid) === sid && ctx.effectiveSlotsOf[sid] >= 5)
      .sort((a, b) => a - b);

    if (opts.maxComboSize >= 5 && repShipIdsForPenta.length > 0) {
      const quadRulesFile = writeIpcJson("rules_k4.json", quadRules);
      await pool.broadcast({
        type: "setCompiledRules",
        comboSize: 4,
        filePath: quadRulesFile,
      });

      const p5ShipGroups = [];
      for (const shipId of repShipIdsForPenta) {
        const quadKeySetArr = !opts.strictNMinusOne ? p4.keysByShip[shipId] || [] : null;
        const shipTasks = [];
        let totalWeight = 0;
        for (const { pool: qPool } of p4.poolsByShip[shipId]) {
          const filteredPool = getAstFilteredItemsForShip(shipId, qPool);
          if (filteredPool.length < 5) continue;
          const chunks = buildBalancedComboChunks(
            filteredPool.length,
            5,
            opts.allowDuplicateItems,
            12000,
          );
          for (const c of chunks) {
            totalWeight += c.weight;
            shipTasks.push({
              filteredPool,
              quadKeySetArr,
              ranges: c.ranges,
              weight: c.weight,
            });
          }
        }
        if (shipTasks.length > 0) {
          p5ShipGroups.push({ shipId, totalWeight, tasks: shipTasks });
        }
      }

      p5 = await runStreamingComboPhase({
        phaseLabel: "Phase 5",
        comboSize: 5,
        shipTaskGroups: p5ShipGroups,
        buildMsg: (task) => ({
          type: "phase5Chunk",
          shipId: task.shipId,
          filteredPool: task.filteredPool,
          allowDuplicateItems: opts.allowDuplicateItems,
          strictNMinusOne: opts.strictNMinusOne,
          pruneInvisible,
          quadKeySetArr: task.quadKeySetArr,
          ranges: task.ranges,
        }),
        extractPools: opts.maxComboSize >= 6,
        recordShipKeys: !opts.strictNMinusOne,
      });
      pentaRules = p5.rules;
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 6: Hexa cross-item correction scan (streaming per-ship compression)
    // ═══════════════════════════════════════════════════════════════
    let hexaRules = [];
    let p6 = {
      rules: [],
      poolsByShip: {},
      keysByShip: {},
      shipsWithHits: new Set(),
      uniqueCount: 0,
      totalExpanded: 0,
    };

    const repShipIdsForHexa = Object.keys(p5.poolsByShip)
      .map(Number)
      .filter((sid) => (shipToGroup[sid] || sid) === sid && ctx.effectiveSlotsOf[sid] >= 6)
      .sort((a, b) => a - b);

    if (opts.maxComboSize >= 6 && repShipIdsForHexa.length > 0) {
      const pentaRulesFile = writeIpcJson("rules_k5.json", pentaRules);
      await pool.broadcast({
        type: "setCompiledRules",
        comboSize: 5,
        filePath: pentaRulesFile,
      });

      const p6ShipGroups = [];
      for (const shipId of repShipIdsForHexa) {
        const pentaKeySetArr = !opts.strictNMinusOne ? p5.keysByShip[shipId] || [] : null;
        const shipTasks = [];
        let totalWeight = 0;
        for (const { pool: pPool } of p5.poolsByShip[shipId]) {
          const filteredPool = getAstFilteredItemsForShip(shipId, pPool);
          if (filteredPool.length < 6) continue;
          const chunks = buildBalancedComboChunks(
            filteredPool.length,
            6,
            opts.allowDuplicateItems,
            12000,
          );
          for (const c of chunks) {
            totalWeight += c.weight;
            shipTasks.push({
              filteredPool,
              pentaKeySetArr,
              ranges: c.ranges,
              weight: c.weight,
            });
          }
        }
        if (shipTasks.length > 0) {
          p6ShipGroups.push({ shipId, totalWeight, tasks: shipTasks });
        }
      }

      p6 = await runStreamingComboPhase({
        phaseLabel: "Phase 6",
        comboSize: 6,
        shipTaskGroups: p6ShipGroups,
        buildMsg: (task) => ({
          type: "phase6Chunk",
          shipId: task.shipId,
          filteredPool: task.filteredPool,
          allowDuplicateItems: opts.allowDuplicateItems,
          strictNMinusOne: opts.strictNMinusOne,
          pruneInvisible,
          pentaKeySetArr: task.pentaKeySetArr,
          ranges: task.ranges,
        }),
        extractPools: false,
        recordShipKeys: false,
      });
      hexaRules = p6.rules;
    }

    // ═══════════════════════════════════════════════════════════════
    // Build final output (identical schema to scan-ast.js)
    // ═══════════════════════════════════════════════════════════════
    let finalSynergyCount = 0;
    for (const [, pm] of synergies) {
      for (const { ships } of pm.values()) finalSynergyCount += ships.length;
    }
    const finalPentaCount = p5.totalExpanded;
    const finalHexaCount = p6.totalExpanded;

    const effectRules = buildEffectRules(equipResults);
    const crossRules = pairRules;

    const nextIdRef = { val: 1 };
    resolveExclusiveGroups(crossRules, tripleRules, nextIdRef);
    resolveExclusiveGroups(tripleRules, quadRules, nextIdRef);
    resolveExclusiveGroups(quadRules, pentaRules, nextIdRef);
    resolveExclusiveGroups(pentaRules, hexaRules, nextIdRef);

    // Gzip-compress any remaining binary combo payloads (supported natively by FUSOU-WEB data-loader)
    compressRuleCombosGzip(crossRules);
    compressRuleCombosGzip(tripleRules);
    compressRuleCombosGzip(quadRules);
    compressRuleCombosGzip(pentaRules);
    compressRuleCombosGzip(hexaRules);

    const finalTripleCount = tripleRules.length;
    const finalQuadCount = quadRules.length;

    const pkgVersion = (() => {
      try {
        return (
          "v" +
          JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version
        );
      } catch {
        return "v0.0.0";
      }
    })();

    const output = {
      _meta: {
        generated: deterministic ? "1970-01-01T00:00:00.000Z" : new Date().toISOString(),
        generator_version: pkgVersion,
        api_start2_batch_hash: apiStart2BatchHash,
        period_tag: opts.periodTag,
        strict_nminus1: opts.strictNMinusOne,
        deterministic,
        source: path.basename(opts.scanFlags.main ? "main.js" : "output/deobfuscated.js"),
        total_ships: ctx.mstShips.length,
        total_items: ctx.mstSlotitems.length,
        total_single_bonuses: nonZeroCount,
        total_cross_synergies: finalSynergyCount,
        total_triple_synergies: finalTripleCount,
        unique_items_with_bonus: equipResults.size,
        unique_synergy_pairs: synergies.size,
        unique_synergy_triples: p3.uniqueCount,
        total_quad_corrections: finalQuadCount,
        unique_synergy_quads: p4.uniqueCount,
        total_penta_corrections: finalPentaCount,
        unique_synergy_pentas: p5.uniqueCount,
        total_hexa_corrections: finalHexaCount,
        unique_synergy_hexas: p6.uniqueCount,
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

    const outName = opts.periodTag
      ? `slot_item_effects_${opts.periodTag}.json`
      : "slot_item_effects_ast.json";
    const finalOutputPath = opts.outputPath || path.join(ROOT, "output", outName);

    fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
    const jsonOut = JSON.stringify(output);
    fs.writeFileSync(finalOutputPath, jsonOut, "utf8");
    console.log(
      `[parallel-scan] saved: ${path.relative(ROOT, finalOutputPath)} (${(Buffer.byteLength(jsonOut) / 1024).toFixed(1)} KB)`,
    );

    if (!opts.skipBrotli) {
      const brotliOut = zlib.brotliCompressSync(Buffer.from(jsonOut, "utf-8"), {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        },
      });
      const brotliPath = `${finalOutputPath}.br`;
      fs.writeFileSync(brotliPath, brotliOut);
      console.log(
        `[parallel-scan] saved: ${path.relative(ROOT, brotliPath)} (${(brotliOut.byteLength / 1024).toFixed(1)} KB)`,
      );

      const previewNameManifest = {
        _meta: {
          generated: deterministic ? "1970-01-01T00:00:00.000Z" : new Date().toISOString(),
          deterministic,
          source: path.basename(opts.scanFlags.main ? "main.js" : "output/deobfuscated.js"),
          total_ships: ctx.mstShips.length,
          total_items: ctx.mstSlotitems.length,
        },
        ships: Object.fromEntries(
          ctx.mstShips
            .map((ship) => [String(ship.api_id), ship.api_name])
            .filter(([, name]) => typeof name === "string" && name.length > 0),
        ),
        items: Object.fromEntries(
          ctx.mstSlotitems
            .map((item) => [String(item.api_id), item.api_name])
            .filter(([, name]) => typeof name === "string" && name.length > 0),
        ),
      };
      const previewPath = path.join(path.dirname(finalOutputPath), "preview_name_manifest.json");
      fs.writeFileSync(previewPath, JSON.stringify(previewNameManifest), "utf8");
    }

    console.log(
      `[parallel-scan] total elapsed: ${((Date.now() - tTotal) / 1000).toFixed(2)}s`,
    );
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await pool.shutdown();
    cleanupIpcTmp();
  }
}

main().catch((err) => {
  console.error(`[parallel-scan] Fatal: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
