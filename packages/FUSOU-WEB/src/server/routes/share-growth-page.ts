import {
  buildShareBadRequestResponse,
  buildSharePageResponse,
} from "@/server/routes/share-page-common";

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function isSafeToken(raw: string | null): raw is string {
  if (!raw) return false;
  return /^[A-Za-z0-9._-]+$/.test(raw);
}

export async function handleShareGrowthRequest(
  request: Request,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const periodTag = requestUrl.searchParams.get("period_tag");
  const tableVersion = requestUrl.searchParams.get("table_version");
  const masterId = parsePositiveInt(requestUrl.searchParams.get("master_id"));

  if (
    !isSafeToken(periodTag) ||
    !isSafeToken(tableVersion) ||
    masterId == null
  ) {
    return buildShareBadRequestResponse("invalid growth share parameters");
  }

  const targetUrl = new URL("/ship-growth", requestUrl.origin);
  targetUrl.searchParams.set("period_tag", periodTag);
  targetUrl.searchParams.set("table_version", tableVersion);
  targetUrl.searchParams.set("master_id", String(masterId));

  return buildSharePageResponse(request, targetUrl.toString(), {
    title: "FUSOU パラメータ推移",
    description: `艦ID ${masterId} のパラメータ推移 (期間 ${periodTag}, v${tableVersion})`,
  });
}
