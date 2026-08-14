import { z } from "zod";
import { isValidPeriodTagDate } from "../utils/period-tags";

export const LatestSokuSpeedPeriodRowSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
  })
  .passthrough();

export const SokuSpeedSlotSchema = z
  .object({ slotitem_id: z.number().int().positive() })
  .passthrough();

export const SokuSpeedSlotRowsSchema = SokuSpeedSlotSchema.array();
export const SokuSpeedExslotSchema = SokuSpeedSlotSchema.nullable();

export const SokuSpeedObservationRowSchema = z
  .object({
    master_id: z.number().int().positive(),
    soku_observed: z.number(),
    slots_json: z.string(),
    exslot_json: z.string().nullable(),
  })
  .passthrough();

export type SokuSpeedObservationRow = z.infer<
  typeof SokuSpeedObservationRowSchema
>;

export function parseSokuSpeedObservationRows(
  value: unknown,
): SokuSpeedObservationRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = SokuSpeedObservationRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export const SokuSpeedIngestBodySchema = z
  .object({
    dataset_id: z.unknown().optional(),
    dataset_token: z.unknown().optional(),
    request_id: z.unknown().optional(),
    payload_hash: z.unknown().optional(),
    event_type: z.unknown().optional(),
    period_tag: z.unknown().optional(),
    table_version: z.unknown().optional(),
    ships: z.unknown().optional(),
    content_hash: z.unknown().optional(),
    file_size: z.unknown().optional(),
  })
  .passthrough();

function isValidInteger(value: unknown): value is number {
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

export const ValidatedSokuSpeedIngestBodySchema =
  SokuSpeedIngestBodySchema.superRefine((body, context) => {
    const datasetId = String(body.dataset_id ?? "").trim();
    const requestId = String(body.request_id ?? "").trim();
    const payloadHash = String(body.payload_hash ?? "").trim();
    const eventType = String(body.event_type ?? "").trim();
    const periodTag = String(body.period_tag ?? "");
    const tableVersion = String(body.table_version ?? "");

    if (!datasetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset_id"],
        message: "dataset_id is required",
      });
    } else if (!/^[a-f0-9]{64}$/i.test(datasetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset_id"],
        message: "dataset_id must be a 64-character SHA-256 hex string",
      });
    }
    if (!requestId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["request_id"],
        message: "request_id is required",
      });
    }
    if (!/^[a-f0-9]{64}$/i.test(payloadHash)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload_hash"],
        message: "payload_hash must be a valid 64-char SHA-256 hex string",
      });
    }
    if (eventType !== "snapshot") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event_type"],
        message: 'event_type must be "snapshot"',
      });
    }
    if (!body.period_tag || !isValidPeriodTagDate(periodTag)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period_tag"],
        message: "Invalid period_tag (expected YYYY-MM-DD)",
      });
    }
    if (!body.table_version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["table_version"],
        message: "table_version is required",
      });
    } else if (!/^\d+\.\d+(?:\.\d+)?$/.test(tableVersion)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["table_version"],
        message:
          "table_version must be in MAJOR.MINOR or MAJOR.MINOR.PATCH format (e.g. '0.5.1')",
      });
    }

    if (!Array.isArray(body.ships) || body.ships.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ships"],
        message: "ships array is required and must not be empty",
      });
      return;
    }

    for (const [index, rawShip] of body.ships.entries()) {
      const ship = asRecord(rawShip);
      const masterId = ship.master_id;
      const level = ship.lv;
      const observedSpeed = ship.soku_observed;
      if (
        !isValidInteger(masterId) ||
        !isValidInteger(level) ||
        !isValidInteger(observedSpeed)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index],
          message: `ships[${index}] has invalid numeric fields`,
        });
        continue;
      }
      if (![5, 10, 15, 20].includes(observedSpeed)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index, "soku_observed"],
          message: `ships[${index}].soku_observed must be one of 5, 10, 15, 20`,
        });
      }
      if (masterId <= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index, "master_id"],
          message: `ships[${index}].master_id must be > 0`,
        });
      }
      if (level < 1 || level > 300) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index, "lv"],
          message: `ships[${index}].lv must be between 1 and 300`,
        });
      }

      if (
        !Array.isArray(ship.slots) ||
        ship.slots.some((rawSlot) => {
          const slot = asRecord(rawSlot);
          return (
            !isValidInteger(slot.slotitem_id) ||
            slot.slotitem_id <= 0 ||
            typeof slot.locked !== "boolean" ||
            !isValidInteger(slot.level) ||
            !isValidInteger(slot.alv)
          );
        })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index, "slots"],
          message: `ships[${index}].slots has invalid fields`,
        });
      }

      if (ship.exslot !== undefined && ship.exslot !== null) {
        const exslot = asRecord(ship.exslot);
        if (
          !isValidInteger(exslot.slotitem_id) ||
          exslot.slotitem_id <= 0 ||
          typeof exslot.locked !== "boolean" ||
          !isValidInteger(exslot.level) ||
          !isValidInteger(exslot.alv)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ships", index, "exslot"],
            message: `ships[${index}].exslot has invalid fields`,
          });
        }
      }

      const hasSlots = Array.isArray(ship.slots) && ship.slots.length > 0;
      const hasExslot = ship.exslot !== undefined && ship.exslot !== null;
      if (!hasSlots && !hasExslot) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index],
          message: `ships[${index}] has no slots or exslot (speed synergy requires at least one item)`,
        });
      }
    }
  });

export type SokuSpeedIngestBody = z.infer<typeof SokuSpeedIngestBodySchema>;
