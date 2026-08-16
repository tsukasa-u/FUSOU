export type JsonRecord = Record<string, unknown>;

export function jsonRecordOf(value: unknown): JsonRecord | null {
  return isJsonRecord(value) ? value : null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function jsonRecordsOf(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = jsonRecordOf(item);
        return record ? [record] : [];
      })
    : [];
}

export function firstJsonRecordOf(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) return jsonRecordOf(value[0]);
  return jsonRecordOf(value);
}

export function unknownArrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export type NumericValueStatus = "valid" | "missing" | "invalid";

export type NumericValueResult = {
  value: number | null;
  status: NumericValueStatus;
};

export function parseFiniteNumber(value: unknown): NumericValueResult {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return { value: null, status: "missing" };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { value, status: "valid" }
      : { value: null, status: "invalid" };
  }
  if (typeof value !== "string") {
    return { value: null, status: "invalid" };
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? { value: parsed, status: "valid" }
    : { value: null, status: "invalid" };
}

export function nullableNumberArray(value: unknown): Array<number | null> {
  return Array.isArray(value)
    ? value.map((item) => parseFiniteNumber(item).value)
    : [];
}

export function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function safeNumber(value: unknown, fallback = 0): number {
  return parseFiniteNumber(value).value ?? fallback;
}

export function safeNumberOrNull(value: unknown): number | null {
  return parseFiniteNumber(value).value;
}

export function safeNumberArray(value: unknown): number[] {
  return unknownArrayOf(value).flatMap((item) => {
    const parsed = safeNumberOrNull(item);
    return parsed === null ? [] : [parsed];
  });
}

export function recordArrayAt(
  record: JsonRecord | null | undefined,
  key: string,
): JsonRecord[] {
  return jsonRecordsOf(record?.[key]);
}
