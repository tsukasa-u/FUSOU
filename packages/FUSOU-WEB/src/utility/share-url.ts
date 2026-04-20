export type ShareDetailSelection =
  | { kind: "ship"; id: number }
  | { kind: "equip"; id: number };

export type ShareGrowthSelection = {
  periodTag: string;
  tableVersion: string;
  masterId: number;
};

export type ShareBattleSelection = {
  battleId: string;
  view?: "phase" | "timeline";
  separators?: boolean;
};

export function buildShareDetailUrl(
  origin: string,
  selection: ShareDetailSelection,
): string {
  const shareUrl = new URL("/share/detail", origin);
  shareUrl.searchParams.set("key", `${selection.kind}:${selection.id}`);
  return shareUrl.toString();
}

export function buildShareGrowthUrl(
  origin: string,
  selection: ShareGrowthSelection,
): string {
  const shareUrl = new URL("/share/growth", origin);
  shareUrl.searchParams.set("period_tag", selection.periodTag);
  shareUrl.searchParams.set("table_version", selection.tableVersion);
  shareUrl.searchParams.set("master_id", String(selection.masterId));
  return shareUrl.toString();
}

export function buildShareBattleUrl(
  origin: string,
  selection: ShareBattleSelection,
): string {
  const shareUrl = new URL("/share/battle", origin);
  shareUrl.searchParams.set("id", selection.battleId);
  if (selection.view) {
    shareUrl.searchParams.set("view", selection.view);
  }
  if (selection.separators) {
    shareUrl.searchParams.set("separators", "1");
  }
  return shareUrl.toString();
}

export async function copyTextWithFallback(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
