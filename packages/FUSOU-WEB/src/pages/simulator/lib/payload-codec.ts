// ── Shared payload codec helpers ──

export function decodePayloadBase64(data: string): unknown {
  // v2 UTF-8-safe decode path
  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    // Backward compatibility: older links used direct atob(JSON)
    return JSON.parse(atob(data));
  }
}

export function decodePayloadBase64Safe(
  data: string,
): { ok: true; payload: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, payload: decodePayloadBase64(data) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Base64 decode failed",
    };
  }
}

const PAYLOAD_TOPLEVEL_KEYS = new Set<string>([
  "fleet1",
  "fleet2",
  "fleet3",
  "fleet4",
  "airBases",
  "snapshotShips",
  "snapshotSlotItems",
  "s3s",
  "s8s",
  "d8k",
  "masterData",
  "combinedFleetType",
]);

export function isLikelySimulatorPayload(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const obj = payload as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (PAYLOAD_TOPLEVEL_KEYS.has(k)) return true;
  }
  return false;
}

export function pickNumericRecord(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
