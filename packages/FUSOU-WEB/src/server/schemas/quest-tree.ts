import { z } from "zod";

const ALLOWED_EVENT_TYPES = new Set(["snapshot", "start", "stop", "complete"]);

function toInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

const OptionalIntegerFieldSchema = z.preprocess(
  toInteger,
  z.number().int().optional(),
);

const OptionalTrimmedStringFieldSchema = z.preprocess(
  (value) => (value == null ? undefined : String(value).trim()),
  z.string().optional(),
);

const OptionalStringFieldSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);

const QuestListEntrySchema = z.preprocess(
  (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
  z
    .object({
      quest_id: OptionalIntegerFieldSchema,
      type: OptionalIntegerFieldSchema,
      category: OptionalIntegerFieldSchema,
      label_type: OptionalIntegerFieldSchema,
      title: OptionalStringFieldSchema,
      detail: OptionalStringFieldSchema,
    })
    .passthrough(),
);

export const QuestIngestEventIdRowSchema = z
  .object({
    id: z.number().int(),
  })
  .passthrough()
  .nullable();

export const QuestTreeIngestBodySchema = z
  .object({
    dataset_id: OptionalTrimmedStringFieldSchema,
    dataset_token: z.unknown().optional(),
    request_id: OptionalTrimmedStringFieldSchema,
    payload_hash: OptionalTrimmedStringFieldSchema,
    event_type: OptionalTrimmedStringFieldSchema,
    timestamp_ms: OptionalIntegerFieldSchema,
    period_tag: OptionalTrimmedStringFieldSchema,
    table_version: OptionalTrimmedStringFieldSchema,
    page_no: OptionalIntegerFieldSchema,
    quest_id: OptionalIntegerFieldSchema,
    quests: z.preprocess(
      (value) => (Array.isArray(value) ? value : []),
      z.array(QuestListEntrySchema),
    ).optional(),
    content_hash: z.unknown().optional(),
    file_size: z.unknown().optional(),
  })
  .passthrough();

export const ValidatedQuestTreeIngestBodySchema =
  QuestTreeIngestBodySchema.superRefine((body, context) => {
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
    if (!payloadHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload_hash"],
        message: "payload_hash is required",
      });
    }
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event_type"],
        message: "event_type must be one of: snapshot, start, stop, complete",
      });
    }
    if (!periodTag) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period_tag"],
        message: "period_tag is required",
      });
    }
    if (!tableVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["table_version"],
        message: "table_version is required",
      });
    }
  });

export type QuestTreeIngestBody = z.infer<typeof QuestTreeIngestBodySchema>;
export type QuestListEntry = NonNullable<QuestTreeIngestBody["quests"]>[number];
