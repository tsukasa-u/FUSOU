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

const DEFAULT_LIMIT_BLOCKS = 200;
const DEFAULT_LIMIT_RECORDS = 20000;

function requestInit(
  signal?: AbortSignal,
  forceRefresh = false,
): RequestInit | undefined {
  if (!signal && !forceRefresh) return undefined;
  return {
    signal,
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
    const payload = await this.requestJson<SummaryPayload>(url);
    return (payload.periods || [])
      .map((row) => ({
        periodTag: String(row.period_tag ?? "").trim(),
        tableVersion: String(row.table_version ?? "").trim() || null,
      }))
      .filter((row) => row.periodTag.length > 0);
  }

  async getRecords(query: RecordQuery): Promise<RecordResult> {
    return this.requestJson<RecordResult>(
      buildRecordsUrl(query),
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async getOverview(query: OverviewQuery): Promise<BattleOverviewPayload> {
    return this.requestJson<BattleOverviewPayload>(
      buildOverviewUrl("/overview", query),
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async getDrops(query: DropsQuery): Promise<BattleDropsPayload> {
    return this.requestJson<BattleDropsPayload>(
      buildOverviewUrl("/drops", query),
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async getDetail(query: BattleDetailQuery): Promise<BattleDetailPayload> {
    return this.requestJson<BattleDetailPayload>(
      buildDetailUrl(query),
      requestInit(query.signal, query.forceRefresh),
    );
  }

  async dispose(): Promise<void> {
    return undefined;
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(url, init);
    if (!response.ok) {
      throw new BattleRepositoryHttpError(response.status, url);
    }
    return (await response.json()) as T;
  }
}