import { z } from "zod";

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

export type QuestTreeIngestBody = z.infer<typeof QuestTreeIngestBodySchema>;
export type QuestListEntry = NonNullable<QuestTreeIngestBody["quests"]>[number];
