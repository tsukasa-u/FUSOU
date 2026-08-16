import type {
  BattleRecord,
  CellRecord,
  EnemyDeckRecord,
  EnemyShipRecord,
  EnemySlotItemRecord,
  MstShipRecord,
  MstSlotItemRecord,
} from "../../map-flow/solid/battle-map-flow/types";
import type { WeaponIconFrame } from "@/features/battles/types";

export type PeriodSummary = {
  period_tag: string;
  table_version: string | null;
};

export type MasterDataStatusItem = {
  name: string;
  status: "pending" | "success" | "failed";
  detail?: string;
  diagnostic?: string;
};

export type SharedDashboardState = {
  activeTab: () => "list" | "detail" | "map-flow" | "stats" | "drops";
  setActiveTab: (tab: "list" | "detail" | "map-flow" | "stats" | "drops") => void;
  
  selectedPeriod: () => PeriodSummary | null;
  periods: () => PeriodSummary[];
  loadingPeriods: () => boolean;
  
  loading: () => boolean;
  error: () => string | null;
  masterDataStatus: () => MasterDataStatusItem[];
  partialLoadWarnings: () => string[];

  battleRecords: () => BattleRecord[];
  cellRecords: () => CellRecord[];
  enemyDecks: () => EnemyDeckRecord[];
  enemyShips: () => EnemyShipRecord[];
  enemySlotItems: () => EnemySlotItemRecord[];
  mstShips: () => MstShipRecord[];
  mstSlotItems: () => MstSlotItemRecord[];
  
  weaponIconFrames: () => Record<number, WeaponIconFrame>;
  weaponIconMeta: () => { width: number; height: number };
  
  mapFilter: () => string;
  setMapFilter: (filter: string) => void;
  resultFilter: () => string;
  setResultFilter: (filter: string) => void;
  
  // Specific to list/detail
  selectedDetailId: () => string;
  setSelectedDetailId: (id: string) => void;
  selectedDatasetId: () => string;
  setSelectedDatasetId: (id: string) => void;
  selectedBattleIndex: () => number | null;
  setSelectedBattleIndex: (index: number | null) => void;
};
