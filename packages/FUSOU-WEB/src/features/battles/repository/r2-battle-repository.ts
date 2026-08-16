import { cachedFetch } from "@/utils/fetchCache";
import {
  BattleRepositoryHttpError,
  type BattleDataRepository,
  type BattleDetailPayload,
  type BattleDetailQuery,
  type BattleDropsPayload,
  type DropsQuery,
  type BattleOverviewPayload,
  type OverviewQuery,
  type BattlePeriod,
  type RecordQuery,
  type RecordResult,
  type BattleSourceKind,
} from "./types";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

type SummaryPayload = {
  periods?: Array<{
    period_tag?: unknown;
    table_version?: unknown;
  }>;
};

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecords(value: unknown): JsonRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: JsonRecord[] = [];
  for (const item of value) {
    if (!isJsonRecord(item)) return null;
    records.push(item);
  }
  return records;
}

function parseOptionalJsonRecords(
  record: JsonRecord,
  key: string,
): JsonRecord[] | undefined | null {
  if (!(key in record)) return undefined;
  return parseJsonRecords(record[key]);
}

function parseSummaryPayload(value: unknown): SummaryPayload | null {
  if (!isJsonRecord(value)) return null;
  const rawPeriods = value["periods"];
  if (rawPeriods === undefined) return {};
  if (!Array.isArray(rawPeriods)) return null;
  const periods: SummaryPayload["periods"] = [];
  for (const rawPeriod of rawPeriods) {
    if (!isJsonRecord(rawPeriod)) return null;
    periods.push({
      period_tag: rawPeriod["period_tag"],
      table_version: rawPeriod["table_version"],
    });
  }
  return { periods };
}

function parseRecordResult(value: unknown): RecordResult | null {
  if (!isJsonRecord(value)) return null;
  const records = parseJsonRecords(value["records"]);
  if (!records) return null;
  return { ...value, records };
}

function parseMasterDataMeta(
  value: unknown,
): BattleOverviewPayload["master_data"] | null | undefined {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) return null;
  const meta: NonNullable<BattleOverviewPayload["master_data"]> = {};
  for (const key of ["period_tag", "table_version"] as const) {
    const item = value[key];
    if (item === undefined || item === null || typeof item === "string") {
      meta[key] = item ?? null;
    } else {
      return null;
    }
  }
  const revision = value["period_revision"];
  if (revision !== undefined && revision !== null) {
    if (typeof revision !== "number" || !Number.isFinite(revision)) {
      return null;
    }
    meta.period_revision = revision;
  } else if (revision === null) {
    meta.period_revision = null;
  }
  return meta;
}

function parseOverviewPayload(
  value: unknown,
  arrayKeys: readonly string[],
): JsonRecord | null {
  if (!isJsonRecord(value)) return null;
  for (const key of arrayKeys) {
    const records = parseOptionalJsonRecords(value, key);
    if (records === null) return null;
  }
  return value;
}

function parseBattleOverviewPayload(
  value: unknown,
): BattleOverviewPayload | null {
  const record = parseOverviewPayload(value, [
    "battles",
    "cells",
    "enemy_decks",
    "enemy_ships",
  ]);
  if (!record) return null;
  const payload: BattleOverviewPayload = {};
  if (typeof record["success"] === "boolean") payload.success = record["success"];
  if (typeof record["period_tag"] === "string") payload.period_tag = record["period_tag"];
  if (typeof record["table_version"] === "string" || record["table_version"] === null) {
    payload.table_version = record["table_version"];
  }
  const masterData = parseMasterDataMeta(record["master_data"]);
  if (masterData === null) return null;
  if (masterData !== undefined) payload.master_data = masterData;
  for (const key of ["battles", "cells", "enemy_decks", "enemy_ships"] as const) {
    const records = parseOptionalJsonRecords(record, key);
    if (records !== undefined && records !== null) payload[key] = records;
  }
  return payload;
}

function parseBattleDropsPayload(value: unknown): BattleDropsPayload | null {
  const record = parseOverviewPayload(value, ["battles", "mst_ships"]);
  if (!record) return null;
  const payload: BattleDropsPayload = {};
  if (typeof record["success"] === "boolean") payload.success = record["success"];
  if (typeof record["period_tag"] === "string") payload.period_tag = record["period_tag"];
  if (typeof record["table_version"] === "string" || record["table_version"] === null) {
    payload.table_version = record["table_version"];
  }
  const masterData = parseMasterDataMeta(record["master_data"]);
  if (masterData === null) return null;
  if (masterData !== undefined) payload.master_data = masterData;
  for (const key of ["battles", "mst_ships"] as const) {
    const records = parseOptionalJsonRecords(record, key);
    if (records !== undefined && records !== null) payload[key] = records;
  }
  return payload;
}

function parseBattleDetailPayload(value: unknown): BattleDetailPayload | null {
  if (!isJsonRecord(value)) return null;
  const payload: BattleDetailPayload = {};
  if (typeof value["success"] === "boolean") payload.success = value["success"];
  if (typeof value["period_tag"] === "string") payload.period_tag = value["period_tag"];
  if (typeof value["table_version"] === "string" || value["table_version"] === null) {
    payload.table_version = value["table_version"];
  }
  if (value["battle"] === null || isJsonRecord(value["battle"])) {
    payload.battle = value["battle"];
  } else if ("battle" in value) {
    return null;
  }
  if ("battle_indexes" in value) {
    if (!Array.isArray(value["battle_indexes"])) return null;
    const indexes = value["battle_indexes"];
    if (!indexes.every((item): item is number => typeof item === "number" && Number.isInteger(item))) {
      return null;
    }
    payload.battle_indexes = indexes;
  }
  if ("linked" in value) {
    if (!isJsonRecord(value["linked"])) return null;
    const linked: NonNullable<BattleDetailPayload["linked"]> = {};
    for (const [key, rawRecords] of Object.entries(value["linked"])) {
      const records = parseJsonRecords(rawRecords);
      if (!records) return null;
      linked[key] = records;
    }
    payload.linked = linked;
  }
  if ("refs" in value) {
    const refsValue = value["refs"];
    if (!isJsonRecord(refsValue)) return null;
    const refs: NonNullable<BattleDetailPayload["refs"]> = {};
    for (const key of ["mst_ship", "mst_slotitem"] as const) {
      if (!(key in refsValue)) continue;
      const records = parseJsonRecords(refsValue[key]);
      if (!records) return null;
      refs[key] = records;
    }
    if ("weapon_icon_frames" in refsValue) {
      refs.weapon_icon_frames = refsValue["weapon_icon_frames"];
    }
    payload.refs = refs;
  }
  if ("derived" in value) {
    const derivedValue = value["derived"];
    if (!isJsonRecord(derivedValue)) return null;
    const derived: NonNullable<BattleDetailPayload["derived"]> = {};
    for (const key of ["friendly_fleet", "enemy_fleet"] as const) {
      if (!(key in derivedValue)) continue;
      const records = parseJsonRecords(derivedValue[key]);
      if (!records) return null;
      derived[key] = records;
    }
    payload.derived = derived;
  }
  if ("source_meta" in value) {
    if (!isJsonRecord(value["source_meta"])) return null;
    const sourceMeta: NonNullable<BattleDetailPayload["source_meta"]> = {};
    if (typeof value["source_meta"]["env_uuid"] === "string") {
      sourceMeta.env_uuid = value["source_meta"]["env_uuid"];
    }
    if (typeof value["source_meta"]["battle_index"] === "number") {
      sourceMeta.battle_index = value["source_meta"]["battle_index"];
    }
    payload.source_meta = sourceMeta;
  }
  return payload;
}

const DEFAULT_LIMIT_BLOCKS = 200;
const DEFAULT_LIMIT_RECORDS = 20000;

function requestInit(
  signal?: AbortSignal,
  forceRefresh = false,
): RequestInit | undefined {
  if (!signal && !forceRefresh) return undefined;
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(forceRefresh
      ? { cache: "reload" as RequestCache, headers: { "Cache-Control": "no-cache" } }
      : {}),
  };
}

function appendOptionalQuery(
  params: URLSearchParams,
  name: string,
  value: string | number | undefined,
): void {
  if (value === undefined || value === "") return;
  params.set(name, String(value));
}

function buildRecordsUrl(query: RecordQuery): string {
  const params = new URLSearchParams();
  params.set("table", query.table);
  params.set("period_tag", query.periodTag);
  appendOptionalQuery(params, "table_version", query.tableVersion);
  appendOptionalQuery(params, "tier", query.tier);
  params.set("limit_blocks", String(query.limitBlocks ?? 120));
  params.set("limit_records", String(query.limitRecords ?? DEFAULT_LIMIT_RECORDS));
  if (query.filter) params.set("filter_json", JSON.stringify(query.filter));
  return `/api/battle-data/global/records?${params.toString()}`;
}

function buildOverviewUrl(
  path: "/overview" | "/drops",
  query: OverviewQuery,
): string {
  const params = new URLSearchParams();
  params.set("period_tag", query.periodTag);
  appendOptionalQuery(params, "table_version", query.tableVersion);
  params.set("limit_blocks", String(query.limitBlocks ?? DEFAULT_LIMIT_BLOCKS));
  params.set("limit_records", String(query.limitRecords ?? DEFAULT_LIMIT_RECORDS));
  return `/api/battle-data/global${path}?${params.toString()}`;
}

function buildDetailUrl(query: BattleDetailQuery): string {
  const params = new URLSearchParams();
  params.set("env_uuid", query.envUuid);
  params.set("battle_index", String(query.battleIndex));
  params.set("period_tag", query.periodTag);
  appendOptionalQuery(params, "table_version", query.tableVersion);
  return `/api/battle-data/detail?${params.toString()}`;
}

export class R2BattleRepository implements BattleDataRepository {
  readonly kind: BattleSourceKind = "r2";

  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher = cachedFetch) {
    this.fetcher = fetcher;
  }

  async listPeriods(table: string): Promise<BattlePeriod[]> {
    const params = new URLSearchParams({ table });
    const url = `/api/battle-data/global/summary?${params.toString()}`;
    const payload = await this.requestJson(url, parseSummaryPayload);
    return (payload.periods || [])
      .map((row) => ({
        periodTag: String(row.period_tag ?? "").trim(),
        tableVersion: String(row.table_version ?? "").trim() || null,
      }))
      .filter((row) => row.periodTag.length > 0);
  }

  async getRecords(query: RecordQuery): Promise<RecordResult> {
    return this.requestJson(
      buildRecordsUrl(query),
      parseRecordResult,
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async getOverview(query: OverviewQuery): Promise<BattleOverviewPayload> {
    return this.requestJson(
      buildOverviewUrl("/overview", query),
      parseBattleOverviewPayload,
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async getDrops(query: DropsQuery): Promise<BattleDropsPayload> {
    return this.requestJson(
      buildOverviewUrl("/drops", query),
      parseBattleDropsPayload,
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async getDetail(query: BattleDetailQuery): Promise<BattleDetailPayload> {
    return this.requestJson(
      buildDetailUrl(query),
      parseBattleDetailPayload,
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async dispose(): Promise<void> {
    return undefined;
  }

  private async requestJson<T>(
    url: string,
    parse: (value: unknown) => T | null,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetcher(url, init);
    if (!response.ok) {
      throw new BattleRepositoryHttpError(response.status, url);
    }
    const payload = parse(await response.json());
    if (payload === null) {
      throw new Error(`Invalid battle data response: ${url}`);
    }
    return payload;
  }
}