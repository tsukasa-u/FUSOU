import {
  buildShareBadRequestResponse,
  buildSharePageResponse,
} from "@/server/routes/share-page-common";

function isSafeBattleId(raw: string | null): raw is string {
  if (!raw) return false;
  return /^[A-Za-z0-9-]{8,80}$/.test(raw);
}

export async function handleShareBattleRequest(
  request: Request,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const battleId = requestUrl.searchParams.get("id");
  if (!isSafeBattleId(battleId)) {
    return buildShareBadRequestResponse("invalid battle id");
  }

  const view = requestUrl.searchParams.get("view");
  const normalizedView = view === "timeline" || view === "phase" ? view : null;
  const separators = requestUrl.searchParams.get("separators") === "1";
  const periodTag = requestUrl.searchParams.get("period_tag")?.trim();
  const tableVersion = requestUrl.searchParams.get("table_version")?.trim();

  const targetUrl = new URL(
    `/battles/${encodeURIComponent(battleId)}`,
    requestUrl.origin,
  );
  if (periodTag) {
    targetUrl.searchParams.set("period_tag", periodTag);
  }
  if (tableVersion) {
    targetUrl.searchParams.set("table_version", tableVersion);
  }
  if (normalizedView) {
    targetUrl.searchParams.set("view", normalizedView);
  }
  if (normalizedView === "timeline" && separators) {
    targetUrl.searchParams.set("separators", "1");
  }

  return buildSharePageResponse(request, targetUrl.toString(), {
    title: "FUSOU 戦闘詳細",
    description: `戦闘詳細共有リンク (${battleId.slice(0, 8)}...)`,
  });
}
