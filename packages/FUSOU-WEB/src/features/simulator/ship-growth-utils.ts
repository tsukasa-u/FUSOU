import type { ChartData, ChartDataset } from "chart.js";
/**
 * Shared ship-growth related types and utility functions.
 * Used by both simulator-details-catalog (detail panels) and simulator-renderer (fleet cards).
 */

import { z } from "zod";
import { compareTableVersions } from "@/features/battles/helpers";

export type ShipGrowthSummary = {
  ok: boolean;
  periods?: Array<{ period_tag: string; table_version: string }>;
};

export type ShipGrowthCaps = {
  master_id: number;
  kaihi_max?: number;
  taisen_max?: number;
  sakuteki_max?: number;
  kaih_max?: number;
  tais_max?: number;
  saku_max?: number;
};

export type NormalizedShipGrowthCaps = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

export type ShipGrowthBoundRow = {
  master_id?: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  lucky_naked?: number;
};

export type ShipGrowthBoundsResponse = {
  caps?: ShipGrowthCaps[];
  bounds?: ShipGrowthBoundRow[];
  updated_at?: number;
  updated_at_iso?: string | null;
};

const ShipGrowthPeriodSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
  })
  .passthrough();

const ShipGrowthCapSchema = z
  .object({
    master_id: z.number().int().positive(),
    kaihi_max: z.number().finite().optional(),
    taisen_max: z.number().finite().optional(),
    sakuteki_max: z.number().finite().optional(),
    kaih_max: z.number().finite().optional(),
    tais_max: z.number().finite().optional(),
    saku_max: z.number().finite().optional(),
  })
  .passthrough()
  .transform((value): ShipGrowthCaps => {
    const result: ShipGrowthCaps = { master_id: value.master_id };
    if (value.kaihi_max !== undefined) result.kaihi_max = value.kaihi_max;
    if (value.taisen_max !== undefined) result.taisen_max = value.taisen_max;
    if (value.sakuteki_max !== undefined)
      result.sakuteki_max = value.sakuteki_max;
    if (value.kaih_max !== undefined) result.kaih_max = value.kaih_max;
    if (value.tais_max !== undefined) result.tais_max = value.tais_max;
    if (value.saku_max !== undefined) result.saku_max = value.saku_max;
    return result;
  });

const ShipGrowthBoundSchema = z
  .object({
    master_id: z.number().int().positive(),
    lv: z.number().int().positive(),
    kaihi_naked: z.number().finite(),
    taisen_naked: z.number().finite(),
    sakuteki_naked: z.number().finite(),
    lucky_naked: z.number().finite().optional().default(0),
  })
  .passthrough();

const ShipGrowthExpRowSchema = z
  .object({
    lv: z.number().int().positive(),
    exp_current: z.number().int().nonnegative(),
  })
  .passthrough();

export const ShipGrowthSummaryResponseSchema = z
  .object({
    ok: z.boolean(),
    periods: z.array(ShipGrowthPeriodSchema).optional(),
    cumulative_available: z.boolean().optional(),
    archive_object_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const ShipGrowthExpResponseSchema = z
  .object({
    ok: z.boolean(),
    exp: z.array(ShipGrowthExpRowSchema).optional(),
    rows: z.array(ShipGrowthExpRowSchema).optional(),
    updated_at: z.number().finite().optional(),
    updated_at_iso: z.string().nullable().optional(),
  })
  .passthrough()
  .refine((value) => !value.ok || value.exp !== undefined || value.rows !== undefined, {
    message: "Successful EXP response must include exp or rows",
  })
  .transform((value) => ({ ...value, exp: value.exp ?? value.rows ?? [] }));

export const ShipGrowthBoundsResponseSchema = z
  .object({
    ok: z.boolean(),
    bounds: z.array(ShipGrowthBoundSchema).optional(),
    caps: z.array(ShipGrowthCapSchema).optional(),
    updated_at: z.number().finite().optional(),
    updated_at_iso: z.string().nullable().optional(),
  })
  .passthrough()
  .refine((value) => !value.ok || (value.bounds !== undefined && value.caps !== undefined), {
    message: "Successful bounds response must include bounds and caps",
  });

const ShipGrowthAllPeriodsEntrySchema = z.object({
  period_tag: z.string().min(1),
  table_version: z.string().min(1),
  bounds: z.array(ShipGrowthBoundSchema),
  caps: z.array(ShipGrowthCapSchema),
}).passthrough();

export const ShipGrowthAllPeriodsResponseSchema = z
  .object({
    ok: z.boolean(),
    entries: z.array(ShipGrowthAllPeriodsEntrySchema).optional(),
    periods: z.array(ShipGrowthAllPeriodsEntrySchema).optional(),
  })
  .passthrough()
  .refine((value) => !value.ok || value.entries !== undefined || value.periods !== undefined, {
    message: "Successful all-periods response must include entries or periods",
  })
  .transform((value) => ({ ...value, entries: value.entries ?? value.periods ?? [] }));

export function normalizeShipGrowthCaps(
  raw: ShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!raw) return null;
  return {
    master_id: raw.master_id,
    kaihi_max: Number(raw.kaihi_max ?? raw.kaih_max ?? 0),
    taisen_max: Number(raw.taisen_max ?? raw.tais_max ?? 0),
    sakuteki_max: Number(raw.sakuteki_max ?? raw.saku_max ?? 0),
  };
}

export function deriveShipGrowthCapsFromBounds(
  masterId: number,
  bounds: ShipGrowthBoundRow[],
): NormalizedShipGrowthCaps | null {
  if (!Array.isArray(bounds) || bounds.length === 0) return null;

  const kaihiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.kaihi_naked || 0)),
  );
  const taisenMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.taisen_naked || 0)),
  );
  const sakutekiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.sakuteki_naked || 0)),
  );

  return {
    master_id: masterId,
    kaihi_max: kaihiMax,
    taisen_max: taisenMax,
    sakuteki_max: sakutekiMax,
  };
}

export function mergeShipGrowthCaps(
  primary: NormalizedShipGrowthCaps | null,
  fallback: NormalizedShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    master_id: primary.master_id,
    kaihi_max: primary.kaihi_max > 0 ? primary.kaihi_max : fallback.kaihi_max,
    taisen_max:
      primary.taisen_max > 0 ? primary.taisen_max : fallback.taisen_max,
    sakuteki_max:
      primary.sakuteki_max > 0 ? primary.sakuteki_max : fallback.sakuteki_max,
  };
}

export function needsStatFallback(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((v) => !Number.isFinite(v) || v <= 0);
}

export function selectLatestShipGrowthPeriod(
  periods: Array<{ period_tag: string; table_version: string }> | undefined | null,
): { period_tag: string; table_version: string } | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const sorted = [...periods].sort((a, b) => {
    const pCmp = b.period_tag.localeCompare(a.period_tag);
    if (pCmp !== 0) return pCmp;
    return compareTableVersions(b.table_version, a.table_version);
  });
  const latest = sorted[0];
  return latest ? { period_tag: latest.period_tag, table_version: latest.table_version } : null;
}

export type BoundRow = {
  master_id: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  lucky_naked: number;
  kaihi_source_period?: string;
  taisen_source_period?: string;
  sakuteki_source_period?: string;
  lucky_source_period?: string;
};

export type CapRow = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

export type AllPeriodsEntry = {
  period_tag: string;
  table_version: string;
  bounds: BoundRow[];
  caps: CapRow[];
};

export type BoundsDataPoint = { x: number; y: number; sourcePeriod?: string };

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeBoundRows(rows: unknown): BoundRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        master_id: toFiniteNumber(r["master_id"]),
        lv: toFiniteNumber(r["lv"]),
        kaihi_naked: toFiniteNumber(r["kaihi_naked"]),
        taisen_naked: toFiniteNumber(r["taisen_naked"]),
        sakuteki_naked: toFiniteNumber(r["sakuteki_naked"]),
        lucky_naked: toFiniteNumber(r["lucky_naked"]),
        ...(typeof r["kaihi_source_period"] === "string"
          ? { kaihi_source_period: r["kaihi_source_period"] }
          : {}),
        ...(typeof r["taisen_source_period"] === "string"
          ? { taisen_source_period: r["taisen_source_period"] }
          : {}),
        ...(typeof r["sakuteki_source_period"] === "string"
          ? { sakuteki_source_period: r["sakuteki_source_period"] }
          : {}),
        ...(typeof r["lucky_source_period"] === "string"
          ? { lucky_source_period: r["lucky_source_period"] }
          : {}),
      };
    })
    .filter(
      (row) =>
        Number.isFinite(row.master_id) &&
        row.master_id > 0 &&
        Number.isFinite(row.lv) &&
        row.lv > 0,
    );
}

export function mergeBoundsByMax(
  archiveRows: BoundRow[],
  liveRows: BoundRow[],
  liveSourcePeriod: string,
): BoundRow[] {
  const merged = new Map<string, BoundRow>();

  for (const row of archiveRows) {
    merged.set(`${row.master_id}:${row.lv}`, { ...row });
  }

  for (const liveRow of liveRows) {
    const key = `${liveRow.master_id}:${liveRow.lv}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...liveRow,
        kaihi_source_period: liveRow.kaihi_source_period ?? liveSourcePeriod,
        taisen_source_period:
          liveRow.taisen_source_period ?? liveSourcePeriod,
        sakuteki_source_period:
          liveRow.sakuteki_source_period ?? liveSourcePeriod,
        lucky_source_period:
          liveRow.lucky_source_period ?? liveSourcePeriod,
      });
      continue;
    }

    const next = { ...existing };
    if (
      liveRow.kaihi_naked > 0 &&
      (existing.kaihi_naked === 0 || liveRow.kaihi_naked < existing.kaihi_naked)
    ) {
      next.kaihi_naked = liveRow.kaihi_naked;
      next.kaihi_source_period =
        liveRow.kaihi_source_period ?? liveSourcePeriod;
    }
    if (
      liveRow.taisen_naked > 0 &&
      (existing.taisen_naked === 0 || liveRow.taisen_naked < existing.taisen_naked)
    ) {
      next.taisen_naked = liveRow.taisen_naked;
      next.taisen_source_period =
        liveRow.taisen_source_period ?? liveSourcePeriod;
    }
    if (
      liveRow.sakuteki_naked > 0 &&
      (existing.sakuteki_naked === 0 || liveRow.sakuteki_naked < existing.sakuteki_naked)
    ) {
      next.sakuteki_naked = liveRow.sakuteki_naked;
      next.sakuteki_source_period =
        liveRow.sakuteki_source_period ?? liveSourcePeriod;
    }
    if (
      liveRow.lucky_naked > 0 &&
      (existing.lucky_naked === 0 || liveRow.lucky_naked < existing.lucky_naked)
    ) {
      next.lucky_naked = liveRow.lucky_naked;
      next.lucky_source_period =
        liveRow.lucky_source_period ?? liveSourcePeriod;
    }
    merged.set(key, next);
  }

  return [...merged.values()].sort(
    (a, b) => a.master_id - b.master_id || a.lv - b.lv,
  );
}

export function mergeCapsByMax(archiveCaps: CapRow[], liveCaps: CapRow[]): CapRow[] {
  const merged = new Map<number, CapRow>();

  for (const row of archiveCaps) {
    merged.set(row.master_id, { ...row });
  }

  for (const liveRow of liveCaps) {
    const existing = merged.get(liveRow.master_id);
    if (!existing) {
      merged.set(liveRow.master_id, { ...liveRow });
      continue;
    }

    merged.set(liveRow.master_id, {
      master_id: liveRow.master_id,
      kaihi_max: Math.max(existing.kaihi_max, liveRow.kaihi_max),
      taisen_max: Math.max(existing.taisen_max, liveRow.taisen_max),
      sakuteki_max: Math.max(existing.sakuteki_max, liveRow.sakuteki_max),
    });
  }

  return [...merged.values()].sort((a, b) => a.master_id - b.master_id);
}

export const STAT_COLORS = {
  kaihi: "34,197,94", // green
  taisen: "249,115,22", // orange
  sakuteki: "168,85,247", // purple
  lucky: "234,179,8", // amber/yellow
} as const;

export function buildBoundsChartData(
  boundRows: BoundRow[],
  cap: CapRow | null,
): ChartData<"line", BoundsDataPoint[]> {
  const minLv = boundRows[0]?.lv ?? 1;
  const maxLv = boundRows[boundRows.length - 1]?.lv ?? 180;

  const datasets: ChartDataset<"line", BoundsDataPoint[]>[] = [];

  const kaihiData = boundRows
    .filter((r) => r.kaihi_naked > 0)
    .map((r) => ({
      x: r.lv,
      y: r.kaihi_naked,
      ...(r.kaihi_source_period
        ? { sourcePeriod: r.kaihi_source_period }
        : {}),
    }));
  if (kaihiData.length > 0) {
    datasets.push({
      label: "回避(naked)",
      data: kaihiData,
      borderColor: "rgb(34, 197, 94)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    });
  }

  const taisenData = boundRows
    .filter((r) => r.taisen_naked > 0)
    .map((r) => ({
      x: r.lv,
      y: r.taisen_naked,
      ...(r.taisen_source_period
        ? { sourcePeriod: r.taisen_source_period }
        : {}),
    }));
  if (taisenData.length > 0) {
    datasets.push({
      label: "対潜(naked)",
      data: taisenData,
      borderColor: "rgb(249, 115, 22)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    });
  }

  const sakutekiData = boundRows
    .filter((r) => r.sakuteki_naked > 0)
    .map((r) => ({
      x: r.lv,
      y: r.sakuteki_naked,
      ...(r.sakuteki_source_period
        ? { sourcePeriod: r.sakuteki_source_period }
        : {}),
    }));
  if (sakutekiData.length > 0) {
    datasets.push({
      label: "索敵(naked)",
      data: sakutekiData,
      borderColor: "rgb(168, 85, 247)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    });
  }

  const luckyData = boundRows
    .filter((r) => r.lucky_naked > 0)
    .map((r) => ({
      x: r.lv,
      y: r.lucky_naked,
      ...(r.lucky_source_period
        ? { sourcePeriod: r.lucky_source_period }
        : {}),
    }));
  if (luckyData.length > 0) {
    datasets.push({
      label: "運(naked)",
      data: luckyData,
      borderColor: "rgb(234, 179, 8)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    });
  }

  if (cap && boundRows.length > 0) {
    if (Number.isFinite(cap.kaihi_max) && cap.kaihi_max > 0) {
      datasets.push({
        label: "回避(cap)",
        data: [
          { x: minLv, y: cap.kaihi_max },
          { x: maxLv, y: cap.kaihi_max },
        ],
        borderColor: "rgba(34, 197, 94, 0.6)",
        borderDash: [8, 6],
        pointRadius: 0,
        tension: 0,
      });
    }
    if (Number.isFinite(cap.taisen_max) && cap.taisen_max > 0) {
      datasets.push({
        label: "対潜(cap)",
        data: [
          { x: minLv, y: cap.taisen_max },
          { x: maxLv, y: cap.taisen_max },
        ],
        borderColor: "rgba(249, 115, 22, 0.6)",
        borderDash: [8, 6],
        pointRadius: 0,
        tension: 0,
      });
    }
    if (Number.isFinite(cap.sakuteki_max) && cap.sakuteki_max > 0) {
      datasets.push({
        label: "索敵(cap)",
        data: [
          { x: minLv, y: cap.sakuteki_max },
          { x: maxLv, y: cap.sakuteki_max },
        ],
        borderColor: "rgba(168, 85, 247, 0.6)",
        borderDash: [8, 6],
        pointRadius: 0,
        tension: 0,
      });
    }
  }

  return { datasets };
}

export function buildAllPeriodsBoundsChartData(
  entries: AllPeriodsEntry[],
  masterId: number | null,
): ChartData<"line", BoundsDataPoint[]> {
  const datasets: ChartDataset<"line", BoundsDataPoint[]>[] = [];
  const total = entries.length;
  let lastDataIdx = -1;
  for (let i = total - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    const hasRows =
      masterId != null
        ? entry.bounds.some((r) => r.master_id === masterId && (r.kaihi_naked > 0 || r.taisen_naked > 0 || r.sakuteki_naked > 0 || r.lucky_naked > 0))
        : entry.bounds.length > 0;
    if (hasRows) {
      lastDataIdx = i;
      break;
    }
  }
  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const rows =
      masterId != null
        ? entry.bounds.filter((r) => r.master_id === masterId)
        : entry.bounds;
    if (rows.length === 0) continue;
    const alpha = total > 1 ? 0.15 + 0.85 * (i / (total - 1)) : 1;
    const borderWidth = i === lastDataIdx ? 2.5 : 1.5;
    const shortLabel = `${entry.period_tag}(v${entry.table_version})`;
    const { kaihi, taisen, sakuteki, lucky } = STAT_COLORS;

    const kaihiData = rows
      .filter((r) => r.kaihi_naked > 0)
      .map((r) => ({ x: r.lv, y: r.kaihi_naked }));
    if (kaihiData.length > 0) {
      datasets.push({
        label: `回避(naked) - ${shortLabel}`,
        data: kaihiData,
        borderColor: `rgba(${kaihi},${alpha})`,
        hoverBorderColor: `rgb(${kaihi})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      });
    }

    const taisenData = rows
      .filter((r) => r.taisen_naked > 0)
      .map((r) => ({ x: r.lv, y: r.taisen_naked }));
    if (taisenData.length > 0) {
      datasets.push({
        label: `対潜(naked) - ${shortLabel}`,
        data: taisenData,
        borderColor: `rgba(${taisen},${alpha})`,
        hoverBorderColor: `rgb(${taisen})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      });
    }

    const sakutekiData = rows
      .filter((r) => r.sakuteki_naked > 0)
      .map((r) => ({ x: r.lv, y: r.sakuteki_naked }));
    if (sakutekiData.length > 0) {
      datasets.push({
        label: `索敵(naked) - ${shortLabel}`,
        data: sakutekiData,
        borderColor: `rgba(${sakuteki},${alpha})`,
        hoverBorderColor: `rgb(${sakuteki})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      });
    }

    const luckyData = rows
      .filter((r) => r.lucky_naked > 0)
      .map((r) => ({ x: r.lv, y: r.lucky_naked }));
    if (luckyData.length > 0) {
      datasets.push({
        label: `運(naked) - ${shortLabel}`,
        data: luckyData,
        borderColor: `rgba(${lucky},${alpha})`,
        hoverBorderColor: `rgb(${lucky})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      });
    }
  }
  return { datasets };
}

export function normalizeCapRows(rows: ShipGrowthCaps[] | undefined): CapRow[] {
  return (rows ?? [])
    .map(normalizeShipGrowthCaps)
    .filter((row): row is CapRow => row !== null && row.master_id > 0);
}

export function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
