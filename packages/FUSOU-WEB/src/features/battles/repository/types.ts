export type BattleSourceKind = "r2" | "local-avro";

export type BattleDataProgressPhase =
  | "permission"
  | "file-discovery"
  | "manifest-validation"
  | "header-validation"
  | "decode"
  | "index"
  | "resolve";

export type BattleDataProgress = {
  phase: BattleDataProgressPhase;
  completed: number;
  total: number;
  label?: string;
  completedBytes?: number;
  totalBytes?: number;
  records?: number;
};

export type BattleRepositoryRequestOptions = {
  onProgress?: (progress: BattleDataProgress) => void;
};

export type BattlePeriod = {
  periodTag: string;
  tableVersion: string | null;
};

export type RecordQuery = {
  table: string;
  periodTag: string;
  tableVersion?: string;
  tier?: "hourly" | "daily" | "weekly" | "period";
  filter?: Record<string, unknown>;
  limitBlocks?: number;
  limitRecords?: number;
  signal?: AbortSignal;
  forceRefresh?: boolean;
};

export type OverviewQuery = {
  periodTag: string;
  tableVersion?: string;
  masterShips?: JsonRecord[];
  limitBlocks?: number;
  limitRecords?: number;
  signal?: AbortSignal;
  forceRefresh?: boolean;
};

export type DropsQuery = OverviewQuery;

export type BattleDetailQuery = {
  envUuid: string;
  battleIndex: number;
  periodTag: string;
  tableVersion?: string;
  masterShips?: JsonRecord[];
  masterSlotItems?: JsonRecord[];
  signal?: AbortSignal;
  forceRefresh?: boolean;
};

export type JsonRecord = Record<string, unknown>;

export type RecordResult = {
  success?: boolean;
  table?: string;
  period_tag?: string;
  table_version?: string | null;
  count?: number;
  records: JsonRecord[];
  [key: string]: unknown;
};

export type MasterDataMeta = {
  period_tag?: string | null;
  period_revision?: number | null;
  table_version?: string | null;
};

export type BattleOverviewPayload = {
  success?: boolean;
  period_tag?: string;
  table_version?: string | null;
  master_data?: MasterDataMeta;
  battles?: JsonRecord[];
  cells?: JsonRecord[];
  enemy_decks?: JsonRecord[];
  enemy_ships?: JsonRecord[];
};

export type BattleDropsPayload = {
  success?: boolean;
  period_tag?: string;
  table_version?: string | null;
  master_data?: MasterDataMeta;
  battles?: JsonRecord[];
  mst_ships?: JsonRecord[];
};

export type BattleDetailPayload = {
  success?: boolean;
  period_tag?: string;
  table_version?: string | null;
  battle_indexes?: number[];
  battle?: JsonRecord | null;
  linked?: Record<string, JsonRecord[] | undefined>;
  refs?: {
    mst_ship?: JsonRecord[];
    mst_slotitem?: JsonRecord[];
    weapon_icon_frames?: unknown;
    [key: string]: unknown;
  };
  derived?: {
    friendly_fleet?: JsonRecord[];
    enemy_fleet?: JsonRecord[];
  };
  source_meta?: {
    env_uuid?: string;
    battle_index?: number;
  };
};

export interface BattleDataRepository {
  readonly kind: BattleSourceKind;
  listPeriods(table: string): Promise<BattlePeriod[]>;
  getRecords(query: RecordQuery, options?: BattleRepositoryRequestOptions): Promise<RecordResult>;
  getOverview(query: OverviewQuery, options?: BattleRepositoryRequestOptions): Promise<BattleOverviewPayload>;
  getDrops(query: DropsQuery, options?: BattleRepositoryRequestOptions): Promise<BattleDropsPayload>;
  getDetail(query: BattleDetailQuery, options?: BattleRepositoryRequestOptions): Promise<BattleDetailPayload>;
  dispose(): Promise<void>;
}

export class BattleRepositoryHttpError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`Battle data request failed: HTTP ${status}`);
    this.name = "BattleRepositoryHttpError";
    this.status = status;
    this.url = url;
  }

  readonly url: string;
}