import { z } from "zod";
import { isValidPeriodTagDate } from "../utils/period-tags";
import { PublicIdSchema } from "./public-id";

export const RemodelMaxUpdatedAtRowSchema = z
  .object({ max_updated_at_ms: z.number().nullable().optional() })
  .passthrough();

export const RemodelChangedPeriodRowSchema = z
  .object({
    period_tag: z.string().min(1),
    max_updated_at_ms: z.number().finite(),
  })
  .passthrough();

export const RemodelPeriodTagRowSchema = z
  .object({ period_tag: z.string().min(1) })
  .passthrough();

export const RemodelSlotlistArchiveRowSchema = z.object({
  period_tag: z.string().min(1),
  secretary_ship_master_id: z.number().int(),
  weekday_jst: z.number().int(),
  remodel_id: z.number().int(),
  remodel_step_id: z.number().int(),
  remodel_level: z.number().int(),
  slotitem_master_id: z.number().int(),
  sp_type: z.number().int(),
  req_fuel: z.number().int(),
  req_bull: z.number().int(),
  req_steel: z.number().int(),
  req_bauxite: z.number().int(),
  req_buildkit: z.number().int(),
  req_remodelkit: z.number().int(),
  req_slot_id: z.number().int(),
  req_slot_num: z.number().int(),
  updated_at_ms: z.number().int(),
});

export const RemodelDetailArchiveRowSchema = z.object({
  period_tag: z.string().min(1),
  slotitem_master_id: z.number().int(),
  remodel_id: z.number().int(),
  remodel_step_id: z.number().int(),
  remodel_level: z.number().int(),
  certain_buildkit: z.number().int(),
  certain_remodelkit: z.number().int(),
  req_slot_id: z.number().int().nullable(),
  req_slot_num: z.number().int().nullable(),
  change_flag: z.number().int(),
  req_useitem_id: z.number().int().nullable(),
  req_useitem_id2: z.number().int().nullable(),
  req_useitem_num: z.number().int().nullable(),
  req_useitem_num2: z.number().int().nullable(),
  updated_at_ms: z.number().int(),
});

export const RemodelPeriodSummaryRowSchema = z
  .object({
    period_tag: z.string().min(1),
    row_count: z.number().int().nonnegative(),
    slotitem_count: z.number().int().nonnegative(),
  })
  .passthrough();

export function parseRemodelPeriodSummaryRows(
  value: unknown,
): Array<z.infer<typeof RemodelPeriodSummaryRowSchema>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = RemodelPeriodSummaryRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export const RemodelEffectiveSummaryRowSchema = z
  .object({
    period_tag: z.string().min(1),
    total_rows: z.number().int().nonnegative(),
    slotlist_rows: z.number().int().nonnegative(),
    recovered_from_detail_rows: z.number().int().nonnegative(),
    unresolved_fallback_rows: z.number().int().nonnegative(),
  })
  .passthrough();

export function parseRemodelEffectiveSummaryRows(
  value: unknown,
): Array<z.infer<typeof RemodelEffectiveSummaryRowSchema>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = RemodelEffectiveSummaryRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

type RemodelJsonValue =
  | null
  | boolean
  | number
  | string
  | RemodelJsonValue[]
  | { [key: string]: RemodelJsonValue };

const RemodelJsonValueSchema: z.ZodType<RemodelJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(RemodelJsonValueSchema),
    z.record(RemodelJsonValueSchema),
  ]),
);

export const RemodelDataIngestBodySchema = z.record(
  z.string(),
  RemodelJsonValueSchema,
);

const VALID_EVENT_TYPES = new Set(["slotlist", "detail"]);
const REMODEL_INGEST_SCHEMA_VERSION = 1;

function isValidInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export type ValidatedRemodelDataIngestBody = {
  [key: string]: unknown;
  dataset_id: string;
  request_id: string;
  payload_hash: string;
  event_type: "slotlist" | "detail";
  schema_version: number;
  period_tag: string;
  timestamp_ms: number;
} &
  (
    | {
        event_type: "slotlist";
        secretary_ship_master_id: number;
        weekday_jst: number;
        entries: Array<{
          remodel_id: number;
          slotitem_master_id: number;
          sp_type: number;
          req_fuel: number;
          req_bull: number;
          req_steel: number;
          req_bauxite: number;
          req_buildkit: number;
          req_remodelkit: number;
          req_slot_id: number;
          req_slot_num: number;
          remodel_step_id?: number | null;
          remodel_level: number;
        }>;
      }
    | {
        event_type: "detail";
        slotitem_master_id: number;
        remodel_id: number;
        remodel_step_id?: number | null;
        remodel_level: number;
        certain_buildkit: number;
        certain_remodelkit: number;
        req_slot_id?: number | null;
        req_slot_num?: number | null;
        change_flag: number;
        req_useitem_id?: number | null;
        req_useitem_id2?: number | null;
        req_useitem_num?: number | null;
        req_useitem_num2?: number | null;
      }
  );

export const ValidatedRemodelDataIngestBodySchema =
  RemodelDataIngestBodySchema.superRefine((body, context) => {
    const datasetId = String(body["dataset_id"] ?? "").trim();
    const requestId = String(body["request_id"] ?? "").trim();
    const payloadHash = String(body["payload_hash"] ?? "").trim();
    const eventType = String(body["event_type"] ?? "").trim();
    const schemaVersion = Number(body["schema_version"]);
    const periodTag = String(body["period_tag"] ?? "").trim();
    const timestampMs = Number(body["timestamp_ms"]);

    if (!datasetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset_id"],
        message: "dataset_id is required",
      });
      return;
    }
    if (!PublicIdSchema.safeParse(datasetId).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset_id"],
        message: "dataset_id must be a UUID v4 public_id",
      });
    }
    if (!requestId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["request_id"],
        message: "request_id is required",
      });
      return;
    }
    if (!/^[a-f0-9]{64}$/i.test(payloadHash)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload_hash"],
        message: "payload_hash must be a valid 64-char SHA-256 hex string",
      });
      return;
    }
    if (!VALID_EVENT_TYPES.has(eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event_type"],
        message: "event_type must be one of: slotlist, detail",
      });
      return;
    }
    if (!isValidInt(schemaVersion)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schema_version"],
        message: "schema_version must be an integer",
      });
      return;
    }
    if (schemaVersion !== REMODEL_INGEST_SCHEMA_VERSION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schema_version"],
        message: `unsupported schema_version: ${schemaVersion} (latest=${REMODEL_INGEST_SCHEMA_VERSION})`,
      });
      return;
    }
    if (!isValidPeriodTagDate(periodTag)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period_tag"],
        message: "period_tag must be a valid calendar date",
      });
      return;
    }
    if (!isValidInt(timestampMs) || timestampMs <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timestamp_ms"],
        message: "timestamp_ms must be a positive integer",
      });
      return;
    }

    if (eventType === "slotlist") {
      const secretaryShipMasterId = body["secretary_ship_master_id"];
      if (
        !isValidInt(secretaryShipMasterId) ||
        secretaryShipMasterId <= 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secretary_ship_master_id"],
          message: "secretary_ship_master_id must be a positive integer",
        });
        return;
      }
      const weekdayJst = body["weekday_jst"];
      if (
        !isValidInt(weekdayJst) ||
        weekdayJst < 0 ||
        weekdayJst > 6
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekday_jst"],
          message: "weekday_jst must be 0-6",
        });
        return;
      }
      const entries = body["entries"];
      if (!Array.isArray(entries) || entries.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries"],
          message: "entries array is required and must not be empty",
        });
        return;
      }
      if (entries.length > 2000) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries"],
          message: "entries array exceeds maximum of 2000 elements",
        });
        return;
      }

      const intFields = [
        "remodel_id",
        "slotitem_master_id",
        "sp_type",
        "req_fuel",
        "req_bull",
        "req_steel",
        "req_bauxite",
        "req_buildkit",
        "req_remodelkit",
        "req_slot_id",
        "req_slot_num",
      ];
      for (const [index, rawEntry] of entries.entries()) {
        const entry = asRecord(rawEntry);
        if (
          entry["remodel_step_id"] != null &&
          !isValidInt(entry["remodel_step_id"])
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["entries", index, "remodel_step_id"],
            message: `entries[${index}].remodel_step_id must be an integer or null`,
          });
          return;
        }
        if (
          entry["remodel_level"] != null &&
          !isValidInt(entry["remodel_level"])
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["entries", index, "remodel_level"],
            message: `entries[${index}].remodel_level must be an integer or null`,
          });
          return;
        }
        if (!isValidInt(entry["remodel_level"])) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["entries", index, "remodel_level"],
            message: `entries[${index}].remodel_level is required and must be an integer`,
          });
          return;
        }
        if (entry["remodel_level"] < 0 || entry["remodel_level"] > 10) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["entries", index, "remodel_level"],
            message: `entries[${index}].remodel_level must be between 0 and 10`,
          });
          return;
        }
        for (const field of intFields) {
          if (!isValidInt(entry[field])) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["entries", index, field],
              message: `entries[${index}].${field} must be an integer`,
            });
            return;
          }
        }
      }
      return;
    }

    const slotitemMasterId = body["slotitem_master_id"];
    if (!isValidInt(slotitemMasterId) || slotitemMasterId <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slotitem_master_id"],
        message: "slotitem_master_id must be a positive integer",
      });
      return;
    }
    if (!isValidInt(body["remodel_id"])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remodel_id"],
        message: "remodel_id must be an integer",
      });
      return;
    }
    if (
      body["remodel_step_id"] != null &&
      !isValidInt(body["remodel_step_id"])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remodel_step_id"],
        message: "remodel_step_id must be an integer or null",
      });
      return;
    }
    if (
      body["remodel_level"] != null &&
      !isValidInt(body["remodel_level"])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remodel_level"],
        message: "remodel_level must be an integer or null",
      });
      return;
    }
    if (!isValidInt(body["remodel_level"])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remodel_level"],
        message: "remodel_level is required and must be an integer",
      });
      return;
    }
    const remodelLevel = body["remodel_level"];
    if (!isValidInt(remodelLevel)) {
      return;
    }
    if (remodelLevel < 0 || remodelLevel > 10) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remodel_level"],
        message: "remodel_level must be between 0 and 10",
      });
      return;
    }
    if (
      !isValidInt(body["certain_buildkit"]) ||
      !isValidInt(body["certain_remodelkit"])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["certain_buildkit"],
        message: "certain_buildkit and certain_remodelkit must be integers",
      });
      return;
    }
    if (!isValidInt(body["change_flag"])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["change_flag"],
        message: "change_flag must be an integer",
      });
      return;
    }
    if (
      (body["req_slot_id"] != null && !isValidInt(body["req_slot_id"])) ||
      (body["req_slot_num"] != null && !isValidInt(body["req_slot_num"]))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["req_slot_id"],
        message: "req_slot_id and req_slot_num must be integers or null",
      });
      return;
    }
    for (const field of [
      "req_useitem_id",
      "req_useitem_id2",
      "req_useitem_num",
      "req_useitem_num2",
    ]) {
      if (body[field] != null && !isValidInt(body[field])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be an integer or null`,
        });
        return;
      }
    }
  })
  .transform((body) => {
    const common = {
      ...body,
      dataset_id: String(body["dataset_id"] ?? "").trim(),
      request_id: String(body["request_id"] ?? "").trim(),
      payload_hash: String(body["payload_hash"] ?? "").trim(),
      schema_version: Number(body["schema_version"]),
      period_tag: String(body["period_tag"] ?? "").trim(),
      timestamp_ms: Number(body["timestamp_ms"]),
    };
    if (String(body["event_type"] ?? "").trim() === "slotlist") {
      return {
        ...common,
        event_type: "slotlist" as const,
        secretary_ship_master_id: body["secretary_ship_master_id"] as number,
        weekday_jst: body["weekday_jst"] as number,
        entries: body["entries"] as Extract<
          ValidatedRemodelDataIngestBody,
          { event_type: "slotlist" }
        >["entries"],
      } as ValidatedRemodelDataIngestBody;
    }
    return {
      ...common,
      event_type: "detail" as const,
      slotitem_master_id: body["slotitem_master_id"] as number,
      remodel_id: body["remodel_id"] as number,
      remodel_step_id: body["remodel_step_id"] as number | null | undefined,
      remodel_level: body["remodel_level"] as number,
      certain_buildkit: body["certain_buildkit"] as number,
      certain_remodelkit: body["certain_remodelkit"] as number,
      req_slot_id: body["req_slot_id"] as number | null | undefined,
      req_slot_num: body["req_slot_num"] as number | null | undefined,
      change_flag: body["change_flag"] as number,
      req_useitem_id: body["req_useitem_id"] as number | null | undefined,
      req_useitem_id2: body["req_useitem_id2"] as number | null | undefined,
      req_useitem_num: body["req_useitem_num"] as number | null | undefined,
      req_useitem_num2: body["req_useitem_num2"] as number | null | undefined,
    } as ValidatedRemodelDataIngestBody;
  });

export type RemodelDataIngestBody = z.infer<
  typeof RemodelDataIngestBodySchema
>;
