// ── Shared payload codec helpers ──
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function jsonRecordOf(value: unknown): Record<string, unknown> | null {
  return isJsonRecord(value) ? value : null;
}

export function jsonRecordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = jsonRecordOf(item);
        return record ? [record] : [];
      })
    : [];
}

export function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nullableNumberArray(value: unknown): Array<number | null> {
  return Array.isArray(value)
    ? value.map((item) => finiteNumberOrNull(item))
    : [];
}

export function combinedFleetTypeOrDefault(value: unknown): 0 | 1 | 2 | 3 {
  switch (finiteNumberOrNull(value)) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    default:
      return 0;
  }
}

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
  const obj = jsonRecordOf(payload);
  if (!obj) return false;

  for (const k of Object.keys(obj)) {
    if (PAYLOAD_TOPLEVEL_KEYS.has(k)) return true;
  }
  return false;
}

export function pickNumericRecord(input: unknown): Record<string, number> | undefined {
  const record = jsonRecordOf(input);
  if (!record) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
