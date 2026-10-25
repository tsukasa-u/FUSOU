import { schedules, task } from "@trigger.dev/sdk/v3";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runCompactionJob } from "../index.js";
import { InternalCompactionClient } from "../internal-api.js";
import type { CompactionTier } from "../types.js";

type Window = { start: number; end: number };
type BackfillPayload = {
  tier: Exclude<CompactionTier, "hourly">;
  source_tier?: CompactionTier;
  start_ms?: number;
  end_ms?: number;
  table_names?: string[];
  chunk_limit?: number;
  period_tag?: string | undefined;
  table_version?: string | undefined;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function buildInternalClient(): InternalCompactionClient {
  const baseUrl = requiredEnv("INTERNAL_COMPACTION_BASE_URL").replace(/\/$/, "");
  const token = requiredEnv("INTERNAL_COMPACTION_TOKEN");
  return new InternalCompactionClient({ baseUrl, token });
}

export function buildWindow(tier: CompactionTier, now = Date.now()): Window {
  if (tier === "hourly") {
    const end = Math.floor(now / 3_600_000) * 3_600_000;
    return { start: end - 3_600_000, end };
  }
  if (tier === "daily") {
    const end = Math.floor(now / 86_400_000) * 86_400_000;
    return { start: end - 86_400_000, end };
  }
  if (tier === "weekly") {
    const WEEK_MS = 7 * 86_400_000;
    const MONDAY_OFFSET_MS = 4 * 86_400_000; // 1970-01-05 00:00:00 UTC was Monday
    const end = Math.floor((now - MONDAY_OFFSET_MS) / WEEK_MS) * WEEK_MS + MONDAY_OFFSET_MS;
    return { start: end - WEEK_MS, end };
  }
  return { start: 0, end: Number.MAX_SAFE_INTEGER };
}

function defaultSourceTierFor(tier: CompactionTier): CompactionTier {
  if (tier === "hourly") return "hourly";
  if (tier === "daily") return "hourly";
  if (tier === "weekly") return "daily";
  return "weekly";
}

function resolveRequestedTables(requested?: string[]): string[] {
  if (!Array.isArray(requested) || requested.length === 0) return [];
  return [...new Set(requested.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function resolveTargetTables(params: {
  sourceTier: CompactionTier;
  requested?: string[];
  window?: Window;
}): Promise<string[]> {
  const requested = resolveRequestedTables(params.requested);
  if (requested.length > 0) return requested;

  const client = buildInternalClient();
  return await client.listSourceTables({
    tier: params.sourceTier,
    ...(params.window?.start !== undefined
      ? { window_start_ms: params.window.start }
      : {}),
    ...(params.window?.end !== undefined
      ? { window_end_ms: params.window.end }
      : {}),
  });
}

function pickLatestSourceGroup(
  groups: Array<{ period_tag: string; table_version: string; source_blocks: number }>,
): { period_tag: string; table_version: string; source_blocks: number } | null {
  return groups[0] ?? null;
}

function createOutputGroupKey(params: {
  tier: CompactionTier;
  sourceTier: CompactionTier;
  windowStart: number;
  windowEnd: number;
  scope: string;
}): string {
  const epochSec = Math.max(0, Math.trunc(Number(params.windowEnd || 0) / 1000));
  const digest = createHash("sha256")
    .update(
      `${params.tier}:${params.sourceTier}:${params.windowStart}:${params.windowEnd}:${params.scope}`,
    )
    .digest("hex")
    .slice(0, 12);
  return `${epochSec}-${digest}`;
}

async function runWindowedBackfill(params: {
  tier: CompactionTier;
  sourceTier: CompactionTier;
  window: Window;
  tableNames: string[];
  chunkLimit: number;
}): Promise<void> {
  const client = buildInternalClient();
  const outputGroupKey = createOutputGroupKey({
    tier: params.tier,
    sourceTier: params.sourceTier,
    windowStart: params.window.start,
    windowEnd: params.window.end,
    scope: "windowed",
  });

  for (const tableName of params.tableNames) {
    const groups = await client.listSourceGroups({
      tier: params.sourceTier,
      table_name: tableName,
      window_start_ms: params.window.start,
      window_end_ms: params.window.end,
    });

    for (const group of groups) {
      await runCompactionJob({
        run_key: `backfill:${params.tier}:${params.sourceTier}:${group.period_tag}:${group.table_version}:${params.window.start}:${params.window.end}`,
        tier: params.tier,
        source_tier: params.sourceTier,
        output_group_key: outputGroupKey,
        table_name: tableName,
        period_tag: group.period_tag,
        table_version: group.table_version,
        window_start_ms: params.window.start,
        window_end_ms: params.window.end,
        chunk_limit: params.chunkLimit,
      });
    }
  }
}


async function triggerSnapshotRebuild(periodTag: string): Promise<void> {
  console.info(`[compactor] Automatically rebuilding snapshots for period: ${periodTag}...`);
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      path.resolve(currentDir, "../../../FUSOU-WEB/scripts/rebuild-all-snapshots.mjs"),
      path.resolve(currentDir, "../../FUSOU-WEB/scripts/rebuild-all-snapshots.mjs"),
      path.resolve(process.cwd(), "../FUSOU-WEB/scripts/rebuild-all-snapshots.mjs"),
      path.resolve(process.cwd(), "packages/FUSOU-WEB/scripts/rebuild-all-snapshots.mjs"),
    ];
    const scriptPath = candidatePaths.find((p) => fs.existsSync(p));
    if (scriptPath) {
      execSync(`node "${scriptPath}"`, { stdio: "inherit", env: { ...process.env, PERIOD_TAG: periodTag } });
      console.info(`[compactor] Snapshot rebuild complete for period: ${periodTag}`);
    } else {
      console.warn(`[compactor] rebuild-all-snapshots.mjs not found in candidates, skipping snapshot rebuild.`);
    }
  } catch (err) {
    console.warn(`[compactor] Failed to automatically rebuild snapshots for ${periodTag}:`, err);
  }
}

async function runPeriodBackfill(params: {
  sourceTier: CompactionTier;
  discoveryWindow: Window;
  tableNames: string[];
  chunkLimit: number;
  periodTag?: string | undefined;
  tableVersion?: string | undefined;
}): Promise<void> {
  const client = buildInternalClient();
  const outputGroupKey = createOutputGroupKey({
    tier: "period",
    sourceTier: params.sourceTier,
    windowStart: params.discoveryWindow.start,
    windowEnd: params.discoveryWindow.end,
    scope: "period",
  });

  const affectedPeriods = new Set<string>();

  for (const tableName of params.tableNames) {
    const rawGroups = await client.listSourceGroups({
      tier: params.sourceTier,
      table_name: tableName,
      window_start_ms: params.discoveryWindow.start,
      window_end_ms: params.discoveryWindow.end,
    });

    const groups = rawGroups.filter((g) => {
      if (params.periodTag && g.period_tag !== params.periodTag) return false;
      if (params.tableVersion && g.table_version !== params.tableVersion) return false;
      return true;
    });

    for (const group of groups) {
      if (group.period_tag) affectedPeriods.add(group.period_tag);
      await runCompactionJob({
        run_key: `backfill:period:${params.sourceTier}:${group.period_tag}:${group.table_version}`,
        tier: "period",
        source_tier: params.sourceTier,
        output_group_key: outputGroupKey,
        table_name: tableName,
        period_tag: group.period_tag,
        table_version: group.table_version,
        window_start_ms: 0,
        window_end_ms: Number.MAX_SAFE_INTEGER,
        chunk_limit: params.chunkLimit,
      });
    }
  }

  // Convergence pass: If promoted from lower tier (e.g. weekly -> period),
  // automatically merge existing period outputs into a single converged file per table.
  if (params.sourceTier !== "period") {
    console.info("[compactor] Running automatic period convergence pass to unify existing period outputs...");
    for (const tableName of params.tableNames) {
      const rawPeriodGroups = await client.listSourceGroups({
        tier: "period",
        table_name: tableName,
        window_start_ms: 0,
        window_end_ms: Number.MAX_SAFE_INTEGER,
      });
      const periodGroups = rawPeriodGroups.filter((g) => {
        if (params.periodTag && g.period_tag !== params.periodTag) return false;
        if (params.tableVersion && g.table_version !== params.tableVersion) return false;
        return true;
      });
      for (const group of periodGroups) {
        if (group.period_tag) affectedPeriods.add(group.period_tag);
        await runCompactionJob({
          run_key: `converge:period:${group.period_tag}:${group.table_version}`,
          tier: "period",
          source_tier: "period",
          output_group_key: outputGroupKey,
          table_name: tableName,
          period_tag: group.period_tag,
          table_version: group.table_version,
          window_start_ms: 0,
          window_end_ms: Number.MAX_SAFE_INTEGER,
          chunk_limit: params.chunkLimit,
        });
      }
    }
  }

  // Automatically rebuild snapshots for all affected periods
  for (const periodTag of affectedPeriods) {
    await triggerSnapshotRebuild(periodTag);
  }
}

async function resolveBackfillWindow(params: {
  tier: CompactionTier;
  sourceTier: CompactionTier;
  tableNames: string[];
  startMs?: number;
  endMs?: number;
}): Promise<Window | null> {
  const startProvided = Number.isFinite(Number(params.startMs));
  const endProvided = Number.isFinite(Number(params.endMs));

  if (startProvided || endProvided) {
    if (!startProvided || !endProvided) {
      throw new Error("start_ms and end_ms must be provided together");
    }

    const start = Number(params.startMs);
    const end = Number(params.endMs);
    if (end <= start) {
      throw new Error("end_ms must be greater than start_ms");
    }

    return { start, end };
  }

  const client = buildInternalClient();
  const range = await client.resolveSourceWindowRange({
    tier: params.sourceTier,
    table_names: params.tableNames,
  });

  if (!Number.isFinite(Number(range.start_ms)) || !Number.isFinite(Number(range.end_ms))) {
    return null;
  }

  const start = Number(range.start_ms);
  const end = Number(range.end_ms);
  if (end <= start) {
    return null;
  }

  return { start, end };
}

async function runTierForAllTables(tier: CompactionTier, sourceTier: CompactionTier): Promise<void> {
  const window = buildWindow(tier);
  const outputGroupKey = createOutputGroupKey({
    tier,
    sourceTier,
    windowStart: window.start,
    windowEnd: window.end,
    scope: "scheduled",
  });
  const tables = await resolveTargetTables({
    sourceTier,
    window,
  });
  if (tables.length === 0) return;
  const client = buildInternalClient();

  for (const tableName of tables) {
    const groups = await client.listSourceGroups({
      tier: sourceTier,
      table_name: tableName,
      window_start_ms: window.start,
      window_end_ms: window.end,
    });

    for (const group of groups) {
      await runCompactionJob({
        run_key: `${tier}:${sourceTier}:${group.period_tag}:${group.table_version}:${window.start}:${window.end}`,
        tier,
        source_tier: sourceTier,
        output_group_key: outputGroupKey,
        table_name: tableName,
        period_tag: group.period_tag,
        table_version: group.table_version,
        window_start_ms: window.start,
        window_end_ms: window.end,
        chunk_limit: 200,
      });
    }
  }

  // Automatically rebuild snapshots for affected periods after daily/weekly compaction
  const affectedPeriods = new Set<string>();
  for (const tableName of tables) {
    const groups = await client.listSourceGroups({
      tier,
      table_name: tableName,
      window_start_ms: window.start,
      window_end_ms: window.end,
    });
    for (const g of groups) {
      if (g.period_tag) affectedPeriods.add(g.period_tag);
    }
  }
  for (const periodTag of affectedPeriods) {
    await triggerSnapshotRebuild(periodTag);
  }
}

async function runBackfillCascade(params: {
  startTier: Exclude<CompactionTier, "hourly">;
  sourceTier: CompactionTier;
  discoveryWindow: Window;
  tableNames: string[];
  chunkLimit: number;
  periodTag?: string | undefined;
  tableVersion?: string | undefined;
}): Promise<void> {
  const order: Exclude<CompactionTier, "hourly">[] = ["daily", "weekly", "period"];
  const startIndex = order.indexOf(params.startTier);
  if (startIndex < 0) {
    throw new Error(`Unsupported backfill tier: ${params.startTier}`);
  }

  for (const tier of order.slice(startIndex)) {
    if (tier === "period") {
      const periodSourceTier = tier === params.startTier ? params.sourceTier : "weekly";
      await runPeriodBackfill({
        sourceTier: periodSourceTier,
        discoveryWindow: params.discoveryWindow,
        tableNames: params.tableNames,
        chunkLimit: params.chunkLimit,
        periodTag: params.periodTag,
        tableVersion: params.tableVersion,
      });

      // Converge period outputs to a single file per table/period/version by
      // compacting period outputs into period again after weekly->period backfill.
      if (periodSourceTier !== "period") {
        await runPeriodBackfill({
          sourceTier: "period",
          discoveryWindow: params.discoveryWindow,
          tableNames: params.tableNames,
          chunkLimit: params.chunkLimit,
          periodTag: params.periodTag,
          tableVersion: params.tableVersion,
        });
      }
      continue;
    }

    await runWindowedBackfill({
      tier,
      sourceTier: tier === params.startTier ? params.sourceTier : defaultSourceTierFor(tier),
      window: params.discoveryWindow,
      tableNames: params.tableNames,
      chunkLimit: params.chunkLimit,
    });
  }
}
export const compactDaily = schedules.task({
  id: "compact-daily",
  queue: {
    name: "compaction-scheduled",
    concurrencyLimit: 1,
  },
  cron: "20 0 * * *",
  run: async () => {
    await runTierForAllTables("daily", "hourly");
  },
});

export const compactWeekly = schedules.task({
  id: "compact-weekly",
  queue: {
    name: "compaction-scheduled",
    concurrencyLimit: 1,
  },
  cron: "40 0 * * 1",
  run: async () => {
    await runTierForAllTables("weekly", "daily");
  },
});

// Period rollover compaction is intentionally manual-only.
// Use the backfill task (`tier: "period"`) when operators want to run it.

export const backfillCompaction = task({
  id: "backfill-compaction",
  queue: {
    name: "compaction-backfill",
    concurrencyLimit: 1,
  },
  run: async (payload: BackfillPayload) => {
    const tier = payload.tier;
    const sourceTier = payload.source_tier ?? (tier === "period" ? "period" : defaultSourceTierFor(tier));
    const requestedTables = resolveRequestedTables(payload.table_names);
    const tableNames = await resolveTargetTables({
      sourceTier,
      requested: requestedTables,
    });
    const chunkLimit = Number.isFinite(Number(payload.chunk_limit)) && Number(payload.chunk_limit) > 0
      ? Math.trunc(Number(payload.chunk_limit))
      : 200;

    if (!tableNames.length) {
      throw new Error("No valid table_names provided for backfill");
    }

    const resolvedWindow = await resolveBackfillWindow({
      tier,
      sourceTier,
      tableNames,
      ...(payload.start_ms !== undefined ? { startMs: payload.start_ms } : {}),
      ...(payload.end_ms !== undefined ? { endMs: payload.end_ms } : {}),
    });

    if (!resolvedWindow) {
      return {
        success: true,
        skipped: true,
        reason: "no source data found for requested tier/tables",
        tier,
        source_tier: sourceTier,
        table_names: tableNames,
      };
    }

    const start = resolvedWindow.start;
    const end = resolvedWindow.end;

    await runBackfillCascade({
      startTier: tier,
      sourceTier,
      discoveryWindow: { start, end },
      tableNames,
      chunkLimit,
      periodTag: payload.period_tag,
      tableVersion: payload.table_version ?? "0.6.0",
    });

    return {
      success: true,
      tier,
      source_tier: sourceTier,
      table_names: tableNames,
      start_ms: start,
      end_ms: end,
      used_default_range: !Number.isFinite(Number(payload.start_ms)) && !Number.isFinite(Number(payload.end_ms)),
    };
  },
});
