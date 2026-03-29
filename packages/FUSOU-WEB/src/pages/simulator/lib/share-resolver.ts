// ── Share URL resolution: normalize any URL/key input to a fleet payload ──

import {
  decodePayloadBase64Safe,
  isLikelySimulatorPayload,
} from "./payload-codec";
import type { ViewerEntry } from "./viewer-workspace";

type ResolvedShare =
  | {
      ok: true;
      payloadKind: "exportedFleet" | "fleetSnapshot";
      payload: unknown;
      sourceType: "shareKey" | "simulatorUrl";
      sourceValue: string;
    }
  | { ok: false; error: string };

type ResolveApiResponse = {
  ok: boolean;
  key?: string;
  originalUrl?: string;
  dataPayload?: Record<string, unknown>;
  snapshotPayload?: Record<string, unknown> | null;
  error?: string;
};

/** Extract a 16-char hex key from a short URL or a bare key string. */
function extractShortKey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{16}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/^\/s\/([0-9a-f]{16})$/);
    if (match) return match[1];
  } catch {
    /* not a URL */
  }
  return null;
}

/** Resolve a simulator URL with a `data=` param directly — no network needed. */
function resolveSimulatorUrlDirectly(input: string): ResolvedShare | null {
  try {
    const parsed = new URL(input.trim());
    if (
      !(
        parsed.pathname === "/simulator" ||
        parsed.pathname.startsWith("/simulator/")
      )
    ) {
      return null;
    }
    const dataParam = parsed.searchParams.get("data");
    if (!dataParam) return null;
    const decoded = decodePayloadBase64Safe(dataParam);
    if (!decoded.ok) {
      return { ok: false, error: `データの復元に失敗しました: ${decoded.error}` };
    }
    const payload = decoded.payload;
    if (!isLikelySimulatorPayload(payload)) {
      return { ok: false, error: "共有データの形式が不正です" };
    }
    return {
      ok: true,
      payloadKind: "exportedFleet",
      payload,
      sourceType: "simulatorUrl",
      sourceValue: parsed.toString(),
    };
  } catch {
    return null;
  }
}

/** Resolve a short key via `GET /api/shorten/resolve/:key`. */
async function resolveViaApi(key: string): Promise<ResolvedShare> {
  let res: Response;
  try {
    res = await fetch(`/api/shorten/resolve/${encodeURIComponent(key)}`);
  } catch {
    return { ok: false, error: "ネットワークエラー" };
  }

  if (!res.ok) {
    if (res.status === 404) return { ok: false, error: "このキーは見つかりません" };
    return { ok: false, error: `APIエラー (${res.status})` };
  }

  let data: ResolveApiResponse;
  try {
    data = (await res.json()) as ResolveApiResponse;
  } catch {
    return { ok: false, error: "APIレスポンスの形式が不正です" };
  }

  if (!data.ok || !data.dataPayload) {
    return { ok: false, error: data.error ?? "解決に失敗しました" };
  }

  // Merge snapshotPayload into the data payload when present.
  const payload: Record<string, unknown> = { ...data.dataPayload };
  if (data.snapshotPayload) {
    if (data.snapshotPayload.snapshotShips && !payload.snapshotShips) {
      payload.snapshotShips = data.snapshotPayload.snapshotShips;
    }
    if (data.snapshotPayload.snapshotSlotItems && !payload.snapshotSlotItems) {
      payload.snapshotSlotItems = data.snapshotPayload.snapshotSlotItems;
    }
  }

  if (!isLikelySimulatorPayload(payload)) {
    return { ok: false, error: "共有データの形式が不正です" };
  }

  return {
    ok: true,
    payloadKind: "exportedFleet",
    payload,
    sourceType: "shareKey",
    sourceValue: key,
  };
}

/**
 * Resolve an arbitrary user input (short URL, short key, or full simulator URL)
 * to a ViewerEntry-compatible payload object.
 */
export async function resolveShareInput(input: string): Promise<ResolvedShare> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "入力が空です" };

  // 1. Short key or short URL (e.g. https://fusou.dev/s/<key>)
  const shortKey = extractShortKey(trimmed);
  if (shortKey) return resolveViaApi(shortKey);

  // 2. Full simulator URL with `data=` param (decode locally, no API needed)
  const direct = resolveSimulatorUrlDirectly(trimmed);
  if (direct) return direct;

  return {
    ok: false,
    error: "有効な共有URLまたはキーを入力してください",
  };
}

// Re-export the type for callers that want to use it without importing viewer-workspace.
export type { ViewerEntry };
