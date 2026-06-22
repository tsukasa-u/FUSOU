export type PeriodSummary = {
  period_tag: string;
  table_version: string | null;
};

export type MasterDataStatusItem = {
  name: string;
  status: "pending" | "success" | "failed";
  detail?: string;
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

  battleRecords: () => any[]; // Typed loosely here to avoid circular imports, will cast in panels
  cellRecords: () => any[];
  enemyDecks: () => any[];
  enemyShips: () => any[];
  enemySlotItems: () => any[];
  mstShips: () => any[];
  mstSlotItems: () => any[];
  
  weaponIconFrames: () => Record<number, any>;
  weaponIconMeta: () => { width: number; height: number };
  
  mapFilter: () => string;
  setMapFilter: (filter: string) => void;
  resultFilter: () => string;
  setResultFilter: (filter: string) => void;
  
  // Specific to list/detail
  selectedDetailId: () => string;
  setSelectedDetailId: (id: string) => void;
};
