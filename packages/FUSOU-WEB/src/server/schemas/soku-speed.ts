import { z } from "zod";
import { PublicIdSchema } from "./public-id";
import { isValidPeriodTagDate } from "../utils/period-tags";

export const SokuObservedSpeedSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
]);

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
    soku_observed: SokuObservedSpeedSchema,
    slots_json: z.string(),
    exslot_json: z.string().nullable(),
  })
  .passthrough();

const SokuSpeedAggregateEntrySchema = z
  .object({
    soku_observed: SokuObservedSpeedSchema,
    item_ids: z.number().int().positive().array(),
  })
  .passthrough();

export const SokuSpeedUpgradeResponseSchema = z
  .object({
    ok: z.literal(true),
    period_tag: z.string().min(1).nullable(),
    table_version: z.string().min(1).nullable(),
    data: z.record(SokuSpeedAggregateEntrySchema.array()),
  })
  .passthrough()
  .superRefine((response, context) => {
    if ((response.period_tag === null) !== (response.table_version === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period_tag"],
        message: "period_tag and table_version must both be null or present",
      });
    }
  });

export type SokuSpeedUpgradeResponse = z.infer<
  typeof SokuSpeedUpgradeResponseSchema
>;

export function parseSokuSpeedUpgradeResponse(
  value: unknown,
): SokuSpeedUpgradeResponse | null {
  const result = SokuSpeedUpgradeResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const OptionalStringInputSchema = z.preprocess(
  (value) => (value == null ? undefined : String(value).trim()),
  z.string().optional(),
);

const OptionalNumberInputSchema = z.preprocess(
  (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  },
  z.number().finite().optional(),
);

const OptionalBooleanInputSchema = z.preprocess(
  (value) => (typeof value === "boolean" ? value : undefined),
  z.boolean().optional(),
);

const SokuSpeedSlotInputSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      slotitem_id: OptionalNumberInputSchema,
      locked: OptionalBooleanInputSchema,
      level: OptionalNumberInputSchema,
      alv: OptionalNumberInputSchema,
    })
    .passthrough(),
);

const SokuSpeedShipInputSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      master_id: OptionalNumberInputSchema,
      lv: OptionalNumberInputSchema,
      soku_observed: OptionalNumberInputSchema,
      slots: z.preprocess(
        (value) => (Array.isArray(value) ? value : []),
        z.array(SokuSpeedSlotInputSchema),
      ),
      exslot: z.preprocess(
        (value) => {
          if (value === undefined) return undefined;
          if (value === null) return null;
          return isRecord(value) ? value : {};
        },
        SokuSpeedSlotInputSchema.nullable().optional(),
      ),
    })
    .passthrough(),
);

export const SokuSpeedIngestBodySchema = z
  .object({
    dataset_id: OptionalStringInputSchema,
    dataset_token: OptionalStringInputSchema,
    request_id: OptionalStringInputSchema,
    payload_hash: OptionalStringInputSchema,
    event_type: OptionalStringInputSchema,
    period_tag: OptionalStringInputSchema,
    table_version: OptionalStringInputSchema,
    timestamp_ms: OptionalNumberInputSchema,
    ships: z.preprocess(
      (value) => (Array.isArray(value) ? value : undefined),
      z.array(SokuSpeedShipInputSchema).optional(),
    ),
    content_hash: OptionalStringInputSchema,
    file_size: OptionalNumberInputSchema,
  })
  .passthrough();

function isValidInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

export const ValidatedSokuSpeedIngestBodySchema =
  SokuSpeedIngestBodySchema.superRefine((body, context) => {
    const datasetId = body.dataset_id ?? "";
    const requestId = body.request_id ?? "";
    const payloadHash = body.payload_hash ?? "";
    const eventType = body.event_type ?? "";
    const periodTag = body.period_tag ?? "";
    const tableVersion = body.table_version ?? "";

    if (!datasetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset_id"],
        message: "dataset_id is required",
      });
    } else if (!PublicIdSchema.safeParse(datasetId).success) {
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

    if (!body.ships || body.ships.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ships"],
        message: "ships array is required and must not be empty",
      });
      return;
    }

    for (const [index, ship] of body.ships.entries()) {
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
        !ship.slots ||
        ship.slots.some((slot) => {
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
        const exslot = ship.exslot;
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

      const hasSlots = ship.slots.length > 0;
      const hasExslot = ship.exslot !== undefined && ship.exslot !== null;
      if (!hasSlots && !hasExslot) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ships", index],
          message: `ships[${index}] has no slots or exslot (speed synergy requires at least one item)`,
        });
      }
    }
  })
  .transform((body) => ({
    ...body,
    dataset_id: body.dataset_id!,
    request_id: body.request_id!,
    payload_hash: body.payload_hash!,
    event_type: body.event_type!,
    period_tag: body.period_tag!,
    table_version: body.table_version!,
    ships: body.ships!.map((ship) => ({
      master_id: ship.master_id!,
      lv: ship.lv!,
      soku_observed: ship.soku_observed!,
      slots: ship.slots.map((slot) => ({
        slotitem_id: slot.slotitem_id!,
        locked: slot.locked!,
        level: slot.level!,
        alv: slot.alv!,
      })),
      exslot:
        ship.exslot == null
          ? null
          : {
              slotitem_id: ship.exslot.slotitem_id!,
              locked: ship.exslot.locked!,
              level: ship.exslot.level!,
              alv: ship.exslot.alv!,
            },
    })),
  }));

export type SokuSpeedIngestBody = z.infer<typeof SokuSpeedIngestBodySchema>;
export type ValidatedSokuSpeedIngestBody = z.infer<
  typeof ValidatedSokuSpeedIngestBodySchema
>;
