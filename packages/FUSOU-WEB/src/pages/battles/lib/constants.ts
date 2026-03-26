export const PHASE_NAMES: Record<string, string> = {
  AirBaseAssult: "基地航空隊突撃",
  CarrierBaseAssault: "空母機動部隊",
  AirBaseAirAttack: "基地航空隊",
  OpeningAirAttack: "開幕航空戦",
  SupportAttack: "支援攻撃",
  OpeningTaisen: "開幕対潜",
  OpeningRaigeki: "開幕雷撃",
  Hougeki: "砲撃戦",
  ClosingRaigeki: "閉幕雷撃",
  FriendlyForceAttack: "友軍艦隊",
  MidnightHougeki: "夜戦",
};

export const FORMATION_NAMES: Record<number, string> = {
  1: "単縦陣",
  2: "複縦陣",
  3: "輪形陣",
  4: "梯形陣",
  5: "単横陣",
  6: "警戒陣",
  11: "第一警戒航行序列",
  12: "第二警戒航行序列",
  13: "第三警戒航行序列",
  14: "第四警戒航行序列",
};

export const AIR_STATE: Record<number, { label: string; cls: string }> = {
  0: { label: "航空均衡", cls: "text-warning" },
  1: { label: "制空権確保", cls: "text-success" },
  2: { label: "航空優勢", cls: "text-info" },
  3: { label: "航空劣勢", cls: "text-error" },
  4: { label: "制空権喪失", cls: "text-error" },
};

export const RANK_COLORS: Record<string, string> = {
  S: "text-success",
  A: "text-info",
  B: "text-warning",
  C: "text-error",
  D: "text-error",
  E: "text-error",
};

export const FRIEND_COLORS = [
  "#3b82f6", "#06b6d4", "#0ea5e9", "#6366f1", "#8b5cf6", "#38bdf8",
];

export const ENEMY_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#ec4899", "#f43f5e", "#fb923c",
];

export const DAMAGE_ZONES = [
  { from: 0, to: 25, fill: "#ef4444", label: "大破" },
  { from: 25, to: 50, fill: "#f97316", label: "中破" },
  { from: 50, to: 75, fill: "#eab308", label: "小破" },
  { from: 75, to: 100, fill: "#22c55e", label: "" },
] as const;
